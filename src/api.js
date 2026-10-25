'use strict';

const fs = require('fs');
const path = require('path');
const { categoryFor, endpointPath, extOf } = require('./categories');

const DEFAULT_BASE = 'https://micompress.com';
// Attribution so we can measure traffic driven by the CLI (see extend/README.md).
const UTM = 'utm_source=github-action&utm_medium=ci&utm_campaign=extend';
// Branded UA identifies the client and stays clear of WAF bot rules.
const USER_AGENT = 'micompress-action/0.1.1 (+https://micompress.com)';
// Channel id so the server can attribute CI usage to the Action.
const CLIENT_ID = 'github-action/0.1.1';

class CompressError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'CompressError';
    this.code = code;
  }
}

/**
 * Compress a single file through the MiCompress public API.
 *
 * @param {string} inputPath
 * @param {object} [opts]
 * @param {string} [opts.baseUrl]   API base (default https://micompress.com)
 * @param {string} [opts.preset]    lossless | recommended | extreme
 * @param {number} [opts.maxWidth]  image resize cap (px)
 * @param {string} [opts.apiKey]    personal API key (mc_…) from micompress.com/account
 * @param {string} [opts.token]     legacy JWT login token for higher limits
 * @param {number} [opts.timeout]   ms (default 120000)
 * @returns {Promise<{buffer:Buffer, meta:object}>}
 */
async function compressFile(inputPath, opts = {}) {
  const baseUrl = (opts.baseUrl || DEFAULT_BASE).replace(/\/+$/, '');
  const filename = path.basename(inputPath);
  const category = categoryFor(filename);
  if (!category) {
    throw new CompressError(
      `Unsupported file type ".${extOf(filename) || '?'}". ` +
      `See supported formats at ${baseUrl}/all-tools`,
      'UNSUPPORTED',
    );
  }

  let stat;
  try {
    stat = fs.statSync(inputPath);
  } catch {
    throw new CompressError(`File not found: ${inputPath}`, 'ENOENT');
  }
  if (!stat.isFile()) throw new CompressError(`Not a file: ${inputPath}`, 'ENOTFILE');

  const url = `${baseUrl}/${endpointPath(category)}/compress`;

  const form = new FormData();
  const bytes = fs.readFileSync(inputPath);
  form.append('file', new Blob([bytes]), filename);
  if (opts.preset) form.append('preset', String(opts.preset));
  if (opts.maxWidth) form.append('maxWidth', String(opts.maxWidth));

  const headers = { Accept: 'application/json', 'User-Agent': USER_AGENT,
    'X-MiCompress-Client': CLIENT_ID };
  // The API key authenticates the compress POST only (not the download GET).
  if (opts.apiKey) headers['X-API-Key'] = String(opts.apiKey).trim();
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), opts.timeout || 120000);
  let res;
  try {
    res = await fetch(url, { method: 'POST', body: form, headers, signal: ac.signal });
  } catch (err) {
    if (err.name === 'AbortError') throw new CompressError('Request timed out', 'TIMEOUT');
    throw new CompressError(`Network error: ${err.message}`, 'NETWORK');
  } finally {
    clearTimeout(timer);
  }

  let json;
  const text = await res.text();
  try {
    json = JSON.parse(text);
  } catch {
    throw new CompressError(`Unexpected response (HTTP ${res.status})`, 'BADRESPONSE');
  }

  if (!res.ok || !json.success) {
    if (res.status === 401 && json.code === 'LOGIN_REQUIRED') {
      throw new CompressError(
        `File exceeds the anonymous size limit. Set the \`api-key\` input from a repository ` +
        `secret (get a free key at ${baseUrl}/account) or compress it online at ${baseUrl}/?${UTM}`,
        'LOGIN_REQUIRED',
      );
    }
    if (res.status === 401 && json.code === 'INVALID_API_KEY') {
      // The server's message already says where to find the key; ours is a fallback.
      throw new CompressError(
        json.error || `Invalid API key — check the \`api-key\` secret against ${baseUrl}/account`,
        'INVALID_API_KEY',
      );
    }
    if (res.status === 429 && (json.code === 'API_QUOTA_REACHED' || json.code === 'USAGE_LIMIT_REACHED')) {
      throw new CompressError(
        `${json.error || 'Monthly quota reached'} — see plans at ${baseUrl}/plans`,
        json.code,
      );
    }
    throw new CompressError(json.error || `HTTP ${res.status}`, json.code || 'API_ERROR');
  }

  // Step 2: download the compressed bytes.
  const dlUrl = `${baseUrl}${json.downloadUrl}`;
  const dlHeaders = { 'User-Agent': USER_AGENT };
  if (opts.token) dlHeaders.Authorization = `Bearer ${opts.token}`;
  const dl = await fetch(dlUrl, { headers: dlHeaders });
  if (!dl.ok) throw new CompressError(`Download failed (HTTP ${dl.status})`, 'DOWNLOAD');
  const buffer = Buffer.from(await dl.arrayBuffer());

  return {
    buffer,
    meta: {
      category,
      inputSize: json.inputSize,
      outputSize: json.outputSize,
      savedBytes: json.savedBytes,
      savedPercent: json.savedPercent,
      format: json.format,
      originalName: json.originalName || filename,
      note: json.note || null,
    },
  };
}

module.exports = { compressFile, CompressError, DEFAULT_BASE, UTM };
