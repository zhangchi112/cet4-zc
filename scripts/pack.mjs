#!/usr/bin/env node
/**
 * 打一个可以直接拖上静态托管的干净目录 dist/（不含原始词库和脚本）。
 *   node scripts/pack.mjs
 * 然后：Vercel / Netlify Drop 直接拖 dist 文件夹，或把 dist 推到 gh-pages 分支。
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const DIST = path.join(ROOT, "dist");

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

const copy = (from, to = from) => {
  const src = path.join(ROOT, from);
  const dest = path.join(DIST, to);
  if (!fs.existsSync(src)) {
    console.warn(`  跳过（不存在）：${from}`);
    return;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(src, dest, { recursive: true });
};

for (const item of ["index.html", "manifest.webmanifest", "sw.js", ".nojekyll", "assets", "icons"]) {
  copy(item);
}

// 只带运行时真正要用的数据：首屏索引 + 释义分片
copy("data/index.json", "data/index.json");
copy("data/d", "data/d");

let files = 0;
let bytes = 0;
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else {
      files++;
      bytes += fs.statSync(full).size;
    }
  }
};
walk(DIST);

console.log(`dist/ 已生成：${files} 个文件，共 ${(bytes / 1024 / 1024).toFixed(2)} MB`);
console.log("把这个文件夹拖到 Netlify Drop / Vercel 即可上线。");
