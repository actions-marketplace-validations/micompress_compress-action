# MiCompress — GitHub Action

> Compress **images, PDFs, video, audio, documents & archives** in CI.
> Powered by [**micompress.com**](https://micompress.com/?utm_source=github-action&utm_medium=ci&utm_campaign=extend).

No native binaries, no toolchain to install, no dependencies — the action uploads
each file to the MiCompress engine over HTTPS and writes the optimized result back.

```yaml
- uses: micompress/compress-action@v0.1.1
  with:
    files: |
      assets/hero.png
      assets/logo.png
```

## Compress only what changed in a pull request

The most useful setup: compress just the images a PR touches, then commit the result.

```yaml
name: Compress images
on: pull_request

permissions:
  contents: write

jobs:
  compress:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.head_ref }}

      - name: Collect changed images
        id: changed
        run: |
          git fetch origin ${{ github.base_ref }} --depth=1
          FILES=$(git diff --name-only --diff-filter=d origin/${{ github.base_ref }}... \
                  | grep -Ei '\.(png|jpe?g|gif|webp)$' || true)
          echo "files<<EOF" >> "$GITHUB_OUTPUT"
          echo "$FILES"      >> "$GITHUB_OUTPUT"
          echo "EOF"         >> "$GITHUB_OUTPUT"

      - uses: micompress/compress-action@v0.1.1
        if: steps.changed.outputs.files != ''
        id: micompress
        with:
          files: ${{ steps.changed.outputs.files }}
          preset: recommended

      - name: Commit if anything shrank
        if: steps.micompress.outputs.files-compressed != '0'
        run: |
          git config user.name  "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git commit -am "Compress images (-${{ steps.micompress.outputs.percent-saved }}%)" || exit 0
          git push
```

## Inputs

| Input | Default | Description |
|---|---|---|
| `files` | *(required)* | Newline- or comma-separated paths. Shell globs are expanded by the runner, so `assets/*.png` works. |
| `preset` | `recommended` | `lossless` · `recommended` · `extreme` |
| `max-width` | — | Resize images down to this width in pixels |
| `output-dir` | — | Write results here instead of overwriting the inputs |
| `api-key` | — | Personal API key from [micompress.com/account](https://micompress.com/account) — store it as a repository secret (see below) |
| `token` | — | Legacy login token — prefer `api-key` |
| `fail-on-error` | `true` | Fail the step if any file could not be compressed |
| `api` | `https://micompress.com` | Override the API base URL |

## API key

Anonymous use works without a key, within per-type size limits. For bigger files:

1. Sign in (free) at **https://micompress.com/account** and copy your key (`mc_…`).
2. Add it as a repository secret named `MICOMPRESS_API_KEY`
   (*Settings → Secrets and variables → Actions*).
3. Pass it to the action:

```yaml
- uses: micompress/compress-action@v0.1.1
  with:
    files: assets/hero.png
    api-key: ${{ secrets.MICOMPRESS_API_KEY }}
```

With a key, files up to **100 MB** are accepted. A free account includes **50
compressions/month** through the API; Plus ($9.99/mo) includes 1,000/month and Pro
($19.99/mo) 5,000/month, shared with website usage. When the allowance runs out the
file fails with `API_QUOTA_REACHED` (free) or `USAGE_LIMIT_REACHED` (paid) — see
**https://micompress.com/plans**.

## Outputs

| Output | Description |
|---|---|
| `files-compressed` | Number of files compressed successfully |
| `files-failed` | Number of files that could not be compressed |
| `bytes-saved` | Total bytes saved |
| `percent-saved` | Overall size reduction, whole-number percent |

The action also writes a result table to the job summary.

## Notes

- **One request per file.** Point it at the files a change actually touches rather
  than an entire `assets/` tree on every build — that keeps CI fast and stays well
  inside the service's fair-use limits.
- Anonymous use works within per-type size limits (images 20MB, video 50MB, …).
  For larger files pass `api-key`.
- Supported formats: **https://micompress.com/all-tools**

## License

MIT © [MiCompress](https://micompress.com)

---

<sub>Need a UI, batch uploads or other formats?
Use **[micompress.com](https://micompress.com/?utm_source=github-action&utm_medium=ci&utm_campaign=extend)**.</sub>
