const baseUrl = process.env.SMOKE_BASE_URL || "http://127.0.0.1:5000";
const endpoints = ["/healthz", "/", "/api/auth/me", "/payment", "/withdrawal"];

function okStatus(path, status) {
  if (path === "/") return status >= 200 && status < 400;
  return status >= 200 && status < 500;
}

async function run() {
  let failed = 0;

  for (const path of endpoints) {
    const url = `${baseUrl}${path}`;
    try {
      const res = await fetch(url, { redirect: "manual" });
      const ok = okStatus(path, res.status);
      console.log(`${ok ? "OK" : "FAIL"} ${path} -> ${res.status}`);
      if (!ok) failed++;
    } catch (err) {
      failed++;
      console.log(`FAIL ${path} -> ${err?.message || err}`);
    }
  }

  if (failed > 0) {
    console.error(`[smoke] failed checks: ${failed}`);
    process.exit(1);
  }

  console.log("[smoke] all checks passed");
}

run();
