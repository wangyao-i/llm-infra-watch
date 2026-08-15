#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path

REPOS = [
    "vllm-project/vllm",
    "vllm-project/vllm-ascend",
    "sgl-project/sglang",
    "sgl-project/sglang-omni",
]

CATEGORY_RULES = {
    "Ascend / NPU": [
        "ascend", "npu", "torch_npu", "torch-npu", "aclnn", "acl", "cann",
        "hccl", "huawei", "a3", "a5", "device op", "device_op"
    ],
    "Quantization": [
        "quant", "mxfp", "fp8", "fp4", "int8", "int4", "w8a8", "w4a4", "w4a8",
        "awq", "gptq", "compressed tensor", "hif4"
    ],
    "MoE": [
        "moe", "expert", "expert parallel", "deepep", "dispatch", "combine",
        "router", "eplb", "alltoall", "all-to-all"
    ],
    "Attention / KV": [
        "attention", "flashattention", "flash attention", "pagedattention", "mla",
        "dsa", "kv cache", "kvcache", "prefix cache", "indexer", "decode attention"
    ],
    "Distributed / Comm": [
        "tensor parallel", "tp ", "data parallel", "dp ", "expert parallel",
        "pipeline parallel", "context parallel", "allreduce", "all-reduce",
        "allgather", "all-gather", "reduce scatter", "reduce_scatter",
        "collective", "communication", "nccl", "hccl"
    ],
    "Scheduler / Runtime": [
        "scheduler", "modelrunner", "model runner", "worker", "executor", "async",
        "cuda graph", "graph mode", "batch", "prefill", "decode", "runtime"
    ],
    "Omni / Multimodal": [
        "omni", "multimodal", "multi-modal", "audio", "speech", "video", "image",
        "asr", "tts", "qwen3-omni", "qwen3 omni"
    ],
    "Kernel / Performance": [
        "kernel", "triton", "performance", "perf", "latency", "throughput",
        "fusion", "fused", "optimiz", "benchmark"
    ],
}

WEIGHTS = {
    "Ascend / NPU": 6,
    "Quantization": 6,
    "MoE": 4,
    "Attention / KV": 4,
    "Omni / Multimodal": 5,
    "Distributed / Comm": 3,
    "Scheduler / Runtime": 3,
    "Kernel / Performance": 2,
}

ANALYSIS_TEXT = {
    "Ascend / NPU": "直接影响 Ascend/NPU backend 的兼容性、算子路径或性能。",
    "Quantization": "可能影响低比特模型支持、显存/带宽占用或量化推理性能。",
    "MoE": "可能影响专家并行、token 路由、通信开销和 MoE 吞吐。",
    "Attention / KV": "可能影响 Attention/KV Cache 的时延、显存效率或长上下文能力。",
    "Distributed / Comm": "可能影响多卡扩展效率、collective 通信或并行策略。",
    "Scheduler / Runtime": "可能改变请求调度、batching、执行流水或推理时延。",
    "Omni / Multimodal": "与多模态/语音/视频推理路径和 Omni 能力直接相关。",
    "Kernel / Performance": "包含 kernel 或性能优化，值得关注 benchmark 和硬件适配变化。",
}

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "site" / "data"
STATE_PATH = DATA_DIR / "state.json"
LATEST_PATH = DATA_DIR / "latest.json"
HISTORY_DIR = DATA_DIR / "history"
TOKEN = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")
API = "https://api.github.com"

def now_utc():
    return datetime.now(timezone.utc)

def iso(dt: datetime):
    return dt.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")

def api_get(path: str, params=None):
    url = API + path
    if params:
        url += "?" + urllib.parse.urlencode(params)
    headers = {
        "Accept": "application/vnd.github+json",
        "User-Agent": "llm-infra-watch",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    if TOKEN:
        headers["Authorization"] = f"Bearer {TOKEN}"
    req = urllib.request.Request(url, headers=headers)
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=45) as r:
                return json.load(r)
        except Exception as e:
            if attempt == 3:
                raise
            time.sleep(2 ** attempt)
    raise RuntimeError("unreachable")

def read_since():
    if STATE_PATH.exists():
        try:
            raw = json.loads(STATE_PATH.read_text())
            value = raw.get("last_successful_run")
            if value:
                return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except Exception:
            pass
    return now_utc() - timedelta(hours=30)

def classify(text: str):
    hay = (text or "").lower()
    found = []
    for category, terms in CATEGORY_RULES.items():
        if any(t in hay for t in terms):
            found.append(category)
    return found or ["Other"]

def analysis_for(categories):
    for c in [
        "Ascend / NPU", "Quantization", "Omni / Multimodal", "MoE",
        "Attention / KV", "Distributed / Comm", "Scheduler / Runtime",
        "Kernel / Performance"
    ]:
        if c in categories:
            return ANALYSIS_TEXT[c]
    return "常规工程变化；可结合修改文件和 benchmark 判断实际影响。"

def score_item(item, repo):
    score = 0
    for c in item.get("categories", []):
        score += WEIGHTS.get(c, 0)
    if repo.endswith("vllm-ascend"):
        score += 3
    if repo.endswith("sglang-omni"):
        score += 2
    if item.get("kind") == "merged":
        score += 2
    title = (item.get("title") or "").lower()
    if any(k in title for k in ("breaking", "refactor", "roadmap", "rfc")):
        score += 2
    return score

def search_prs(repo, qualifier, since):
    q = f"repo:{repo} is:pr {qualifier}:>={iso(since)}"
    result = api_get("/search/issues", {"q": q, "sort": qualifier if qualifier in {"created","updated"} else "updated", "order": "desc", "per_page": 100})
    return result.get("items", [])

def pr_details(repo, number):
    return api_get(f"/repos/{repo}/pulls/{number}")

def normalize_pr(repo, item, kind):
    d = pr_details(repo, item["number"])
    title = d.get("title") or ""
    body = d.get("body") or ""
    labels = " ".join(x.get("name","") for x in d.get("labels", []))
    categories = classify(" ".join([title, body[:2500], labels]))
    t = d.get("merged_at") if kind == "merged" else d.get("created_at")
    return {
        "number": d.get("number"),
        "title": title,
        "author": (d.get("user") or {}).get("login"),
        "url": d.get("html_url"),
        "time": t,
        "categories": categories,
        "analysis": analysis_for(categories),
        "draft": bool(d.get("draft")),
        "additions": d.get("additions"),
        "deletions": d.get("deletions"),
        "changed_files": d.get("changed_files"),
        "merge_commit_sha": d.get("merge_commit_sha"),
        "kind": kind,
    }

def fetch_commits(repo, since, merged_shas):
    items = []
    page = 1
    while page <= 3:
        batch = api_get(f"/repos/{repo}/commits", {"since": iso(since), "per_page": 100, "page": page})
        if not batch:
            break
        for c in batch:
            sha = c.get("sha")
            if sha in merged_shas:
                continue
            msg = ((c.get("commit") or {}).get("message") or "").splitlines()[0]
            # Most squash-merged GitHub PR commits end in "(#123)".
            if re.search(r"\(#\d+\)\s*$", msg):
                continue
            author = ((c.get("author") or {}).get("login")
                      or (((c.get("commit") or {}).get("author") or {}).get("name")))
            t = (((c.get("commit") or {}).get("committer") or {}).get("date"))
            categories = classify(msg)
            items.append({
                "sha": (sha or "")[:12],
                "title": msg,
                "author": author,
                "url": c.get("html_url"),
                "time": t,
                "categories": categories,
                "analysis": analysis_for(categories),
                "kind": "commit",
            })
        if len(batch) < 100:
            break
        page += 1
    return items

def main():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    HISTORY_DIR.mkdir(parents=True, exist_ok=True)
    since = read_since()
    generated = now_utc()
    out = {
        "generated_at": iso(generated),
        "since": iso(since),
        "repositories": {},
        "category_counts": {},
        "focus_items": [],
    }
    category_counter = Counter()
    focus = []

    for repo in REPOS:
        print(f"Collecting {repo}", flush=True)
        merged_search = search_prs(repo, "merged", since)
        opened_search = search_prs(repo, "created", since)

        merged = [normalize_pr(repo, x, "merged") for x in merged_search]
        opened = [normalize_pr(repo, x, "opened") for x in opened_search]

        # Keep only truly merged records because search syntax can occasionally surface closed items.
        merged = [x for x in merged if x.get("time")]
        merged_shas = {x.get("merge_commit_sha") for x in merged if x.get("merge_commit_sha")}
        commits = fetch_commits(repo, since, merged_shas)

        out["repositories"][repo] = {
            "merged_prs": merged,
            "opened_prs": opened,
            "commits": commits,
            "stats": {
                "merged": len(merged),
                "opened": len(opened),
                "commits": len(commits),
            }
        }

        for item in merged + opened + commits:
            for cat in item.get("categories", []):
                category_counter[cat] += 1
            if any(cat != "Other" for cat in item.get("categories", [])):
                enriched = dict(item)
                enriched["repo"] = repo
                enriched["priority_score"] = score_item(item, repo)
                focus.append(enriched)

    focus.sort(key=lambda x: (x.get("priority_score", 0), x.get("time") or ""), reverse=True)
    out["focus_items"] = focus[:12]
    out["category_counts"] = dict(category_counter.most_common())

    LATEST_PATH.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n")
    history_name = generated.astimezone(timezone(timedelta(hours=8))).strftime("%Y-%m-%d") + ".json"
    (HISTORY_DIR / history_name).write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n")
    STATE_PATH.write_text(json.dumps({"last_successful_run": iso(generated)}, indent=2) + "\n")
    print(f"Wrote {LATEST_PATH}")

if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise
