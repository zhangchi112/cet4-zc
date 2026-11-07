#!/usr/bin/env node
/**
 * 从 english-vocabulary 数据集抽取四级词表，生成前端数据。
 *
 * 输入（data/repo，由
 *   git -c http.sslBackend=openssl clone --depth 1 https://gitee.com/staryihui/english-vocabulary.git data/repo
 * 得到）：
 *   tb_vocabulary.json  10 万词条：spelling / UKphonetic / USphonetic / paraphrase / frequency
 *   tb_voc_book.json    词书与词条的对应关系
 *   tb_book.json        词书元信息（bookid 1 = 四级词汇乱序便携版，3 = 星火四级词汇必背乱序版）
 *
 * 输出：
 *   data/index.json     首屏索引：[单词, 英音, 美音, 首义] —— 体积小，启动即加载
 *   data/d/<x>.json     按首字母分片的完整释义，打开词条时按需加载
 *   data/words.json     全量词表（中文反查、离线预缓存用）
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const ROOT = path.resolve(import.meta.dirname, "..");
const REPO = path.join(ROOT, "data", "repo");
const OUT_DIR = path.join(ROOT, "data");
const CHUNK_DIR = path.join(OUT_DIR, "d");

const CET4_BOOK_IDS = [1, 3];

const readJSON = (p) => JSON.parse(fs.readFileSync(p, "utf8"));

const vocab = readJSON(path.join(REPO, "tb_vocabulary.json"));
const books = readJSON(path.join(REPO, "tb_book.json"));
const vocBook = readJSON(path.join(REPO, "tb_voc_book.json"));

const byId = new Map(vocab.map((w) => [w.wordid, w]));
const bookNames = new Map(books.map((b) => [b.bookid, b.bookname]));
const ids = new Set(vocBook.filter((x) => CET4_BOOK_IDS.includes(x.bookid)).map((x) => x.wordid));

/** 清洗释义：统一换行、压缩空白、剔除空行 */
function cleanTrans(raw) {
  if (!raw) return "";
  return String(raw)
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.replace(/[ \t\u3000]+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

/** 所有可能出现在释义行首的词性标记，长的排前面 */
const POS = [
  "vt.& vi.", "vt.&vi.", "vt. & vi.", "n.& vt.", "adj.", "adv.", "prep.", "conj.",
  "pron.", "abbr.", "num.", "art.", "aux.", "int.", "vt.", "vi.", "n.", "v.", "a.", "ad.",
];

/** 拆出一行的词性 + 释义 */
function splitPos(line) {
  const lower = line.toLowerCase();
  for (const p of POS) {
    if (lower.startsWith(p)) {
      const rest = line.slice(p.length).replace(/^[\s,，]+/, "").trim();
      if (rest) return [p.replace(/\s+/g, ""), rest];
    }
  }
  return ["", line];
}

/** 首义：取第一行的第一个义项，过长截断 */
function shortMeaning(trans) {
  const first = trans.split("\n")[0] || "";
  const [pos, rest] = splitPos(first);
  const senses = rest.split(/[,，；;]/).map((s) => s.trim()).filter(Boolean);
  let text = senses[0] || rest;
  if (text.length > 30) text = text.slice(0, 30) + "…";
  return (pos ? pos + " " : "") + text;
}

const seen = new Set();
const rows = [];

for (const id of ids) {
  const w = byId.get(id);
  if (!w || !w.spelling) continue;
  const word = w.spelling.trim();
  const key = word.toLowerCase();
  if (seen.has(key)) continue;
  const trans = cleanTrans(w.paraphrase);
  if (!trans) continue;
  seen.add(key);
  rows.push({
    word,
    uk: (w.UKphonetic || "").trim(),
    us: (w.USphonetic || "").trim(),
    trans,
    freq: Math.round((w.frequency || 0) * 1000),
  });
}

rows.sort((a, b) => a.word.localeCompare(b.word, "en"));

const meta = {
  count: rows.length,
  books: CET4_BOOK_IDS.map((id) => bookNames.get(id)),
  source: "https://gitee.com/staryihui/english-vocabulary",
  built: new Date().toISOString().slice(0, 10),
};

const kb = (s) => (Buffer.byteLength(s) / 1024).toFixed(1);
const gzkb = (s) => (zlib.gzipSync(s, { level: 9 }).length / 1024).toFixed(1);

// ---- 按首字母分桶 ----
const buckets = new Map();
for (const r of rows) {
  const letter = /^[a-z]/.test(r.word[0].toLowerCase()) ? r.word[0].toLowerCase() : "_";
  if (!buckets.has(letter)) buckets.set(letter, []);
  buckets.get(letter).push(r);
}
meta.letters = [...buckets.keys()].sort();

// ---- index.json ----
const index = { meta, words: rows.map((r) => [r.word, r.uk, r.us, shortMeaning(r.trans)]) };
const indexJSON = JSON.stringify(index);
fs.writeFileSync(path.join(OUT_DIR, "index.json"), indexJSON);

// ---- d/<letter>.json ----
fs.rmSync(CHUNK_DIR, { recursive: true, force: true });
fs.mkdirSync(CHUNK_DIR, { recursive: true });

let chunkBytes = 0;
let chunkGz = 0;
for (const [letter, items] of [...buckets].sort()) {
  const obj = {};
  for (const r of items) obj[r.word] = r.trans;
  const json = JSON.stringify(obj);
  fs.writeFileSync(path.join(CHUNK_DIR, `${letter}.json`), json);
  chunkBytes += Buffer.byteLength(json);
  chunkGz += zlib.gzipSync(json, { level: 9 }).length;
}

fs.rmSync(path.join(OUT_DIR, "words.json"), { force: true });

console.log(`词条：${rows.length}`);
console.log(`  词书：${meta.books.join(" + ")}`);
console.log(`  index.json   ${kb(indexJSON)} KB（gzip ${gzkb(indexJSON)} KB）`);
console.log(`  d/*.json     ${buckets.size} 片，共 ${(chunkBytes / 1024).toFixed(0)} KB（gzip ${(chunkGz / 1024).toFixed(0)} KB）`);

const noPhon = rows.filter((r) => !r.uk && !r.us).length;
const noPos = rows.filter((r) => !/^[a-z]/i.test(splitPos(r.trans.split("\n")[0])[0] || "")).length;
console.log(`  缺音标 ${noPhon} 条 / 首行无词性 ${noPos} 条`);
