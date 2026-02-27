import fs from "fs";
import path from "path";
import { execSync, spawn, ChildProcess } from "child_process";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import type { Page, Browser } from "puppeteer-core";

const stealthPlugin = StealthPlugin();
puppeteer.use(stealthPlugin);

import { getTargetUrl, getTargetHost } from "./target-config";
import { solveTurnstile } from "./captcha-solver";

// ═══════════════════════════════════════════════════════════════
//  CONFIG
// ═══════════════════════════════════════════════════════════════
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const PROXY_HOST = process.env.PROXY_HOST || "gw.dataimpulse.com";
const PROXY_PORT = process.env.PROXY_PORT || "823";
const PROXY_USER = process.env.PROXY_USER || "";
const PROXY_PASS = process.env.PROXY_PASS || "";

const COOKIE_TTL = 8 * 60 * 1000;
const CHALLENGE_POLL_INTERVAL = 2000;
const CHALLENGE_MAX_WAIT = 45000;
const NAV_TIMEOUT = 50000;
const BROWSER_RESTART_INTERVAL = 30 * 60 * 1000; // 30 min

// ═══════════════════════════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════════════════════════
interface CloudflareCookies {
  cfBm: string;
  cfClearance: string;
  cfuvid: string;
  allCookies: Record<string, string>;
  userAgent: string;
}

let browser: Browser | null = null;
let browserLaunchedAt = 0;
let xvfbProcess: ChildProcess | null = null;
let puppeteerSessionId = generateSessionId();

let cachedCookies: CloudflareCookies | null = null;
let lastRefresh = 0;

let globalCfClearance: string | null = null;
let globalUserAgent: string = USER_AGENT;

let bypassInProgress: Promise<CloudflareCookies | null> | null = null;
let lastBypassError = "";
let consecutiveFailures = 0;

// ═══════════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════════
function generateSessionId(): string {
  return Math.random().toString(16).substring(2, 18);
}

function getProxyUsername(): string {
  return `${PROXY_USER}_session-${puppeteerSessionId}`;
}

function log(tag: string, msg: string) {
  console.log(`[${tag}] ${msg}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ═══════════════════════════════════════════════════════════════
//  CHROME PATH DETECTION
// ═══════════════════════════════════════════════════════════════
function getChromePath(): string | undefined {
  const envPath =
    process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROMIUM_PATH;
  if (envPath && fs.existsSync(envPath)) return envPath;

  if (process.platform === "win32") {
    const winPaths = [
      process.env.LOCALAPPDATA
        ? path.join(
            process.env.LOCALAPPDATA,
            "Google",
            "Chrome",
            "Application",
            "chrome.exe",
          )
        : "",
      process.env.PROGRAMFILES
        ? path.join(
            process.env.PROGRAMFILES,
            "Google",
            "Chrome",
            "Application",
            "chrome.exe",
          )
        : "",
      process.env["PROGRAMFILES(X86)"]
        ? path.join(
            process.env["PROGRAMFILES(X86)"],
            "Google",
            "Chrome",
            "Application",
            "chrome.exe",
          )
        : "",
    ].filter(Boolean);
    for (const p of winPaths) {
      if (fs.existsSync(p)) return p;
    }
  } else {
    const linuxPaths = [
      "/usr/bin/google-chrome-stable",
      "/usr/bin/google-chrome",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
      "/usr/lib/chromium-browser/chromium-browser",
      "/usr/lib64/chromium-browser/chromium-browser",
      "/snap/bin/chromium",
    ];
    for (const p of linuxPaths) {
      if (fs.existsSync(p)) return p;
    }
  }
  return undefined;
}

// ═══════════════════════════════════════════════════════════════
//  XVFB - Virtual Display for headful on Linux servers
// ═══════════════════════════════════════════════════════════════
function hasDisplay(): boolean {
  if (process.platform === "win32") return true;
  return !!process.env.DISPLAY;
}

function isXvfbInstalled(): boolean {
  try {
    execSync("which Xvfb", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function startXvfb(): boolean {
  if (process.platform === "win32") return true;
  if (hasDisplay()) return true;

  if (!isXvfbInstalled()) {
    log(
      "XVFB",
      "Xvfb yüklü değil. Headful Chrome için gerekli: apt-get install -y xvfb",
    );
    return false;
  }

  if (xvfbProcess) return true;

  const display = `:${99 + Math.floor(Math.random() * 100)}`;
  try {
    xvfbProcess = spawn(
      "Xvfb",
      [display, "-screen", "0", "1920x1080x24", "-ac", "-nolisten", "tcp"],
      { stdio: "pipe", detached: true },
    );

    xvfbProcess.unref();
    xvfbProcess.on("error", (err) => {
      log("XVFB", `Error: ${err.message}`);
      xvfbProcess = null;
    });
    xvfbProcess.on("exit", () => {
      xvfbProcess = null;
    });

    process.env.DISPLAY = display;
    log("XVFB", `Virtual display started on ${display}`);
    return true;
  } catch (err: any) {
    log("XVFB", `Failed to start: ${err.message}`);
    return false;
  }
}

function stopXvfb() {
  if (xvfbProcess) {
    try {
      xvfbProcess.kill("SIGTERM");
    } catch {}
    xvfbProcess = null;
  }
}

// ═══════════════════════════════════════════════════════════════
//  BROWSER LAUNCH - Headful Chrome + Real System TLS
// ═══════════════════════════════════════════════════════════════
async function closeBrowser() {
  if (browser) {
    try {
      await browser.close();
    } catch {}
    browser = null;
  }
}

function shouldRestartBrowser(): boolean {
  if (!browser) return true;
  if (Date.now() - browserLaunchedAt > BROWSER_RESTART_INTERVAL) return true;
  return false;
}

async function launchBrowser(): Promise<Browser> {
  if (browser && !shouldRestartBrowser()) {
    try {
      const pages = await browser.pages();
      if (pages.length >= 0) return browser;
    } catch {
      browser = null;
    }
  }

  await closeBrowser();

  const chromePath = getChromePath();
  const isLinux = process.platform !== "win32";
  const useHeadful = process.env.CF_HEADLESS !== "true";

  if (useHeadful && isLinux) {
    startXvfb();
  }

  const headlessMode = useHeadful ? false : ("new" as const);

  log(
    "BROWSER",
    `Launching ${useHeadful ? "HEADFUL" : "headless"} Chrome with real system TLS...`,
  );
  if (chromePath) log("BROWSER", `Chrome path: ${chromePath}`);

  const args = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-blink-features=AutomationControlled",
    `--proxy-server=${PROXY_HOST}:${PROXY_PORT}`,
    "--window-size=1920,1080",
    "--lang=tr-TR,tr",
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "--disable-ipc-flooding-protection",
    "--disable-client-side-phishing-detection",
    "--no-default-browser-check",
    "--no-first-run",
    "--metrics-recording-only",
    "--disable-default-apps",
    "--disable-popup-blocking",
    "--disable-translate",
    "--disable-sync",
    "--password-store=basic",
    "--use-mock-keychain",
  ];

  if (useHeadful) {
    args.push("--start-maximized");
  } else {
    args.push("--disable-gpu");
    args.push("--disable-dev-shm-usage");
  }

  const launchOptions: any = {
    headless: headlessMode,
    args,
    ignoreDefaultArgs: ["--enable-automation", "--disable-extensions"],
    defaultViewport: null,
  };

  if (chromePath) {
    launchOptions.executablePath = chromePath;
  }

  try {
    const newBrowser = await puppeteer.launch(launchOptions);
    browser = newBrowser as unknown as Browser;
    browserLaunchedAt = Date.now();
    consecutiveFailures = 0;

    newBrowser.on("disconnected", () => {
      log("BROWSER", "Disconnected - will relaunch on next request");
      browser = null;
    });

    log("BROWSER", "Chrome launched successfully");
    return browser;
  } catch (err: any) {
    log("BROWSER", `Launch failed: ${err.message}`);
    if (!chromePath) {
      log(
        "BROWSER",
        "Chrome/Chromium bulunamadı. .env: PUPPETEER_EXECUTABLE_PATH veya CHROMIUM_PATH ayarlayın.",
      );
    }
    throw err;
  }
}

// ═══════════════════════════════════════════════════════════════
//  STEALTH PAGE - Comprehensive browser fingerprint evasion
// ═══════════════════════════════════════════════════════════════
async function createStealthPage(): Promise<Page> {
  const b = await launchBrowser();
  const page = (await b.newPage()) as Page;

  if (PROXY_USER && PROXY_PASS) {
    await page.authenticate({
      username: getProxyUsername(),
      password: PROXY_PASS,
    });
  }

  await page.setViewport({ width: 1920, height: 1080 });
  await page.setUserAgent(USER_AGENT);

  await page.setExtraHTTPHeaders({
    "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7",
    "sec-ch-ua":
      '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
  });

  // Comprehensive stealth evasions injected before any page navigation
  await page.evaluateOnNewDocument(() => {
    // --- webdriver ---
    Object.defineProperty(navigator, "webdriver", {
      get: () => undefined,
    });
    // Also delete if it somehow gets set
    if ((navigator as any).webdriver) {
      delete (navigator as any).webdriver;
    }

    // --- languages ---
    Object.defineProperty(navigator, "languages", {
      get: () => ["tr-TR", "tr", "en-US", "en"],
    });
    Object.defineProperty(navigator, "language", {
      get: () => "tr-TR",
    });

    // --- platform ---
    Object.defineProperty(navigator, "platform", {
      get: () => "Win32",
    });

    // --- hardware concurrency ---
    Object.defineProperty(navigator, "hardwareConcurrency", {
      get: () => 8,
    });

    // --- device memory ---
    Object.defineProperty(navigator, "deviceMemory", {
      get: () => 8,
    });

    // --- max touch points (desktop = 0) ---
    Object.defineProperty(navigator, "maxTouchPoints", {
      get: () => 0,
    });

    // --- connection ---
    Object.defineProperty(navigator, "connection", {
      get: () => ({
        effectiveType: "4g",
        rtt: 50,
        downlink: 10,
        saveData: false,
      }),
    });

    // --- plugins (realistic Chrome plugins) ---
    Object.defineProperty(navigator, "plugins", {
      get: () => {
        const pluginData = [
          {
            name: "PDF Viewer",
            description: "Portable Document Format",
            filename: "internal-pdf-viewer",
            mimeTypes: [
              {
                type: "application/pdf",
                suffixes: "pdf",
                description: "Portable Document Format",
              },
            ],
          },
          {
            name: "Chrome PDF Viewer",
            description: "Portable Document Format",
            filename: "internal-pdf-viewer",
            mimeTypes: [
              {
                type: "application/pdf",
                suffixes: "pdf",
                description: "",
              },
            ],
          },
          {
            name: "Chromium PDF Viewer",
            description: "Portable Document Format",
            filename: "internal-pdf-viewer",
            mimeTypes: [
              {
                type: "application/pdf",
                suffixes: "pdf",
                description: "",
              },
            ],
          },
          {
            name: "Microsoft Edge PDF Viewer",
            description: "Portable Document Format",
            filename: "internal-pdf-viewer",
            mimeTypes: [
              {
                type: "application/pdf",
                suffixes: "pdf",
                description: "",
              },
            ],
          },
          {
            name: "WebKit built-in PDF",
            description: "Portable Document Format",
            filename: "internal-pdf-viewer",
            mimeTypes: [
              {
                type: "application/pdf",
                suffixes: "pdf",
                description: "",
              },
            ],
          },
        ];

        const plugins = pluginData.map((p) => {
          const plugin = Object.create(Plugin.prototype);
          Object.defineProperties(plugin, {
            name: { get: () => p.name },
            description: { get: () => p.description },
            filename: { get: () => p.filename },
            length: { get: () => p.mimeTypes.length },
          });
          return plugin;
        });

        const pluginArray = Object.create(PluginArray.prototype);
        Object.defineProperty(pluginArray, "length", {
          get: () => plugins.length,
        });
        for (let i = 0; i < plugins.length; i++) {
          Object.defineProperty(pluginArray, i, {
            get: () => plugins[i],
            enumerable: true,
          });
        }
        pluginArray.item = (idx: number) => plugins[idx] || null;
        pluginArray.namedItem = (name: string) =>
          plugins.find((p: any) => p.name === name) || null;
        pluginArray.refresh = () => {};
        return pluginArray;
      },
    });

    // --- mimeTypes ---
    Object.defineProperty(navigator, "mimeTypes", {
      get: () => {
        const mimeArray = Object.create(MimeTypeArray.prototype);
        Object.defineProperty(mimeArray, "length", { get: () => 2 });
        return mimeArray;
      },
    });

    // --- chrome object ---
    const w = window as any;
    w.chrome = {
      app: {
        isInstalled: false,
        InstallState: {
          DISABLED: "disabled",
          INSTALLED: "installed",
          NOT_INSTALLED: "not_installed",
        },
        RunningState: {
          CANNOT_RUN: "cannot_run",
          READY_TO_RUN: "ready_to_run",
          RUNNING: "running",
        },
        getDetails: () => null,
        getIsInstalled: () => false,
      },
      runtime: {
        OnInstalledReason: {
          CHROME_UPDATE: "chrome_update",
          INSTALL: "install",
          SHARED_MODULE_UPDATE: "shared_module_update",
          UPDATE: "update",
        },
        OnRestartRequiredReason: {
          APP_UPDATE: "app_update",
          OS_UPDATE: "os_update",
          PERIODIC: "periodic",
        },
        PlatformArch: {
          ARM: "arm",
          ARM64: "arm64",
          MIPS: "mips",
          MIPS64: "mips64",
          X86_32: "x86-32",
          X86_64: "x86-64",
        },
        PlatformNaclArch: {
          ARM: "arm",
          MIPS: "mips",
          MIPS64: "mips64",
          X86_32: "x86-32",
          X86_64: "x86-64",
        },
        PlatformOs: {
          ANDROID: "android",
          CROS: "cros",
          LINUX: "linux",
          MAC: "mac",
          OPENBSD: "openbsd",
          WIN: "win",
        },
        RequestUpdateCheckStatus: {
          NO_UPDATE: "no_update",
          THROTTLED: "throttled",
          UPDATE_AVAILABLE: "update_available",
        },
        connect: () => {},
        sendMessage: () => {},
        id: undefined,
      },
      loadTimes: () => ({
        commitLoadTime: Date.now() / 1000 - 2.5,
        connectionInfo: "h2",
        finishDocumentLoadTime: Date.now() / 1000 - 1.5,
        finishLoadTime: Date.now() / 1000 - 1.0,
        firstPaintAfterLoadTime: 0,
        firstPaintTime: Date.now() / 1000 - 1.8,
        navigationType: "Other",
        npnNegotiatedProtocol: "h2",
        requestTime: Date.now() / 1000 - 3.0,
        startLoadTime: Date.now() / 1000 - 2.8,
        wasAlternateProtocolAvailable: false,
        wasFetchedViaSpdy: true,
        wasNpnNegotiated: true,
      }),
      csi: () => ({
        onloadT: Date.now(),
        pageT: 3000 + Math.random() * 500,
        startE: Date.now() - 3000,
        tran: 15,
      }),
    };

    // --- permissions ---
    const origQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (params: any) => {
      if (params.name === "notifications") {
        return Promise.resolve({
          state: Notification.permission,
        } as PermissionStatus);
      }
      return origQuery.call(window.navigator.permissions, params);
    };

    // --- screen dimensions ---
    Object.defineProperty(screen, "width", { get: () => 1920 });
    Object.defineProperty(screen, "height", { get: () => 1080 });
    Object.defineProperty(screen, "availWidth", { get: () => 1920 });
    Object.defineProperty(screen, "availHeight", { get: () => 1040 });
    Object.defineProperty(screen, "colorDepth", { get: () => 24 });
    Object.defineProperty(screen, "pixelDepth", { get: () => 24 });

    // --- window outer dimensions ---
    Object.defineProperty(window, "outerWidth", { get: () => 1920 });
    Object.defineProperty(window, "outerHeight", { get: () => 1080 });

    // --- Notification ---
    if (!("Notification" in window)) {
      (window as any).Notification = {
        permission: "default",
        requestPermission: () => Promise.resolve("default"),
      };
    }

    // --- WebGL renderer spoof ---
    const getParameter = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function (param: number) {
      if (param === 37445) return "Google Inc. (NVIDIA)";
      if (param === 37446)
        return "ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 Direct3D11 vs_5_0 ps_5_0, D3D11)";
      return getParameter.call(this, param);
    };

    const getParameter2 = WebGL2RenderingContext.prototype.getParameter;
    WebGL2RenderingContext.prototype.getParameter = function (param: number) {
      if (param === 37445) return "Google Inc. (NVIDIA)";
      if (param === 37446)
        return "ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 Direct3D11 vs_5_0 ps_5_0, D3D11)";
      return getParameter2.call(this, param);
    };

    // --- Prevent iframe contentWindow detection ---
    const origHTMLIFrameElement = HTMLIFrameElement.prototype;
    const origContentWindow = Object.getOwnPropertyDescriptor(
      origHTMLIFrameElement,
      "contentWindow",
    );
    if (origContentWindow) {
      Object.defineProperty(HTMLIFrameElement.prototype, "contentWindow", {
        get: function () {
          const w = origContentWindow.get!.call(this);
          if (w) {
            try {
              Object.defineProperty(w, "chrome", { get: () => (window as any).chrome });
            } catch {}
          }
          return w;
        },
      });
    }

    // --- toString patches for native code spoofing ---
    const patchFn = (fn: Function, name: string) => {
      fn.toString = () => `function ${name}() { [native code] }`;
    };
    patchFn(navigator.permissions.query, "query");
  });

  return page;
}

// ═══════════════════════════════════════════════════════════════
//  CHALLENGE DETECTION & RESOLUTION
// ═══════════════════════════════════════════════════════════════
interface ChallengeInfo {
  isChallenge: boolean;
  type: "js_challenge" | "turnstile" | "managed" | "none";
  title: string;
  turnstileIframeCount: number;
  turnstileSiteKey: string | null;
  hasCheckbox: boolean;
}

async function detectChallenge(page: Page): Promise<ChallengeInfo> {
  return page.evaluate(() => {
    const title = document.title || "";
    const bodyText = document.body?.innerText?.substring(0, 2000) || "";

    // Title-based detection (most reliable)
    const challengeTitlePatterns = /^just a moment|^bir dakika|^checking|^attention required|^security check|^please wait/i;
    const isChallengeTitle = challengeTitlePatterns.test(title.trim());

    // Body-based detection (only very specific CF challenge strings)
    const isChallengeBody =
      /verifying you are human|verifying that you are not a robot|enable javascript and cookies to continue|checking your browser before/i.test(bodyText);

    // DOM-based detection (CF challenge specific elements)
    const hasChallengeForm = !!document.getElementById("challenge-form");
    const hasChallengeRunning = !!document.getElementById("cf-challenge-running");
    const hasChallengeStage = !!document.querySelector("#challenge-stage");

    const isChallenge = isChallengeTitle || isChallengeBody || hasChallengeForm || hasChallengeRunning || hasChallengeStage;

    const turnstileIframes = Array.from(
      document.querySelectorAll('iframe[src*="challenges.cloudflare.com"]'),
    );

    let turnstileSiteKey: string | null = null;
    const turnstileEl = document.querySelector(".cf-turnstile");
    if (turnstileEl) {
      turnstileSiteKey = turnstileEl.getAttribute("data-sitekey");
    }
    if (!turnstileSiteKey) {
      const scripts = document.querySelectorAll("script");
      for (const s of Array.from(scripts)) {
        if (s.textContent?.includes("turnstile.render")) {
          const m = s.textContent.match(/sitekey:\s*['"]([^'"]+)['"]/);
          if (m) {
            turnstileSiteKey = m[1];
            break;
          }
        }
      }
    }

    let type: "js_challenge" | "turnstile" | "managed" | "none" = "none";
    if (isChallenge) {
      if (turnstileIframes.length > 0 || turnstileSiteKey) {
        type = "turnstile";
      } else if (hasChallengeForm) {
        type = "managed";
      } else {
        type = "js_challenge";
      }
    }

    return {
      isChallenge,
      type,
      title,
      turnstileIframeCount: turnstileIframes.length,
      turnstileSiteKey,
      hasCheckbox: document.querySelectorAll('input[type="checkbox"]').length > 0,
    };
  });
}

async function waitForChallengeResolution(
  page: Page,
  maxWait: number = CHALLENGE_MAX_WAIT,
): Promise<boolean> {
  const startTime = Date.now();
  let pollCount = 0;
  let initialTitle = "";

  try {
    initialTitle = await page.title();
  } catch {}

  while (Date.now() - startTime < maxWait) {
    pollCount++;
    await sleep(CHALLENGE_POLL_INTERVAL);

    try {
      // Quick title check first (faster than full DOM evaluation)
      const currentTitle = await page.title();
      const titleChanged = currentTitle !== initialTitle && !(/^just a moment|^bir dakika|^checking|^please wait/i.test(currentTitle.trim()));

      if (titleChanged) {
        log("CF", `Title changed: "${initialTitle}" -> "${currentTitle}" after ${pollCount} polls (${((Date.now() - startTime) / 1000).toFixed(1)}s)`);
        await sleep(2000);
        return true;
      }

      // Full challenge detection
      const info = await detectChallenge(page);
      if (!info.isChallenge) {
        log("CF", `Challenge resolved after ${pollCount} polls (${((Date.now() - startTime) / 1000).toFixed(1)}s)`);
        return true;
      }

      if (pollCount % 5 === 0) {
        log("CF", `Still waiting... type=${info.type}, title="${info.title}", elapsed=${((Date.now() - startTime) / 1000).toFixed(0)}s`);
      }
    } catch (err: any) {
      if (err.message?.includes("Execution context was destroyed") ||
          err.message?.includes("navigating") ||
          err.message?.includes("Target closed") ||
          err.message?.includes("Session closed")) {
        log("CF", "Page navigated during challenge - likely resolved");
        await sleep(3000);
        return true;
      }
    }
  }

  // Final check - maybe the title changed but we missed it
  try {
    const finalTitle = await page.title();
    if (finalTitle !== initialTitle && !(/^just a moment|^bir dakika|^checking|^please wait/i.test(finalTitle.trim()))) {
      log("CF", `Challenge resolved on final check. Title: "${finalTitle}"`);
      return true;
    }
  } catch {}

  return false;
}

async function handleTurnstileChallenge(
  page: Page,
  siteKey: string | null,
  url: string,
): Promise<boolean> {
  // Strategy 1: 2Captcha (if siteKey found and configured)
  if (siteKey) {
    log("CF", `Attempting Turnstile solve via 2Captcha (siteKey: ${siteKey.substring(0, 12)}...)`);
    try {
      const result = await solveTurnstile(url, siteKey);
      if (result.success && result.token) {
        log("CF", "2Captcha solved Turnstile, injecting token...");
        await page.evaluate((token: string) => {
          const inputs = document.querySelectorAll(
            '[name="cf-turnstile-response"], [name="g-recaptcha-response"]',
          );
          inputs.forEach((inp) => {
            (inp as HTMLInputElement).value = token;
          });

          const callbacks = (window as any).__turnstileCallbacks;
          if (callbacks) {
            Object.values(callbacks).forEach((cb: any) => {
              if (typeof cb === "function") cb(token);
            });
          }

          const forms = document.querySelectorAll("form");
          forms.forEach((form) => {
            const input = form.querySelector(
              '[name="cf-turnstile-response"]',
            );
            if (input) {
              try {
                form.submit();
              } catch {}
            }
          });
        }, result.token);

        await sleep(3000);
        const resolved = await waitForChallengeResolution(page, 15000);
        if (resolved) return true;
      }
    } catch (e: any) {
      log("CF", `2Captcha Turnstile error: ${e.message}`);
    }
  }

  // Strategy 2: Click interaction on Turnstile checkbox
  log("CF", "Attempting Turnstile click interaction...");
  try {
    const turnstileFrame = page.frames().find((f) => f.url().includes("challenges.cloudflare.com"));
    if (turnstileFrame) {
      const checkbox =
        (await turnstileFrame.$('input[type="checkbox"]')) ||
        (await turnstileFrame.$(".cb-i")) ||
        (await turnstileFrame.$('[role="checkbox"]')) ||
        (await turnstileFrame.$(".mark"));
      if (checkbox) {
        log("CF", "Found Turnstile checkbox, clicking...");
        await checkbox.click();
        await sleep(5000);
        return await waitForChallengeResolution(page, 20000);
      }
    }

    // Click center of iframe
    const frameElement = await page.$(
      'iframe[src*="challenges.cloudflare.com"]',
    );
    if (frameElement) {
      const box = await frameElement.boundingBox();
      if (box) {
        log("CF", "Clicking center of Turnstile iframe...");
        await page.mouse.move(
          box.x + box.width / 2 + (Math.random() * 10 - 5),
          box.y + box.height / 2 + (Math.random() * 5 - 2.5),
        );
        await sleep(300 + Math.random() * 200);
        await page.mouse.click(
          box.x + box.width / 2,
          box.y + box.height / 2,
        );
        await sleep(5000);
        return await waitForChallengeResolution(page, 20000);
      }
    }
  } catch (e: any) {
    log("CF", `Turnstile click error: ${e.message}`);
  }

  return false;
}

// ═══════════════════════════════════════════════════════════════
//  COOKIE EXTRACTION
// ═══════════════════════════════════════════════════════════════
async function extractAllCookies(page: Page): Promise<CloudflareCookies> {
  const cookies = await page.cookies();
  const allCookies: Record<string, string> = {};
  let cfClearance = "";
  let cfBm = "";
  let cfuvid = "";

  for (const c of cookies) {
    allCookies[c.name] = c.value;
    if (c.name === "cf_clearance") cfClearance = c.value;
    if (c.name === "__cf_bm") cfBm = c.value;
    if (c.name === "_cfuvid") cfuvid = c.value;
  }

  return {
    cfClearance,
    cfBm,
    cfuvid,
    allCookies,
    userAgent: globalUserAgent,
  };
}

// ═══════════════════════════════════════════════════════════════
//  MAIN BYPASS LOGIC
// ═══════════════════════════════════════════════════════════════
export async function getCloudflareBypassCookies(): Promise<CloudflareCookies | null> {
  const now = Date.now();
  if (globalCfClearance && now - lastRefresh < COOKIE_TTL) {
    return {
      cfBm: "",
      cfClearance: globalCfClearance,
      cfuvid: "",
      allCookies: { cf_clearance: globalCfClearance },
      userAgent: globalUserAgent,
    };
  }

  if (!PROXY_USER || !PROXY_PASS) {
    lastBypassError =
      "PROXY_USER ve PROXY_PASS .env'de zorunlu. DataImpulse hesabı ekleyin.";
    log(
      "CF",
      "CF bypass için PROXY_USER ve PROXY_PASS .env'de zorunlu.",
    );
    return null;
  }

  if (bypassInProgress) {
    log("CF", "Bypass zaten devam ediyor, bekleniyor...");
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
    if (consecutiveFailures >= 3) {
      log("CF", "3 ardışık başarısızlık - browser yeniden başlatılıyor...");
      await closeBrowser();
      puppeteerSessionId = generateSessionId();
      consecutiveFailures = 0;
      await sleep(3000);
    }

    page = await createStealthPage();
    const targetUrl = getTargetUrl() + "/tr/";

    log("CF", `Starting headful bypass... Target: ${targetUrl}`);

    // Navigate with retry
    let navSuccess = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        log("CF", `Navigation attempt ${attempt}/3...`);
        await page.goto(targetUrl, {
          waitUntil: "domcontentloaded",
          timeout: NAV_TIMEOUT,
        });
        navSuccess = true;
        break;
      } catch (navErr: any) {
        log("CF", `Nav attempt ${attempt} failed: ${navErr.message}`);
        if (attempt < 3) {
          await sleep(3000 * attempt);
          if (attempt === 2) {
            puppeteerSessionId = generateSessionId();
            await page.authenticate({
              username: getProxyUsername(),
              password: PROXY_PASS,
            });
          }
        }
      }
    }

    if (!navSuccess) {
      throw new Error("Tüm navigation denemeleri başarısız");
    }

    // Initial wait for page to settle
    await sleep(3000);

    // Check for challenge
    const challengeInfo = await detectChallenge(page);
    log("CF", `Challenge detection: type=${challengeInfo.type}, title="${challengeInfo.title}"`);

    if (challengeInfo.isChallenge) {
      log("CF", `${challengeInfo.type} challenge detected. Headful Chrome attempting auto-solve...`);

      if (challengeInfo.type === "js_challenge" || challengeInfo.type === "managed") {
        log("CF", "Waiting for JS/managed challenge auto-resolution...");
        const resolved = await waitForChallengeResolution(page, CHALLENGE_MAX_WAIT);

        if (!resolved) {
          log("CF", "Auto-resolution timed out, checking for Turnstile...");
          const recheck = await detectChallenge(page);
          if (recheck.type === "turnstile") {
            await handleTurnstileChallenge(page, recheck.turnstileSiteKey, targetUrl);
          }
        }
      } else if (challengeInfo.type === "turnstile") {
        log("CF", "Turnstile detected, waiting 8s for potential auto-resolve...");
        await sleep(8000);
        const recheck = await detectChallenge(page);
        if (recheck.isChallenge) {
          await handleTurnstileChallenge(page, challengeInfo.turnstileSiteKey, targetUrl);
        } else {
          log("CF", "Turnstile auto-resolved in headful mode!");
        }
      }
    } else {
      log("CF", `No challenge detected - page loaded directly. Title: "${challengeInfo.title}"`);
    }

    // Wait for redirects and page load to complete
    await sleep(2000);
    try {
      await page.waitForFunction(() => document.readyState === "complete", { timeout: 10000 });
    } catch {}

    // Extract cookies - even without cf_clearance, all cookies are useful
    const result = await extractAllCookies(page);
    const cookieCount = Object.keys(result.allCookies).length;
    const currentTitle = await page.title().catch(() => "unknown");
    await page.close();

    log("CF", `Page title after bypass: "${currentTitle}", cookies: ${cookieCount}`);

    if (result.cfClearance) {
      globalCfClearance = result.cfClearance;
      lastRefresh = now;
      cachedCookies = result;
      consecutiveFailures = 0;
      log("CF", `Bypass SUCCESS! cf_clearance obtained. Total cookies: ${cookieCount}`);
      return result;
    }

    if (cookieCount > 0) {
      cachedCookies = result;
      consecutiveFailures = 0;
      log("CF", `Bypass OK - ${cookieCount} cookies obtained (no cf_clearance, site may not require it)`);
      log("CF", `Cookie names: ${Object.keys(result.allCookies).join(", ")}`);
      return result;
    }

    consecutiveFailures++;
    lastBypassError = "Cookie alınamadı. Proxy ve target domain doğru mu kontrol edin.";
    log("CF", lastBypassError);
    return null;
  } catch (err: any) {
    consecutiveFailures++;
    lastBypassError = err?.message || String(err);
    log("CF", `Bypass error: ${lastBypassError}`);
    if (page) await page.close().catch(() => {});
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
//  DIRECT BROWSER LOGIN
// ═══════════════════════════════════════════════════════════════
export async function directBrowserLogin(
  email: string,
  password: string,
  captchaToken?: string,
) {
  let page: Page | null = null;
  try {
    page = await createStealthPage();

    log("BROWSER-LOGIN", "Navigating to homepage...");
    await page.goto(getTargetUrl() + "/tr/", {
      waitUntil: "domcontentloaded",
      timeout: NAV_TIMEOUT,
    });
    await sleep(2000);

    // Handle CF challenge on homepage
    const challenge = await detectChallenge(page);
    if (challenge.isChallenge) {
      log("BROWSER-LOGIN", `CF challenge detected: ${challenge.type}`);

      if (challenge.type === "js_challenge" || challenge.type === "managed") {
        const resolved = await waitForChallengeResolution(page, 30000);
        if (!resolved) {
          log("BROWSER-LOGIN", "CF challenge did not resolve");
          const cookies = await extractAllCookies(page);
          await page.close();
          return {
            success: false,
            cookies: cookies.allCookies,
            error: "Cloudflare koruma aktif. cf_clearance cookie gerekli.",
          };
        }
        await sleep(2000);
      } else if (challenge.type === "turnstile") {
        const ok = await handleTurnstileChallenge(
          page,
          challenge.turnstileSiteKey,
          getTargetUrl() + "/tr/",
        );
        if (!ok) {
          const cookies = await extractAllCookies(page);
          await page.close();
          return {
            success: false,
            cookies: cookies.allCookies,
            error: "Turnstile çözülemedi.",
          };
        }
        await sleep(2000);
      }
    }

    log("BROWSER-LOGIN", "Fetching CSRF token from login form...");
    const loginFormHtml = await page.evaluate(async () => {
      try {
        const resp = await fetch(
          "/login/login?p=true&_=" + Date.now(),
          { credentials: "include" },
        );
        return await resp.text();
      } catch (e: any) {
        return "FETCH_ERROR: " + (e.message || "");
      }
    });

    const csrfMatch =
      loginFormHtml.match(
        /name="__RequestVerificationToken"[^>]*value="([^"]+)"/,
      ) ||
      loginFormHtml.match(
        /value="([^"]+)"[^>]*name="__RequestVerificationToken"/,
      );
    const csrfToken = csrfMatch ? csrfMatch[1] : "";
    log(
      "BROWSER-LOGIN",
      `CSRF: ${csrfToken ? csrfToken.substring(0, 20) + "..." : "NOT FOUND"}`,
    );

    const token = captchaToken || "";
    const currentTargetHost = getTargetHost();

    const performAjaxLogin = async (
      emailVal: string,
      passVal: string,
      tokenVal: string,
      csrf: string,
      tHost: string,
    ) => {
      const params = new URLSearchParams();
      if (csrf) params.append("__RequestVerificationToken", csrf);
      params.append("FormToken", document.location.host || tHost);
      params.append("Email", emailVal);
      params.append("Password", passVal);
      if (tokenVal) params.append("g-recaptcha-response", tokenVal);
      params.append("gameUrl", "");

      try {
        const resp = await fetch("/tr/Login/Login", {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "X-Requested-With": "XMLHttpRequest",
            Accept: "application/json, text/javascript, */*; q=0.01",
          },
          body: params.toString(),
          credentials: "include",
        });
        const text = await resp.text();
        return {
          status: resp.status,
          body: text,
          headers: Object.fromEntries(resp.headers.entries()),
        };
      } catch (e: any) {
        return {
          status: 0,
          body: "FETCH_ERROR: " + (e.message || ""),
          headers: {},
        };
      }
    };

    log("BROWSER-LOGIN", "Submitting login via AJAX...");
    let ajaxResult = await page.evaluate(
      performAjaxLogin,
      email,
      password,
      token,
      csrfToken,
      currentTargetHost,
    );

    log(
      "BROWSER-LOGIN",
      `AJAX result: status=${ajaxResult.status}, body=${ajaxResult.body.substring(0, 200)}`,
    );

    // Handle CF challenge on login POST
    if (
      ajaxResult.body.includes("moment") ||
      ajaxResult.body.includes("challenge") ||
      ajaxResult.status === 403
    ) {
      log("BROWSER-LOGIN", "CF challenge on login POST, handling...");

      const postChallenge = await detectChallenge(page);
      if (postChallenge.type === "turnstile") {
        await handleTurnstileChallenge(
          page,
          postChallenge.turnstileSiteKey,
          getTargetUrl() + "/tr/Login/Login",
        );
      } else {
        await waitForChallengeResolution(page, 20000);
      }

      await sleep(3000);

      // Retry login
      const ajaxResult2 = await page.evaluate(
        performAjaxLogin,
        email,
        password,
        token,
        csrfToken,
        currentTargetHost,
      );
      log(
        "BROWSER-LOGIN",
        `Retry result: status=${ajaxResult2.status}, body=${ajaxResult2.body.substring(0, 200)}`,
      );

      if (
        !(
          ajaxResult2.body.includes("moment") ||
          ajaxResult2.body.includes("challenge") ||
          ajaxResult2.status === 403
        )
      ) {
        ajaxResult = ajaxResult2;
      } else {
        const cookies = await extractAllCookies(page);
        await page.close();
        return {
          success: false,
          cookies: cookies.allCookies,
          error: "Cloudflare koruma aktif. cf_clearance cookie gerekli.",
        };
      }
    }

    if (ajaxResult.status >= 200 && ajaxResult.status < 400) {
      log("BROWSER-LOGIN", "AJAX succeeded, parsing...");
      const cookies = await extractAllCookies(page);
      await page.close();

      try {
        const json = JSON.parse(ajaxResult.body.trim());
        if (json.OpenTrustedBrowser === true) {
          return {
            success: true,
            requires2FA: true,
            message: "TrustBrowser 2FA required",
            cookies: cookies.allCookies,
            redirectUrl: "/tr/Login/TrustBrowser",
          };
        }
        if (json.Success || json.IsSuccess) {
          return {
            success: true,
            message: "Login successful",
            cookies: cookies.allCookies,
            redirectUrl: "/tr/",
          };
        }
        return {
          success: false,
          message: json.Message || "Login failed",
          cookies: cookies.allCookies,
          error: json.Message,
        };
      } catch {
        if (ajaxResult.body.toLowerCase().includes("trustbrowser")) {
          return {
            success: true,
            requires2FA: true,
            message: "TrustBrowser 2FA required",
            cookies: cookies.allCookies,
            redirectUrl: "/tr/Login/TrustBrowser",
          };
        }
        return {
          success: false,
          body: ajaxResult.body.substring(0, 500),
          cookies: cookies.allCookies,
          error: "Non-JSON response",
        };
      }
    }

    // Fallback: form submit
    log("BROWSER-LOGIN", "AJAX failed, trying form.submit() fallback...");
    await page.evaluate(
      (
        emailVal: string,
        passVal: string,
        tokenVal: string,
        csrf: string,
        tHost: string,
      ) => {
        const form = document.createElement("form");
        form.method = "POST";
        form.action = "/tr/Login/Login";
        form.style.display = "none";
        const fields: Record<string, string> = {
          FormToken: tHost,
          Email: emailVal,
          Password: passVal,
          gameUrl: "",
        };
        if (tokenVal) fields["g-recaptcha-response"] = tokenVal;
        if (csrf) fields["__RequestVerificationToken"] = csrf;
        for (const [name, value] of Object.entries(fields)) {
          const input = document.createElement("input");
          input.type = "hidden";
          input.name = name;
          input.value = value;
          form.appendChild(input);
        }
        document.body.appendChild(form);
        form.submit();
      },
      email,
      password,
      token,
      csrfToken,
      currentTargetHost,
    );

    try {
      await page.waitForNavigation({
        waitUntil: "networkidle2",
        timeout: 15000,
      });
    } catch {}

    const finalUrl = page.url();
    const finalBody = await page.evaluate(
      () =>
        document.body?.innerText ||
        document.documentElement?.outerHTML ||
        "",
    );
    log(
      "BROWSER-LOGIN",
      `After form submit: url="${finalUrl}", body=${finalBody.substring(0, 200)}`,
    );

    const cookies = await extractAllCookies(page);
    await page.close();

    if (finalUrl.includes("/tr/") && !finalUrl.includes("Login")) {
      return {
        success: true,
        message: "Login successful (redirected)",
        cookies: cookies.allCookies,
        redirectUrl: "/tr/",
      };
    }

    const bodyLower = finalBody.toLowerCase();
    if (
      bodyLower.includes("opentrustedbrowser") ||
      bodyLower.includes("trustbrowser") ||
      bodyLower.includes("doğrulama")
    ) {
      return {
        success: true,
        requires2FA: true,
        message: "TrustBrowser 2FA required",
        cookies: cookies.allCookies,
        redirectUrl: "/tr/Login/TrustBrowser",
      };
    }

    let parsedJson: any = null;
    try {
      parsedJson = JSON.parse(finalBody.trim());
    } catch {}

    if (parsedJson?.OpenTrustedBrowser === true) {
      return {
        success: true,
        requires2FA: true,
        message: "TrustBrowser 2FA required",
        cookies: cookies.allCookies,
        redirectUrl: "/tr/Login/TrustBrowser",
      };
    }
    if (parsedJson?.Success || parsedJson?.IsSuccess) {
      return {
        success: true,
        message: "Login successful",
        cookies: cookies.allCookies,
        redirectUrl: "/tr/",
      };
    }

    return {
      success: false,
      body: finalBody.substring(0, 500),
      cookies: cookies.allCookies,
      message: parsedJson?.Message,
      error: parsedJson?.Message || "Giriş başarısız",
    };
  } catch (err: any) {
    log("BROWSER-LOGIN", `Error: ${err.message}`);
    if (page) await page.close().catch(() => {});
    return { success: false, error: err.message };
  }
}

// ═══════════════════════════════════════════════════════════════
//  BROWSER FETCH HELPERS
// ═══════════════════════════════════════════════════════════════
export async function fetchPageViaBrowser(
  url: string,
  opts: any = {},
) {
  const p = await createStealthPage();

  if (opts.userAgent) {
    await p.setUserAgent(opts.userAgent);
    if (/Mobile|Android|iPhone|iPad/i.test(opts.userAgent)) {
      await p.setViewport({
        width: 430,
        height: 932,
        isMobile: true,
        hasTouch: true,
      });
    }
  }

  try {
    if (opts.method === "POST") {
      await p.goto(getTargetUrl() + "/tr/", {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });

      // Handle challenge before POST
      const challenge = await detectChallenge(p);
      if (challenge.isChallenge) {
        await waitForChallengeResolution(p, 20000);
      }

      const result = await p.evaluate(
        async (fetchUrl: string, fetchOpts: any) => {
          const resp = await fetch(fetchUrl, {
            method: "POST",
            headers: fetchOpts.headers || {
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: fetchOpts.body || "",
            credentials: "same-origin",
          });
          const text = await resp.text();
          const ct = resp.headers.get("content-type") || "text/html";
          return { status: resp.status, body: text, contentType: ct };
        },
        url,
        opts,
      );
      await p.close();
      return result;
    } else {
      const response = await p.goto(getTargetUrl() + url, {
        waitUntil: "load",
        timeout: NAV_TIMEOUT,
      });

      // Handle challenge
      const challenge = await detectChallenge(p);
      if (challenge.isChallenge) {
        log("BROWSER", "Challenge detected on page fetch, waiting...");
        await waitForChallengeResolution(p, 25000);
      }

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

export async function fetchResourceViaBrowser(
  url: string,
  clientUA?: string,
) {
  const p = await createStealthPage();

  if (clientUA) {
    await p.setUserAgent(clientUA);
    if (/Mobile|Android|iPhone|iPad/i.test(clientUA)) {
      await p.setViewport({
        width: 430,
        height: 932,
        isMobile: true,
        hasTouch: true,
      });
    }
  }

  try {
    await p.goto(getTargetUrl() + "/tr/", {
      waitUntil: "domcontentloaded",
      timeout: 20000,
    });

    // Handle challenge before resource fetch
    const challenge = await detectChallenge(p);
    if (challenge.isChallenge) {
      await waitForChallengeResolution(p, 20000);
    }

    const result = await p.evaluate(async (resourceUrl: string) => {
      const resp = await fetch(resourceUrl, { credentials: "same-origin" });
      const text = await resp.text();
      const ct =
        resp.headers.get("content-type") || "application/octet-stream";
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

// ═══════════════════════════════════════════════════════════════
//  EXPORTS (compatibility with routes.ts)
// ═══════════════════════════════════════════════════════════════
export function getLastBypassError(): string {
  return lastBypassError;
}
export function getCachedCookies() {
  return cachedCookies;
}
export function setCachedCookies(c: any) {
  cachedCookies = { allCookies: c } as any;
}
export function getPuppeteerSessionId() {
  return puppeteerSessionId;
}
export function setPuppeteerSessionId(id: string) {
  puppeteerSessionId = id;
}
export async function performLogin(e: string, p: string) {
  return directBrowserLogin(e, p);
}

// Cleanup on process exit
process.on("exit", () => {
  stopXvfb();
});
process.on("SIGTERM", () => {
  closeBrowser().then(() => stopXvfb());
});
process.on("SIGINT", () => {
  closeBrowser().then(() => stopXvfb());
});
