const shortRepo = r => r.split("/")[1];

function fmtTime(v) {
  if (!v) return "—";
  try { return new Intl.DateTimeFormat("zh-CN", {dateStyle:"medium", timeStyle:"short", timeZone:"Asia/Singapore"}).format(new Date(v)); }
  catch { return v; }
}
function esc(s="") {
  return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
}
function feedItem(item) {
  const title = esc(item.title || item.message || "(untitled)");
  const author = esc(item.author || "unknown");
  const url = item.url || "#";
  const tags = (item.categories || []).map(t => `<span class="tag">${esc(t)}</span>`).join("");
  const kindLabel = item.kind === "merged" ? "MERGED PR" : item.kind === "opened" ? "OPENED PR" : "COMMIT";
  const num = item.number ? `#${item.number} · ` : "";
  return `<a class="feed-item" href="${esc(url)}" target="_blank" rel="noopener">
    <div class="repo-label">${esc(shortRepo(item.repo))}</div>
    <div>
      <div class="item-title">${num}${title}</div>
      <div class="meta">${author} · ${fmtTime(item.time)}</div>
      ${item.analysis ? `<div class="analysis">${esc(item.analysis)}</div>` : ""}
      <div class="tags">${tags}</div>
    </div>
    <span class="kind ${item.kind}">${kindLabel}</span>
  </a>`;
}

async function main() {
  const res = await fetch("./data/latest.json", {cache:"no-store"});
  const data = await res.json();
  const repos = data.repositories || {};
  let merged=0, opened=0, commits=0;
  for (const v of Object.values(repos)) {
    merged += v.stats?.merged || 0;
    opened += v.stats?.opened || 0;
    commits += v.stats?.commits || 0;
  }
  document.getElementById("mergedTotal").textContent = merged;
  document.getElementById("openedTotal").textContent = opened;
  document.getElementById("commitTotal").textContent = commits;
  document.getElementById("updated").textContent = data.generated_at ? `更新 ${fmtTime(data.generated_at)}` : "等待首次采集";
  document.getElementById("footerTime").textContent = data.generated_at ? fmtTime(data.generated_at) : "waiting";
  document.getElementById("windowText").textContent = data.since
    ? `采集窗口：${fmtTime(data.since)} → ${fmtTime(data.generated_at)}`
    : (data.message || "等待首次采集");

  const cards = Object.entries(repos).map(([repo,v]) => `<div class="repo-card">
    <h3>${esc(repo)}</h3>
    <div class="counts">
      <div class="count"><strong>${v.stats?.merged || 0}</strong><span>Merged</span></div>
      <div class="count"><strong>${v.stats?.opened || 0}</strong><span>Opened</span></div>
      <div class="count"><strong>${v.stats?.commits || 0}</strong><span>Commits</span></div>
    </div>
  </div>`).join("");
  document.getElementById("repoCards").innerHTML = cards;

  const focus = data.focus_items || [];
  document.getElementById("focusList").innerHTML = focus.length ? focus.map(feedItem).join("") : `<div class="empty">首次采集后展示重点变化。</div>`;

  const cats = Object.entries(data.category_counts || {}).sort((a,b)=>b[1]-a[1]);
  document.getElementById("categoryGrid").innerHTML = cats.length
    ? cats.map(([k,v])=>`<div class="category"><span>${esc(k)}</span><strong>${v}</strong></div>`).join("")
    : `<div class="empty">暂无分类数据。</div>`;

  const repoFilter = document.getElementById("repoFilter");
  Object.keys(repos).forEach(r => {
    const opt=document.createElement("option"); opt.value=r; opt.textContent=shortRepo(r); repoFilter.appendChild(opt);
  });

  const all = [];
  for (const [repo,v] of Object.entries(repos)) {
    (v.merged_prs || []).forEach(x=>all.push({...x,repo,kind:"merged"}));
    (v.opened_prs || []).forEach(x=>all.push({...x,repo,kind:"opened"}));
    (v.commits || []).forEach(x=>all.push({...x,repo,kind:"commit"}));
  }
  all.sort((a,b)=>new Date(b.time)-new Date(a.time));
  const renderAll=()=>{
    const rf=repoFilter.value, kf=document.getElementById("kindFilter").value;
    const rows=all.filter(x=>(!rf||x.repo===rf)&&(!kf||x.kind===kf));
    document.getElementById("allChanges").innerHTML = rows.length ? rows.map(feedItem).join("") : `<div class="empty">这个筛选条件下没有变化。</div>`;
  };
  repoFilter.onchange=renderAll;
  document.getElementById("kindFilter").onchange=renderAll;
  renderAll();
}
main().catch(err => {
  document.getElementById("windowText").textContent = "加载数据失败：" + err.message;
});
