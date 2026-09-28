// The only suite runner:
//   CCP_FIXTURES=<fixture folder of one version> node tests/run.mjs [test files]
//   (no files: every tests/*.test.mjs)
// 1. snapshots the guarded real paths (exists, size, mtime, sha1 - absent ones too);
// 2. isolation guard: the engine must not be a live copy (under ~/.claude or
//    ~/.agents/skills, or the one the SessionStart hook runs), and `--where` in a
//    sandbox must see only the sandbox installation, or the suite does not start;
// 3. runs `node --test --test-concurrency=1 <files>` with the bait environment:
//    USERPROFILE, HOME, APPDATA, LOCALAPPDATA and CCP_STATE_DIR point at an empty temp folder,
//    CCP_RUN_BAIT names that folder (tests/lib/sandbox.mjs refuses to load without it),
//    CCP_FIXTURES is set explicitly;
// 4. snapshots again and fails loudly on any change, and on anything written to the bait;
//    prints how many tests skipped and why (material only the author has, mostly).
// Exit: 0 green; 1 a test failed; 2 usage error, Node older than 20.10, CCP_FIXTURES
// inside the skill folder, suite refused, a guarded real file changed, or the bait was
// written to.
//
// The guarded-path list comes only from guardSpec(process.env) inside main(). The CLI
// accepts test files and nothing else (any argument starting with "-" is refused), and
// no environment variable changes the list, so a normal `node tests/run.mjs` call
// cannot redirect the guard. Only code that imports runSuite() can pass another list:
// that is the self-test in tests/layout.test.mjs, which points it at a temp folder.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { fixturesDir, loadFixtures } from "./lib/fixtures.mjs";

const USAGE = `usage: CCP_FIXTURES=<fixture folder> node tests/run.mjs [test files]
Runs the suite in isolation from the real installation. CCP_FIXTURES names the fixture
folder of one version (references/layout-recovery.md takes one from your installation).
Without files: every tests/*.test.mjs. Options: none (-h / --help prints this).`;
const SKIP_REPORTER = new URL("./lib/skip-reporter.mjs", import.meta.url).href;

const INSTALL_PREFIX = "anthropic.claude-code-";
const INSTALL_FILES = ["webview/index.js", "webview/index.js.orig", "extension.js", "extension.js.orig"];
const STATE_FILES = [
  "settings.json", "settings.json.ccp.bak", "settings.json.ccm.bak",
  ...["config.json", "ledger.json", "local.json", "lock"].map((s) => `vscode-claude-code-patch.${s}`),
  ...["local.json", "ledger.json", "runtime", "lock"].map((s) => `vscode-claude-chat-context-meter.${s}`),
];
const STATE_PATTERN = /^(settings\.json|vscode-claude-code-patch\.|vscode-claude-chat-context-meter\.)|\.ccp-tmp-/i;
const TMP_PATTERN = /\.ccp-tmp-/i;
const BAIT_VARS = ["USERPROFILE", "HOME", "APPDATA", "LOCALAPPDATA", "CCP_STATE_DIR"];
const MIN_NODE = [20, 10]; // --test-concurrency, --test-reporter-destination

/** Why this Node cannot run the suite, or null. */
export function nodeProblem(version = process.versions.node) {
  const [major, minor] = version.split(".").map(Number);
  if (major > MIN_NODE[0] || (major === MIN_NODE[0] && minor >= MIN_NODE[1])) return null;
  return `[run.mjs] the suite needs Node ${MIN_NODE.join(".")} or newer, this is ${version} (${process.execPath})`;
}

const keyOf = (p) => path.resolve(p).toLowerCase();

function uniquePaths(list) {
  const seen = new Map();
  for (const p of list) if (p && !seen.has(keyOf(p))) seen.set(keyOf(p), path.resolve(p));
  return [...seen.values()];
}

function listDir(dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

/** What to guard, derived from an environment at call time. */
export function guardSpec(env) {
  const homes = uniquePaths([env.USERPROFILE, env.HOME]);
  if (homes.length === 0) homes.push(os.homedir());
  return Object.freeze({
    extRoots: homes.map((h) => path.join(h, ".vscode", "extensions")),
    stateDirs: uniquePaths([...homes.map((h) => path.join(h, ".claude")), env.CCP_STATE_DIR]),
    skillRoots: homes.map((h) => path.join(h, ".agents", "skills")),
  });
}

/** Every guarded path that exists now, plus the fixed names whether they exist or not. */
function guardedPaths(spec) {
  const out = [];
  for (const root of spec.extRoots) {
    for (const name of listDir(root)) {
      if (!name.toLowerCase().startsWith(INSTALL_PREFIX)) continue;
      const inst = path.join(root, name);
      for (const f of INSTALL_FILES) out.push(path.join(inst, f));
      for (const d of [inst, path.join(inst, "webview")]) {
        for (const n of listDir(d)) if (TMP_PATTERN.test(n)) out.push(path.join(d, n));
      }
    }
  }
  for (const dir of spec.stateDirs) {
    for (const f of STATE_FILES) out.push(path.join(dir, f));
    for (const n of listDir(dir)) if (STATE_PATTERN.test(n)) out.push(path.join(dir, n));
  }
  return out;
}

function record(p) {
  let st;
  try {
    st = fs.statSync(p);
  } catch {
    return { path: p, exists: false };
  }
  const rec = { path: p, exists: true, isFile: st.isFile(), size: st.size, mtimeMs: st.mtimeMs };
  if (rec.isFile) rec.sha1 = crypto.createHash("sha1").update(fs.readFileSync(p)).digest("hex");
  return rec;
}

/** Map of lower-cased path -> {exists, isFile, size, mtimeMs, sha1}; `also` adds paths. */
export function snapshot(spec, also = []) {
  const map = new Map();
  for (const p of [...also, ...guardedPaths(spec)]) if (!map.has(keyOf(p))) map.set(keyOf(p), record(p));
  return map;
}

/** Records that differ between two snapshots, in either direction. */
export function compareSnapshots(before, after) {
  const changed = [];
  for (const k of new Set([...before.keys(), ...after.keys()])) {
    const b = before.get(k) || { path: (after.get(k) || {}).path, exists: false };
    const a = after.get(k) || { path: b.path, exists: false };
    if (["exists", "isFile", "size", "mtimeMs", "sha1"].some((f) => a[f] !== b[f])) changed.push({ before: b, after: a });
  }
  return changed;
}

function describe(rec) {
  if (!rec.exists) return "absent";
  const kind = rec.isFile ? "" : " (not a file)";
  return `${rec.size} bytes, mtime ${new Date(rec.mtimeMs).toISOString()}, sha1 ${(rec.sha1 || "-").slice(0, 12)}${kind}`;
}

/**
 * Copy of env without the variables a sandbox must own, plus `set`. NODE_TEST_CONTEXT
 * goes too: inherited from a test process it makes a nested `node --test` report to a
 * parent runner that is not listening, and its tests silently do not run.
 */
function childEnv(env, set) {
  const drop = new Set([...BAIT_VARS, "CCP_FIXTURES", "NODE_TEST_CONTEXT"]);
  const out = {};
  for (const [k, v] of Object.entries(env)) {
    const u = k.toUpperCase();
    if (drop.has(u) || (/^CC[PM]_/.test(u) && u !== "CCP_ALLOW_NO_FIXTURES")) continue;
    out[k] = v;
  }
  return Object.assign(out, set);
}

function listTree(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    out.push(p);
    if (e.isDirectory()) out.push(...listTree(p));
  }
  return out;
}

const norm = (text) => text.replace(/\//g, "\\").toLowerCase();
const under = (p, dir) => norm(path.resolve(p)).startsWith(norm(path.resolve(dir)) + "\\");

function realOf(p) {
  try {
    return fs.realpathSync(path.resolve(p));
  } catch {
    return path.resolve(p);
  }
}

/** Engine paths our SessionStart hook entries in `settings` run (whole arguments, quoted or plain words). */
function hookEngines(settings) {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(settings, "utf8").replace(/^\uFEFF/, "")); // the engine reads a BOM too
  } catch {
    return [];
  }
  const groups = data && data.hooks && Array.isArray(data.hooks.SessionStart) ? data.hooks.SessionStart : [];
  const out = [];
  for (const entry of groups.flatMap((g) => (g && Array.isArray(g.hooks) ? g.hooks : []))) {
    const strings = entry && typeof entry === "object" ? [entry.command, ...(Array.isArray(entry.args) ? entry.args : [])] : [];
    for (const s of strings.filter((x) => typeof x === "string")) {
      for (const w of [s, ...[...s.matchAll(/"([^"]+)"|(\S+)/g)].map((m) => m[1] || m[2])]) {
        if (/[\\/]claude_code_patch\.mjs$/i.test(w)) out.push(w);
      }
    }
  }
  return out;
}

/** Why `engine` is a live copy the suite must not run from, or null. */
function liveCopy(engine, spec) {
  const real = realOf(engine);
  const dir = [...spec.stateDirs, ...(spec.skillRoots || [])].find((d) => under(real, realOf(d)));
  if (dir) return `the engine ${real} lies under ${dir}: run the suite in a copy outside the live folders (tools/mirror.mjs makes one)`;
  for (const stateDir of spec.stateDirs) {
    const settings = path.join(stateDir, "settings.json");
    if (hookEngines(settings).some((p) => norm(realOf(p)) === norm(real))) {
      return `the engine ${real} is the one the SessionStart hook in ${settings} runs: run the suite in a copy (tools/mirror.mjs makes one)`;
    }
  }
  return null;
}

/** Step 2: `--where` in a sandbox must report the sandbox installation and nothing real. */
function isolationGuard(root, env, spec) {
  const engine = path.join(root, "claude_code_patch.mjs");
  if (!fs.existsSync(engine)) return { ok: true, note: "isolation guard: claude_code_patch.mjs not present yet, --where step skipped" };
  const live = liveCopy(engine, spec);
  if (live) return { ok: false, reason: live };
  let fx = null;
  try {
    fx = loadFixtures(env);
  } catch {
    fx = null; // the tests themselves report unusable fixtures loudly
  }
  const box = fs.mkdtempSync(path.join(os.tmpdir(), "ccp-run-where-"));
  try {
    const inst = path.join(box, ".vscode", "extensions", `${INSTALL_PREFIX}${fx ? fx.version : "2.1.280"}-win32-x64`);
    fs.mkdirSync(path.join(inst, "webview"), { recursive: true });
    fs.mkdirSync(path.join(box, ".claude"));
    const place = (name, dest) => (fx && fx.has(name) ? fs.copyFileSync(fx.path(name), dest) : fs.writeFileSync(dest, "void 0;\n"));
    place("index.js.orig", path.join(inst, "webview", "index.js"));
    place("extension.js", path.join(inst, "extension.js"));
    const env2 = childEnv(env, { USERPROFILE: box, HOME: box, APPDATA: box, CCP_STATE_DIR: path.join(box, ".claude"), ...fixturesOf(env) });
    const r = spawnSync(process.execPath, [engine, "--where"], { cwd: box, env: env2, encoding: "utf8", timeout: 60000 });
    const text = `${r.stdout || ""}\n${r.stderr || ""}`;
    if (r.error || r.status !== 0) return { ok: false, reason: `--where in the sandbox failed (status ${r.status}, ${r.error ? r.error.message : "no error"}):\n${text.trim()}` };
    const paths = (text.match(/[A-Za-z]:[\\/][^\s"'<>|*?]*/g) || []).map((p) => p.replace(/[.,;:)\]]+$/, ""));
    const foreign = paths.filter((p) => /anthropic\.claude-code-|[\\/]\.vscode[\\/]extensions/i.test(p) && !under(p, box));
    const real = [...spec.extRoots, ...spec.stateDirs].filter((d) => norm(text).includes(norm(path.resolve(d))));
    if (foreign.length || real.length) {
      return { ok: false, reason: `--where in the sandbox reported paths outside it: ${[...foreign, ...real].join(", ")}` };
    }
    if (!paths.some((p) => under(p, inst) || norm(path.resolve(p)) === norm(inst))) {
      return { ok: false, reason: `--where in the sandbox did not report the sandbox installation ${inst}:\n${text.trim()}` };
    }
    return { ok: true, note: "isolation guard: --where saw only the sandbox installation" };
  } finally {
    fs.rmSync(box, { recursive: true, force: true });
  }
}

/** { CCP_FIXTURES } of `env` when set, else {} (the CCP_ALLOW_NO_FIXTURES=1 bypass). */
const fixturesOf = (env) => (fixturesDir(env) ? { CCP_FIXTURES: fixturesDir(env) } : {});

/**
 * Steps 1-4. `guard` is the guard spec to snapshot; main() always passes
 * guardSpec(process.env). `stdio: "pipe"` returns the child's output as `output`.
 */
export function runSuite({ root, files, env, guard, stdio = "inherit", log = (line) => process.stderr.write(`${line}\n`) }) {
  const before = snapshot(guard);
  const result = { exitCode: 2, testExit: null, refused: null, violations: [], baitLeaks: [], checked: before.size, output: "", skipped: null };
  try {
    const iso = isolationGuard(root, env, guard);
    if (!iso.ok) {
      result.refused = iso.reason;
      return result;
    }
    log(`[run.mjs] ${iso.note}`);
    const bait = fs.mkdtempSync(path.join(os.tmpdir(), "ccp-run-bait-"));
    const skips = fs.mkdtempSync(path.join(os.tmpdir(), "ccp-run-skips-")); // outside the bait: the bait must stay empty
    try {
      // CCP_RUN_BAIT: the isolation sentinel tests/lib/sandbox.mjs checks at import.
      const set = { ...fixturesOf(env), CCP_RUN_BAIT: bait };
      for (const v of BAIT_VARS) set[v] = bait;
      const skipFile = path.join(skips, "skips.jsonl");
      const reporters = ["--test-reporter=spec", "--test-reporter-destination=stdout",
        `--test-reporter=${SKIP_REPORTER}`, `--test-reporter-destination=${skipFile}`];
      const r = spawnSync(process.execPath, ["--test", "--test-concurrency=1", ...reporters, ...files], {
        cwd: root, env: childEnv(env, set), stdio, encoding: "utf8", maxBuffer: 1 << 28,
      });
      result.testExit = r.status === 0 ? 0 : 1;
      if (r.error) log(`[run.mjs] node --test did not run: ${r.error.message}`);
      if (stdio === "pipe") result.output = `${r.stdout || ""}${r.stderr || ""}`;
      result.baitLeaks = listTree(bait);
      result.skipped = readSkips(skipFile);
    } finally {
      fs.rmSync(bait, { recursive: true, force: true });
      fs.rmSync(skips, { recursive: true, force: true });
    }
  } finally {
    result.violations = compareSnapshots(before, snapshot(guard, [...before.values()].map((r) => r.path)));
    const clean = !result.refused && result.violations.length === 0 && result.baitLeaks.length === 0;
    if (clean && result.testExit !== null) result.exitCode = result.testExit;
    report(result, log);
  }
  return result;
}

/** The skipped tests the skip reporter wrote: [{ name, reason, file }]. */
function readSkips(file) {
  let text = "";
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }
  return text.split("\n").filter(Boolean).map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return { name: line, reason: "(unreadable reporter line)", file: "" };
    }
  });
}

function report(result, log) {
  const bar = "=".repeat(78);
  if (result.skipped) {
    const byReason = new Map();
    for (const s of result.skipped) byReason.set(s.reason, (byReason.get(s.reason) || 0) + 1);
    log(`[run.mjs] skipped: ${result.skipped.length ? `${result.skipped.length}, by reason:` : "none"}`);
    for (const [reason, n] of byReason) log(`  ${n} x ${reason}`);
  }
  if (result.refused) log(`${bar}\n[run.mjs] SUITE NOT STARTED - isolation guard refused:\n${result.refused}\n${bar}`);
  if (result.violations.length) {
    log(`${bar}\n[run.mjs] REAL FILE CHANGED DURING THE SUITE - stop, do not re-run; investigate each file:`);
    for (const { before, after } of result.violations) log(`  ${after.path || before.path}\n    before: ${describe(before)}\n    after:  ${describe(after)}`);
    log(bar);
  }
  if (result.baitLeaks.length) {
    log(`${bar}\n[run.mjs] BAIT WRITTEN - code resolved a home/state path from the process environment:`);
    for (const p of result.baitLeaks) log(`  ${p}`);
    log(bar);
  }
  if (!result.violations.length) log(`[run.mjs] guarded real paths: ${result.checked} checked before and after, none changed`);
}

function main(argv) {
  if (argv.some((a) => a === "-h" || a === "--help")) {
    console.log(USAGE);
    return 0;
  }
  const old = nodeProblem();
  if (old) {
    console.error(old);
    return 2;
  }
  const bad = argv.filter((a) => a.startsWith("-"));
  if (bad.length) {
    console.error(`[run.mjs] unknown option ${bad.join(" ")}\n${USAGE}`);
    return 2;
  }
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const testsDir = path.join(root, "tests");
  const isFile = (p) => fs.existsSync(p) && fs.statSync(p).isFile();
  let files = argv.map((a) => [path.resolve(a), path.resolve(root, a)].find(isFile));
  const missing = argv.filter((a, i) => !files[i]);
  if (missing.length) {
    console.error(`[run.mjs] no such test file: ${missing.join(", ")}`);
    return 2;
  }
  if (files.length === 0) files = listDir(testsDir).filter((n) => n.endsWith(".test.mjs")).sort().map((n) => path.join(testsDir, n));
  if (files.length === 0) {
    console.error(`[run.mjs] no tests/*.test.mjs in ${root}`);
    return 2;
  }
  // node --test takes glob patterns: pass forward-slash paths, relative to root when inside it.
  const args = files.map((f) => (under(f, root) ? path.relative(root, f) : f).replace(/\\/g, "/"));
  if (process.env.CCP_ALLOW_NO_FIXTURES === "1") console.error("[run.mjs] *** CCP_ALLOW_NO_FIXTURES=1: fixture tests skip - SUITE INCOMPLETE ***");
  else if (!fixturesDir(process.env)) {
    console.error(`[run.mjs] CCP_FIXTURES is not set: point it at the fixture folder of one version\n${USAGE}`);
    return 2;
  } else if (under(realOf(fixturesDir(process.env)), realOf(root))) {
    // A fixture is Anthropic's code: inside the skill folder it would travel with a copy or a commit.
    console.error(`[run.mjs] CCP_FIXTURES ${fixturesDir(process.env)} lies inside the skill folder ${root}: ` +
      "keep fixtures under %LOCALAPPDATA%\\vscode-claude-code-patch\\fixtures (references/layout-recovery.md)");
    return 2;
  }
  return runSuite({ root, files: args, env: process.env, guard: guardSpec(process.env) }).exitCode;
}

const self = fileURLToPath(import.meta.url);
if (process.argv[1] && fs.realpathSync(self) === fs.realpathSync(process.argv[1])) process.exitCode = main(process.argv.slice(2));
