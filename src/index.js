#!/usr/bin/env node
'use strict';

/**
 * MiCompress GitHub Action entry point.
 *
 * Deliberately written against the raw Actions runner contract (INPUT_* env
 * vars, $GITHUB_OUTPUT, $GITHUB_STEP_SUMMARY, ::error:: commands) rather than
 * @actions/core, so the action stays dependency-free and needs no bundling
 * step — the same reason the CLI this vendors has no dependencies.
 */

const fs = require('fs');
const path = require('path');
const { compressFile, CompressError, DEFAULT_BASE, UTM } = require('./api');

function getInput(name, fallback) {
  // The runner uppercases the input name and replaces spaces with underscores.
  const raw = process.env['INPUT_' + name.toUpperCase().replace(/ /g, '_')];
  if (raw == null || raw === '') return fallback;
  return raw.trim();
}

function getBooleanInput(name, fallback) {
  const raw = getInput(name, null);
  if (raw == null) return fallback;
  return /^(true|1|yes)$/i.test(raw);
}

function setOutput(name, value) {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) return; // running outside Actions (local test)
  // Delimited form is required: values may contain newlines.
  const delim = 'ghadelimiter_' + Math.random().toString(36).slice(2);
  fs.appendFileSync(file, `${name}<<${delim}\n${value}\n${delim}\n`);
}

function appendSummary(md) {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) return;
  try { fs.appendFileSync(file, md); } catch { /* summary is best-effort */ }
}

function logError(msg) { process.stdout.write(`::error::${msg}\n`); }
function logWarning(msg) { process.stdout.write(`::warning::${msg}\n`); }

/** Split a multi-line / comma-separated input into a clean file list. */
function parseFileList(raw) {
  return String(raw || '')
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function humanSize(n) {
  if (n == null) return '?';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)}${u[i]}`;
}

async function main() {
  const files = parseFileList(getInput('files'));
  if (files.length === 0) {
    logError('No files given. Set the `files` input to one or more paths.');
    return 1;
  }

  const preset = getInput('preset', 'recommended');
  if (!['lossless', 'recommended', 'extreme'].includes(preset)) {
    logError(`Invalid preset "${preset}" (use lossless, recommended or extreme).`);
    return 1;
  }

  const maxWidthRaw = getInput('max-width', null);
  const maxWidth = maxWidthRaw ? parseInt(maxWidthRaw, 10) : null;
  if (maxWidthRaw && (!Number.isFinite(maxWidth) || maxWidth <= 0)) {
    logError(`Invalid max-width "${maxWidthRaw}" — expected a positive number.`);
    return 1;
  }

  const outputDir = getInput('output-dir', null);
  const token = getInput('token', null);
  const failOnError = getBooleanInput('fail-on-error', true);
  const baseUrl = getInput('api', DEFAULT_BASE);

  if (outputDir) fs.mkdirSync(outputDir, { recursive: true });

  const rows = [];
  let failed = 0;
  let totalIn = 0;
  let totalOut = 0;

  for (const file of files) {
    try {
      const { buffer, meta } = await compressFile(file, { preset, maxWidth, token, baseUrl });
      const dest = outputDir ? path.join(outputDir, path.basename(file)) : file;
      fs.writeFileSync(dest, buffer);
      totalIn += meta.inputSize || 0;
      totalOut += meta.outputSize || 0;
      rows.push({ file, ok: true, from: meta.inputSize, to: meta.outputSize, pct: meta.savedPercent });
      process.stdout.write(
        `✔ ${file}  ${humanSize(meta.inputSize)} → ${humanSize(meta.outputSize)} (-${meta.savedPercent}%)\n`,
      );
    } catch (err) {
      failed++;
      const msg = err instanceof CompressError ? err.message : (err && err.message) || String(err);
      rows.push({ file, ok: false, error: msg });
      // A single bad file should not read as a hard failure unless asked for.
      (failOnError ? logError : logWarning)(`${file}: ${msg}`);
    }
  }

  const pct = totalIn > 0 ? Math.round((1 - totalOut / totalIn) * 100) : 0;
  setOutput('files-compressed', String(files.length - failed));
  setOutput('files-failed', String(failed));
  setOutput('bytes-saved', String(Math.max(0, totalIn - totalOut)));
  setOutput('percent-saved', String(pct));

  let summary = `## MiCompress\n\n`;
  summary += `**${files.length - failed}/${files.length}** files compressed — `;
  summary += `${humanSize(totalIn)} → ${humanSize(totalOut)} (**-${pct}%**)\n\n`;
  summary += `| File | Before | After | Saved |\n|---|---|---|---|\n`;
  for (const r of rows) {
    summary += r.ok
      ? `| \`${r.file}\` | ${humanSize(r.from)} | ${humanSize(r.to)} | -${r.pct}% |\n`
      : `| \`${r.file}\` | — | — | ❌ ${r.error} |\n`;
  }
  summary += `\n<sub>Powered by [micompress.com](${baseUrl}/?${UTM})</sub>\n`;
  appendSummary(summary);

  process.stdout.write(
    `\n${files.length - failed}/${files.length} done — ` +
    `${humanSize(totalIn)} → ${humanSize(totalOut)} (-${pct}%) · powered by micompress.com\n`,
  );

  return failed > 0 && failOnError ? 1 : 0;
}

main().then((code) => process.exit(code)).catch((err) => {
  logError(`Unexpected failure: ${err && err.message ? err.message : err}`);
  process.exit(1);
});
