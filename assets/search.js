/**
 * 纯函数搜索逻辑，不碰 DOM，方便单独测试。
 *
 * 索引条目格式：[单词, 英音, 美音, 首义]
 */

/** 统一大小写与空白 */
export function normalize(input) {
  return String(input || "")
    .trim()
    .toLowerCase()
    .replace(/[\u3000\s]+/g, " ");
}

/** 是否包含中日韩字符（用于走中文释义反查） */
export function hasCJK(input) {
  return /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(input);
}

/**
 * 带上限的编辑距离：超过 limit 直接返回 limit + 1，避免无谓计算。
 */
export function editDistance(a, b, limit = 3) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > limit) return limit + 1;

  const prev = new Array(b.length + 1);
  const cur = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    let rowMin = cur[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > limit) return limit + 1;
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j];
  }
  return prev[b.length];
}

/**
 * 在索引里查英文。
 * 优先级：完全匹配 > 前缀 > 包含 > 模糊（仅当上面都没有结果时）
 * @returns {{word:string, uk:string, us:string, short:string, score:number}[]}
 */
export function searchIndex(entries, rawQuery, limit = 60) {
  const q = normalize(rawQuery);
  if (!q) return [];

  const exact = [];
  const prefix = [];
  const contains = [];

  for (const e of entries) {
    const w = e[0].toLowerCase();
    if (w === q) {
      exact.push({ e, score: 1000 });
    } else if (w.startsWith(q)) {
      // 越接近完整的词排前面
      prefix.push({ e, score: 900 - Math.min(w.length - q.length, 40) });
    } else if (w.includes(q)) {
      contains.push({ e, score: 700 - Math.min(w.indexOf(q), 30) });
    }
  }

  const pack = (arr) =>
    arr.map(({ e, score }) => ({ word: e[0], uk: e[1], us: e[2], short: e[3], score }));

  if (exact.length || prefix.length || contains.length) {
    const all = [...exact, ...prefix, ...contains].sort(
      (a, b) => b.score - a.score || a.e[0].localeCompare(b.e[0], "en")
    );
    return pack(all).slice(0, limit);
  }

  // 模糊匹配：单次编辑容忍 1 个错，长词容忍 2 个
  if (q.length >= 3 && /^[a-z' -]+$/.test(q)) {
    const tolerance = q.length >= 6 ? 2 : 1;
    const fuzzy = [];
    for (const e of entries) {
      const w = e[0].toLowerCase();
      if (Math.abs(w.length - q.length) > tolerance) continue;
      const d = editDistance(q, w, tolerance);
      if (d > 0 && d <= tolerance) fuzzy.push({ e, score: 500 - d * 60 });
    }
    fuzzy.sort((a, b) => a.score - b.score || a.e[0].localeCompare(b.e[0], "en"));
    return pack(fuzzy).slice(0, 12);
  }

  return [];
}

/** 中文释义反查：直接扫描全量词表，几千条在手机上毫秒级 */
export function searchChinese(fullWords, rawQuery, limit = 60) {
  const q = String(rawQuery || "").trim();
  if (!q) return [];
  const hits = [];
  for (const [word, uk, us, trans, freq] of fullWords) {
    if (trans.includes(q)) hits.push({ word, uk, us, short: firstSense(trans), freq });
  }
  hits.sort((a, b) => (b.freq || 0) - (a.freq || 0) || a.word.localeCompare(b.word, "en"));
  return hits.slice(0, limit);
}

/** 从完整释义里取一条短释义（列表展示用） */
export function firstSense(trans) {
  const first = String(trans).split("\n")[0] || "";
  const m = first.match(/^([a-z.& ]{1,12}\.)\s*/i);
  const pos = m ? m[1].replace(/\s+/g, "") : "";
  const rest = m ? first.slice(m[0].length) : first;
  const one = rest.split(/[,，；;]/)[0].trim() || rest.trim();
  return (pos ? pos + " " : "") + one;
}
