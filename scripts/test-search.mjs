#!/usr/bin/env node
/** 搜索逻辑自测：node scripts/test-search.mjs */
import fs from "node:fs";
import path from "node:path";
import { searchIndex, searchChinese, editDistance, normalize, hasCJK } from "../assets/search.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const index = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "index.json"), "utf8"));
const entries = index.words;

let failed = 0;
const check = (name, cond, extra = "") => {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name} ${extra}`);
  }
};

const words = (list) => list.map((r) => r.word);

console.log("数据完整性");
check("词条数 3553", entries.length === 3553, `实际 ${entries.length}`);
check("meta.letters 与字母数一致", index.meta.letters.length > 20, index.meta.letters.join(""));
check("无空单词", entries.every((e) => e[0] && e[0].trim().length > 0));
check("释义非空", entries.every((e) => e[3] && e[3].length > 0));
check("单词全小写或含连字符", entries.every((e) => /^[a-z][a-z'-]*$/.test(e[0])), entries
  .filter((e) => !/^[a-z][a-z'-]*$/.test(e[0]))
  .slice(0, 5)
  .map((e) => e[0])
  .join(","));

console.log("\n编辑距离");
check("abandon/abandan = 1", editDistance("abandon", "abandan") === 1);
check("kitten/sitting = 3", editDistance("kitten", "sitting") === 3);
check("空串/abc = 3", editDistance("", "abc") === 3);
check("限值提前返回", editDistance("abcdef", "xyz", 2) === 3);

console.log("\n英文搜索");
const hit = words(searchIndex(entries, "aban"));
check("前缀 aban 命中 abandon", hit.includes("abandon"), hit.slice(0, 5).join(","));
check("完全匹配排第一", searchIndex(entries, "abandon")[0].word === "abandon");
const mid = words(searchIndex(entries, "bandon"));
check("包含匹配 bandon 命中 abandon", mid.includes("abandon"));
const fuzzy = words(searchIndex(entries, "recieve"));
check("拼错 recieve 能找到 receive", fuzzy.includes("receive"), fuzzy.join(","));
const fuzzy2 = words(searchIndex(entries, "accomodation"));
check("拼错 accomodation 能找到 accommodation", fuzzy2.includes("accommodation"), fuzzy2.join(","));
check("无结果返回空", searchIndex(entries, "qqzzxx").length === 0);
check("大写输入正常", searchIndex(entries, "ABANDON")[0].word === "abandon");
check("中文输入不误入英文搜索", normalize("放弃") === "放弃");
check("hasCJK 识别中文", hasCJK("放弃") && !hasCJK("abandon"));

console.log("\n中文反查");
const chunkDir = path.join(ROOT, "data", "d");
const trans = new Map();
for (const f of fs.readdirSync(chunkDir)) {
  for (const [w, t] of Object.entries(JSON.parse(fs.readFileSync(path.join(chunkDir, f), "utf8")))) {
    trans.set(w, t);
  }
}
const fullList = entries.map(([w, uk, us]) => [w, uk, us, trans.get(w)]).filter((r) => r[3]);
check("分片覆盖全部词条", fullList.length === entries.length, `${fullList.length}/${entries.length}`);
const cn = words(searchChinese(fullList, "放弃"));
check("中文「放弃」命中 abandon", cn.includes("abandon"), cn.slice(0, 4).join(","));
const cn2 = words(searchChinese(fullList, "天文学"));
check("中文「天文学」命中 astronomy", cn2.includes("astronomy"), cn2.slice(0, 4).join(","));

console.log(failed ? `\n${failed} 项失败` : "\n全部通过");
process.exit(failed ? 1 : 0);
