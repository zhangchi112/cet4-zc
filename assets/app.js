import { normalize, hasCJK, searchIndex, searchChinese } from "./search.js";

const $ = (id) => document.getElementById(id);

const LS = {
  fav: "cet4.fav.v1",
  recent: "cet4.recent.v1",
  theme: "cet4.theme.v1",
  audio: "cet4.audio.v1",
};

const state = {
  meta: null,
  index: [], // [word, uk, us, short]
  map: new Map(), // lower(word) -> entry
  chunks: new Map(), // letter -> Promise<{word: trans}>
  fullList: null, // [[word, uk, us, trans], ...] 中文反查用
  fullLoading: null,
  results: [],
  fav: new Set(readLS(LS.fav, [])),
  recent: readLS(LS.recent, []),
  theme: localStorage.getItem(LS.theme) || "auto",
  audio: localStorage.getItem(LS.audio) || "tts",
  detailWord: null,
  detailToken: 0,
};

/* ---------------- 小工具 ---------------- */

function readLS(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

function writeLS(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 隐私模式下写不进去也就算了 */
  }
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

let toastTimer;
function toast(msg) {
  const box = $("toast");
  box.textContent = msg;
  box.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => box.classList.remove("show"), 1600);
}

function setStatus(text) {
  $("status").textContent = text || "";
}

const icon = (paths) => {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  for (const p of paths) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", p);
    svg.appendChild(path);
  }
  return svg;
};

/* ---------------- 主题 ---------------- */

function applyTheme() {
  const root = document.documentElement;
  if (state.theme === "auto") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", state.theme);
  const dark =
    state.theme === "dark" ||
    (state.theme === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);

  // 手动选了主题就同步状态栏颜色；跟随系统时交给 media 属性自己切换
  const metas = document.querySelectorAll('meta[name="theme-color"]');
  if (state.theme === "auto") {
    if (metas[0]) metas[0].setAttribute("content", "#f6f7f9");
    if (metas[1]) metas[1].setAttribute("content", "#0c1013");
  } else {
    const color = dark ? "#0c1013" : "#f6f7f9";
    for (const m of metas) m.setAttribute("content", color);
  }
}

/* ---------------- 数据加载 ---------------- */

async function boot() {
  applyTheme();
  bindEvents();
  renderRecents();
  renderFav();

  try {
    const res = await fetch("data/index.json");
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    state.meta = data.meta;
    state.index = data.words;
    for (const e of data.words) state.map.set(e[0].toLowerCase(), e);
    $("wordCount").textContent = data.meta.count;
  } catch (err) {
    setStatus("词库加载失败：" + err.message);
    toast("词库加载失败，请检查网络");
  }

  registerSW();

  // 支持 ?q=aban 直接带查询打开（也方便分享）
  const preset = new URLSearchParams(location.search).get("q");
  if (preset) {
    $("q").value = preset;
    $("clearBtn").hidden = false;
    runSearch(preset);
  }

  handleHash();
  window.addEventListener("popstate", handleHash);
}

function chunkLetter(word) {
  const c = (word[0] || "").toLowerCase();
  return /[a-z]/.test(c) ? c : "_";
}

function loadChunk(letter) {
  if (!state.chunks.has(letter)) {
    const p = fetch(`data/d/${letter}.json`)
      .then((r) => (r.ok ? r.json() : {}))
      .catch(() => ({}));
    state.chunks.set(letter, p);
  }
  return state.chunks.get(letter);
}

/** 载入全部释义分片（中文反查、离线完整性用） */
function ensureFull() {
  if (state.fullList) return Promise.resolve(state.fullList);
  if (!state.fullLoading) {
    const letters = state.meta?.letters || [];
    state.fullLoading = Promise.all(letters.map(loadChunk)).then((parts) => {
      const transOf = new Map();
      for (const obj of parts) {
        for (const [w, t] of Object.entries(obj)) transOf.set(w, t);
      }
      const list = [];
      for (const [word, uk, us] of state.index) {
        const trans = transOf.get(word);
        if (trans) list.push([word, uk, us, trans]);
      }
      state.fullList = list;
      return list;
    });
  }
  return state.fullLoading;
}

/* ---------------- 搜索 ---------------- */

let searchTimer;
let searchSeq = 0;

function onQueryInput() {
  const raw = $("q").value;
  $("clearBtn").hidden = !raw;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => runSearch(raw), 90);
}

async function runSearch(raw) {
  const seq = ++searchSeq;
  const q = normalize(raw);
  const list = $("results");

  if (!q) {
    list.replaceChildren();
    $("home").classList.remove("hidden");
    setStatus("");
    state.results = [];
    return;
  }

  $("home").classList.add("hidden");

  let results;
  if (hasCJK(raw)) {
    setStatus("检索中文释义…");
    const full = await ensureFull();
    if (seq !== searchSeq) return;
    results = searchChinese(full, raw.trim());
  } else {
    results = searchIndex(state.index, q);
  }

  if (seq !== searchSeq) return;

  state.results = results;
  renderResults(results, q);
  if (!results.length) {
    setStatus(hasCJK(raw) ? "释义里没有这个词" : "没有匹配，试试别的拼写");
  } else {
    setStatus(`${results.length} 个结果`);
  }
}

function highlight(word, q) {
  const node = document.createDocumentFragment();
  const lower = word.toLowerCase();
  const at = q && /^[a-z' -]+$/.test(q) ? lower.indexOf(q) : -1;
  if (at < 0) {
    node.append(word);
    return node;
  }
  if (at > 0) node.append(word.slice(0, at));
  const mark = el("mark", null, word.slice(at, at + q.length));
  node.append(mark, word.slice(at + q.length));
  return node;
}

function makeItem(entry, q) {
  const [word, uk, us, short] = entry;
  const li = el("li", "item");
  li.dataset.word = word;
  li.tabIndex = 0;
  li.setAttribute("role", "button");

  const main = el("div", "item-main");
  const head = el("div", "item-head");
  const w = el("div", "item-word");
  w.append(highlight(word, q));
  head.append(w);
  if (uk || us) head.append(el("div", "item-phon", `/${uk || us}/`));
  const mean = el("div", "item-mean", short || "");
  main.append(head, mean);
  li.append(main);
  return li;
}

function renderResults(results, q) {
  const list = $("results");
  const items = results.map((r) => makeItem([r.word, r.uk, r.us, r.short], q));
  list.replaceChildren(...items);
}

/* ---------------- 首页 / 最近 ---------------- */

function addRecent(word) {
  state.recent = [word, ...state.recent.filter((w) => w !== word)].slice(0, 12);
  writeLS(LS.recent, state.recent);
  renderRecents();
}

function renderRecents() {
  const block = $("recentBlock");
  const wrap = $("recentChips");
  block.hidden = state.recent.length === 0;
  wrap.replaceChildren(
    ...state.recent.map((word) => {
      const b = el("button", "chip", word);
      b.type = "button";
      b.dataset.word = word;
      return b;
    })
  );
}

/* ---------------- 详情 ---------------- */

function phoneticButtons(word, uk, us) {
  const wrap = el("div", "phonetics");
  const add = (label, value) => {
    const btn = el("button", "phon-btn");
    btn.type = "button";
    btn.append(icon(["M4 9.5h3l4-3.2v11.4l-4-3.2H4z", "M15.5 8.5a5 5 0 010 7"]));
    if (value) {
      btn.append(el("span", "phon-flag", label), document.createTextNode(`/${value}/`));
      btn.addEventListener("click", () => speak(word, label));
    } else {
      btn.classList.add("is-missing");
      btn.append(el("span", "phon-flag", label), document.createTextNode("暂无音标"));
    }
    wrap.append(btn);
  };

  if (uk && us && uk !== us) {
    add("UK", uk);
    add("US", us);
  } else if (uk || us) {
    add("英/美", uk || us);
  } else {
    add("音标", "");
  }
  return wrap;
}

/** 释义行首可能的词性标记，长的在前 */
const POS = [
  "vt.& vi.", "vt.&vi.", "vt. & vi.", "n.& vt.", "adj.", "adv.", "prep.", "conj.",
  "pron.", "abbr.", "num.", "art.", "aux.", "int.", "vt.", "vi.", "n.", "v.", "a.", "ad.",
];

function splitPos(line) {
  const lower = line.toLowerCase();
  for (const p of POS) {
    if (lower.startsWith(p)) {
      const rest = line.slice(p.length).replace(/^[\s,，、]+/, "").trim();
      if (rest) return [p.replace(/\s+/g, ""), rest];
    }
  }
  return ["", line];
}

/** 按逗号切义项，但别把括号里的逗号切开 */
function splitSenses(text) {
  const out = [];
  let buf = "";
  let depth = 0;
  for (const ch of text) {
    if (ch === "（" || ch === "(") depth++;
    if (ch === "）" || ch === ")") depth = Math.max(0, depth - 1);
    if ((ch === "," || ch === "，" || ch === ";") && depth === 0) {
      if (buf.trim()) out.push(buf.trim());
      buf = "";
      continue;
    }
    buf += ch;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

function renderSenses(container, trans) {
  const lines = String(trans || "").split("\n").filter(Boolean);
  container.replaceChildren();
  for (const line of lines) {
    const [pos, rest] = splitPos(line);
    const row = el("div", "sense-row");
    if (pos) row.append(el("span", "pos", pos));
    row.append(el("div", "sense-text", splitSenses(rest).join("；")));
    container.append(row);
  }
}

function renderDetail(word) {
  const key = word.toLowerCase();
  const entry = state.map.get(key);
  const [w, uk, us, short] = entry || [word, "", "", ""];

  state.detailWord = w;
  $("starBtn").classList.toggle("on", state.fav.has(lowerOf(w)));

  const body = $("detailBody");
  body.replaceChildren();
  const head = el("div");
  head.append(el("h1", "word", w), phoneticButtons(w, uk, us));

  const senses = el("div", "senses");
  const foot = el("div", "detail-foot", `数据来自 english-vocabulary · 四级词库 ${state.meta?.count || ""} 词`);
  body.append(head, senses, foot);
  renderSenses(senses, short);

  const token = ++state.detailToken;
  loadChunk(chunkLetter(w)).then((chunk) => {
    if (token !== state.detailToken) return;
    const trans = chunk[w] || chunk[lowerOf(w)];
    if (trans) renderSenses(senses, trans);
    else if (!entry) senses.replaceChildren(el("div", "sense-text", "词库里没有这个词，试试别的拼写。"));
  });
}

const lowerOf = (w) => String(w).toLowerCase();

function openWord(word) {
  if (!word) return;
  renderDetail(word);
  showDetail(true);
  addRecent(word);
  history.pushState({ word }, "", "#" + encodeURIComponent(word));
}

function showDetail(on) {
  const d = $("detail");
  d.classList.toggle("hidden", !on);
  d.setAttribute("aria-hidden", String(!on));
  document.body.style.overflow = on ? "hidden" : "";
  if (on) $("detailBody").scrollTop = 0;
}

function closeDetail() {
  showDetail(false);
  state.detailToken++;
}

function handleHash() {
  const raw = decodeURIComponent(location.hash.replace(/^#/, ""));
  if (raw) {
    renderDetail(raw);
    showDetail(true);
  } else {
    closeDetail();
  }
}

/* ---------------- 收藏 ---------------- */

function toggleFav() {
  const w = state.detailWord;
  if (!w) return;
  const key = lowerOf(w);
  if (state.fav.has(key)) {
    state.fav.delete(key);
    toast("已移出生词本");
  } else {
    state.fav.add(key);
    toast("已加入生词本");
  }
  writeLS(LS.fav, [...state.fav]);
  $("starBtn").classList.toggle("on", state.fav.has(key));
  updateFavDot();
  renderFav();
}

function updateFavDot() {
  $("favDot").hidden = state.fav.size === 0;
}

function renderFav() {
  const list = $("favList");
  const words = [...state.fav]
    .map((k) => state.map.get(k))
    .filter(Boolean)
    .reverse();

  $("favEmpty").classList.toggle("hidden", words.length > 0);
  $("exportBtn").disabled = words.length === 0;
  list.replaceChildren(...words.map((e) => makeItem(e, "")));
  updateFavDot();
}

function exportFav() {
  const rows = [...state.fav]
    .map((k) => state.map.get(k))
    .filter(Boolean)
    .map(([word, uk, us, short]) => [word, uk || us || "", short].map(csvCell).join(","));
  const csv = "\ufeff单词,音标,释义\n" + rows.join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "四级生词本.csv";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  toast(`已导出 ${rows.length} 个词`);
}

function csvCell(v) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/* ---------------- 发音 ---------------- */

let voices = [];
function loadVoices() {
  voices = speechSynthesis?.getVoices?.() || [];
}
if ("speechSynthesis" in window) {
  loadVoices();
  speechSynthesis.addEventListener?.("voiceschanged", loadVoices);
}

function pickVoice(lang) {
  if (!voices.length) loadVoices();
  const same = voices.filter((v) => v.lang.replace("_", "-").toLowerCase() === lang.toLowerCase());
  const near = voices.filter((v) => v.lang.toLowerCase().startsWith(lang.slice(0, 2)));
  const pool = same.length ? same : near;
  const preferred = pool.find((v) => /natural|premium|enhanced|siri|google/i.test(v.name));
  return preferred || pool[0] || null;
}

function speak(word, label) {
  const isUS = label === "US";
  const lang = isUS ? "en-US" : "en-GB";

  if (state.audio === "online") {
    const url = `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(word)}&type=${isUS ? 2 : 1}`;
    const audio = new Audio(url);
    audio.onerror = () => tts(word, lang);
    audio.play().catch(() => tts(word, lang));
    return;
  }
  tts(word, lang);
}

function tts(word, lang) {
  if (!("speechSynthesis" in window)) {
    toast("这台设备的浏览器不支持发音");
    return;
  }
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(word);
  u.lang = lang;
  u.rate = 0.85;
  const voice = pickVoice(lang);
  if (voice) u.voice = voice;
  speechSynthesis.speak(u);
}

/* ---------------- 设置面板 ---------------- */

function openSheet() {
  if (document.querySelector(".sheet-wrap")) return;

  const wrap = el("div", "sheet-wrap");
  const mask = el("div", "sheet-mask");
  const sheet = el("div", "sheet");
  sheet.setAttribute("role", "dialog");

  const seg = (label, options, current, onPick) => {
    const row = el("div", "sheet-row");
    row.append(el("div", "sheet-label", label));
    const group = el("div", "seg");
    for (const [value, text] of options) {
      const b = el("button", "seg-btn" + (value === current ? " is-on" : ""), text);
      b.type = "button";
      b.addEventListener("click", () => {
        for (const s of group.children) s.classList.remove("is-on");
        b.classList.add("is-on");
        onPick(value);
      });
      group.append(b);
    }
    row.append(group);
    return row;
  };

  sheet.append(el("div", "sheet-grip"));
  sheet.append(
    seg(
      "主题",
      [
        ["auto", "跟随系统"],
        ["light", "浅色"],
        ["dark", "深色"],
      ],
      state.theme,
      (v) => {
        state.theme = v;
        localStorage.setItem(LS.theme, v);
        applyTheme();
      }
    )
  );
  sheet.append(
    seg(
      "发音",
      [
        ["tts", "系统语音"],
        ["online", "在线真人"],
      ],
      state.audio,
      (v) => {
        state.audio = v;
        localStorage.setItem(LS.audio, v);
        toast(v === "online" ? "在线真人发音需要联网" : "已切换为系统语音");
      }
    )
  );
  sheet.append(
    el(
      "p",
      "sheet-note",
      "系统语音离线可用，音质因手机而异；在线真人音质更好，但走第三方公开接口，可能随时失效，失败会自动回退。"
    )
  );

  const close = () => wrap.remove();
  mask.addEventListener("click", close);
  wrap.append(mask, sheet);
  document.body.append(wrap);
  requestAnimationFrame(() => wrap.classList.add("show"));
}

/* ---------------- 事件绑定 ---------------- */

function bindEvents() {
  $("q").addEventListener("input", onQueryInput);
  $("q").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      $("q").blur();
      if (state.results[0]) openWord(state.results[0].word);
    }
  });
  $("clearBtn").addEventListener("click", () => {
    $("q").value = "";
    $("clearBtn").hidden = true;
    runSearch("");
    $("q").focus();
  });

  $("results").addEventListener("click", (e) => {
    const item = e.target.closest(".item");
    if (item) openWord(item.dataset.word);
  });
  $("favList").addEventListener("click", (e) => {
    const item = e.target.closest(".item");
    if (item) openWord(item.dataset.word);
  });
  $("recentChips").addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (chip) openWord(chip.dataset.word);
  });

  $("randomBtn").addEventListener("click", () => {
    if (!state.index.length) return;
    // 用查询框里的首字母当种子，纯随机即可
    const pick = state.index[Math.floor(Math.random() * state.index.length)];
    openWord(pick[0]);
  });

  $("clearRecent").addEventListener("click", () => {
    state.recent = [];
    writeLS(LS.recent, []);
    renderRecents();
  });

  $("tabbar").addEventListener("click", (e) => {
    const tab = e.target.closest(".tab");
    if (!tab) return;
    switchTab(tab.dataset.tab);
  });

  $("themeBtn").addEventListener("click", openSheet);
  $("backBtn").addEventListener("click", () => history.back());
  $("starBtn").addEventListener("click", toggleFav);
  $("exportBtn").addEventListener("click", exportFav);
}

function switchTab(name) {
  for (const t of document.querySelectorAll(".tab")) {
    t.classList.toggle("is-active", t.dataset.tab === name);
  }
  $("viewSearch").classList.toggle("hidden", name !== "search");
  $("viewFav").classList.toggle("hidden", name !== "fav");
  if (name === "fav") renderFav();
}

/* ---------------- Service Worker ---------------- */

function registerSW() {
  if (!("serviceWorker" in navigator)) return;
  if (!/^https?:$/.test(location.protocol)) return;
  navigator.serviceWorker.register("sw.js").catch(() => {
    /* 局域网 http 下会失败，不影响使用 */
  });
}

boot();
