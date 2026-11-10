#!/usr/bin/env node
/**
 * 线上部署体检：确认 GitHub Pages 上跑的确实是最新代码。
 *   node scripts/verify-live.mjs [站点地址]
 */
const BASE = (process.argv[2] || "https://zhangchi112.github.io/cet4-zc/").replace(/\/?$/, "/");

const bust = () => `?v=${Date.now()}`;

async function get(path) {
  const res = await fetch(BASE + path + (path.includes("?") ? "" : bust()), {
    headers: { "User-Agent": "cet4-verify", "Cache-Control": "no-cache" },
  });
  const body = await res.text();
  return { status: res.status, type: res.headers.get("content-type") || "", body };
}

let failed = 0;
function check(name, ok, detail = "") {
  if (!ok) failed++;
  console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? "  " + detail : ""}`);
}

const html = await get("index.html");
check("首页可访问", html.status === 200, `HTTP ${html.status}`);
check("首页含「查下一个词」按钮", html.body.includes('id="newSearchBtn"'));

const app = await get("assets/app.js");
check("app.js 是最新版本", app.body.includes("startNewSearch"));
check("按钮文案已打包", app.body.includes("查下一个词"));

const css = await get("assets/style.css");
check("样式含悬浮按钮", css.body.includes(".fab {"));

const sw = await get("sw.js");
const version = (sw.body.match(/const VERSION = "([^"]+)"/) || [])[1];
check("Service Worker 版本已升级", version === "cet4-v2", version || "未找到");
check("sw.js MIME 正确", sw.type.includes("javascript"), sw.type);

const manifest = await get("manifest.webmanifest");
check("PWA 清单可访问", manifest.status === 200 && manifest.body.includes("四级词汇"));
check("清单 MIME 正确", manifest.type.includes("manifest+json"), manifest.type);

const data = await get("data/index.json");
let count = 0;
try {
  count = JSON.parse(data.body).meta.count;
} catch {
  /* 解析失败下面会报错 */
}
check("词库索引可访问", data.status === 200 && count === 3553, `${count} 词`);

const chunk = await get("data/d/a.json");
check("释义分片可访问", chunk.status === 200 && chunk.body.includes("abandon"));

console.log(`\n站点：${BASE}`);
console.log(failed ? `${failed} 项异常 —— 可能还在构建，等一分钟再跑` : "线上版本已是最新");
process.exit(failed ? 1 : 0);
