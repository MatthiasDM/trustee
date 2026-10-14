// Start een geïsoleerde testomgeving: eigen D1/R2/KV-state, verse migraties en seed, Vite op poort 5199.
// Gebruik: node scripts/test-env.mjs start | stop | reset
import { spawn, execSync } from "node:child_process";
import { existsSync, rmSync, writeFileSync, readFileSync, mkdirSync, openSync } from "node:fs";

const STATE = ".wrangler/test-state";
const PORT = process.env.TEST_PORT ?? "5199";
const PID = ".wrangler/test-env.pid";
const cmd = process.argv[2] ?? "start";

function reset() {
  rmSync(STATE, { recursive: true, force: true });
  mkdirSync(STATE, { recursive: true });
  execSync(`npx wrangler d1 migrations apply trustee-db --local --persist-to ${STATE}`, { stdio: "inherit" });
  execSync(`node scripts/seed.mjs`, { stdio: "inherit" });
  execSync(`npx wrangler d1 execute trustee-db --local --persist-to ${STATE} --file=./seed/seed.sql`, { stdio: "inherit" });
}
async function waitHealthy(ms = 60000) {
  const t0 = Date.now();
  // health én een echte route met D1-toegang: de eerste aanroep na een koude start compileert nog en gaf sporadisch een 500 (HTML)
  while (Date.now() - t0 < ms) { try { const r = await fetch(`http://127.0.0.1:${PORT}/api/health`); const m = await fetch(`http://127.0.0.1:${PORT}/api/auth/me`); if (r.ok && m.ok) return true; } catch {} await new Promise((r) => setTimeout(r, 500)); }
  throw new Error("testserver niet gestart");
}
if (cmd === "reset") reset();
if (cmd === "start") {
  killPort();
  if (!existsSync(`${STATE}/v3`)) reset();
  const child = spawn("npx", ["vite", "--port", PORT, "--strictPort", "--host", "127.0.0.1"], { env: { ...process.env, TRUSTEE_STATE: STATE, CLOUDFLARE_ENV: "test" }, stdio: process.env.TEST_VERBOSE ? "inherit" : ["ignore", openSync(`${STATE}/server.log`, "a"), openSync(`${STATE}/server.log`, "a")], detached: true });
  child.unref();
  writeFileSync(PID, String(child.pid));
  await waitHealthy();
  console.log(`testomgeving op http://localhost:${PORT} (pid ${child.pid})`);
}
function killPort() {
  // alles wat op de testpoort luistert afsluiten (npm exec spawnt vite in een eigen procesgroep)
  try { const pids = execSync(`lsof -nP -iTCP:${PORT} -sTCP:LISTEN -t`, { encoding: "utf8" }).split("\n").filter(Boolean); for (const pid of pids) { try { process.kill(Number(pid), "SIGKILL"); } catch {} } } catch {}
  if (existsSync(PID)) { try { process.kill(-Number(readFileSync(PID, "utf8")), "SIGTERM"); } catch {} rmSync(PID, { force: true }); }
}
if (cmd === "stop") { killPort(); console.log("testomgeving gestopt"); }
