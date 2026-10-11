import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
if (existsSync(resolve(root, ".env"))) process.loadEnvFile(resolve(root, ".env"));
if (!existsSync(resolve(root, "node_modules"))) {
  console.error("Run pnpm install before starting Wandary.");
  process.exit(1);
}
const children = new Set();
let stopping = false;
function signalGroup(child, signal) {
  try { process.kill(-child.pid, signal); } catch (error) {
    if (error.code !== "ESRCH") child.kill(signal);
  }
}
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) signalGroup(child, "SIGTERM");
  setTimeout(() => {
    for (const child of children) signalGroup(child, "SIGKILL");
    process.exit(code);
  }, 1500).unref();
}
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
const apps = [
  ["API", "@wandary/api", "dev"],
  ["Customer", "@wandary/customer", "web"],
  ["Partner", "@wandary/partner", "web"],
  ["Operations", "@wandary/ops", "dev"],
];
for (const [name, pkg, script] of apps) {
  const child = spawn("pnpm", ["--filter", pkg, script], {
    cwd: root,
    stdio: "inherit",
    detached: true,
    env: { ...process.env, DEMO_MODE: process.env.DEMO_MODE ?? "true", CI: "1" },
  });
  children.add(child);
  child.on("error", (error) => {
    console.error(`${name} failed to start: ${error.message}`);
    stop(1);
  });
  child.on("exit", (code, signal) => {
    children.delete(child);
    if (!stopping) {
      console.error(`${name} exited (${code ?? signal}); stopping the app group.`);
      stop(code || 1);
    }
  });
}
console.log("Wandary local DEMO: customer :8081, partner :8082, operations :5173, API :4100.");
console.log("Start the database first: docker compose up -d postgres. Ctrl+C stops all app processes.");
