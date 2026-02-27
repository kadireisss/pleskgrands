#!/usr/bin/env node
/**
 * Static Mirror Crawler - Puppeteer ile CF bypass ederek siteyi indirir
 * Kullanım: node crawl-static.mjs
 */
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import fs from "fs";
import path from "path";
import https from "https";
import http from "http";
import { URL } from "url";

puppeteer.use(StealthPlugin());

// ══════════════════════════════════════════════
// AYARLAR
// ══════════════════════════════════════════════
const TARGET_ORIGIN = "https://grandpashabet7078.com";
const START_PATHS = [
  "/tr/",
];
const OUTPUT_DIR = "./static_mirror";
const DEVICE = "mobile"; // mobile veya desktop

const MOBILE_UA =
  "Mozilla/5.0 (Linux; Android 13; SM-S908B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";
const DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const VIEWPORT_MOBILE = { width: 412, height: 915, isMobile: true, hasTouch: true };
const VIEWPORT_DESKTOP = { width: 1920, height: 1080, isMobile: false, hasTouch: false };

// Proxy ayarları (.env'den veya manuel)
const PROXY_HOST = process.env.PROXY_HOST || "gw.dataimpulse.com";
const PROXY_PORT = process.env.PROXY_PORT || "823";
const PROXY_USER = process.env.PROXY_USER || "";
const PROXY_PASS = process.env.PROXY_PASS || "";

const MAX_PAGES = 30; // Maksimum sayfa sayısı
const PAGE_TIMEOUT = 60000; // 60 saniye
const WAIT_AFTER_LOAD = 5000; // Sayfa yüklendikten sonra bekleme

// ══════════════════════════════════════════════
const downloadedPages = new Set();
const downloadedAssets = new Set();
const pageQueue = [];
let totalSize = 0;

function log(tag, msg) {
  const time = new Date().toLocaleTimeString("tr-TR");
  console.log(`[${time}] [${tag}] ${msg}`);
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function urlToFilePath(urlStr, baseDir) {
  try {
    const u = new URL(urlStr, TARGET_ORIGIN);
    let p = u.pathname;
    if (!p || p === "/") p = "/index.html";
    if (p.endsWith("/")) p += "index.html";
    // HTML sayfaları için .html uzantısı ekle
    const ext = path.extname(p);
    if (!ext && !p.includes(".")) p += ".html";
    // Query string'i dosya adına ekle (cache busting için)
    if (u.search && (ext === ".js" || ext === ".css")) {
      const hash = u.search.replace(/[^a-zA-Z0-9]/g, "_").substring(0, 20);
      const base = p.substring(0, p.length - ext.length);
      p = `${base}_${hash}${ext}`;
    }
    p = p.replace(/\.\./g, "").replace(/\/+/g, "/");
    return path.join(baseDir, p);
  } catch {
    return path.join(baseDir, "unknown_" + Date.now());
  }
}

async function downloadAsset(url, cookies, outputDir) {
  if (downloadedAssets.has(url)) return;
  downloadedAssets.add(url);

  try {
    const u = new URL(url);
    const filePath = urlToFilePath(url, outputDir);
    
    if (fs.existsSync(filePath) && fs.statSync(filePath).size > 0) return;

    ensureDir(path.dirname(filePath));

    const data = await new Promise((resolve, reject) => {
      const isHttps = u.protocol === "https:";
      const mod = isHttps ? https : http;
      
      const options = {
        hostname: u.hostname,
        port: u.port || (isHttps ? 443 : 80),
        path: u.pathname + u.search,
        method: "GET",
        headers: {
          "Host": u.hostname,
          "User-Agent": DEVICE === "mobile" ? MOBILE_UA : DESKTOP_UA,
          "Accept": "*/*",
          "Accept-Language": "tr-TR,tr;q=0.9",
          "Cookie": cookies,
          "Referer": TARGET_ORIGIN + "/tr/",
        },
        timeout: 15000,
        rejectUnauthorized: false,
      };

      const req = mod.request(options, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          const loc = res.headers.location;
          if (loc) {
            downloadAsset(new URL(loc, url).href, cookies, outputDir).catch(() => {});
          }
          resolve(null);
          return;
        }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          if (res.statusCode === 200) {
            resolve(Buffer.concat(chunks));
          } else {
            resolve(null);
          }
        });
        res.on("error", reject);
      });
      req.on("error", reject);
      req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
      req.end();
    });

    if (data) {
      fs.writeFileSync(filePath, data);
      totalSize += data.length;
    }
  } catch (e) {
    // Sessiz geç
  }
}

function extractAssets(html, baseUrl) {
  const assets = new Set();
  const patterns = [
    /(?:src|href)=["']([^"']+\.(?:css|js|png|jpg|jpeg|gif|svg|ico|woff2?|ttf|eot|webp|avif)(?:\?[^"']*)?)['"]/gi,
    /url\(["']?([^"')]+\.(?:css|js|png|jpg|jpeg|gif|svg|ico|woff2?|ttf|eot|webp|avif)(?:\?[^"')]*)?)/gi,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      try {
        const absUrl = new URL(match[1], baseUrl).href;
        const u = new URL(absUrl);
        // Sadece target domain'den indir
        if (u.hostname.includes("grandpashabet")) {
          assets.add(absUrl);
        }
      } catch {}
    }
  }
  return Array.from(assets);
}

function extractPageLinks(html, baseUrl) {
  const links = new Set();
  const pattern = /href=["']([^"'#]+)["']/gi;
  let match;
  while ((match = pattern.exec(html)) !== null) {
    try {
      const absUrl = new URL(match[1], baseUrl).href;
      const u = new URL(absUrl);
      if (
        u.hostname.includes("grandpashabet") &&
        !u.pathname.match(/\.(css|js|png|jpg|jpeg|gif|svg|ico|woff2?|ttf|eot|webp|avif|pdf|zip)$/i) &&
        u.pathname.startsWith("/tr/")
      ) {
        links.add(u.origin + u.pathname);
      }
    } catch {}
  }
  return Array.from(links);
}

function rewriteHtml(html, targetOrigin, localBase) {
  // Target domain linklerini göreceli yollara çevir
  let result = html;
  
  // https://grandpashabet7078.com/... → /...
  result = result.replace(
    new RegExp(targetOrigin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(/[^\"'\\s]*)", "gi"),
    "$1"
  );
  
  // Mutlak yolları göreceli yap (opsiyonel)
  // result = result.replace(/href="\//g, 'href="./');
  // result = result.replace(/src="\//g, 'src="./');

  return result;
}

async function main() {
  log("START", "Static Mirror Crawler başlatılıyor...");
  log("START", `Target: ${TARGET_ORIGIN}`);
  log("START", `Output: ${OUTPUT_DIR}`);
  log("START", `Device: ${DEVICE}`);

  ensureDir(OUTPUT_DIR);

  // Chromium bul
  const chromePaths = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    process.env.CHROMIUM_PATH,
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
    "/usr/bin/google-chrome-stable",
    "/snap/bin/chromium",
  ].filter(Boolean);

  let execPath = null;
  for (const p of chromePaths) {
    if (fs.existsSync(p)) { execPath = p; break; }
  }
  if (!execPath) {
    log("ERROR", "Chromium bulunamadı! PUPPETEER_EXECUTABLE_PATH ayarlayın.");
    process.exit(1);
  }
  log("BROWSER", `Chromium: ${execPath}`);

  // Puppeteer args
  const args = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--disable-web-security",
    "--disable-features=IsolateOrigins,site-per-process",
    "--lang=tr-TR",
  ];

  if (PROXY_HOST && PROXY_PORT) {
    args.push(`--proxy-server=http://${PROXY_HOST}:${PROXY_PORT}`);
    log("PROXY", `Proxy: ${PROXY_HOST}:${PROXY_PORT}`);
  }

  const browser = await puppeteer.launch({
    executablePath: execPath,
    headless: "new",
    args,
    defaultViewport: DEVICE === "mobile" ? VIEWPORT_MOBILE : VIEWPORT_DESKTOP,
  });

  const page = await browser.newPage();

  // Proxy auth
  if (PROXY_USER && PROXY_PASS) {
    await page.authenticate({ username: PROXY_USER, password: PROXY_PASS });
    log("PROXY", "Proxy kimlik doğrulaması ayarlandı");
  }

  // User agent
  await page.setUserAgent(DEVICE === "mobile" ? MOBILE_UA : DESKTOP_UA);

  // Ekstra headerlar
  await page.setExtraHTTPHeaders({
    "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7",
  });

  // ── CF Bypass: İlk sayfa ──
  log("CF", "Cloudflare bypass deneniyor...");
  try {
    await page.goto(TARGET_ORIGIN + "/tr/", {
      waitUntil: "networkidle2",
      timeout: PAGE_TIMEOUT,
    });

    // CF challenge bekleme
    let retries = 0;
    while (retries < 5) {
      const title = await page.title();
      const content = await page.content();
      if (
        title.includes("Just a moment") ||
        content.includes("cf-challenge") ||
        content.includes("challenge-platform")
      ) {
        log("CF", `Challenge tespit edildi, bekleniyor... (${retries + 1}/5)`);
        await new Promise((r) => setTimeout(r, 8000));
        retries++;
      } else {
        break;
      }
    }

    const cookies = await page.cookies();
    const cfClearance = cookies.find((c) => c.name === "cf_clearance");
    if (cfClearance) {
      log("CF", `✓ cf_clearance alındı: ${cfClearance.value.substring(0, 20)}...`);
    } else {
      log("CF", "⚠ cf_clearance bulunamadı, devam ediliyor...");
    }

    // Cookie string oluştur (asset indirme için)
    const cookieStr = cookies.map((c) => `${c.name}=${c.value}`).join("; ");

    log("CF", `${cookies.length} cookie alındı`);

    // ── SAYFA CRAWL ──
    for (const startPath of START_PATHS) {
      if (!pageQueue.includes(TARGET_ORIGIN + startPath)) {
        pageQueue.push(TARGET_ORIGIN + startPath);
      }
    }

    while (pageQueue.length > 0 && downloadedPages.size < MAX_PAGES) {
      const pageUrl = pageQueue.shift();
      if (downloadedPages.has(pageUrl)) continue;
      downloadedPages.add(pageUrl);

      const pageNum = downloadedPages.size;
      log("PAGE", `[${pageNum}/${MAX_PAGES}] ${pageUrl}`);

      try {
        await page.goto(pageUrl, {
          waitUntil: "networkidle2",
          timeout: PAGE_TIMEOUT,
        });

        // Sayfa yüklendikten sonra bekle (JS render için)
        await new Promise((r) => setTimeout(r, WAIT_AFTER_LOAD));

        // Scroll down (lazy load tetikleme)
        await page.evaluate(async () => {
          for (let i = 0; i < 5; i++) {
            window.scrollBy(0, window.innerHeight);
            await new Promise((r) => setTimeout(r, 500));
          }
          window.scrollTo(0, 0);
        });

        await new Promise((r) => setTimeout(r, 2000));

        // HTML al
        let html = await page.content();
        
        // Linkleri çıkar (crawl kuyruğuna ekle)
        const links = extractPageLinks(html, pageUrl);
        for (const link of links) {
          if (!downloadedPages.has(link) && !pageQueue.includes(link)) {
            pageQueue.push(link);
          }
        }
        log("LINKS", `${links.length} link bulundu, kuyrukta ${pageQueue.length} sayfa`);

        // Asset URL'lerini çıkar
        const assets = extractAssets(html, pageUrl);
        log("ASSETS", `${assets.length} asset bulundu`);

        // HTML'i yeniden yaz
        html = rewriteHtml(html, TARGET_ORIGIN, "");

        // HTML kaydet
        const htmlPath = urlToFilePath(pageUrl, OUTPUT_DIR);
        ensureDir(path.dirname(htmlPath));
        fs.writeFileSync(htmlPath, html, "utf-8");
        totalSize += Buffer.byteLength(html);
        log("SAVE", `${htmlPath} (${(Buffer.byteLength(html) / 1024).toFixed(0)}KB)`);

        // Screenshot (opsiyonel, debug için)
        const ssPath = htmlPath.replace(/\.html$/, ".png");
        await page.screenshot({ path: ssPath, fullPage: false }).catch(() => {});

        // Assetleri indir (paralel, 5'er 5'er)
        const batchSize = 5;
        for (let i = 0; i < assets.length; i += batchSize) {
          const batch = assets.slice(i, i + batchSize);
          await Promise.allSettled(
            batch.map((a) => downloadAsset(a, cookieStr, OUTPUT_DIR))
          );
        }
        log("ASSETS", `${downloadedAssets.size} toplam asset indirildi`);

      } catch (e) {
        log("ERROR", `Sayfa hatası: ${e.message}`);
      }
    }

    // ── Sonuç ──
    const sizeStr = (totalSize / 1024 / 1024).toFixed(2);
    log("DONE", "═══════════════════════════════════════");
    log("DONE", `Sayfalar: ${downloadedPages.size}`);
    log("DONE", `Assetler: ${downloadedAssets.size}`);
    log("DONE", `Toplam: ${sizeStr} MB`);
    log("DONE", `Çıktı: ${path.resolve(OUTPUT_DIR)}`);
    log("DONE", "═══════════════════════════════════════");

    // index.html oluştur (redirect)
    const indexPath = path.join(OUTPUT_DIR, "index.html");
    if (!fs.existsSync(indexPath)) {
      fs.writeFileSync(
        indexPath,
        `<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0;url=/tr/index.html"></head><body>Yönlendiriliyor...</body></html>`
      );
    }

  } catch (e) {
    log("FATAL", `Hata: ${e.message}`);
  } finally {
    await browser.close();
    log("END", "Tarayıcı kapatıldı");
  }
}

main().catch(console.error);
