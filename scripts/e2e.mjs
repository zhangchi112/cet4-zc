#!/usr/bin/env node
/**
 * 用 Chrome DevTools Protocol 在手机尺寸下跑一遍界面，顺便截图。
 * 前提：先 `node scripts/dev-server.mjs` 起服务。
 *   node scripts/e2e.mjs [baseUrl] [outDir]
 * 依赖：本机 Chrome，零第三方包。
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const BASE = process.argv[2] || "http://127.0.0.1:4173/";
const OUT = path.resolve(process.argv[3] || ".shots");
const PORT = 9333;

const CHROME_CANDIDATES = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
];

const chromePath = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
if (!chromePath) {
  console.error("找不到 Chrome / Edge");
  process.exit(1);
}

fs.mkdirSync(OUT, { recursive: true });

const profile = fs.mkdtempSync(path.join(os.tmpdir(), "cet4-e2e-"));
const chrome = spawn(
  chromePath,
  [
    "--headless",
    "--disable-gpu",
    "--no-sandbox",
    "--hide-scrollbars",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--mute-audio",
    "--remote-allow-origins=*",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    "about:blank",
  ],
  { stdio: "ignore" }
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForDevtools() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (res.ok) return (await res.json()).webSocketDebuggerUrl;
    } catch {
      /* 还没起来 */
    }
    await sleep(250);
  }
  throw new Error("DevTools 没起来");
}

let nextId = 1;
const pending = new Map();
const events = [];
let ws;

function send(method, params = {}, sessionId) {
  const id = nextId++;
  const msg = { id, method, params };
  if (sessionId) msg.sessionId = sessionId;
  ws.send(JSON.stringify(msg));
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`${method} 超时`));
      }
    }, 15000);
  });
}

/** 在页面里跑一段 JS，返回结果 */
async function evaluate(expression, sessionId) {
  const res = await send(
    "Runtime.evaluate",
    { expression, awaitPromise: true, returnByValue: true },
    sessionId
  );
  if (res.exceptionDetails) {
    throw new Error(res.exceptionDetails.exception?.description || "页面脚本异常");
  }
  return res.result?.value;
}

async function shot(sessionId, name) {
  const res = await send(
    "Page.captureScreenshot",
    { format: "png", captureBeyondViewport: false },
    sessionId
  );
  const file = path.join(OUT, `${name}.png`);
  fs.writeFileSync(file, Buffer.from(res.data, "base64"));
  console.log(`  📸 ${name}.png`);
}

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? "  " + detail : ""}`);
}

async function main() {
  const browserWs = await waitForDevtools();
  ws = new WebSocket(browserWs);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });

  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
      return;
    }
    if (msg.method === "Runtime.exceptionThrown" || msg.method === "Log.entryAdded") {
      events.push(msg);
    }
  };

  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });

  await send("Page.enable", {}, sessionId);
  await send("Runtime.enable", {}, sessionId);
  await send("Log.enable", {}, sessionId);
  await send(
    "Emulation.setDeviceMetricsOverride",
    { width: 390, height: 844, deviceScaleFactor: 2, mobile: true },
    sessionId
  );
  await send(
    "Emulation.setEmulatedMedia",
    { features: [{ name: "prefers-color-scheme", value: "light" }] },
    sessionId
  );

  await send("Page.navigate", { url: BASE }, sessionId);
  await sleep(1500);

  // 等词库加载完
  for (let i = 0; i < 40; i++) {
    const ready = await evaluate("document.documentElement.dataset.ready === '1'", sessionId);
    if (ready) break;
    await sleep(200);
  }

  console.log("\n首页");
  const count = await evaluate("document.getElementById('wordCount').textContent", sessionId);
  check("词条数渲染为 3553", count === "3553", count);
  check(
    "页面无横向溢出",
    await evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1", sessionId)
  );
  await shot(sessionId, "01-home-light");

  console.log("\n英文搜索");
  await evaluate(
    `(() => { const q = document.getElementById('q'); q.value = 'aban';
      q.dispatchEvent(new Event('input', { bubbles: true })); })()`,
    sessionId
  );
  await sleep(400);
  const n = await evaluate("document.querySelectorAll('#results .item').length", sessionId);
  const first = await evaluate(
    "document.querySelector('#results .item-word')?.textContent",
    sessionId
  );
  check("输入 aban 有结果", n > 0, `${n} 条`);
  check("首条是 abandon", first === "abandon", String(first));
  await shot(sessionId, "02-search");

  console.log("\n词条详情");
  await evaluate(
    "document.querySelector('#results .item').click()",
    sessionId
  );
  await sleep(600);
  const word = await evaluate("document.querySelector('.word')?.textContent", sessionId);
  const senseCount = await evaluate("document.querySelectorAll('.sense-row').length", sessionId);
  const hash = await evaluate("location.hash", sessionId);
  check("详情页单词正确", word === "abandon", String(word));
  check("释义已加载（含多个词性行）", senseCount >= 2, `${senseCount} 行`);
  check("地址栏带上 #abandon", hash === "#abandon", hash);
  await shot(sessionId, "03-detail");

  // 发音：劫持 speechSynthesis，确认读的是单词而不是音标
  await evaluate(
    `(() => { window.__said = []; speechSynthesis.speak = (u) => window.__said.push(u.text); })()`,
    sessionId
  );
  await evaluate("document.querySelector('.phon-btn').click()", sessionId);
  await sleep(300);
  const said = await evaluate("window.__said[0]", sessionId);
  check("点音标读的是单词本身", said === "abandon", String(said));

  console.log("\n收藏");
  await evaluate("document.getElementById('starBtn').click()", sessionId);
  await sleep(300);
  const fav = await evaluate("localStorage.getItem('cet4.fav.v1')", sessionId);
  check("收藏写入 localStorage", String(fav).includes("abandon"), String(fav));
  check(
    "星标变亮",
    await evaluate("document.getElementById('starBtn').classList.contains('on')", sessionId)
  );

  console.log("\n查下一个词（底部快捷键）");
  await evaluate("document.getElementById('newSearchBtn').click()", sessionId);
  await sleep(500);
  check(
    "快捷键关闭详情",
    await evaluate("document.getElementById('detail').classList.contains('hidden')", sessionId)
  );
  check("搜索框已清空", await evaluate("document.getElementById('q').value === ''", sessionId));
  check(
    "焦点回到搜索框（键盘会弹出）",
    await evaluate("document.activeElement && document.activeElement.id === 'q'", sessionId)
  );
  check("地址栏 hash 已清除", await evaluate("location.hash === ''", sessionId));
  await shot(sessionId, "09-new-search");

  console.log("\n返回 + 生词本");
  // 重新查一个词，验证返回键的行为没被快捷键破坏
  await evaluate(
    `(() => { const q = document.getElementById('q'); q.value = 'aban';
      q.dispatchEvent(new Event('input', { bubbles: true })); })()`,
    sessionId
  );
  await sleep(400);
  await evaluate("document.querySelector('#results .item').click()", sessionId);
  await sleep(400);
  await evaluate("history.back()", sessionId);
  await sleep(400);
  check(
    "返回后关闭详情",
    await evaluate("document.getElementById('detail').classList.contains('hidden')", sessionId)
  );
  await evaluate("document.querySelector('.tab[data-tab=\"fav\"]').click()", sessionId);
  await sleep(300);
  check(
    "生词本里有 abandon",
    await evaluate(
      "document.querySelector('#favList .item-word')?.textContent === 'abandon'",
      sessionId
    )
  );
  await shot(sessionId, "04-favorites");

  console.log("\n中文反查");
  await evaluate("document.querySelector('.tab[data-tab=\"search\"]').click()", sessionId);
  await evaluate(
    `(() => { const q = document.getElementById('q'); q.value = '放弃';
      q.dispatchEvent(new Event('input', { bubbles: true })); })()`,
    sessionId
  );
  await sleep(1200);
  const cn = await evaluate(
    "Array.from(document.querySelectorAll('#results .item-word')).map(e => e.textContent).slice(0, 5).join(',')",
    sessionId
  );
  check("中文「放弃」能查到", String(cn).includes("abandon"), String(cn));
  await shot(sessionId, "05-chinese");

  console.log("\n设置面板 / 深色模式");
  await evaluate(
    `(() => { const q = document.getElementById('q'); q.value = '';
      q.dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('themeBtn').click(); })()`,
    sessionId
  );
  await sleep(400);
  check("设置面板弹出", await evaluate("!!document.querySelector('.sheet')", sessionId));
  await shot(sessionId, "06-settings");
  await evaluate(
    "Array.from(document.querySelectorAll('.seg-btn')).find(b => b.textContent === '深色').click()",
    sessionId
  );
  await sleep(300);
  check(
    "深色模式生效",
    await evaluate("document.documentElement.dataset.theme === 'dark'", sessionId)
  );
  await evaluate("document.querySelector('.sheet-mask').click()", sessionId);
  await sleep(300);
  await shot(sessionId, "07-home-dark");

  console.log("\n离线（Service Worker）");
  const sw = await evaluate(
    "navigator.serviceWorker.getRegistrations().then(r => r.length)",
    sessionId
  );
  check("Service Worker 已注册", sw > 0, `${sw} 个`);

  await send("Network.enable", {}, sessionId);
  await send(
    "Network.emulateNetworkConditions",
    { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 },
    sessionId
  );
  await send("Page.reload", {}, sessionId);
  await sleep(2500);
  const offlineCount = await evaluate(
    "document.getElementById('wordCount')?.textContent",
    sessionId
  );
  check("断网后仍能打开首页", offlineCount === "3553", String(offlineCount));
  check(
    "断网后仍能查词",
    await evaluate(
      `(async () => { const q = document.getElementById('q'); q.value = 'aban';
        q.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise(r => setTimeout(r, 500));
        return document.querySelectorAll('#results .item').length > 0; })()`,
      sessionId
    )
  );
  await shot(sessionId, "08-offline");
  await send(
    "Network.emulateNetworkConditions",
    { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 },
    sessionId
  );

  const errors = events.filter(
    (e) =>
      e.method === "Runtime.exceptionThrown" ||
      (e.method === "Log.entryAdded" && e.params?.entry?.level === "error")
  );
  check("控制台无报错", errors.length === 0, errors.map((e) => JSON.stringify(e.params).slice(0, 160)).join(" | "));

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} 项通过`);
  return failed.length;
}

main()
  .then((code) => finish(code))
  .catch((err) => {
    console.error("E2E 失败：", err.message);
    finish(1);
  });

function finish(code) {
  try {
    chrome.kill();
  } catch {
    /* ignore */
  }
  setTimeout(() => process.exit(code), 200);
}
