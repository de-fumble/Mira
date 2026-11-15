// Runs automatically before `npm run dev` (the "predev" script).
// Stops any dev server already running for this project, including one that was
// paused with Ctrl+Z, so `npm run dev` always starts fresh on port 3000.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const LOCK = new URL("../.next/dev/lock", import.meta.url);

let pid;
try {
  pid = JSON.parse(readFileSync(LOCK, "utf8")).pid;
} catch {
  process.exit(0); // no lock → nothing running
}

const alive = (p) => {
  try {
    process.kill(p, 0);
    return true;
  } catch {
    return false;
  }
};

if (!pid || !alive(pid)) process.exit(0);

// The lock holds the server process; its parent is the `next dev` launcher. Stop both.
const pids = [pid];
try {
  const [ppid, ...cmd] = execFileSync("ps", ["-o", "ppid=,command=", "-p", String(pid)], { encoding: "utf8" })
    .trim()
    .split(/\s+/);
  const parent = Number(ppid);
  const parentCmd = execFileSync("ps", ["-o", "command=", "-p", String(parent)], { encoding: "utf8" });
  if (cmd.join(" ").includes("next") && /next(\.js)?\s+dev/.test(parentCmd)) pids.unshift(parent);
} catch {}

for (const p of pids) {
  try {
    process.kill(p, "SIGTERM");
    process.kill(p, "SIGCONT"); // a paused (Ctrl+Z) process only acts on TERM once resumed
  } catch {}
}

// Give it up to 3 s to exit cleanly, then force it.
const deadline = Date.now() + 3000;
while (pids.some(alive) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
for (const p of pids.filter(alive)) {
  try {
    process.kill(p, "SIGKILL");
  } catch {}
}

console.log(`Stopped the previous Mira dev server (PID ${pid}).`);
