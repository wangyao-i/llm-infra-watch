# LLM Infra Watch

A lightweight daily dashboard for tracking changes in:

- `vllm-project/vllm`
- `vllm-project/vllm-ascend`
- `sgl-project/sglang`
- `sgl-project/sglang-omni`

It tracks:

- newly merged PRs
- newly opened PRs
- notable commits
- technical categories and simple impact analysis
- a "Worth Watching" feed prioritized for Ascend/NPU, quantization, MoE, attention/KV cache, distributed runtime, and Omni/multimodal work

## How it works

GitHub Actions runs every day at about **08:05 Singapore time** (`00:05 UTC`), fetches public GitHub data, updates JSON history, commits the new data, and deploys the static dashboard to GitHub Pages.

No external database and no API key are required. The workflow uses the repository's built-in `GITHUB_TOKEN`.

## First deployment

1. Create a **public** GitHub repository named `llm-infra-watch`.
2. Put these files on the default branch.
3. Open **Settings → Pages → Build and deployment → Source → GitHub Actions**.
4. Open **Actions → Daily LLM Infra Watch → Run workflow** once to generate the first real dataset.
5. The site will be available at:

   `https://<your-github-user>.github.io/llm-infra-watch/`

## Local preview

Open `site/index.html` in a browser. Until the first workflow run it displays sample/empty state data.

## Customize focus

Edit the keyword groups and scoring weights in `scripts/fetch_changes.py`.

## Data layout

- `site/data/latest.json`: latest daily snapshot used by the dashboard
- `site/data/history/YYYY-MM-DD.json`: daily snapshots
- `site/data/state.json`: last successful collection timestamp

## Notes

GitHub scheduled workflows can occasionally start a little later than the exact cron minute. The collector uses the previous successful timestamp, so delayed runs should not lose changes.
