// The test sandbox: a temp home with a copy of the fixture bundles as an installed
// extension, its own state folder, and (optionally) its own parts folder. Every
// engine test runs in one; nothing here touches a real path.
//
//   const sb = makeSandbox({ set: "two", enabled: ["context-meter", "chat-media"] });
//   const r = await sb.run(["--verify"]);        // in-process: { code, out, err }
//   const c = sb.cli(["--ensure"]);               // child process: { code, out, err }
//   sb.read("webview"); sb.orig("host"); sb.remove();
//
// Layout of a sandbox <dir>:
//   <dir>\.vscode\extensions\anthropic.claude-code-<version>-win32-x64\{webview\index.js, extension.js}
//   <dir>\.claude\                 state folder (CCP_STATE_DIR), settings.json included
//   <dir>\parts\                   only with `set`/`parts`: CCP_PARTS_DIR, a copy of the real
//                                  parts/context-meter.mjs plus the chosen fake parts
// Without `set`/`parts` the engine uses the real parts/ next to it.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { run } from "../../claude_code_patch.mjs";
import { loadFixtures } from "./fixtures.mjs";

// Isolation sentinel: only tests/run.mjs sets CCP_RUN_BAIT to its bait folder under the OS
// temp dir, the same folder it gives USERPROFILE, HOME, APPDATA and CCP_STATE_DIR. A test file
// started any other way (`node --test tests/engine.test.mjs`) runs with the real home: refuse
// before any test. A bait outside the temp dir (the real home, set by hand) is refused too.
if (!runByRunner(process.env)) throw new Error("tests/lib/sandbox.mjs: not isolated - run the suite through node tests/run.mjs");

function runByRunner(env) {
  const bait = env.CCP_RUN_BAIT;
  if (!bait) return false;
  const key = (p) => path.resolve(p).toLowerCase();
  if (!key(bait).startsWith(key(os.tmpdir()) + path.sep)) return false;
  return ["USERPROFILE", "HOME", "APPDATA", "CCP_STATE_DIR"].every((v) => Boolean(env[v]) && key(env[v]) === key(bait));
}

export const BUILD_DIR = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
export const ENGINE = path.join(BUILD_DIR, "claude_code_patch.mjs");
export const FAKE_PARTS = path.join(BUILD_DIR, "tests", "fixtures", "fake-parts");
export const TARGET_PATH = { webview: ["webview", "index.js"], host: ["extension.js"] };
/** Every part, a literal list: the default config of a sandbox. */
export const ALL_PARTS = Object.freeze(["context-meter", "chat-media", "chat-icons", "chat-mark", "chat-files"]);

// Variables a sandbox owns; dropped from the inherited environment, then set.
const OWNED = /^(USERPROFILE|HOME|APPDATA|LOCALAPPDATA|NODE_TEST_CONTEXT|CC[PM]_\w*)$/i;

const sha1 = (buf) => crypto.createHash("sha1").update(buf).digest("hex");

/** Run `fn` with console.log/console.error captured; resolves to { code, out, err }. */
export async function captureConsole(fn) {
  const out = [];
  const err = [];
  const saved = [console.log, console.error];
  console.log = (...a) => out.push(a.join(" "));
  console.error = (...a) => err.push(a.join(" "));
  try {
    const code = await fn();
    return { code, out: out.join("\n"), err: err.join("\n") };
  } finally {
    [console.log, console.error] = saved;
  }
}

/**
 * A fresh sandbox. Options:
 *   fx        fixtures (default loadFixtures(), which throws loudly when unusable)
 *   set       name of a folder under tests/fixtures/fake-parts: all its .mjs files become parts
 *   parts     list of "<set>/<file>.mjs" fake parts (instead of or on top of `set`)
 *   enabled   part ids for the config file (default: all five); null -> no config file,
 *             which is the engine's own default (the base parts)
 *   language, buttons   written into that config file when given
 *   ledger    object written as vscode-claude-code-patch.ledger.json
 *   webview, host   text to install instead of the fixture's pristine bundle
 */
export function makeSandbox({ fx = loadFixtures(), set = null, parts = null, enabled = ALL_PARTS, language, buttons, ledger = null,
  webview = null, host = null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ccp-sb-"));
  const state = path.join(dir, ".claude");
  const inst = path.join(dir, ".vscode", "extensions", `anthropic.claude-code-${fx.version}-win32-x64`);
  fs.mkdirSync(path.join(inst, "webview"), { recursive: true });
  fs.mkdirSync(state);
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !OWNED.test(k)));
  Object.assign(env, { USERPROFILE: dir, HOME: dir, APPDATA: path.join(dir, "AppData"), CCP_STATE_DIR: state });
  const sb = new Sandbox(dir, state, inst, env, fx);
  sb.write("webview", webview === null ? fx.read("index.js.orig") : webview);
  sb.write("host", host === null ? fx.read("extension.js") : host);
  if (set || parts) {
    const partsDir = path.join(dir, "parts");
    fs.mkdirSync(partsDir);
    fs.copyFileSync(path.join(BUILD_DIR, "parts", "context-meter.mjs"), path.join(partsDir, "context-meter.mjs"));
    const fakes = [...(set ? fs.readdirSync(path.join(FAKE_PARTS, set)).filter((f) => f.endsWith(".mjs")).map((f) => `${set}/${f}`) : []), ...(parts || [])];
    for (const rel of fakes) fs.copyFileSync(path.join(FAKE_PARTS, ...rel.split("/")), path.join(partsDir, path.basename(rel)));
    env.CCP_PARTS_DIR = partsDir;
    sb.partsDir = partsDir;
  }
  if (enabled) {
    const cfg = { schema: "ccp-config/1", paused: false, enabled: [...enabled] };
    if (language !== undefined) cfg.language = language;
    if (buttons !== undefined) cfg.buttons = buttons;
    sb.setConfig(cfg);
  }
  if (ledger) sb.setJson("ledger", ledger);
  return sb;
}

class Sandbox {
  constructor(dir, state, inst, env, fx) {
    Object.assign(this, { dir, state, inst, env, fx, partsDir: null });
  }

  /** Absolute path of a target ("webview" | "host"). */
  path(target) {
    return path.join(this.inst, ...TARGET_PATH[target]);
  }

  read(target) {
    return fs.readFileSync(this.path(target), "utf8");
  }

  /** Text of `<target>.orig`, or null when absent. */
  orig(target) {
    const p = `${this.path(target)}.orig`;
    return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
  }

  write(target, text) {
    fs.writeFileSync(this.path(target), text);
  }

  writeOrig(target, text) {
    fs.writeFileSync(`${this.path(target)}.orig`, text);
  }

  /** Path of a state file: "config" | "ledger" | "local" | "lock" -> vscode-claude-code-patch.<name>[.json]; else a name inside the state folder. */
  statePath(name) {
    const own = { config: "config.json", ledger: "ledger.json", local: "local.json", lock: "lock" }[name];
    return path.join(this.state, own ? `vscode-claude-code-patch.${own}` : name);
  }

  json(name) {
    const p = this.statePath(name);
    return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : null;
  }

  setJson(name, value) {
    fs.writeFileSync(this.statePath(name), `${JSON.stringify(value, null, 2)}\n`);
  }

  setConfig(value) {
    this.setJson("config", value);
  }

  /** The engine's exported run() in this process, with this sandbox's env. */
  run(args = [], io = {}) {
    return captureConsole(() => run(args, this.env, io));
  }

  /** The engine as a child process (the real CLI path), with this sandbox's env plus `extraEnv`. */
  cli(args = [], extraEnv = {}, engine = ENGINE) {
    const r = spawnSync(process.execPath, [engine, ...args], { env: { ...this.env, ...extraEnv }, encoding: "utf8", timeout: 120000 });
    return { code: r.status, out: r.stdout || "", err: r.stderr || "" };
  }

  /** Every file under the sandbox except the parts folder: relative path -> "size:mtimeMs:sha1". */
  snapshot() {
    const out = {};
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (p === this.partsDir) continue;
        if (e.isDirectory()) walk(p);
        else {
          const st = fs.statSync(p);
          out[path.relative(this.dir, p)] = `${st.size}:${st.mtimeMs}:${sha1(fs.readFileSync(p))}`;
        }
      }
    };
    walk(this.dir);
    return out;
  }

  /** Leftover *.ccp-tmp-* files anywhere in the sandbox. */
  tmpFiles() {
    return Object.keys(this.snapshot()).filter((p) => /\.ccp-tmp-/.test(p));
  }

  remove() {
    fs.rmSync(this.dir, { recursive: true, force: true, maxRetries: 5 });
  }
}

/** Run `fn(sb)` in a fresh sandbox and remove it afterwards, whatever happens. */
export async function withSandbox(options, fn) {
  const sb = makeSandbox(options);
  try {
    return await fn(sb);
  } finally {
    sb.remove();
  }
}
