import fs from "fs";
import path from "path";
import https from "https";
import http from "http";
import zlib from "zlib";
import { HttpsProxyAgent } from "https-proxy-agent";
import { getTargetUrl } from "./target-config";

const SNAPSHOTS_DIR = path.resolve(process.cwd(), "snapshots");

interface SnapshotInfo {
  id: string;
  name: string;
  createdAt: string;
  pageCount: number;
  assetCount: number;
  totalSize: number;
  targetUrl: string;
  active: boolean;
}

interface SnapshotProgress {
  status: "idle" | "running" | "done" | "error";
  current: string;
  pagesDownloaded: number;
  assetsDownloaded: number;
  totalSize: number;
  errors: string[];
  startedAt?: string;
}

let currentProgress: SnapshotProgress = {
  status: "idle",
  current: "",
  pagesDownloaded: 0,
  assetsDownloaded: 0,
  totalSize: 0,
  errors: [],
};

let activeSnapshotId: string | null = null;

function log(tag: string, msg: string) {
  console.log(`[${tag}] ${msg}`);
}

function ensureDir(dirPath: string) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function sanitizePath(urlPath: string): string {
  let p = urlPath.replace(/^https?:\/\/[^\/]+/, "");
  p = p.split("?")[0].split("#")[0];
  if (!p || p === "/") p = "/index.html";
  if (p.endsWith("/")) p += "index.html";
  if (!path.extname(p) && !p.endsWith(".html")) p += ".html";
  p = p.replace(/\.\./g, "").replace(/\/+/g, "/");
  return p;
}

function sanitizeAssetPath(urlPath: string): string {
  let p = urlPath.replace(/^https?:\/\/[^\/]+/, "");
  p = p.split("?")[0].split("#")[0];
  if (!p || p === "/") return "/assets/unknown";
  p = p.replace(/\.\./g, "").replace(/\/+/g, "/");
  return p;
}

function getContentCategory(contentType: string, urlPath: string): string {
  const ct = (contentType || "").toLowerCase();
  if (ct.includes("text/html") || ct.includes("application/xhtml")) return "html";
  if (ct.includes("text/css")) return "css";
  if (ct.includes("javascript") || ct.includes("ecmascript")) return "js";
  if (ct.includes("image/")) return "image";
  if (ct.includes("font/") || ct.includes("application/font") || ct.includes("application/x-font")) return "font";
  if (ct.includes("application/json")) return "json";
  if (ct.includes("text/xml") || ct.includes("application/xml")) return "xml";

  const ext = path.extname(urlPath).toLowerCase();
  if ([".html", ".htm"].includes(ext)) return "html";
  if ([".css"].includes(ext)) return "css";
  if ([".js", ".mjs"].includes(ext)) return "js";
  if ([".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".ico", ".avif"].includes(ext)) return "image";
  if ([".woff", ".woff2", ".ttf", ".eot", ".otf"].includes(ext)) return "font";
  if ([".json"].includes(ext)) return "json";
  return "other";
}

async function fetchUrl(
  url: string,
  cookies: string,
  userAgent: string,
  proxyAgent?: HttpsProxyAgent<string>,
  isBinary = false
): Promise<{ data: Buffer; contentType: string; statusCode: number }> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const isHttps = parsedUrl.protocol === "https:";
    const reqModule = isHttps ? https : http;

    const options: any = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: "GET",
      headers: {
        "Host": parsedUrl.hostname,
        "User-Agent": userAgent,
        "Accept": "*/*",
        "Accept-Encoding": "gzip, deflate, br",
        "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7",
        "Cookie": cookies,
        "Referer": `${parsedUrl.protocol}//${parsedUrl.hostname}/`,
      },
      timeout: 15000,
      rejectUnauthorized: false,
    };

    if (isHttps && proxyAgent) {
      options.agent = proxyAgent;
    }

    const req = reqModule.request(options, (res) => {
      const encoding = res.headers["content-encoding"];
      let stream: NodeJS.ReadableStream = res;
      if (encoding === "gzip") stream = res.pipe(zlib.createGunzip());
      else if (encoding === "deflate") stream = res.pipe(zlib.createInflate());
      else if (encoding === "br") stream = res.pipe(zlib.createBrotliDecompress());

      const chunks: Buffer[] = [];
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("end", () => {
        resolve({
          data: Buffer.concat(chunks),
          contentType: res.headers["content-type"] || "text/html",
          statusCode: res.statusCode || 200,
        });
      });
      stream.on("error", reject);
    });

    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Timeout"));
    });
    req.end();
  });
}

function extractAssetUrls(html: string, baseUrl: string): string[] {
  const urls = new Set<string>();
  const baseOrigin = new URL(baseUrl).origin;

  const patterns = [
    /(?:href|src|data-src|data-image|data-bg|poster)=["']([^"']+)["']/gi,
    /url\(\s*["']?([^"')]+)["']?\s*\)/gi,
    /srcset=["']([^"']+)["']/gi,
  ];

  const skipPatterns = [
    /\s/,
    /[{}]/,
    /\+\s/,
    /pageUrl/i,
    /loginHref/i,
    /^\w+basli/i,
    /^mailto:/i,
    /^tel:/i,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      let urlStr = match[1];
      if (!urlStr) continue;

      if (skipPatterns.some(p => p.test(urlStr))) continue;
      if (urlStr.startsWith("data:") || urlStr.startsWith("blob:") || urlStr.startsWith("javascript:") || urlStr === "#" || urlStr === ".") continue;

      const hasAssetExt = /\.(css|js|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|webp|avif|mp4|webm|json|xml)(\?|$)/i.test(urlStr);
      if (!hasAssetExt && !urlStr.includes("/plat/prd/") && !urlStr.includes("/cdn")) continue;

      if (urlStr.startsWith("//")) {
        urls.add("https:" + urlStr);
        continue;
      }
      if (urlStr.startsWith("/")) {
        urls.add(baseOrigin + urlStr);
        continue;
      }
      if (urlStr.startsWith("http://") || urlStr.startsWith("https://")) {
        urls.add(urlStr);
        continue;
      }
      urls.add(baseOrigin + "/" + urlStr);
    }
  }

  return Array.from(urls);
}

function extractCssUrls(css: string, baseUrl: string): string[] {
  const urls = new Set<string>();
  const baseOrigin = new URL(baseUrl).origin;
  const basePath = baseUrl.substring(0, baseUrl.lastIndexOf("/") + 1);

  const urlPattern = /url\(\s*["']?([^"')]+)["']?\s*\)/gi;
  const importPattern = /@import\s+["']([^"']+)["']/gi;

  for (const pattern of [urlPattern, importPattern]) {
    let match;
    while ((match = pattern.exec(css)) !== null) {
      let urlStr = match[1];
      if (!urlStr || urlStr.startsWith("data:")) continue;
      if (urlStr.startsWith("//")) {
        urls.add("https:" + urlStr);
      } else if (urlStr.startsWith("/")) {
        urls.add(baseOrigin + urlStr);
      } else if (urlStr.startsWith("http")) {
        urls.add(urlStr);
      } else {
        urls.add(basePath + urlStr);
      }
    }
  }

  return Array.from(urls);
}

function rewriteUrlsForLocal(content: string, targetOrigin: string, snapshotBasePath: string): string {
  let result = content;
  const targetHostPattern = targetOrigin.replace(/https?:\/\//, "").replace(/\./g, "\\.").replace(/\d+/, "\\d*");
  const fullPattern = new RegExp(`https?://${targetHostPattern}`, "gi");
  result = result.replace(fullPattern, snapshotBasePath);
  const protoRelPattern = new RegExp(`//${targetHostPattern}`, "gi");
  result = result.replace(protoRelPattern, snapshotBasePath || "");
  return result;
}

function rewriteCssUrlsToRelative(css: string, cssFilePath: string, targetOrigin: string): string {
  let result = rewriteUrlsForLocal(css, targetOrigin, "");
  result = result.replace(/url\(\s*["']?(\/[^"')]+)["']?\s*\)/gi, (match, urlPath) => {
    return `url(${urlPath})`;
  });
  return result;
}

const MOBILE_USER_AGENT = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

export async function createSnapshot(
  targetUrl: string,
  targetHost: string,
  cookies: Map<string, string>,
  userAgent: string,
  proxyAgent?: HttpsProxyAgent<string>,
  pagePaths: string[] = ["/tr/"],
  deviceType: "mobile" | "desktop" = "mobile"
): Promise<SnapshotInfo> {
  const effectiveUA = deviceType === "mobile" ? MOBILE_USER_AGENT : userAgent;
  const snapshotId = `snapshot_${Date.now()}`;
  const snapshotDir = path.join(SNAPSHOTS_DIR, snapshotId);
  ensureDir(snapshotDir);

  currentProgress = {
    status: "running",
    current: "Başlatılıyor...",
    pagesDownloaded: 0,
    assetsDownloaded: 0,
    totalSize: 0,
    errors: [],
    startedAt: new Date().toISOString(),
  };

  const cookieString = Array.from(cookies.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");

  const targetOrigin = `https://${targetHost}`;
  const downloadedUrls = new Set<string>();
  const assetQueue: string[] = [];
  let totalSize = 0;
  let pageCount = 0;
  let assetCount = 0;

  const targetDomainPattern = /grandpashabet\d*\.com/i;

  function isTargetDomain(url: string): boolean {
    try {
      const u = new URL(url);
      return targetDomainPattern.test(u.hostname);
    } catch {
      return false;
    }
  }

  function extractPageLinks(html: string, baseUrl: string): string[] {
    const links: string[] = [];
    const linkRegex = /href="(\/[^"]*?)"/gi;
    let match;
    while ((match = linkRegex.exec(html)) !== null) {
      let href = match[1].trim();
      if (!href || href === "/") continue;
      if (href.startsWith("//")) continue;
      if (/\.(css|js|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|mp4|webm|mp3)(\?|$)/i.test(href)) continue;
      if (href.includes("cdn-cgi")) continue;
      links.push(href);
    }
    const unique = new Set(links);
    return Array.from(unique);
  }

  const MAX_PAGES = 100;
  const downloadedPages = new Set<string>();

  async function downloadPage(pagePath: string): Promise<string[]> {
    const fullUrl = targetOrigin + pagePath;
    if (downloadedUrls.has(fullUrl) || downloadedPages.has(pagePath)) return [];
    downloadedUrls.add(fullUrl);
    downloadedPages.add(pagePath);

    currentProgress.current = `Sayfa: ${pagePath}`;

    try {
      let result = await fetchUrl(fullUrl, cookieString, effectiveUA, proxyAgent);

      if (result.statusCode === 403) {
        log("SNAPSHOT", `Page ${pagePath}: 403 alındı, 2s bekleyip tekrar deneniyor...`);
        await new Promise(r => setTimeout(r, 2000));
        result = await fetchUrl(fullUrl, cookieString, effectiveUA, proxyAgent);
      }

      if (result.statusCode >= 400) {
        currentProgress.errors.push(`Page ${pagePath}: HTTP ${result.statusCode}`);
        return [];
      }

      const contentType = result.contentType || "";
      if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
        return [];
      }

      let html = result.data.toString("utf-8");

      const assetUrls = extractAssetUrls(html, fullUrl);
      for (const assetUrl of assetUrls) {
        if (!downloadedUrls.has(assetUrl) && !assetQueue.includes(assetUrl)) {
          if (isTargetDomain(assetUrl) || assetUrl.startsWith(targetOrigin)) {
            assetQueue.push(assetUrl);
          }
        }
      }

      const discoveredLinks = extractPageLinks(html, fullUrl);

      html = rewriteUrlsForLocal(html, targetOrigin, "");

      html = html.replace(
        /(\s(?:href)=["'])(\/(?:tr|sections|home|promotions|promo|sport|sports|esport|account|Account|registration|referafriend|bonus|lobby|play|Home|Scripts|agent)\b[^"']*)(["'])/gi,
        '$1/snapshot$2$3'
      );

      const filePath = sanitizePath(pagePath);
      const fullFilePath = path.join(snapshotDir, filePath);
      ensureDir(path.dirname(fullFilePath));
      fs.writeFileSync(fullFilePath, html, "utf-8");
      totalSize += Buffer.byteLength(html);
      pageCount++;
      currentProgress.pagesDownloaded = pageCount;
      currentProgress.totalSize = totalSize;

      return discoveredLinks;
    } catch (err: any) {
      log("SNAPSHOT", `Error downloading page ${pagePath}: ${err.message}`);
      currentProgress.errors.push(`Page ${pagePath}: ${err.message}`);
      return [];
    }
  }

  try {
    const CONCURRENCY = 10;

    const pageQueue = [...pagePaths];
    let pageIdx = 0;

    while (pageIdx < pageQueue.length && downloadedPages.size < MAX_PAGES) {
      const batch: string[] = [];
      while (batch.length < CONCURRENCY && pageIdx < pageQueue.length && downloadedPages.size + batch.length < MAX_PAGES) {
        const p = pageQueue[pageIdx++];
        if (!downloadedPages.has(p)) batch.push(p);
      }
      if (batch.length === 0) break;

      const results = await Promise.allSettled(batch.map(p => downloadPage(p)));
      for (const r of results) {
        if (r.status === "fulfilled") {
          for (const link of r.value) {
            if (!downloadedPages.has(link) && !pageQueue.includes(link) && pageQueue.length < MAX_PAGES * 2) {
              pageQueue.push(link);
            }
          }
        }
      }
    }

    const processedAssets = new Set<string>();
    const MAX_ASSETS = 500;
    let assetIdx = 0;

    const downloadAsset = async (assetUrl: string): Promise<void> => {
      try {
        const parsedAssetUrl = new URL(assetUrl);
        const assetPath = sanitizeAssetPath(parsedAssetUrl.pathname);
        const destPath = path.join(snapshotDir, assetPath);

        if (fs.existsSync(destPath) && fs.statSync(destPath).isDirectory()) {
          return;
        }
        const parentDir = path.dirname(destPath);
        const parts = parentDir.split(path.sep);
        for (let i = 1; i <= parts.length; i++) {
          const partial = parts.slice(0, i).join(path.sep);
          if (fs.existsSync(partial) && fs.statSync(partial).isFile()) {
            return;
          }
        }

        const useProxy = isTargetDomain(assetUrl);
        let result = await fetchUrl(
          assetUrl,
          cookieString,
          effectiveUA,
          useProxy ? proxyAgent : undefined,
          true
        );

        if (result.statusCode === 403) {
          await new Promise(r => setTimeout(r, 1000));
          result = await fetchUrl(assetUrl, cookieString, effectiveUA, useProxy ? proxyAgent : undefined, true);
        }

        if (result.statusCode >= 400) {
          currentProgress.errors.push(`Asset ${assetPath}: HTTP ${result.statusCode}`);
          return;
        }

        const category = getContentCategory(result.contentType, assetPath);

        let data = result.data;
        if (category === "css") {
          let cssText = data.toString("utf-8");
          const cssAssetUrls = extractCssUrls(cssText, assetUrl);
          for (const cssAssetUrl of cssAssetUrls) {
            if (!downloadedUrls.has(cssAssetUrl) && !assetQueue.includes(cssAssetUrl)) {
              if (isTargetDomain(cssAssetUrl)) {
                assetQueue.push(cssAssetUrl);
              }
            }
          }
          cssText = rewriteCssUrlsToRelative(cssText, assetPath, targetOrigin);
          data = Buffer.from(cssText, "utf-8");
        } else if (category === "js") {
          let jsText = data.toString("utf-8");
          jsText = rewriteUrlsForLocal(jsText, targetOrigin, "");
          data = Buffer.from(jsText, "utf-8");
        }

        ensureDir(path.dirname(destPath));
        fs.writeFileSync(destPath, data);
        totalSize += data.length;
        assetCount++;
        currentProgress.assetsDownloaded = assetCount;
        currentProgress.totalSize = totalSize;
      } catch (err: any) {
        currentProgress.errors.push(`Asset: ${err.message}`);
      }
    }

    while (assetIdx < assetQueue.length && processedAssets.size < MAX_ASSETS) {
      const batch: string[] = [];
      while (batch.length < CONCURRENCY && assetIdx < assetQueue.length && processedAssets.size + batch.length < MAX_ASSETS) {
        const assetUrl = assetQueue[assetIdx++];
        if (processedAssets.has(assetUrl) || downloadedUrls.has(assetUrl)) continue;
        processedAssets.add(assetUrl);
        downloadedUrls.add(assetUrl);
        batch.push(assetUrl);
      }
      if (batch.length === 0) break;

      currentProgress.current = `${batch.length} asset paralel indiriliyor... (${assetCount}/${assetQueue.length})`;
      await Promise.allSettled(batch.map(url => downloadAsset(url)));
    }

    const rootIndex = path.join(snapshotDir, "index.html");
    if (!fs.existsSync(rootIndex)) {
      const trIndex = path.join(snapshotDir, "tr", "index.html");
      if (fs.existsSync(trIndex)) {
        const redirectHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=/snapshot/tr/"><title>Redirect</title></head><body></body></html>`;
        fs.writeFileSync(rootIndex, redirectHtml, "utf-8");
      }
    }

    const info: SnapshotInfo = {
      id: snapshotId,
      name: snapshotId,
      createdAt: new Date().toISOString(),
      pageCount,
      assetCount,
      totalSize,
      targetUrl,
      active: false,
    };

    fs.writeFileSync(path.join(snapshotDir, "snapshot.json"), JSON.stringify(info, null, 2));

    currentProgress.status = "done";
    currentProgress.current = "Tamamlandı!";
    log("SNAPSHOT", `Snapshot complete: ${pageCount} pages, ${assetCount} assets, ${(totalSize / 1024 / 1024).toFixed(2)}MB`);

    return info;
  } catch (err: any) {
    currentProgress.status = "error";
    currentProgress.current = `Hata: ${err.message}`;
    log("SNAPSHOT", `Error: ${err.message}`);
    throw err;
  }
}

export function getSnapshotProgress(): SnapshotProgress {
  return { ...currentProgress };
}

function autoGenerateSnapshotJson(dirName: string): SnapshotInfo | null {
  const dirPath = path.join(SNAPSHOTS_DIR, dirName);
  try {
    const stat = fs.statSync(dirPath);
    if (!stat.isDirectory()) return null;

    const hasContent = fs.readdirSync(dirPath).some((entry) => {
      const entryPath = path.join(dirPath, entry);
      return fs.statSync(entryPath).isDirectory();
    });
    if (!hasContent) return null;

    let pageCount = 0;
    let assetCount = 0;
    let totalSize = 0;

    const walkDir = (dir: string) => {
      const entries = fs.readdirSync(dir);
      for (const entry of entries) {
        const fullPath = path.join(dir, entry);
        const entryStat = fs.statSync(fullPath);
        if (entryStat.isDirectory()) {
          walkDir(fullPath);
        } else if (entryStat.isFile()) {
          totalSize += entryStat.size;
          if (entry.endsWith(".html") || entry.endsWith(".htm")) {
            pageCount++;
          } else {
            assetCount++;
          }
        }
      }
    };

    walkDir(dirPath);

    const info: SnapshotInfo = {
      id: dirName,
      name: dirName,
      createdAt: stat.mtime.toISOString(),
      pageCount,
      assetCount,
      totalSize,
      targetUrl: getTargetUrl(),
      active: false,
    };

    fs.writeFileSync(path.join(dirPath, "snapshot.json"), JSON.stringify(info, null, 2));
    log("SNAPSHOT", `Auto-generated snapshot.json for ${dirName}: ${pageCount} pages, ${assetCount} assets`);
    return info;
  } catch (err: any) {
    log("SNAPSHOT", `Failed to auto-generate snapshot.json for ${dirName}: ${err.message}`);
    return null;
  }
}

export function listSnapshots(): SnapshotInfo[] {
  ensureDir(SNAPSHOTS_DIR);
  const allDirs = fs.readdirSync(SNAPSHOTS_DIR).filter((d) => {
    const fullPath = path.join(SNAPSHOTS_DIR, d);
    return fs.statSync(fullPath).isDirectory();
  });

  for (const d of allDirs) {
    const jsonPath = path.join(SNAPSHOTS_DIR, d, "snapshot.json");
    if (!fs.existsSync(jsonPath)) {
      autoGenerateSnapshotJson(d);
    }
  }

  const dirs = allDirs.filter((d) => {
    return fs.existsSync(path.join(SNAPSHOTS_DIR, d, "snapshot.json"));
  });

  return dirs
    .map((d) => {
      try {
        const info = JSON.parse(fs.readFileSync(path.join(SNAPSHOTS_DIR, d, "snapshot.json"), "utf-8"));
        info.active = d === activeSnapshotId;
        return info;
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export function activateSnapshot(snapshotId: string): boolean {
  const snapshotDir = path.join(SNAPSHOTS_DIR, snapshotId);
  if (!fs.existsSync(snapshotDir)) return false;
  if (!fs.existsSync(path.join(snapshotDir, "snapshot.json"))) {
    autoGenerateSnapshotJson(snapshotId);
  }
  if (!fs.existsSync(path.join(snapshotDir, "snapshot.json"))) return false;
  activeSnapshotId = snapshotId;
  log("SNAPSHOT", `Activated snapshot: ${snapshotId}`);
  return true;
}

export function deactivateSnapshot(): void {
  activeSnapshotId = null;
  log("SNAPSHOT", "Snapshot deactivated, proxy mode active");
}

export function getActiveSnapshotId(): string | null {
  return activeSnapshotId;
}

export function getActiveSnapshotDir(): string | null {
  if (!activeSnapshotId) return null;
  const dir = path.join(SNAPSHOTS_DIR, activeSnapshotId);
  if (!fs.existsSync(dir)) {
    activeSnapshotId = null;
    return null;
  }
  return dir;
}

export function deleteSnapshot(snapshotId: string): boolean {
  const snapshotDir = path.join(SNAPSHOTS_DIR, snapshotId);
  if (!fs.existsSync(snapshotDir)) return false;
  if (activeSnapshotId === snapshotId) activeSnapshotId = null;
  fs.rmSync(snapshotDir, { recursive: true, force: true });
  log("SNAPSHOT", `Deleted snapshot: ${snapshotId}`);
  return true;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / 1024 / 1024).toFixed(2) + " MB";
}
