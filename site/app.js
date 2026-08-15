const shortRepo = r => r.split("/")[1];

function fmtTime(v) {
  if (!v) return "—";
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      dateStyle:"medium",
      timeStyle:"short",
      timeZone:"Asia/Singapore"
    }).format(new Date(v));
  } catch {
    return v;
  }
}

function esc(s="") {
  return String(s).replace(/[&<>"']/g, c => ({
    "&":"&amp;",
    "<":"&lt;",
    ">":"&gt;",
    "\"":"&quot;",
    "'":"&#39;"
  }[c]));
}

function hasCategory(item, category) {
  return !category || (item.categories || []).includes(category);
}

function feedItem(item) {
  const title = esc(item.title || item.message || "(untitled)");
  const author = esc(item.author || "unknown");
  const url = item.url || "#";
  const tags = (item.categories || [])
    .map(t => `<span class="tag">${esc(t)}</span>`)
    .join("");
  const kindLabel =
    item.kind === "merged" ? "MERGED PR" :
    item.kind === "opened" ? "OPENED PR" :
    "COMMIT";
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
  document.getElementById("updated").textContent =
    data.generated_at ? `更新 ${fmtTime(data.generated_at)}` : "等待首次采集";
  document.getElementById("footerTime").textContent =
    data.generated_at ? fmtTime(data.generated_at) : "waiting";
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

  const all = [];
  for (const [repo,v] of Object.entries(repos)) {
    (v.merged_prs || []).forEach(x=>all.push({...x,repo,kind:"merged"}));
    (v.opened_prs || []).forEach(x=>all.push({...x,repo,kind:"opened"}));
    (v.commits || []).forEach(x=>all.push({...x,repo,kind:"commit"}));
  }
  all.sort((a,b)=>new Date(b.time)-new Date(a.time));

  const focus = (data.focus_items || []).map(x => ({...x}));

  const categorySet = new Set(Object.keys(data.category_counts || {}));
  all.forEach(x => (x.categories || []).forEach(c => categorySet.add(c)));
  const categories = [...categorySet]
    .filter(Boolean)
    .sort((a,b) =>
      (data.category_counts?.[b] || 0) - (data.category_counts?.[a] || 0) ||
      a.localeCompare(b)
    );

  const categoryFilter = document.getElementById("categoryFilter");
  categories.forEach(category => {
    const opt = document.createElement("option");
    opt.value = category;
    opt.textContent = `${category} (${data.category_counts?.[category] || 0})`;
    categoryFilter.appendChild(opt);
  });

  const repoFilter = document.getElementById("repoFilter");
  Object.keys(repos).forEach(r => {
    const opt=document.createElement("option");
    opt.value=r;
    opt.textContent=shortRepo(r);
    repoFilter.appendChild(opt);
  });

  let activeCategory = "";

  function syncCategoryUI() {
    categoryFilter.value = activeCategory;
    document.querySelectorAll(".category-chip").forEach(el => {
      el.classList.toggle("active", el.dataset.category === activeCategory);
    });
    document.querySelectorAll(".category.clickable").forEach(el => {
      el.classList.toggle("active", el.dataset.category === activeCategory);
    });
    document.getElementById("activeCategoryText").textContent =
      activeCategory ? `当前：${activeCategory}` : "当前：全部分类";
  }

  function renderFocus() {
    const rows = focus.filter(x => hasCategory(x, activeCategory));
    document.getElementById("focusList").innerHTML = rows.length
      ? rows.map(feedItem).join("")
      : `<div class="empty">这个分类下暂无重点变化。</div>`;
  }

  function renderAll() {
    const rf = repoFilter.value;
    const kf = document.getElementById("kindFilter").value;

    const rows = all.filter(x =>
      (!rf || x.repo === rf) &&
      (!kf || x.kind === kf) &&
      hasCategory(x, activeCategory)
    );

    document.getElementById("allChanges").innerHTML = rows.length
      ? rows.map(feedItem).join("")
      : `<div class="empty">这个筛选条件下没有变化。</div>`;
  }

  function setActiveCategory(category) {
    activeCategory = category || "";
    syncCategoryUI();
    renderFocus();
    renderAll();

    const url = new URL(location.href);
    if (activeCategory) url.searchParams.set("category", activeCategory);
    else url.searchParams.delete("category");
    history.replaceState(null, "", url);
  }

  const chips = [
    `<button class="category-chip active" data-category="" type="button">全部</button>`,
    ...categories.map(category =>
      `<button class="category-chip" data-category="${esc(category)}" type="button">
        ${esc(category)}
        <span>${data.category_counts?.[category] || 0}</span>
      </button>`
    )
  ];
  document.getElementById("categoryChips").innerHTML = chips.join("");

  document.querySelectorAll(".category-chip").forEach(btn => {
    btn.addEventListener("click", () => setActiveCategory(btn.dataset.category || ""));
  });

  const cats = Object.entries(data.category_counts || {}).sort((a,b)=>b[1]-a[1]);
  document.getElementById("categoryGrid").innerHTML = cats.length
    ? cats.map(([k,v]) =>
        `<button class="category clickable" data-category="${esc(k)}" type="button">
          <span>${esc(k)}</span>
          <strong>${v}</strong>
          <small>点击筛选</small>
        </button>`
      ).join("")
    : `<div class="empty">暂无分类数据。</div>`;

  document.querySelectorAll(".category.clickable").forEach(card => {
    card.addEventListener("click", () => {
      const category = card.dataset.category || "";
      setActiveCategory(activeCategory === category ? "" : category);
    });
  });

  repoFilter.onchange = renderAll;
  document.getElementById("kindFilter").onchange = renderAll;
  categoryFilter.onchange = () => setActiveCategory(categoryFilter.value);
  document.getElementById("clearCategory").onclick = () => setActiveCategory("");

  const requestedCategory = new URLSearchParams(location.search).get("category") || "";
  setActiveCategory(categories.includes(requestedCategory) ? requestedCategory : "");
}

main().catch(err => {
  document.getElementById("windowText").textContent = "加载数据失败：" + err.message;
});
