import fs from "fs";
import path from "path";

const POOL_DIR = path.resolve("data");
const POOL_FILE = path.join(POOL_DIR, "cookie-pool.json");
const MAX_SNAPSHOTS = 20;
const SNAPSHOT_TTL = 30 * 60 * 1000; // 30 dakika - eski snapshot'ları temizle
const CF_CLEARANCE_TTL = 8 * 60 * 1000; // 8 dakika

interface CookieSnapshot {
  id: string;
  cookies: Record<string, string>;
  createdAt: number;
  sessionId: string;
  hasCfClearance: boolean;
  source: "bypass" | "import" | "warmup" | "response";
  targetDomain: string;
}

interface CookiePoolData {
  snapshots: CookieSnapshot[];
  activeCookies: Record<string, string>;
  lastUpdated: number;
}

let poolData: CookiePoolData = {
  snapshots: [],
  activeCookies: {},
  lastUpdated: 0,
};

let saveTimer: NodeJS.Timeout | null = null;

function log(msg: string) {
  console.log(`[COOKIE-POOL] ${msg}`);
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
}

function ensureDir() {
  if (!fs.existsSync(POOL_DIR)) {
    fs.mkdirSync(POOL_DIR, { recursive: true });
  }
}

// ═══════════════════════════════════════════════════
//  DISK I/O
// ═══════════════════════════════════════════════════
export function loadPool(): Record<string, string> {
  ensureDir();
  try {
    if (fs.existsSync(POOL_FILE)) {
      const raw = fs.readFileSync(POOL_FILE, "utf-8");
      const data = JSON.parse(raw) as CookiePoolData;
      poolData = data;
      cleanExpiredSnapshots();
      log(`Loaded ${poolData.snapshots.length} snapshots, ${Object.keys(poolData.activeCookies).length} active cookies`);
      return { ...poolData.activeCookies };
    }
  } catch (err: any) {
    log(`Load error: ${err.message}`);
  }
  return {};
}

function saveToDisk() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      ensureDir();
      poolData.lastUpdated = Date.now();
      fs.writeFileSync(POOL_FILE, JSON.stringify(poolData, null, 2), "utf-8");
    } catch (err: any) {
      log(`Save error: ${err.message}`);
    }
  }, 1000);
}

// ═══════════════════════════════════════════════════
//  SNAPSHOT MANAGEMENT
// ═══════════════════════════════════════════════════
function cleanExpiredSnapshots() {
  const now = Date.now();
  const before = poolData.snapshots.length;
  poolData.snapshots = poolData.snapshots.filter((s) => now - s.createdAt < SNAPSHOT_TTL);

  if (poolData.snapshots.length > MAX_SNAPSHOTS) {
    poolData.snapshots = poolData.snapshots.slice(-MAX_SNAPSHOTS);
  }

  if (before !== poolData.snapshots.length) {
    log(`Cleaned ${before - poolData.snapshots.length} expired snapshots`);
  }
}

export function addSnapshot(
  cookies: Record<string, string>,
  sessionId: string,
  source: CookieSnapshot["source"],
  targetDomain: string,
): void {
  if (!cookies || Object.keys(cookies).length === 0) return;

  cleanExpiredSnapshots();

  const snapshot: CookieSnapshot = {
    id: generateId(),
    cookies: { ...cookies },
    createdAt: Date.now(),
    sessionId,
    hasCfClearance: !!cookies["cf_clearance"],
    source,
    targetDomain,
  };

  poolData.snapshots.push(snapshot);

  // Active cookies'e merge et (yeni cookie'ler mevcut olanları override eder)
  for (const [k, v] of Object.entries(cookies)) {
    poolData.activeCookies[k] = v;
  }

  saveToDisk();
  log(`Snapshot added: ${Object.keys(cookies).length} cookies from ${source}, cf_clearance=${snapshot.hasCfClearance}`);
}

// ═══════════════════════════════════════════════════
//  COOKIE RETRIEVAL
// ═══════════════════════════════════════════════════
export function getActiveCookies(): Record<string, string> {
  return { ...poolData.activeCookies };
}

export function getBestCookieSet(targetDomain: string): Record<string, string> | null {
  cleanExpiredSnapshots();

  const domainSnapshots = poolData.snapshots
    .filter((s) => s.targetDomain === targetDomain)
    .sort((a, b) => b.createdAt - a.createdAt);

  // cf_clearance olan en taze snapshot'ı tercih et
  const withClearance = domainSnapshots.find(
    (s) => s.hasCfClearance && Date.now() - s.createdAt < CF_CLEARANCE_TTL,
  );
  if (withClearance) return { ...withClearance.cookies };

  // cf_clearance olmasa bile en taze snapshot
  if (domainSnapshots.length > 0) return { ...domainSnapshots[0].cookies };

  // Active cookies'den dön
  if (Object.keys(poolData.activeCookies).length > 0) {
    return { ...poolData.activeCookies };
  }

  return null;
}

export function hasFreshCfClearance(targetDomain: string): boolean {
  return poolData.snapshots.some(
    (s) =>
      s.targetDomain === targetDomain &&
      s.hasCfClearance &&
      Date.now() - s.createdAt < CF_CLEARANCE_TTL,
  );
}

// ═══════════════════════════════════════════════════
//  COOKIE UPDATE (from proxy responses)
// ═══════════════════════════════════════════════════
export function updateCookies(newCookies: Record<string, string>): void {
  if (!newCookies || Object.keys(newCookies).length === 0) return;

  let changed = false;
  for (const [k, v] of Object.entries(newCookies)) {
    if (poolData.activeCookies[k] !== v) {
      poolData.activeCookies[k] = v;
      changed = true;
    }
  }

  if (changed) saveToDisk();
}

export function setCookie(name: string, value: string): void {
  if (poolData.activeCookies[name] !== value) {
    poolData.activeCookies[name] = value;
    saveToDisk();
  }
}

// ═══════════════════════════════════════════════════
//  BULK OPERATIONS
// ═══════════════════════════════════════════════════
export function importCookies(
  cookies: Record<string, string>,
  sessionId: string,
  targetDomain: string,
): number {
  if (!cookies || Object.keys(cookies).length === 0) return 0;

  addSnapshot(cookies, sessionId, "import", targetDomain);
  return Object.keys(cookies).length;
}

export function clearPool(): void {
  poolData.snapshots = [];
  poolData.activeCookies = {};
  poolData.lastUpdated = Date.now();
  saveToDisk();
  log("Pool cleared");
}

export function clearDomainCookies(targetDomain: string): void {
  poolData.snapshots = poolData.snapshots.filter(
    (s) => s.targetDomain !== targetDomain,
  );
  saveToDisk();
  log(`Cleared cookies for domain: ${targetDomain}`);
}

// ═══════════════════════════════════════════════════
//  STATUS / DIAGNOSTICS
// ═══════════════════════════════════════════════════
export function getPoolStatus() {
  cleanExpiredSnapshots();
  const now = Date.now();

  return {
    totalSnapshots: poolData.snapshots.length,
    activeCookieCount: Object.keys(poolData.activeCookies).length,
    activeCookieNames: Object.keys(poolData.activeCookies),
    hasCfClearance: !!poolData.activeCookies["cf_clearance"],
    snapshots: poolData.snapshots.map((s) => ({
      id: s.id,
      source: s.source,
      age: Math.round((now - s.createdAt) / 1000) + "s",
      cookieCount: Object.keys(s.cookies).length,
      hasCfClearance: s.hasCfClearance,
      sessionId: s.sessionId.substring(0, 8) + "...",
      targetDomain: s.targetDomain,
    })),
    lastUpdated: poolData.lastUpdated
      ? new Date(poolData.lastUpdated).toISOString()
      : null,
  };
}
