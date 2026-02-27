import { rm } from "node:fs/promises";

const targets = [
  "node_modules",
  "dist",
  "coverage",
  "logs",
  ".local",
  ".cursor",
  ".vscode",
];

for (const target of targets) {
  try {
    await rm(target, { recursive: true, force: true });
    console.log(`[clean] removed ${target}`);
  } catch (err) {
    console.warn(`[clean] skip ${target}:`, err?.message || err);
  }
}

console.log("[clean] done");
