import fs from "fs";
import path from "path";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import type { Page } from "puppeteer-core";
const stealthPlugin = StealthPlugin();
puppeteer.use(stealthPlugin);

import { getTargetUrl, getTargetHost } from "./target-config";
import { solveTurnstile } from "./captcha-solver";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36";

const PROXY_HOST = process.env.PROXY_HOST || "gw.dataimpulse.com";
const PROXY_PORT = process.env.PROXY_PORT || "823";
const PROXY_USER = process.env.PROXY_USER || "";
const PROXY_PASS = process.env.PROXY_PASS || "";
let browser: any = null;
let puppeteerSessionId = generateSessionId();

interface CloudflareCookies {
  cfBm: string;
  cfClearance: string;
  cfuvid: string;
  allCookies: Record<string, string>;
  userAgent: string;
}

let cachedCookies: CloudflareCookies | null = null;
let lastRefresh: number = 0;
const COOKIE_TTL = 8 * 60 * 1000;

let globalCfClearance: string | null = null;
let globalUserAgent: string = USER_AGENT;

let bypassInProgress: Promise<CloudflareCookies | null> | null = null;
let lastBypassError: string = "";

function generateSessionId(): string {
  return Math.random().toString(16).substring(2, 18);
}

function getProxyUsername(): string {
  return `${PROXY_USER}_session-${puppeteerSessionId}`;
}

function getProxyUrl(): string {
  return `http://${getProxyUsername()}:${PROXY_PASS}@${PROXY_HOST}:${PROXY_PORT}`;
}

function log(tag: string, msg: string) {
  console.log(`[${tag}] ${msg}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getChromePath(): string | undefined {
  const envPath = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROMIUM_PATH;
  if (envPath && fs.existsSync(envPath)) return envPath;

  const isWin = process.platform === "win32";
  if (isWin) {
    const winPaths = [
      process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe") : "",
      process.env.PROGRAMFILES ? path.join(process.env.PROGRAMFILES, "Google", "Chrome", "Application", "chrome.exe") : "",
      process.env["PROGRAMFILES(X86)"] ? path.join(process.env["PROGRAMFILES(X86)"], "Google", "Chrome", "Application", "chrome.exe") : "",
    ].filter(Boolean);
    for (const p of winPaths) {
      if (fs.existsSync(p)) return p;
    }
  } else {
    // chromium-browser genelde Snap shim; önce gerçek chromium'u dene
    const linuxPaths = [
      "/usr/bin/chromium",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/google-chrome",
      "/usr/bin/chromium-browser",
      "/usr/lib/chromium-browser/chromium-browser",
      "/usr/lib64/chromium-browser/chromium-browser",
    ];
    for (const p of linuxPaths) {
      if (fs.existsSync(p)) return p;
    }
  }
  return undefined;
}

async function launchBrowser(): Promise<any> {
  if (browser) {
    try {
      const pages = await browser.pages();
      if (pages.length >= 0) return browser;
    } catch {
      browser = null;
    }
  }

  log("BROWSER", "Launching with stealth + proxy...");

  const chromePath = getChromePath();

  const launchOptions: any = {
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-software-rasterizer",
      "--disable-extensions",
      "--disable-background-networking",
      "--no-first-run",
      "--disable-blink-features=AutomationControlled",
      "--disable-features=IsolateOrigins,site-per-process",
      `--proxy-server=${PROXY_HOST}:${PROXY_PORT}`,
      "--window-size=1920,1080",
      "--lang=tr-TR,tr",
    ],
    ignoreDefaultArgs: ["--enable-automation"],
  };

  if (chromePath) {
    launchOptions.executablePath = chromePath;
    log("BROWSER", `Using Chrome: ${chromePath}`);
  } else {
    log("BROWSER", "Chrome bulunamadi. Windows: Chrome kurun. Linux: chromium-browser kurun. .env: PUPPETEER_EXECUTABLE_PATH ile yolu verin.");
  }

  try {
    const newBrowser = await puppeteer.launch(launchOptions);
    browser = newBrowser;
    return newBrowser;
  } catch (launchErr: any) {
    log("BROWSER", `Launch failed: ${launchErr.message}`);
    if (!chromePath) log("BROWSER", "Chrome/Chromium yolu: .env PUPPETEER_EXECUTABLE_PATH veya CHROMIUM_PATH. Linux: apt install chromium-browser");
    throw launchErr;
  }
}

async function createPage(): Promise<Page> {
  const b = await launchBrowser();
  const page = await b.newPage();
  if (PROXY_USER && PROXY_PASS) {
    await page.authenticate({ username: getProxyUsername(), password: PROXY_PASS });
  }
  await page.setViewport({ width: 1920, height: 1080 });
  await page.setUserAgent(USER_AGENT);
  
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'languages', { get: () => ['tr-TR', 'tr', 'en-US', 'en'] });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    (window as any).chrome = { runtime: {}, loadTimes: () => ({}), csi: () => ({}) };
    const origQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (params: any) =>
      params.name === 'notifications'
        ? Promise.resolve({ state: 'prompt' } as PermissionStatus)
        : origQuery.call(window.navigator.permissions, params);
  });
  
  return page;
}

async function extractSiteKey(page: Page): Promise<string> {
  // Capture from network first
  const networkKey = (page as any).capturedSiteKey;
  if (networkKey) return networkKey;

  return await page.evaluate(() => {
    // Turnstile check first
    const turnstileEl = document.querySelector(".cf-turnstile");
    if (turnstileEl) {
      const key = turnstileEl.getAttribute("data-sitekey");
      if (key) return key.trim();
    }
    
    // Check for turnstile script src containing sitekey
    const scripts = Array.from(document.querySelectorAll('script'));
    for (const s of scripts) {
      if (s.src && s.src.includes('challenges.cloudflare.com')) {
        // Sometimes key is in URL params? Usually not, but worth checking if needed
      }
    }

    // reCAPTCHA check
    const el = document.querySelector("[data-sitekey]");
    if (el) return (el.getAttribute("data-sitekey") || "").trim();
    for (const s of Array.from(document.querySelectorAll('script[src*="recaptcha"]'))) {
      const m = s.getAttribute("src")?.match(/render=([A-Za-z0-9_-]{30,})/);
      if (m) return m[1].trim();
    }
    
    // Default fallback (reCAPTCHA)
    return "6LdHNV8rAAAAADFdYiPXfZd9LGmYRv0L6JkXp3gg"; 
  });
}

export async function directBrowserLogin(email: string, password: string, captchaToken?: string) {
  let page: Page | null = null;
  try {
    page = await createPage();

    log("BROWSER-LOGIN", "Navigating to homepage...");
    await page.goto(getTargetUrl() + "/tr/", { waitUntil: "load", timeout: 35000 });

    const pageTitle = await page.title();
    log("BROWSER-LOGIN", `Page title: "${pageTitle}"`);

    if (pageTitle.includes("moment") || pageTitle.includes("Cloudflare") || pageTitle.includes("Checking")) {
      log("BROWSER-LOGIN", "CF challenge detected on homepage, waiting 15s...");
      try {
        await page.waitForFunction(() => {
          return !document.title.includes("moment") && !document.title.includes("Checking");
        }, { timeout: 15000 });
        log("BROWSER-LOGIN", `CF resolved! Title: "${await page.title()}"`);
        await sleep(2000);
      } catch {
        log("BROWSER-LOGIN", "CF challenge did not resolve. cf_clearance needed.");
        const cookies = await page.cookies();
        const cookieMap: Record<string, string> = {};
        for (const c of cookies) cookieMap[c.name] = c.value;
        await page.close();
        return { success: false, cookies: cookieMap, error: "Cloudflare koruma aktif. cf_clearance cookie gerekli." };
      }
    }

    log("BROWSER-LOGIN", "Fetching CSRF token from login form...");
    const loginFormHtml = await page.evaluate(async () => {
      try {
        const resp = await fetch('/login/login?p=true&_=' + Date.now(), { credentials: 'include' });
        return await resp.text();
      } catch (e: any) {
        return 'FETCH_ERROR: ' + (e.message || '');
      }
    });
    log("BROWSER-LOGIN", `Login form: ${loginFormHtml.length} bytes, hasCSRF: ${loginFormHtml.includes('__RequestVerificationToken')}`);

    const csrfMatch = loginFormHtml.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/) ||
                      loginFormHtml.match(/value="([^"]+)"[^>]*name="__RequestVerificationToken"/);
    const csrfToken = csrfMatch ? csrfMatch[1] : "";
    log("BROWSER-LOGIN", `CSRF token: ${csrfToken ? csrfToken.substring(0, 20) + "..." : "NOT FOUND"}`);

    let token = captchaToken || "";

    log("BROWSER-LOGIN", "Submitting login via AJAX POST to /tr/Login/Login...");
    const currentTargetHost = getTargetHost();
    const performAjaxLogin = async (emailVal: string, passVal: string, tokenVal: string, csrf: string, tHost: string) => {
      const params = new URLSearchParams();
      if (csrf) params.append('__RequestVerificationToken', csrf);
      params.append('FormToken', document.location.host || tHost);
      params.append('Email', emailVal);
      params.append('Password', passVal);
      if (tokenVal) params.append('g-recaptcha-response', tokenVal);
      params.append('gameUrl', '');

      try {
        const resp = await fetch('/tr/Login/Login', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'X-Requested-With': 'XMLHttpRequest',
            'Accept': 'application/json, text/javascript, */*; q=0.01',
          },
          body: params.toString(),
          credentials: 'include',
        });
        const text = await resp.text();
        return { status: resp.status, body: text, headers: Object.fromEntries(resp.headers.entries()) };
      } catch (e: any) {
        return { status: 0, body: 'FETCH_ERROR: ' + (e.message || ''), headers: {} };
      }
    };

    const ajaxResult = await page.evaluate(performAjaxLogin, email, password, token, csrfToken, currentTargetHost);

    log("BROWSER-LOGIN", `AJAX result: status=${ajaxResult.status}, body=${ajaxResult.body.substring(0, 200)}`);

    if (ajaxResult.body.includes('moment') || ajaxResult.body.includes('challenge') || ajaxResult.status === 403) {
      log("BROWSER-LOGIN", "CF challenge blocked AJAX POST. Trying Turnstile interaction on login page...");

      try {
        const challengeInfo = await page.evaluate(() => {
          const iframes = Array.from(document.querySelectorAll('iframe'));
          const turnstileIframes = iframes.filter(f => (f as HTMLIFrameElement).src && (f as HTMLIFrameElement).src.includes('challenges.cloudflare.com'));
          const checkboxes = document.querySelectorAll('input[type=\"checkbox\"]');
          const buttons = document.querySelectorAll('button, [role=\"button\"]');
          return {
            iframeCount: iframes.length,
            turnstileCount: turnstileIframes.length,
            checkboxCount: checkboxes.length,
            buttonCount: buttons.length,
          };
        });
        log("BROWSER-LOGIN", `Login challenge info: ${JSON.stringify(challengeInfo)}`);

        if (challengeInfo.turnstileCount > 0) {
          log("BROWSER-LOGIN", "Turnstile detected during login! Attempting to solve with 2Captcha...");
          
          try {
            // 1. Sitekey'i bul
            const siteKey = await page.evaluate(() => {
              const el = document.querySelector('.cf-turnstile') || document.querySelector('[data-sitekey]');
              if (el) return el.getAttribute('data-sitekey');
              
              // Scriptlerden ara
              const scripts = document.querySelectorAll('script');
              for (const s of Array.from(scripts)) {
                if (s.textContent && s.textContent.includes('turnstile.render')) {
                  const match = s.textContent.match(/sitekey:\s*['"]([^'"]+)['"]/);
                  if (match) return match[1];
                }
              }
              return null;
            });

            let solved = false;
            if (siteKey) {
              log("BROWSER-LOGIN", `Found Turnstile sitekey: ${siteKey}`);
              const solveResult = await solveTurnstile(getTargetUrl() + "/tr/Login/Login", siteKey, "login");
              
              if (solveResult.success && solveResult.token) {
                log("BROWSER-LOGIN", `Turnstile solved! Token: ${solveResult.token.substring(0, 20)}...`);
                
                await page.evaluate((token) => {
                  // Token'ı inputlara bas
                  const inputs = document.querySelectorAll('[name="cf-turnstile-response"], [name="g-recaptcha-response"]');
                  inputs.forEach(inp => { (inp as HTMLInputElement).value = token; });
                  
                  // Global değişkene ata
                  (window as any).cf_turnstile_token = token;
                  
                  // Varsa callback'i tetikle (Cloudflare genellikle otomatik algılar ama biz yine de deneyelim)
                  try {
                    if ((window as any).turnstile && (window as any).turnstile.getResponse) {
                      // Turnstile API varsa resetleyip manuel değer atanamaz ama callback çağrılabilir
                    }
                  } catch(e) {}
                }, solveResult.token);
                
                solved = true;
                await sleep(2000);
              } else {
                log("BROWSER-LOGIN", `2Captcha failed: ${solveResult.error}`);
              }
            }

            if (!solved) {
              log("BROWSER-LOGIN", "2Captcha failed or sitekey not found. Falling back to click interaction...");
              const turnstileFrame = page.frames().find(f => f.url().includes('challenges.cloudflare.com'));
              if (turnstileFrame) {
                const checkbox = await turnstileFrame.$('input[type=\"checkbox\"]') ||
                                 await turnstileFrame.$('.cb-i') ||
                                 await turnstileFrame.$('[role=\"checkbox\"]');
                if (checkbox) {
                  log("BROWSER-LOGIN", "Found Turnstile checkbox, clicking...");
                  await checkbox.click();
                } else {
                  log("BROWSER-LOGIN", "Clicking center of Turnstile iframe...");
                  const frameElement = await page.$('iframe[src*=\"challenges.cloudflare.com\"]');
                  if (frameElement) {
                    const box = await frameElement.boundingBox();
                    if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
                  }
                }
                await sleep(5000);
              }
            }
          } catch (e: any) {
            log("BROWSER-LOGIN", `Turnstile interaction error: ${e.message}`);
          }
        }

        try {
          log("BROWSER-LOGIN", "Waiting up to 20s for login challenge resolution...");
          await page.waitForFunction(() => {
            return !document.title.includes("moment") && !document.title.includes("Checking") && !document.title.includes("Cloudflare");
          }, { timeout: 20000 });
          await sleep(3000);
        } catch {
          log("BROWSER-LOGIN", "Login challenge did not resolve after interaction.");
        }

        log("BROWSER-LOGIN", "Retrying AJAX login once after Turnstile interaction...");
        const ajaxResult2 = await page.evaluate(performAjaxLogin, email, password, token, csrfToken, currentTargetHost);
        log("BROWSER-LOGIN", `AJAX retry result: status=${ajaxResult2.status}, body=${ajaxResult2.body.substring(0, 200)}`);

        if (!(ajaxResult2.body.includes('moment') || ajaxResult2.body.includes('challenge') || ajaxResult2.status === 403)) {
          // Treat retry as main result
          (ajaxResult as any).status = ajaxResult2.status;
          (ajaxResult as any).body = ajaxResult2.body;
        } else {
          log("BROWSER-LOGIN", "Login challenge still blocking after retry. cf_clearance/cookies needed.");
          const cookies2 = await page.cookies();
          const cookieMap2: Record<string, string> = {};
          for (const c of cookies2) cookieMap2[c.name] = c.value;
          await page.close();
          return { success: false, cookies: cookieMap2, error: "Cloudflare koruma aktif. cf_clearance cookie gerekli." };
        }
      } catch (e: any) {
        log("BROWSER-LOGIN", `Error while trying to solve Turnstile on login: ${e.message}`);
        const cookies2 = await page.cookies();
        const cookieMap2: Record<string, string> = {};
        for (const c of cookies2) cookieMap2[c.name] = c.value;
        await page.close();
        return { success: false, cookies: cookieMap2, error: "Cloudflare koruma aktif. cf_clearance cookie gerekli." };
      }
    }

    if (ajaxResult.status === 200 || (ajaxResult.status >= 200 && ajaxResult.status < 400)) {
      log("BROWSER-LOGIN", "AJAX POST succeeded, parsing response...");
      
      const cookies = await page.cookies();
      const cookieMap: Record<string, string> = {};
      for (const c of cookies) cookieMap[c.name] = c.value;
      await page.close();

      try {
        const json = JSON.parse(ajaxResult.body.trim());
        log("BROWSER-LOGIN", `Login JSON: ${JSON.stringify(json).substring(0, 200)}`);
        
        if (json.OpenTrustedBrowser === true) {
          return { success: true, requires2FA: true, message: "TrustBrowser 2FA required", cookies: cookieMap, redirectUrl: "/tr/Login/TrustBrowser" };
        }
        if (json.Success || json.IsSuccess) {
          return { success: true, message: "Login successful", cookies: cookieMap, redirectUrl: "/tr/" };
        }
        return { success: false, message: json.Message || "Login failed", cookies: cookieMap, error: json.Message };
      } catch {
        if (ajaxResult.body.toLowerCase().includes("trustbrowser")) {
          return { success: true, requires2FA: true, message: "TrustBrowser 2FA required", cookies: cookieMap, redirectUrl: "/tr/Login/TrustBrowser" };
        }
        return { success: false, body: ajaxResult.body.substring(0, 500), cookies: cookieMap, error: "Non-JSON response" };
      }
    }

    log("BROWSER-LOGIN", "AJAX failed, trying form.submit() fallback...");
    
    await page.evaluate((emailVal: string, passVal: string, tokenVal: string, csrf: string, tHost: string) => {
      const form = document.createElement('form');
      form.method = 'POST';
      form.action = '/tr/Login/Login';
      form.style.display = 'none';
      const fields: Record<string, string> = {
        'FormToken': tHost, 'Email': emailVal, 'Password': passVal,
        'gameUrl': '',
      };
      if (tokenVal) fields['g-recaptcha-response'] = tokenVal;
      if (csrf) fields['__RequestVerificationToken'] = csrf;
      for (const [name, value] of Object.entries(fields)) {
        const input = document.createElement('input');
        input.type = 'hidden'; input.name = name; input.value = value;
        form.appendChild(input);
      }
      document.body.appendChild(form);
      form.submit();
    }, email, password, token, csrfToken, currentTargetHost);

    try { await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 }); } catch {}
    
    const finalUrl = page.url();
    const finalBody = await page.evaluate(() => document.body?.innerText || document.documentElement?.outerHTML || '');
    log("BROWSER-LOGIN", `After form submit: url="${finalUrl}", body=${finalBody.substring(0, 200)}`);

    const cookies = await page.cookies();
    const cookieMap: Record<string, string> = {};
    for (const c of cookies) cookieMap[c.name] = c.value;
    await page.close();

    if (finalUrl.includes("/tr/") && !finalUrl.includes("Login")) {
      return { success: true, message: "Login successful (redirected)", cookies: cookieMap, redirectUrl: "/tr/" };
    }

    const bodyLower = finalBody.toLowerCase();
    if (bodyLower.includes("opentrustedbrowser") || bodyLower.includes("trustbrowser") || bodyLower.includes("doğrulama")) {
      return { success: true, requires2FA: true, message: "TrustBrowser 2FA required", cookies: cookieMap, redirectUrl: "/tr/Login/TrustBrowser" };
    }

    let parsedJson: any = null;
    try { parsedJson = JSON.parse(finalBody.trim()); } catch {}
    
    if (parsedJson?.OpenTrustedBrowser === true) {
      return { success: true, requires2FA: true, message: "TrustBrowser 2FA required", cookies: cookieMap, redirectUrl: "/tr/Login/TrustBrowser" };
    }
    if (parsedJson?.Success || parsedJson?.IsSuccess) {
      return { success: true, message: "Login successful", cookies: cookieMap, redirectUrl: "/tr/" };
    }

    return { success: false, body: finalBody.substring(0, 500), cookies: cookieMap, message: parsedJson?.Message, error: parsedJson?.Message || "Giriş başarısız" };
  } catch (err: any) {
    log("BROWSER-LOGIN", `Error: ${err.message}`);
    if (page) await page.close().catch(() => {});
    return { success: false, error: err.message };
  }
}

export async function getCloudflareBypassCookies(): Promise<CloudflareCookies | null> {
  const now = Date.now();
  if (globalCfClearance && (now - lastRefresh) < COOKIE_TTL) {
    return { cfBm: "", cfClearance: globalCfClearance, cfuvid: "", allCookies: { "cf_clearance": globalCfClearance }, userAgent: globalUserAgent };
  }

  if (!PROXY_USER || !PROXY_PASS) {
    lastBypassError = "PROXY_USER ve PROXY_PASS .env'de zorunlu. DataImpulse hesabi ekleyin.";
    log("CF", "CF bypass icin PROXY_USER ve PROXY_PASS .env'de zorunlu. Proxy olmadan Cloudflare gecilemez.");
    return null;
  }

  if (bypassInProgress) {
    log("CF", "Bypass already in progress, waiting for existing attempt...");
    return bypassInProgress;
  }

  bypassInProgress = _doBypass();
  try {
    return await bypassInProgress;
  } finally {
    bypassInProgress = null;
  }
}

async function _doBypass(): Promise<CloudflareCookies | null> {
  const now = Date.now();
  let page: Page | null = null;
  try {
    page = await createPage();
    log("CF", `Starting bypass... Target: ${getTargetUrl()}/tr/`);
    
    const urlsToTry = [
      getTargetUrl() + "/tr/",
    ];
    
    for (const url of urlsToTry) {
      let navOk = false;
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          log("CF", `Navigating to: ${url} (attempt ${attempt}/2)`);
          await page.goto(url, { waitUntil: "load", timeout: 45000 });
          navOk = true;
          break;
        } catch (navErr: any) {
          log("CF", `Navigation attempt ${attempt} failed: ${navErr.message}`);
          if (attempt === 2) throw navErr;
          await sleep(3000);
        }
      }
      if (!navOk) continue;

      await sleep(4000);

      const title = await page.title();
      log("CF", `Page title: "${title}"`);
      if (title.includes("moment") || title.includes("Checking") || title.includes("Cloudflare")) {
        log("CF", "CF challenge page detected, trying to solve...");
        
        await sleep(5000);
        
        const challengeInfo = await page.evaluate(() => {
          const iframes = Array.from(document.querySelectorAll('iframe'));
          const turnstileIframes = iframes.filter(f => f.src && f.src.includes('challenges.cloudflare.com'));
          const checkboxes = document.querySelectorAll('input[type="checkbox"]');
          const buttons = document.querySelectorAll('button, [role="button"]');
          const html = document.documentElement.outerHTML.substring(0, 2000);
          return {
            iframeCount: iframes.length,
            turnstileIframes: turnstileIframes.map(f => ({ src: f.src, width: f.width, height: f.height })),
            checkboxCount: checkboxes.length,
            buttonCount: buttons.length,
            htmlSnippet: html,
          };
        });
        log("CF", `Challenge info: ${JSON.stringify({ iframes: challengeInfo.iframeCount, turnstile: challengeInfo.turnstileIframes.length, checkboxes: challengeInfo.checkboxCount, buttons: challengeInfo.buttonCount })}`);
        log("CF", `Challenge HTML: ${challengeInfo.htmlSnippet.substring(0, 500)}`);

        if (challengeInfo.turnstileIframes.length > 0) {
          log("CF", "Turnstile iframe detected! Attempting to solve with 2Captcha...");
          
          try {
            // 1. Sitekey'i bul
            const siteKey = await page.evaluate(() => {
              // Turnstile genellikle .cf-turnstile içinde data-sitekey attribute'unda bulunur
              const el = document.querySelector('.cf-turnstile');
              if (el) return el.getAttribute('data-sitekey');
              
              // Veya iframe src'sinde olabilir (nadiren)
              const iframes = document.querySelectorAll('iframe[src*="challenges.cloudflare.com"]');
              for (const f of Array.from(iframes)) {
                // Iframe src'sinden sitekey çıkarmak zor olabilir, genellikle parent elementte bulunur
              }
              
              // Script taglerinde arayalım
              const scripts = document.querySelectorAll('script');
              for (const s of Array.from(scripts)) {
                if (s.src && s.src.includes('challenges.cloudflare.com')) {
                  // Script src'sinde sitekey olabilir mi? Genellikle hayır.
                }
                // Inline scriptlerde turnstile.render çağrısı aranabilir
                if (s.textContent && s.textContent.includes('turnstile.render')) {
                  const match = s.textContent.match(/sitekey:\s*['"]([^'"]+)['"]/);
                  if (match) return match[1];
                }
              }
              
              return null;
            });

            if (siteKey) {
              log("CF", `Found Turnstile sitekey: ${siteKey}`);
              
              // 2. 2Captcha ile çöz
              const solveResult = await solveTurnstile(url, siteKey);
              
              if (solveResult.success && solveResult.token) {
                log("CF", `Turnstile solved via 2Captcha! Token: ${solveResult.token.substring(0, 20)}...`);
                
                // 3. Token'ı sayfaya inject et
                await page.evaluate((token) => {
                  // cf-turnstile-response input'unu bul ve doldur
                  const input = document.querySelector('[name="cf-turnstile-response"]');
                  if (input) {
                    (input as HTMLInputElement).value = token;
                    // Form submit tetikle (varsa)
                    // Genellikle Cloudflare otomatik algılar veya callback çalıştırır
                  }
                  
                  // Turnstile callback'ini tetikle (eğer biliniyorsa)
                  // window.turnstile.render callback'i... bu zor olabilir.
                  
                  // Alternatif: Token'ı global bir değişkene ata, belki site kullanır
                  (window as any).cf_turnstile_token = token;
                }, solveResult.token);
                
                // 4. Bekle ve kontrol et
                await sleep(3000);
              } else {
                log("CF", `2Captcha failed: ${solveResult.error}`);
                // Fallback: Tıklama yöntemini dene
                throw new Error("2Captcha failed, falling back to click");
              }
            } else {
              log("CF", "Could not find Turnstile sitekey, falling back to click method...");
              throw new Error("Sitekey not found");
            }
          } catch (e: any) {
            log("CF", `2Captcha/Sitekey error: ${e.message}. Trying click method...`);
            
            try {
              const turnstileFrame = page.frames().find(f => f.url().includes('challenges.cloudflare.com'));
              if (turnstileFrame) {
                log("CF", `Found Turnstile frame: ${turnstileFrame.url().substring(0, 100)}`);
                const checkbox = await turnstileFrame.$('input[type="checkbox"]') || await turnstileFrame.$('.cb-i') || await turnstileFrame.$('[role="checkbox"]');
                if (checkbox) {
                  log("CF", "Found checkbox in Turnstile, clicking...");
                  await checkbox.click();
                  await sleep(5000);
                } else {
                  log("CF", "No checkbox found in Turnstile frame, clicking center of frame...");
                  const frameElement = await page.$('iframe[src*="challenges.cloudflare.com"]');
                  if (frameElement) {
                    const box = await frameElement.boundingBox();
                    if (box) {
                      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
                      await sleep(5000);
                    }
                  }
                }
              }
            } catch (clickErr: any) {
              log("CF", `Turnstile click interaction error: ${clickErr.message}`);
            }
          }
        }

        try {
          log("CF", "Waiting up to 25s for challenge resolution...");
          await page.waitForFunction(() => {
            return !document.title.includes("moment") && !document.title.includes("Checking") && !document.title.includes("Cloudflare");
          }, { timeout: 25000 });
          log("CF", `Challenge resolved! Title: "${await page.title()}"`);
          await sleep(4000);
          
          const postChallengeCookies = await page.cookies();
          const cfClear = postChallengeCookies.find(c => c.name === "cf_clearance");
          if (cfClear) {
            log("CF", `cf_clearance obtained after challenge! Value: ${cfClear.value.substring(0, 20)}...`);
            globalCfClearance = cfClear.value;
            lastRefresh = now;
            const allCookies: Record<string, string> = {};
            for (const c of postChallengeCookies) allCookies[c.name] = c.value;
            await page.close();
            return { cfBm: allCookies["__cf_bm"] || "", cfClearance: cfClear.value, cfuvid: allCookies["_cfuvid"] || "", allCookies, userAgent: globalUserAgent };
          }
        } catch {
          log("CF", "Challenge did not resolve after interaction");
          const currentTitle = await page.title().catch(() => "unknown");
          log("CF", `Current title: "${currentTitle}"`);
        }
      }

      const cookies = await page.cookies();
      const cf = cookies.find(c => c.name === "cf_clearance");
      if (cf) {
        globalCfClearance = cf.value;
        lastRefresh = now;
        const allCookies: Record<string, string> = {};
        for (const c of cookies) allCookies[c.name] = c.value;
        await page.close();
        log("CF", `Bypass successful from ${url}!`);
        return { cfBm: allCookies["__cf_bm"] || "", cfClearance: cf.value, cfuvid: allCookies["_cfuvid"] || "", allCookies, userAgent: globalUserAgent };
      }
    }

    for (let attempt = 0; attempt < 3; attempt++) {
      const cookies = await page.cookies();
      const cf = cookies.find(c => c.name === "cf_clearance");
      if (cf) {
        globalCfClearance = cf.value;
        lastRefresh = now;
        const allCookies: Record<string, string> = {};
        for (const c of cookies) allCookies[c.name] = c.value;
        await page.close();
        log("CF", "Bypass successful!");
        return { cfBm: allCookies["__cf_bm"] || "", cfClearance: cf.value, cfuvid: allCookies["_cfuvid"] || "", allCookies, userAgent: globalUserAgent };
      }
      log("CF", `Attempt ${attempt + 1}/3 - cf_clearance not found, waiting...`);
      await sleep(5000);
    }

    const cookies = await page.cookies();
    const allCookies: Record<string, string> = {};
    for (const c of cookies) allCookies[c.name] = c.value;
    await page.close();

    if (Object.keys(allCookies).length > 0) {
      log("CF", `Bypass partial - got ${Object.keys(allCookies).length} cookies but no cf_clearance`);
      return { cfBm: allCookies["__cf_bm"] || "", cfClearance: "", cfuvid: allCookies["_cfuvid"] || "", allCookies, userAgent: globalUserAgent };
    }

    lastBypassError = "cf_clearance alinamadi. Chromium kurulu mu? pm2 logs ile detay kontrol edin.";
    log("CF", "Bypass failed - cf_clearance alinamadi. Proxy ve target domain dogru mu kontrol edin.");
    return null;
  } catch (err: any) {
    lastBypassError = err?.message || String(err);
    log("CF", `Bypass error: ${lastBypassError}`);
    if (err.stack) log("CF", `Stack: ${err.stack.split("\n").slice(0, 3).join(" | ")}`);
    if (page) await page.close().catch(() => {});
    return null;
  }
}

// Diagnostic: son bypass hatasi (admin panelde gosterilir)
export function getLastBypassError(): string { return lastBypassError; }

// Minimal missing exports to maintain compatibility with routes.ts
export function getCachedCookies() { return cachedCookies; }
export function setCachedCookies(c: any) { cachedCookies = { allCookies: c } as any; }
export function getPuppeteerSessionId() { return puppeteerSessionId; }
export function setPuppeteerSessionId(id: string) { puppeteerSessionId = id; }
export async function performLogin(e: string, p: string) { return directBrowserLogin(e, p); }
export async function fetchPageViaBrowser(url: string, opts: any = {}) { 
    const p = await createPage();
    
    // If client sent a mobile UA, use it
    if (opts.userAgent) {
      await p.setUserAgent(opts.userAgent);
      // If mobile UA, set mobile viewport
      if (/Mobile|Android|iPhone|iPad/i.test(opts.userAgent)) {
        await p.setViewport({ width: 430, height: 932, isMobile: true, hasTouch: true });
      }
    }
    
    try {
      if (opts.method === "POST") {
        // POST via page.evaluate fetch - preserves cookies/session
        await p.goto(getTargetUrl() + "/tr/", { waitUntil: "domcontentloaded", timeout: 30000 });
        const result = await p.evaluate(async (fetchUrl: string, fetchOpts: any) => {
          const resp = await fetch(fetchUrl, {
            method: "POST",
            headers: fetchOpts.headers || { "Content-Type": "application/x-www-form-urlencoded" },
            body: fetchOpts.body || "",
            credentials: "same-origin"
          });
          const text = await resp.text();
          const ct = resp.headers.get("content-type") || "text/html";
          return { status: resp.status, body: text, contentType: ct };
        }, url, opts);
        await p.close();
        return result;
      } else {
        // GET HTML page - full navigation for JS execution
        const response = await p.goto(getTargetUrl() + url, { waitUntil: "load", timeout: 35000 });
        const body = await p.content();
        const status = response?.status() || 200;
        await p.close();
        return { status, body, contentType: "text/html" };
      }
    } catch (err: any) {
      await p.close();
      log("BROWSER", `fetchPageViaBrowser error: ${err.message}`);
      return null;
    }
}

export async function fetchResourceViaBrowser(url: string, clientUA?: string) {
    // For JS/CSS/images - use fetch() inside browser context to get RAW content
    // NOT page.goto which wraps everything in HTML
    const p = await createPage();
    
    if (clientUA) {
      await p.setUserAgent(clientUA);
      if (/Mobile|Android|iPhone|iPad/i.test(clientUA)) {
        await p.setViewport({ width: 430, height: 932, isMobile: true, hasTouch: true });
      }
    }
    
    try {
      // Navigate to base page first to establish cookies/session context
      await p.goto(getTargetUrl() + "/tr/", { waitUntil: "domcontentloaded", timeout: 20000 });
      
      // Now fetch the resource using the browser's fetch API (raw content)
      const result = await p.evaluate(async (resourceUrl: string) => {
        const resp = await fetch(resourceUrl, { credentials: "same-origin" });
        const text = await resp.text();
        const ct = resp.headers.get("content-type") || "application/octet-stream";
        return { status: resp.status, body: text, contentType: ct };
      }, url);
      
      await p.close();
      return result;
    } catch (err: any) {
      await p.close();
      log("BROWSER", `fetchResourceViaBrowser error: ${err.message}`);
      return null;
    }
}
