#!/usr/bin/env node
// Full Last Letter Library word-list scraper. Resumable, self-healing.
import { chromium } from "playwright";
import fs from "node:fs/promises";
import fsSync from "node:fs";

const BASE        = process.env.TARGET_URL ?? "https://lastletterlibrary.com";
const API_PATH    = "/api/words/game";
const SITEKEY     = "0x4AAAAAACr09WvFR-JJAZaD";   // site's Turnstile key
const LIMIT       = 100;
const ALPHABET    = [..."abcdefghijklmnopqrstuvwxyz-'"];
const MODE        = process.env.LIBRARY_MODE ?? "pro";   // "pro" or "casual"
const MIN_GAP_MS  = Number(process.env.MIN_GAP_MS ?? 15500);
const STATE_FILE  = process.env.STATE_FILE ?? "lll-state.json";
const OUT_FILE    = process.env.OUT_FILE ?? "words.txt";
// Optional sharding: run separate copies with ROOTS=a / ROOTS=b on other IPs.
const ROOTS       = [...(process.env.ROOTS ?? ALPHABET.join(""))];

let lastRequestAt = 0;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function loadState() {
  try {
    const s = JSON.parse(fsSync.readFileSync(STATE_FILE, "utf8"));
    return { queue: s.queue ?? [], done: new Set(s.done ?? []), words: new Set(s.words ?? []) };
  } catch {
    return { queue: [...ROOTS], done: new Set(), words: new Set() };
  }
}

async function save(state) {
  const tmp = STATE_FILE + ".tmp";
  await fs.writeFile(tmp, JSON.stringify({
    queue: state.queue, done: [...state.done], words: [...state.words]
  }));
  await fs.rename(tmp, STATE_FILE);
  await fs.writeFile(OUT_FILE, [...state.words].sort().join("\n") + "\n");
}

// Mint a fresh single-use Turnstile token from the page itself.
async function mintToken(page) {
  const token = await page.evaluate(({ sitekey }) => new Promise(resolve => {
    document.getElementById("lll-mint")?.remove();
    const host = document.createElement("div");
    host.id = "lll-mint";
    host.style.cssText = "position:fixed;left:0;bottom:0;width:300px;height:65px;overflow:hidden;z-index:2147483647";
    document.body.appendChild(host);
    let settled = false;
    const done = v => { if (!settled) { settled = true; resolve(v); } };
    try {
      window.turnstile.render(host, {
        sitekey, callback: t => done(t), "error-callback": () => done(null)
      });
    } catch { done(null); }
    setTimeout(() => done(null), 20000);
  }), { sitekey: SITEKEY }).catch(() => null);
  return token && token.length > 20 ? token : null;
}

async function search(page, prefix) {
  for (let attempt = 1; ; attempt++) {
    try {
      const wait = MIN_GAP_MS - (Date.now() - lastRequestAt);
      if (wait > 0) await sleep(wait);

      const token = await mintToken(page);
      if (!token) throw new Error("no Turnstile token");

      lastRequestAt = Date.now();
      const res = await page.evaluate(async ({ api, prefix, limit, mode, token }) => {
        const p = new URLSearchParams();
        p.set("startsWith", prefix); p.set("limit", String(limit)); p.set("activeMode", mode);
        const r = await fetch(`${api}?${p}`, {
          credentials: "include",
          headers: { "x-turnstile-token": token, accept: "application/json" }
        });
        return { status: r.status, text: await r.text() };
      }, { api: API_PATH, prefix, limit: LIMIT, mode: MODE, token });

      if (res.status === 429) {
        const m = res.text.match(/(\d+)\s*seconds?/i) || res.text.match(/wait\s*(\d+)/i);
        const secs = m ? Number(m[1]) : 12;
        console.log(`  429 on "${prefix}" — waiting ${secs + 1}s`);
        await sleep((secs + 1) * 1000);
        continue;
      }
      if (res.status === 401 || res.status === 403) {
        console.log(`  anti-bot ${res.status} on "${prefix}" — reload + retry`);
        await page.reload({ waitUntil: "domcontentloaded", timeout: 120000 }).catch(() => {});
        await sleep(2500);
        continue;
      }
      if (res.status !== 200 && res.status !== 304) {
        throw new Error(`HTTP ${res.status}: ${res.text.slice(0, 120)}`);
      }

      const data = JSON.parse(res.text);
      const arr = data.words ?? data.results ?? data.items ?? data.data ?? (Array.isArray(data) ? data : []);
      return arr
        .map(w => (typeof w === "string" ? w : w.word ?? w.name ?? w.text ?? w.value))
        .filter(Boolean).map(s => String(s).toLowerCase());
    } catch (err) {
      console.log(`  retry "${prefix}" (attempt ${attempt}): ${err.message}`);
      await sleep(Math.min(30000, 2000 * attempt));
    }
  }
}

async function main() {
  const state = loadState();
  const { queue, done, words } = state;

  const browser = await chromium.launch({
    headless: false, channel: "chrome",
    args: ["--disable-blink-features=AutomationControlled"]
  });
  const page = await browser.newPage();
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForFunction(() => window.turnstile?.render, null, { timeout: 60000 }).catch(() => {});
  await sleep(2000);

  while (queue.length) {
    const prefix = queue.shift();
    if (done.has(prefix)) continue;

    const found = await search(page, prefix);
    let added = 0;
    for (const w of found) if (!words.has(w)) { words.add(w); added++; }
    done.add(prefix);

    if (found.length >= LIMIT) {
      for (const c of ALPHABET) {
        const child = prefix + c;
        if (!done.has(child) && !queue.includes(child)) queue.push(child);
      }
    }

    await save(state);
    console.log(`"${prefix}": ${found.length} results, +${added} new, total ${words.size}, queue ${queue.length}`);
  }

  await save(state);
  console.log(`DONE. ${words.size} words -> ${OUT_FILE}`);
  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });