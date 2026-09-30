#!/usr/bin/env node
/**
 * Engine of the skill vscode-claude-code-patch.
 *
 * Patches the installed VS Code Claude Code extension - the chat webview bundle
 * (`webview/index.js`) and the extension host bundle (`extension.js`) - with the
 * enabled parts. The base install: `context-meter` (the ring), `chat-media`
 * (paths, previews, viewer), `chat-mark` (Insert path and the rectangle marks),
 * `chat-files` (the chat files panel). The add-on: `chat-icons` (composer buttons
 * from the config). One writer per file: every write rebuilds each target
 * from its pristine copy (`<file>.orig`, else the file itself) with the edits of
 * every enabled part in one pass, one parse check, one atomic write, one lock and
 * one SessionStart hook.
 *
 * Nothing path-like is computed at module load: every path comes from the `env`
 * handed to run(), at call time. Importing this module runs nothing; the CLI runs
 * only when this file is the process entry point. Windows only for now.
 *
 *   node claude_code_patch.mjs [--dry-run]           build from the pristine copy by the config
 *   node claude_code_patch.mjs --verify | --status | --where
 *   node claude_code_patch.mjs --enable <id> | --disable <id> | --reapply | --revert
 *   node claude_code_patch.mjs --language <en|ru> | --buttons <file|none>
 *   node claude_code_patch.mjs --ensure              self-heal for the SessionStart hook
 *   node claude_code_patch.mjs --install-hook | --uninstall-hook | --forget
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

/** The parts and their order: order of loading, of text at one point, of the config. */
export const PARTS = Object.freeze(["context-meter", "chat-media", "chat-icons", "chat-mark", "chat-files"]);

/** What a missing config enables: the base install. The buttons are the add-on. */
export const DEFAULT_ENABLED = Object.freeze(["context-meter", "chat-media", "chat-mark", "chat-files"]);

/** Languages of every label, tooltip and text the parts put into the chat. */
export const LANGUAGES = Object.freeze(["en", "ru"]);

/**
 * Marker names by owner and target - an engine constant, not read from modules.
 * A name ending in `:*` is a family: chat-icons owns every `CC-ICON:<id>`, one per
 * configured button, whatever the id.
 */
export const MARKERS = Object.freeze({
  engine: { webview: ["CC-RUN"] },
  "context-meter": { webview: ["CC-BTN:context", "CC-PIE"] },
  "chat-media": {
    webview: ["CC-HELP", "CC-CTX", "CC-URL", "CC-LINK", "CC-MDIMG", "CC-CODE"],
    host: ["CC-OPEN", "CC-CAPS", "CC-REVEAL", "CC-READIMG", "CC-PHOTOS", "CC-PS"],
  },
  "chat-icons": { webview: ["CC-SEND", "CC-ICON:*"] },
  "chat-mark": { webview: ["CC-MARK"] },
  "chat-files": { webview: ["CC-FILES", "CC-SESS"] },
});

/** Any marker of our namespace. Every guard sees this, not a list. */
export const ANY_MARKER = /\/\*CC-[A-Z]+(?::[\w-]+)?\*\//;
const ANY_MARKER_ALL = /\/\*(CC-[A-Z]+(?::[\w-]+)?)\*\//g;

const TARGETS = ["webview", "host"];
const WRITE_ORDER = ["host", "webview"]; // host first: a failed host write drops the host parts from webview
const TARGET_FILE = { webview: ["webview", "index.js"], host: ["extension.js"] };
const PLUMBING = "run-plumbing";
const PLUMBING_NAMES = ["cc", "ca"]; // declared by the run-plumbing text
const INSTALL_PREFIX = "anthropic.claude-code-";
const SKILL = "vscode-claude-code-patch";
const HOOK_TAG = "claude_code_patch.mjs";
const V1_HOOK_TAG = "patch_claude_code_ui.mjs";
const V1_SKILL = "vscode-claude-chat-context-meter";
// v1's hook in its runner form (Electron as node): run.ps1 / run.sh inside the v1 folder.
const V1_RUNNER = /vscode-claude-chat-context-meter[\\/]+run\.(?:ps1|sh)\b/i;
const CONFIG_SCHEMA = "ccp-config/1";
const CACHE_SCHEMA = "ccp-cache/1";
const LOCK_POLL_MS = 250;
const LOCK_WAIT_MS = 30000;
const LOCK_STALE_MS = 120000;
const RENAME_RETRIES = 10;
const RENAME_DELAY_MS = 100;
const RENAME_RETRY_CODES = ["EPERM", "EBUSY", "EACCES"];
const TMP_RE = /\.ccp-tmp-\d+$/;
const ENSURE_PREFIX = `Claude Code chat patch (${SKILL}):`;
const BUILDS = ["build", "enable", "disable", "reapply", "language", "buttons"];
const MIN_NODE = [16, 9]; // Object.hasOwn

const OWNER = new Map();
const FAMILY = []; // [prefix, owner] of every `:*` name
for (const [owner, row] of Object.entries(MARKERS)) {
  for (const names of Object.values(row)) {
    for (const name of names) {
      if (name.endsWith(":*")) FAMILY.push([name.slice(0, -1), owner]);
      else OWNER.set(name, owner);
    }
  }
}
/** Owner of a marker name; undefined for a foreign one. */
const ownerOf = (name) => OWNER.get(name) || (FAMILY.find(([prefix]) => name.startsWith(prefix)) || [])[1];
/** Whether `name` is on a marker row, by its exact name or its family. */
const onRow = (row, name) => row.some((r) => (r.endsWith(":*") ? name.startsWith(r.slice(0, -1)) : r === name));
const partTargets = (id) => Object.keys(MARKERS[id]);

const HELP = `Patch the Claude Code chat in VS Code (Windows). Base parts: context-meter (the context
ring), chat-media (previews and buttons under image paths, the image viewer, clickable file links),
chat-mark (Insert path and rectangle marks on images), chat-files (the chat files panel). Add-on:
chat-icons (your own composer buttons, from --buttons).

  (no flag)              build every enabled part from the pristine copy and write what changed
  --verify               per installation, target and part: SAFE TO PATCH or UNSAFE; writes nothing
  --enable <id>          enable a part and build          (parts: ${PARTS.join(", ")})
  --disable <id>         disable a part and build without it
  --language <en|ru>     language of the labels, tooltips and texts the patch adds; builds
  --buttons <file>       composer buttons from a JSON file (a list); enables chat-icons and builds
  --buttons none         remove the buttons, disable chat-icons and build
  --reapply              same as no flag
  --revert               restore every patched file from .orig byte for byte and pause;
                         the SessionStart hook re-applies nothing until an explicit build
  --ensure               self-heal for the SessionStart hook: builds when something changed and
                         says so as one JSON line {"systemMessage": ...}; always exits 0
  --status               config, markers found and whose, .orig, parts loaded, hook, traces of v1
  --where                installations and targets found, state folder
  --install-hook         add the SessionStart hook (refused while v1's hook is present)
  --uninstall-hook       remove it again
  --forget               delete the fingerprint cache (vscode-claude-code-patch.local.json)
  --dry-run              with a build: every check, no write at all
  -h, --help             this text

A button: {"id": "a-z0-9-", "icon": "<name>" or "label": "<= 3 chars", "tooltip": "<= 80 chars", "action":
  {"type": "command", "command": "/name"} | {"type": "send", "text": "..."} | {"type": "insert", "text": "one line"}};
  at most 5. A wrong field is named with the allowed values (icon names included).
No config file = the base parts in English. Config: %USERPROFILE%\\.claude\\vscode-claude-code-patch.config.json
Installations are looked up only in %USERPROFILE%\\.vscode\\extensions.
State: %USERPROFILE%\\.claude\\vscode-claude-code-patch.* (CCP_STATE_DIR moves it, settings.json too).
Every change becomes visible after Developer: Reload Window.`;

const USAGE = `usage: claude_code_patch.mjs [--verify | --enable <id> | --disable <id> | --language <en|ru> | --buttons <file|none> | --reapply | --revert | --ensure | --status | --where | --install-hook | --uninstall-hook | --forget] [--dry-run] (--help for more)`;

class Fatal extends Error {}
class Usage extends Error {}

/* ------------------------------------------------------------------ paths */

/** Every path of a run, from `env` at call time. */
function pathsOf(env) {
  const home = env.USERPROFILE || env.HOME || os.homedir();
  const state = env.CCP_STATE_DIR || path.join(home, ".claude");
  const here = path.dirname(fileURLToPath(import.meta.url));
  const stateFile = (suffix) => path.join(state, `${SKILL}.${suffix}`);
  return {
    home,
    state,
    engine: fileURLToPath(import.meta.url),
    extRoot: path.join(home, ".vscode", "extensions"),
    parts: env.CCP_PARTS_DIR ? path.resolve(env.CCP_PARTS_DIR) : path.join(here, "parts"),
    customParts: Boolean(env.CCP_PARTS_DIR),
    lib: path.join(here, "lib", "layout.mjs"),
    assets: path.join(here, "assets"),
    config: stateFile("config.json"),
    ledger: stateFile("ledger.json"),
    cache: stateFile("local.json"),
    lock: stateFile("lock"),
    settings: path.join(state, "settings.json"),
    // where a global install lives: `npx skills add -g` (junctioned into ~/.claude/skills), or a copy there
    globalSkills: [path.join(home, ".agents", "skills"), path.join(home, ".claude", "skills")],
    v1Skills: [...new Set([path.join(state, "skills", V1_SKILL), path.join(home, ".claude", "skills", V1_SKILL),
      path.join(home, ".agents", "skills", V1_SKILL)])],
  };
}

/* ----------------------------------------------------------------- basics */

const sha1 = (data) => crypto.createHash("sha1").update(data).digest("hex");
const sha12 = (text) => sha1(Buffer.from(text, "utf8")).slice(0, 12);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const readText = (file) => fs.readFileSync(file, "utf8");
/** JSON.parse that accepts a leading UTF-8 BOM (Windows PowerShell 5.1 `Set-Content -Encoding UTF8` writes one). */
const parseJson = (text) => JSON.parse(text.replace(/^\uFEFF/, ""));
const firstLine = (err) => {
  const msg = String((err && err.message) || err).split("\n")[0];
  const name = err && err.name;
  return name && name !== "Error" && !msg.startsWith(name) ? `${name}: ${msg}` : msg;
};

function isFile(file) {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

/** The real path of `p` (junctions resolved), lower-cased for comparison; the resolved path when it does not exist. */
function realKey(p) {
  let real = path.resolve(p);
  try {
    real = fs.realpathSync(real);
  } catch {}
  return real.toLowerCase();
}

const isUnder = (p, dir) => realKey(p).startsWith(realKey(dir) + path.sep);

function markersIn(src) {
  return [...src.matchAll(ANY_MARKER_ALL)].map((m) => m[1]);
}

const unique = (list) => [...new Set(list)];
const foreignOf = (names) => unique(names.filter((name) => !ownerOf(name)));

function stamp(file, featureSet) {
  const st = fs.statSync(file);
  return { size: st.size, mtimeMs: st.mtimeMs, featureSet };
}

/**
 * sha1 of the skill's own code - the engine, lib/layout.mjs, every part module in
 * use and every asset - once per run. It is in the fast-path key of --ensure, so a
 * skill update or a repair is applied at the next session start, and a part a
 * build left UNSAFE is tried again as soon as its code changes.
 */
function codeHash(R) {
  if (R.code) return R.code;
  const h = crypto.createHash("sha1");
  const add = (file, name) => {
    h.update(`${name}\n`);
    try {
      h.update(fs.readFileSync(file));
    } catch {
      h.update("(unreadable)");
    }
    h.update("\n");
  };
  add(R.p.engine, "engine");
  add(R.p.lib, "lib/layout.mjs");
  for (const [dir, tag] of [[R.p.parts, "parts"], [R.p.assets, "assets"]]) {
    let names = [];
    try {
      names = fs.readdirSync(dir).filter((name) => isFile(path.join(dir, name))).sort();
    } catch {}
    for (const name of names) add(path.join(dir, name), `${tag}/${name}`);
  }
  R.code = h.digest("hex").slice(0, 12);
  return R.code;
}

/** Fingerprint of what a build depends on besides the targets: the config's parts, language and buttons, and the code. */
const featureSetOf = (R, cfg) =>
  sha12(JSON.stringify({ enabled: cfg.enabled, language: languageOf(cfg), buttons: cfg.buttons === undefined ? null : cfg.buttons, code: codeHash(R) }));

/**
 * Write `text` to `file` atomically: a tmp file beside it, read back and compared
 * by sha1, then renamed over the file; a rename refused with EPERM/EBUSY/EACCES is
 * retried. Any failure removes the tmp and leaves `file` as it was.
 */
async function writeAtomic(R, file, text) {
  const tmp = `${file}.ccp-tmp-${process.pid}`;
  try {
    R.io.writeFile(tmp, text);
    if (sha1(fs.readFileSync(tmp)) !== sha1(Buffer.from(text, "utf8"))) {
      throw new Error(`${path.basename(tmp)} does not read back as written`);
    }
    for (let attempt = 0; ; attempt += 1) {
      try {
        fs.renameSync(tmp, file);
        return;
      } catch (err) {
        if (attempt >= RENAME_RETRIES || !RENAME_RETRY_CODES.includes(err.code)) throw err;
        await sleep(RENAME_DELAY_MS);
      }
    }
  } catch (err) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {}
    throw new Error(`writing ${file} failed: ${firstLine(err)}`);
  }
}

/* ------------------------------------------------------------------- lock */

/** Pid named by a lock whose run is no longer running (process.kill -> ESRCH), else null. */
function deadHolder(lock) {
  let m;
  try {
    m = readText(lock).match(/^(\d+) \S+/);
  } catch {
    return null;
  }
  const pid = m ? Number(m[1]) : 0;
  if (!pid || pid === process.pid) return null;
  try {
    process.kill(pid, 0);
    return null;
  } catch (err) {
    return err.code === "ESRCH" ? pid : null;
  }
}

/**
 * Run `fn` holding the lock. A lock naming a pid that no longer runs is removed at
 * once; any other held lock is waited for, polling every 250 ms up to
 * `io.lockWaitMs` (30 s); one older than 120 s is abandoned and removed. Every
 * writing command takes it; whoever takes it reads the config, the cache and the
 * files afresh.
 */
async function withLock(R, fn) {
  fs.mkdirSync(R.p.state, { recursive: true });
  const started = Date.now();
  let fd;
  for (;;) {
    try {
      fd = fs.openSync(R.p.lock, "wx");
      break;
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
      const dead = deadHolder(R.p.lock);
      if (dead) {
        try {
          fs.unlinkSync(R.p.lock);
          R.say(`  [-] removed a lock left by a run that is no longer running (pid ${dead})`);
          continue;
        } catch {} // not removable: the rules below
      }
      let since;
      try {
        since = fs.statSync(R.p.lock).mtimeMs;
      } catch {
        continue; // released between the two calls
      }
      if (Date.now() - since > LOCK_STALE_MS) {
        try {
          fs.unlinkSync(R.p.lock);
          continue;
        } catch {}
      }
      if (Date.now() - started >= R.io.lockWaitMs) {
        throw new Fatal(`the lock is held by another run since ${new Date(since).toISOString()} (${R.p.lock})`);
      }
      await sleep(LOCK_POLL_MS);
    }
  }
  try {
    fs.writeSync(fd, `${process.pid} ${new Date().toISOString()}\n`);
    return await fn();
  } finally {
    try {
      fs.closeSync(fd);
    } catch {}
    try {
      fs.unlinkSync(R.p.lock);
    } catch {}
  }
}

/* ------------------------------------------------------------ state files */

/**
 * The config: absent -> the base parts (DEFAULT_ENABLED), no language, no buttons;
 * unreadable or invalid -> { error, keep }, where `keep` holds the buttons of a
 * config that at least parses, so --revert does not throw them away.
 * `buttons` is not checked here: chat-icons checks it, so a bad list takes out
 * only that part.
 */
function readConfig(R) {
  if (!fs.existsSync(R.p.config)) return { cfg: { paused: false, enabled: [...DEFAULT_ENABLED] }, text: null };
  let text;
  let raw;
  try {
    text = readText(R.p.config);
    raw = parseJson(text);
  } catch (err) {
    return { error: `config ${R.p.config} is unreadable (${firstLine(err)})`, keep: {} };
  }
  const keep = raw && typeof raw === "object" && raw.buttons !== undefined ? { buttons: raw.buttons } : {};
  const bad = (why) => ({ error: `config ${R.p.config}: ${why}`, keep });
  if (!raw || raw.schema !== CONFIG_SCHEMA) return bad(`schema is not ${CONFIG_SCHEMA}`);
  if (typeof raw.paused !== "boolean" || !Array.isArray(raw.enabled)) return bad("needs a boolean paused and an enabled list");
  const unknown = raw.enabled.filter((id) => !PARTS.includes(id));
  if (unknown.length) return bad(`unknown part ${unknown.join(", ")} (parts: ${PARTS.join(", ")})`);
  if (raw.language !== undefined && !LANGUAGES.includes(raw.language)) {
    return bad(`language ${JSON.stringify(raw.language)} is not one of ${LANGUAGES.join(", ")}`);
  }
  const cfg = { paused: raw.paused, enabled: PARTS.filter((id) => raw.enabled.includes(id)) };
  if (raw.language !== undefined) cfg.language = raw.language;
  if (raw.buttons !== undefined) cfg.buttons = raw.buttons;
  return { cfg, text };
}

const languageOf = (cfg) => cfg.language || "en";

/** The config file's text: the three fixed keys, then language and buttons where the config has them. */
function configText(cfg) {
  const out = { schema: CONFIG_SCHEMA, paused: cfg.paused, enabled: cfg.enabled };
  if (cfg.language !== undefined) out.language = cfg.language;
  if (cfg.buttons !== undefined) out.buttons = cfg.buttons;
  return `${JSON.stringify(out, null, 2)}\n`;
}

function deepFreeze(value) {
  if (value && typeof value === "object") {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

/** ctx.options of every part: the language and a deep-frozen copy of the buttons (checked by chat-icons). */
function optionsOf(cfg) {
  const buttons = cfg.buttons === undefined ? [] : JSON.parse(JSON.stringify(cfg.buttons));
  return Object.freeze({ language: languageOf(cfg), buttons: deepFreeze(buttons) });
}

/** Chat-icons without buttons inserts nothing; --status does not expect its markers then. */
const insertsNothing = (id, cfg) => id === "chat-icons" && !(Array.isArray(cfg.buttons) && cfg.buttons.length);

function readJsonOr(file, fallback) {
  try {
    return JSON.parse(readText(file));
  } catch {
    return fallback;
  }
}

function readCache(R) {
  const raw = readJsonOr(R.p.cache, null);
  return raw && raw.schema === CACHE_SCHEMA && raw.targets && typeof raw.targets === "object" ? raw.targets : {};
}

async function writeCache(R, entries) {
  if (!Object.keys(entries).length) return;
  const targets = { ...readCache(R), ...entries };
  await writeAtomic(R, R.p.cache, `${JSON.stringify({ schema: CACHE_SCHEMA, targets }, null, 2)}\n`);
}

/**
 * The ledger of builds, read once per run. Absent = empty and readable; a file
 * that does not read, does not parse or is not an object = { ok: false, why }:
 * every build refuses, --revert restores without the sha1 check.
 */
function readLedger(R) {
  if (!fs.existsSync(R.p.ledger)) return { data: {}, ok: true };
  let data;
  try {
    data = JSON.parse(readText(R.p.ledger));
  } catch (err) {
    return { data: {}, ok: false, why: firstLine(err) };
  }
  return data && typeof data === "object" && !Array.isArray(data) ? { data, ok: true } : { data: {}, ok: false, why: "not a JSON object" };
}

const ledgerLine = (R) =>
  `ledger ${R.p.ledger} is unreadable (${R.ledger.why}) - fix it or delete it (deleting drops the sha1 history of every version)`;

/** The one ledger read of a build, --ensure or --verify: an unreadable ledger refuses the command. */
function takeLedger(R) {
  R.ledger = readLedger(R);
  if (!R.ledger.ok) throw new Fatal(ledgerLine(R));
}

function ledgerSha(ledger, version, target) {
  const entry = ledger.data[version];
  if (!entry || typeof entry !== "object") return null;
  const own = entry.targets && entry.targets[target] && entry.targets[target].sha1_pristine;
  const sha = own || (target === "webview" ? entry.sha1_pristine : null);
  return typeof sha === "string" ? sha.slice(0, 12) : null;
}

/* ---------------------------------------------------------- installations */

/** Installations under ~/.vscode/extensions only. */
function findInstalls(R) {
  let names;
  try {
    names = fs.readdirSync(R.p.extRoot).sort();
  } catch {
    return [];
  }
  const out = [];
  for (const name of names) {
    if (!name.startsWith(INSTALL_PREFIX)) continue;
    const dir = path.join(R.p.extRoot, name);
    const files = Object.fromEntries(TARGETS.map((t) => [t, path.join(dir, ...TARGET_FILE[t])]));
    if (!isFile(files.webview)) continue;
    const m = name.match(/claude-code-(\d+(?:\.\d+)*)/);
    out.push({ name, dir, version: m ? m[1] : name, files });
  }
  return out;
}

/** Leftovers of a killed run beside the targets and the state files; removed under the lock. */
function removeLeftovers(R, inst) {
  for (const dir of [inst.dir, path.join(inst.dir, "webview"), R.p.state]) {
    let names = [];
    try {
      names = fs.readdirSync(dir);
    } catch {}
    for (const name of names.filter((n) => TMP_RE.test(n))) {
      try {
        fs.rmSync(path.join(dir, name), { force: true });
        R.say(`  [-] removed leftover ${path.join(dir, name)}`);
      } catch {}
    }
  }
}

/* ------------------------------------------------------------------ guards */

/** Guards of a pristine copy: no marker at all; sha1 = ledger where known. */
function pristineGuard(src, version, target, ledger) {
  const marks = markersIn(src);
  if (marks.length) return `the pristine copy carries CC markers ${unique(marks).join(", ")}`;
  const want = ledgerSha(ledger, version, target);
  const have = sha12(src);
  if (want && have !== want) return `the pristine copy has sha1 ${have}, the ledger says ${want} for ${version}`;
  return null;
}

/** Guards of the current file: foreign markers; markers without .orig. */
function currentGuard(rec) {
  const marks = markersIn(rec.cur);
  const foreign = foreignOf(marks);
  if (foreign.length) return `foreign CC markers ${foreign.join(", ")}`;
  if (marks.length && !rec.hasOrig) {
    return `${path.basename(rec.file)} carries CC markers but ${path.basename(rec.orig)} is missing - reinstall the extension`;
  }
  return null;
}

/** Both targets of an installation, read once, guarded before the first plan(). */
function readTargets(inst, ledger) {
  const T = {};
  for (const target of TARGETS) {
    const file = inst.files[target];
    const rec = { target, file, orig: `${file}.orig`, hasOrig: isFile(`${file}.orig`) };
    T[target] = rec;
    if (!isFile(file)) {
      rec.guard = `${file} not found`;
      continue;
    }
    rec.cur = readText(file);
    rec.pristine = rec.hasOrig ? readText(rec.orig) : rec.cur;
    rec.guard = currentGuard(rec) || pristineGuard(rec.pristine, inst.version, target, ledger);
  }
  return T;
}

/** Parse check of a built target; the error line or null. */
function parseError(target, src) {
  try {
    if (target === "host") {
      new vm.Script(`(function (exports, require, module, __filename, __dirname) {${src}\n})`, { filename: "ccp-host.js" });
    } else {
      new vm.Script(src, { filename: "ccp-webview.js" });
      new vm.Script(`"use strict";${src}`, { filename: "ccp-webview-strict.js" });
    }
    return null;
  } catch (err) {
    return firstLine(err);
  }
}

/* ------------------------------------------------------------------ modules */

async function importFresh(file) {
  const st = fs.statSync(file);
  return import(`${pathToFileURL(file).href}?v=${st.mtimeMs}-${st.size}`);
}

/** lib/layout.mjs, loaded only by a build, --verify and --status, never statically. */
function loadLib(R) {
  if (!R.lib) {
    R.lib = importFresh(R.p.lib).then(
      (lib) => lib,
      (err) => ({ error: `lib/layout.mjs failed to load: ${firstLine(err)}` })
    );
  }
  return R.lib;
}

/** A part module, one at a time inside try/catch, checked against the part contract. */
function loadPart(R, id) {
  if (!R.modules.has(id)) {
    R.modules.set(id, (async () => {
      try {
        const mod = (await importFresh(path.join(R.p.parts, `${id}.mjs`))).default;
        if (!mod || typeof mod.plan !== "function") throw new Error("no default export with plan()");
        if (mod.id !== id) throw new Error(`its id ${JSON.stringify(mod.id)} is not the file name ${id}`);
        const want = JSON.stringify([...partTargets(id)].sort());
        if (!Array.isArray(mod.targets) || JSON.stringify([...mod.targets].sort()) !== want) {
          throw new Error(`its targets ${JSON.stringify(mod.targets)} differ from the engine table ${want}`);
        }
        return { mod };
      } catch (err) {
        return { error: `module did not load: ${firstLine(err)}` };
      }
    })());
  }
  return R.modules.get(id);
}

/** The contract checks over one plan() answer; throws with the reason. */
function checkPlan(id, target, plan, srcLength, toolbar, toolbarError) {
  if (!plan || !Array.isArray(plan.edits)) throw new Error("plan() returned no edits list");
  const requires = plan.requires === undefined ? [] : plan.requires;
  if (!Array.isArray(requires) || requires.some((r) => r !== PLUMBING)) {
    throw new Error(`requires ${JSON.stringify(requires)} is not a subset of ["${PLUMBING}"]`);
  }
  const row = MARKERS[id][target];
  plan.edits.forEach((edit, i) => {
    if (!edit || !Number.isInteger(edit.at) || edit.at < 0 || edit.at > srcLength || typeof edit.text !== "string") {
      throw new Error(`edit ${i} is not an insertion {at, text} inside the file`);
    }
    const marks = markersIn(edit.text);
    if (marks.length !== 1) throw new Error(`edit ${i} carries ${marks.length} CC markers, expected exactly 1`);
    if (!onRow(row, marks[0])) throw new Error(`edit ${i} carries ${marks[0]}, not one of its own (${row.join(", ")})`);
  });
  if (requires.includes(PLUMBING)) {
    if (!toolbar) throw new Error(`${PLUMBING} impossible: ${toolbarError}`);
    if (PLUMBING_NAMES.includes(toolbar.ctx)) {
      throw new Error(`${PLUMBING} impossible: the panel context is named ${toolbar.ctx}, a name its text declares`);
    }
  }
}

/** plan() of one part on each of its targets; the whole part or nothing. */
async function planPart(R, lib, inst, id, T, toolbar, toolbarError, options) {
  const loaded = await loadPart(R, id);
  if (loaded.error) return { error: `${id}: ${loaded.error}` };
  const plans = {};
  for (const target of partTargets(id)) {
    const src = T[target].pristine;
    try {
      const ctx = lib.makeCtx({ version: inst.version, target, src, toolbar, toolbarError, options });
      const plan = loaded.mod.plan(target, src, ctx);
      checkPlan(id, target, plan, src.length, toolbar, toolbarError);
      plans[target] = plan;
    } catch (err) {
      return { error: `${id}/${target}: ${firstLine(err)}` }; // any exception, not only LayoutError
    }
  }
  return { plans };
}

/* ------------------------------------------------------------------- build */

const asksPlumbing = (plans) => (id) => Object.values(plans.get(id)).some((p) => (p.requires || []).includes(PLUMBING));

/** The engine's shared edits: slash commands through the panel's command registry, v1's text verbatim. */
function runPlumbing(lay) {
  const reg = `${lay.ctx}.commandRegistry`;
  return [
    { at: lay.signatureEnd, text: ",onRunSlash:__ccRun,onCanRunSlash:__ccCan/*CC-RUN*/" },
    {
      at: lay.callPropsAt,
      text:
        `onRunSlash:(cc)=>{let ca=${reg}.findCommandByLabel(cc);if(!ca)return!1;return ${reg}.executeCommand(ca.id),!0},` +
        `onCanRunSlash:(cc)=>!!${reg}.findCommandByLabel(cc),/*CC-RUN*/`,
    },
  ];
}

/**
 * Assemble one target from its pristine copy: run-plumbing first, then every
 * built part in part order, through the one applyEdits. Returns the text and the
 * owners whose marker count after assembly is off.
 */
function assemble(lib, T, target, parts, plans, toolbar) {
  const ids = parts.filter((id) => plans.get(id)[target]);
  if (!ids.length) return null;
  const edits = [];
  if (target === "webview" && parts.some(asksPlumbing(plans))) {
    edits.push(...runPlumbing(toolbar));
  }
  for (const id of ids) edits.push(...plans.get(id)[target].edits);
  const text = lib.applyEdits(T[target].pristine, edits);
  const expected = new Map();
  for (const e of edits) for (const m of markersIn(e.text)) expected.set(m, (expected.get(m) || 0) + 1);
  const found = new Map();
  for (const m of markersIn(text)) found.set(m, (found.get(m) || 0) + 1);
  const off = unique([...expected.keys(), ...found.keys()].filter((m) => expected.get(m) !== found.get(m)).map(ownerOf));
  return { text, off };
}

async function writeTarget(R, rec, text) {
  if (text === rec.cur) return "unchanged";
  if (!rec.hasOrig) await writeAtomic(R, rec.orig, rec.pristine); // .orig first, from memory
  await writeAtomic(R, rec.file, text);
  return "written";
}

/**
 * One installation: guards, plan, assembly, parse, then write host before
 * webview. `mode.write` false = --verify / --dry-run: every check, no write.
 * Returns { ok, cache, ledger } where cache holds the fingerprints to record.
 */
async function buildInstall(R, inst, cfg, mode) {
  const T = readTargets(inst, R.ledger);
  const featureSet = featureSetOf(R, cfg);
  const options = optionsOf(cfg);
  const unsafe = new Map();
  const refuse = (id, reason) => {
    if (unsafe.has(id)) return;
    unsafe.set(id, reason);
    R.unsafeIds.add(id);
  };
  let ok = true;

  const known = R.ledger.data[inst.version];
  R.say(`  version ${inst.version}: ${known ? `in the ledger${known.date ? ` (${known.date})` : ""}` : "not in the ledger"}`);
  for (const t of TARGETS) {
    const rec = T[t];
    if (mode.verify && rec.cur !== undefined) {
      const marks = unique(markersIn(rec.cur));
      const want = ledgerSha(R.ledger, inst.version, t);
      R.say(`  ${t}: ${marks.length ? `patched (${marks.join(", ")})` : "clean"}; .orig ${rec.hasOrig ? "present" : "absent"}; ` +
        `pristine sha1 ${sha12(rec.pristine)}${want ? (want === sha12(rec.pristine) ? " = ledger" : ` != ledger ${want}`) : ""}`);
    }
    if (rec.guard && (cfg.enabled.some((id) => partTargets(id).includes(t)) || rec.hasOrig)) R.problem(`  REFUSED ${t}: ${rec.guard}`);
  }
  for (const id of cfg.enabled) for (const t of partTargets(id)) if (T[t].guard) refuse(id, `${id}/${t}: target refused: ${T[t].guard}`);

  // Plan every remaining enabled part on the pristine copies.
  const plans = new Map();
  let lib = null;
  let toolbar = null;
  const toPlan = cfg.enabled.filter((id) => !unsafe.has(id));
  if (toPlan.length) {
    lib = await loadLib(R);
    if (lib.error) {
      for (const id of toPlan) refuse(id, `${id}: ${lib.error}`);
    } else {
      const panel = lib.readToolbar(T.webview.pristine);
      toolbar = panel.toolbar;
      if (mode.verify) R.say(`  layout: ${toolbar ? toolbar.describe() : `not found: ${panel.toolbarError}`}`);
      for (const id of toPlan) {
        const r = await planPart(R, lib, inst, id, T, toolbar, panel.toolbarError, options);
        if (r.error) refuse(id, r.error);
        else plans.set(id, r.plans);
      }
    }
  }
  // A part that plans no edit at all (chat-icons without buttons) says why instead of "applied".
  const empty = (id) => plans.has(id) && Object.values(plans.get(id)).every((p) => p.edits.length === 0);
  const emptyWhy = (id) => {
    const note = Object.values(plans.get(id)).flatMap((p) => (Array.isArray(p.notes) ? p.notes : []))[0];
    return `nothing to insert${note ? ` (${note})` : ""}`;
  };

  // Assemble, recount markers, parse.
  let parts = cfg.enabled.filter((id) => plans.has(id) && !unsafe.has(id));
  const built = {};
  for (let dropped = true; dropped; parts = parts.filter((id) => !unsafe.has(id))) {
    dropped = false;
    for (const t of TARGETS) {
      built[t] = parts.length ? assemble(lib, T, t, parts, plans, toolbar) : null;
      for (const owner of built[t] ? built[t].off : []) {
        for (const id of parts.filter(owner === "engine" ? asksPlumbing(plans) : (x) => x === owner)) {
          refuse(id, `${id}/${t}: marker count after assembly differs from its edits`);
          dropped = true;
        }
      }
    }
  }
  for (const id of cfg.enabled) if (unsafe.has(id)) R.problem(`  UNSAFE: ${unsafe.get(id)}`);
  if (unsafe.size) ok = false;

  const parseFailed = TARGETS.filter((t) => built[t] && (built[t].parseError = parseError(t, built[t].text)));
  for (const t of parseFailed) R.problem(`  UNSAFE: parse ${t}: ${built[t].parseError}`);
  if (parseFailed.length) {
    R.problem(`  Fatal: ${parseFailed.join(" and ")} does not parse after the build - nothing written to any target`);
    return { ok: false, cache: {}, ledger: {} };
  }

  // Targets no enabled part touches go back to their .orig, after its guards.
  const restore = {};
  for (const t of TARGETS) {
    const rec = T[t];
    if (cfg.enabled.some((id) => partTargets(id).includes(t)) || !rec.hasOrig || rec.cur === undefined) continue;
    const why = rec.guard || (parseError(t, rec.pristine) && `${path.basename(rec.orig)} does not parse`);
    if (why) {
      if (!rec.guard) R.problem(`  REFUSED ${t}: ${why}`);
      R.problem(`  ${t}: not restored, left as it is`);
      ok = false;
    } else restore[t] = true;
  }

  if (!mode.write) {
    for (const id of cfg.enabled) {
      if (unsafe.has(id)) continue;
      R.say(`  ${id}: SAFE TO PATCH${mode.verify ? "" : " (dry run)"}`);
      if (empty(id)) R.say(`    ${id}: ${emptyWhy(id)}`);
    }
    for (const t of TARGETS) {
      if (built[t] && built[t].text !== T[t].cur) R.say(`  [dry-run] would write ${t}`);
      if (restore[t]) R.say(`  [dry-run] would restore ${t} from ${path.basename(T[t].orig)}`);
    }
    return { ok, cache: {}, ledger: {} };
  }

  // Write host first, then webview; a failed host drops the host parts from webview.
  const cache = {};
  const ledger = {};
  let changed = false;
  for (const t of WRITE_ORDER) {
    const rec = T[t];
    if (rec.cur === undefined) continue;
    try {
      if (built[t]) {
        const how = await writeTarget(R, rec, built[t].text);
        changed = changed || how === "written";
        R.say(`  [${how === "written" ? "w" : "="}] ${t} ${how}: ${parts.filter((id) => plans.get(id)[t]).join(", ")}`);
        if (!ledgerSha(R.ledger, inst.version, t)) ledger[t] = sha12(rec.pristine);
      } else if (restore[t]) {
        if (rec.cur !== rec.pristine) await writeAtomic(R, rec.file, rec.pristine);
        fs.unlinkSync(rec.orig);
        changed = true;
        R.say(`  [-] ${t} restored from ${path.basename(rec.orig)}, which is removed`);
      } else if (cfg.enabled.some((id) => partTargets(id).includes(t)) && rec.hasOrig) {
        R.say(`  [=] ${t} left as it is: it still carries the build of a previous run`);
      }
      cache[rec.file] = stamp(rec.file, featureSet);
    } catch (err) {
      ok = false;
      R.problem(`  [!] ${t}: ${firstLine(err)}`);
      if (t !== "host" || !built.webview) continue;
      for (const id of parts.filter((x) => partTargets(x).includes("host"))) {
        refuse(id, `${id}/host: the host write failed`);
        R.problem(`  UNSAFE: ${unsafe.get(id)}`);
      }
      parts = parts.filter((id) => !unsafe.has(id));
      built.webview = parts.length ? assemble(lib, T, "webview", parts, plans, toolbar) : null;
      const again = built.webview && parseError("webview", built.webview.text);
      if (again) {
        R.problem(`  Fatal: webview without the host parts does not parse (${again}) - webview not written`);
        return { ok: false, cache, ledger };
      }
    }
  }
  if (ok) for (const id of cfg.enabled) R.say(empty(id) ? `  [=] ${id}: ${emptyWhy(id)}` : `  [+] ${id} applied`);
  return { ok, cache, ledger, changed };
}

/**
 * A build over every installation (or `installs`), then the cache and the ledger.
 * R.ledger is the run's one read (takeLedger); the new sha1s are merged into it.
 * An error inside one installation takes only that installation out.
 */
async function buildAll(R, cfg, mode, installs = findInstalls(R)) {
  if (!installs.length) {
    R.problem(`no Claude Code installation under ${R.p.extRoot}`);
    return 1;
  }
  let code = 0;
  const cache = {};
  const ledgerAdds = {};
  for (const inst of installs) {
    R.say(inst.name);
    let r;
    try {
      if (mode.write) removeLeftovers(R, inst);
      r = await buildInstall(R, inst, cfg, mode);
    } catch (err) {
      R.problem(`  [!] ${inst.name}: ${firstLine(err)}`);
      code = 1;
      continue;
    }
    if (!r.ok) code = 1;
    Object.assign(cache, r.cache);
    if (Object.keys(r.ledger).length) ledgerAdds[inst.version] = r.ledger;
    if (r.changed) R.wrote.push(inst.version);
  }
  if (!mode.write) return code;
  await writeCache(R, cache);
  if (Object.keys(ledgerAdds).length) {
    const data = R.ledger.data;
    for (const [version, targets] of Object.entries(ledgerAdds)) {
      const entry = data[version] || { date: new Date().toISOString().slice(0, 10) };
      entry.targets = entry.targets || {};
      for (const [t, sha] of Object.entries(targets)) entry.targets[t] = { ...(entry.targets[t] || {}), sha1_pristine: sha };
      data[version] = entry;
    }
    await writeAtomic(R, R.p.ledger, `${JSON.stringify(data, null, 2)}\n`);
  }
  return code;
}

/* ------------------------------------------------------------------- hooks */

function readSettings(R) {
  if (!fs.existsSync(R.p.settings)) return {};
  let settings;
  try {
    settings = parseJson(readText(R.p.settings));
  } catch (err) {
    throw new Fatal(`${R.p.settings} is not valid JSON (${firstLine(err)}) - fix it first; nothing written`);
  }
  if (!settings || typeof settings !== "object" || Array.isArray(settings) || (settings.hooks !== undefined && (typeof settings.hooks !== "object" || !settings.hooks))) {
    throw new Fatal(`${R.p.settings} does not hold a settings object - nothing written`);
  }
  return settings;
}

const hookGroups = (settings) => (settings.hooks && Array.isArray(settings.hooks.SessionStart) ? settings.hooks.SessionStart : []);
const groupHooks = (group) => (group && Array.isArray(group.hooks) ? group.hooks : []);
const hookEntries = (settings) => hookGroups(settings).flatMap(groupHooks);
const entryJson = (entry) => JSON.stringify(entry === undefined ? null : entry);
const isOurHook = (entry) => entryJson(entry).includes(HOOK_TAG);
/** A SessionStart entry of v1 in any of its forms: node + patch_claude_code_ui.mjs, or run.ps1 / run.sh in the v1 folder. */
const isV1Hook = (entry) => entryJson(entry).includes(V1_HOOK_TAG) || V1_RUNNER.test(entryJson(entry));
const hasHook = (settings, match) => hookEntries(settings).some(match);

/** The strings a hook entry runs: its command, then its args. */
function entryStrings(entry) {
  if (!entry || typeof entry !== "object") return [];
  return [entry.command, ...(Array.isArray(entry.args) ? entry.args : [])].filter((s) => typeof s === "string");
}

/** Paths ending in one of `names` inside a hook entry: whole arguments, quoted words, plain words. */
function pathsIn(entry, names) {
  const ends = (s) => names.some((n) => s.toLowerCase().endsWith(n.toLowerCase()) && /[\\/]/.test(s.slice(-n.length - 1, -n.length)));
  const out = [];
  for (const s of entryStrings(entry)) {
    if (ends(s)) out.push(s);
    for (const m of s.matchAll(/"([^"]+)"|(\S+)/g)) if (ends(m[1] || m[2])) out.push(m[1] || m[2]);
  }
  return unique(out);
}

/** The folder v1 runs from: from its hook entry, else v1's usual install folders; null when none holds its script. */
function v1Folder(R, entry) {
  const dirs = [...pathsIn(entry, [V1_HOOK_TAG, "run.ps1", "run.sh"]).map((p) => path.dirname(p)), ...R.p.v1Skills];
  return dirs.find((dir) => isFile(path.join(dir, V1_HOOK_TAG))) || null;
}

/** The move off v1, with its exact commands where its folder is known. */
function v1Refusal(R, entry) {
  const dir = v1Folder(R, entry);
  const script = dir ? `"${path.join(dir, V1_HOOK_TAG)}"` : `"<v1 skill folder>\\${V1_HOOK_TAG}"`;
  return [
    `The v1 skill ${V1_SKILL} still patches this chat from its SessionStart hook in ${R.p.settings}: ` +
      "two patchers would erase each other's work. Move off v1 first, then run this command again:",
    `  1. node ${script} --uninstall-hook`,
    `  2. node ${script} --revert`,
    `  3. npx skills@latest remove -g ${V1_SKILL}`,
  ].join("\n");
}

/** Every build and --install-hook refuse while v1's hook is there (an unreadable settings.json names no hook). */
function refuseWhileV1(R, settings = null) {
  if (!settings) {
    try {
      settings = readSettings(R);
    } catch {
      return;
    }
  }
  const entry = hookEntries(settings).find(isV1Hook);
  if (entry) throw new Fatal(v1Refusal(R, entry));
}

/* ---------------------------------------------------------------- commands */

/** The buttons of `--buttons <file>`: a JSON list (or {"buttons": [...]}), checked by chat-icons itself. */
async function readButtons(R, file) {
  const where = path.resolve(file);
  let raw;
  try {
    raw = parseJson(readText(where));
  } catch (err) {
    throw new Fatal(`--buttons: ${where} is not a readable JSON file (${firstLine(err)}) - nothing written`);
  }
  const list = Array.isArray(raw) ? raw : raw && Array.isArray(raw.buttons) ? raw.buttons : null;
  if (!list) throw new Fatal(`--buttons: ${where} holds no list of buttons - nothing written`);
  if (!list.length) throw new Fatal(`--buttons: ${where} holds no button; --buttons none removes them - nothing written`);
  const loaded = await loadPart(R, "chat-icons");
  if (loaded.error) throw new Fatal(`--buttons: chat-icons ${loaded.error} - nothing written`);
  if (typeof loaded.mod.validateButtons === "function") {
    try {
      loaded.mod.validateButtons(list);
    } catch (err) {
      throw new Fatal(`--buttons: ${where}: ${firstLine(err)} - nothing written`);
    }
  }
  return list;
}

async function cmdBuild(R, o) {
  refuseWhileV1(R); // before the lock: nothing at all is written
  return withLock(R, async () => {
    takeLedger(R); // before the config write: an unreadable ledger writes nothing
    const c = readConfig(R);
    if (c.error) throw new Fatal(`${c.error} - fix or delete it (--revert rewrites it with the defaults)`);
    const cfg = { ...c.cfg, paused: false };
    if (o.cmd === "enable") cfg.enabled = PARTS.filter((id) => id === o.id || cfg.enabled.includes(id));
    if (o.cmd === "disable") cfg.enabled = cfg.enabled.filter((id) => id !== o.id);
    if (o.cmd === "language") cfg.language = o.value;
    if (o.cmd === "buttons" && o.value === "none") {
      delete cfg.buttons;
      cfg.enabled = cfg.enabled.filter((id) => id !== "chat-icons");
    } else if (o.cmd === "buttons") {
      cfg.buttons = await readButtons(R, o.value);
      cfg.enabled = PARTS.filter((id) => id === "chat-icons" || cfg.enabled.includes(id));
    }
    const have = c.text === null ? configText({ paused: false, enabled: [...DEFAULT_ENABLED] }) : c.text; // no file = the defaults
    if (!o.dryRun && configText(cfg) !== have) await writeAtomic(R, R.p.config, configText(cfg));
    const code = await buildAll(R, cfg, { write: !o.dryRun });
    if (!o.dryRun) R.say("\nReload VS Code to see the change: Ctrl+Shift+P -> Developer: Reload Window");
    return code;
  });
}

/**
 * Self-heal for the SessionStart hook: a fast path on the targets' size and mtime
 * plus the fingerprint of the config and the code; else, under the lock, afresh.
 */
async function cmdEnsure(R) {
  const fresh = (cfg, cache) => {
    const featureSet = featureSetOf(R, cfg);
    return (inst) =>
      TARGETS.every((t) => {
        const file = inst.files[t];
        if (!isFile(file)) return true;
        const had = cache[file];
        const now = stamp(file, featureSet);
        return had && had.size === now.size && had.mtimeMs === now.mtimeMs && had.featureSet === now.featureSet;
      });
  };
  const pending = () => {
    const c = readConfig(R);
    if (c.error) {
      R.problem(`${c.error}; doing nothing`);
      return null;
    }
    if (c.cfg.paused) return null;
    const cache = readCache(R);
    const todo = findInstalls(R).filter((inst) => !fresh(c.cfg, cache)(inst));
    return todo.length ? { cfg: c.cfg, todo } : null;
  };
  if (!pending()) return 0;
  refuseWhileV1(R);
  await withLock(R, async () => {
    takeLedger(R); // the slow path only: the fast path above never reads the ledger
    const again = pending(); // re-read under the lock
    if (again) await buildAll(R, again.cfg, { write: true }, again.todo);
  });
  return 0;
}

async function cmdRevert(R) {
  return withLock(R, async () => {
    const c = readConfig(R);
    if (c.error) R.say(`${c.error}; rewritten with the defaults${c.keep.buttons !== undefined ? ", its buttons kept" : ""}`);
    const cfg = c.error ? { paused: true, enabled: [...DEFAULT_ENABLED], ...c.keep } : { ...c.cfg, paused: true };
    await writeAtomic(R, R.p.config, configText(cfg)); // paused first: a hook starting now re-applies nothing
    const installs = findInstalls(R);
    if (!installs.length) {
      R.problem(`no Claude Code installation under ${R.p.extRoot}`);
      return 1;
    }
    // Unreadable ledger: restore without its sha1 check; the marker guard and the parse check stay.
    R.ledger = readLedger(R);
    let warn = !R.ledger.ok;
    let code = 0;
    const cache = {};
    for (const inst of installs) {
      R.say(inst.name);
      try { // one installation's or one target's error never stops the others
        removeLeftovers(R, inst);
        for (const t of WRITE_ORDER) {
          const file = inst.files[t];
          const orig = `${file}.orig`;
          if (!isFile(file)) continue;
          try {
            const marks = unique(markersIn(readText(file)));
            if (!isFile(orig)) {
              if (marks.length) {
                R.problem(`  [!] ${t} carries CC markers (${marks.join(", ")}) but ${path.basename(orig)} is missing - reinstall the extension`);
                code = 1;
              } else R.say(`  [=] ${t}: clean, nothing to restore`);
            } else {
              const pristine = readText(orig);
              const why = pristineGuard(pristine, inst.version, t, R.ledger) || (parseError(t, pristine) && `${path.basename(orig)} does not parse`);
              if (why) {
                R.problem(`  [!] ${t} NOT restored: ${why}; the file is left as it is`);
                code = 1;
                continue;
              }
              await writeAtomic(R, file, pristine);
              fs.unlinkSync(orig);
              const foreign = foreignOf(marks);
              R.say(`  [-] ${t} restored from ${path.basename(orig)}, which is removed` +
                (foreign.length ? `; foreign markers thrown away: ${foreign.join(", ")}` : ""));
              if (warn) R.problem(`ledger unreadable: .orig restored without the sha1 check (${R.p.ledger})`);
              warn = false;
            }
            cache[file] = stamp(file, featureSetOf(R, cfg));
          } catch (err) {
            R.problem(`  [!] ${inst.name} ${t}: ${firstLine(err)}`);
            code = 1;
          }
        }
      } catch (err) {
        R.problem(`  [!] ${inst.name}: ${firstLine(err)}`);
        code = 1;
      }
    }
    await writeCache(R, cache);
    R.say("\nPaused: the SessionStart hook re-applies nothing until an explicit build (no flag, --enable, --disable, --language, --buttons or --reapply).");
    R.say("Reload VS Code to see the change: Ctrl+Shift+P -> Developer: Reload Window");
    return code;
  });
}

async function cmdVerify(R) {
  const c = readConfig(R);
  if (c.error) R.problem(`${c.error} - verifying every part`);
  const cfg = c.error ? { paused: false, enabled: [...PARTS] } : c.cfg;
  if (cfg.paused) R.say("config: paused (--revert); below is what an explicit build would do");
  takeLedger(R); // unreadable: the line and exit 1, no trial build
  const code = await buildAll(R, cfg, { write: false, verify: true });
  return c.error ? 1 : code;
}

/** --install-hook / --uninstall-hook: one entry of ours; v1's is never touched. */
async function cmdHook(R, install) {
  return withLock(R, async () => {
    const settings = readSettings(R);
    if (install) refuseWhileV1(R, settings);
    if (install && process.versions.electron) {
      throw new Fatal("running under Electron: the hook would start the editor on every session; run this with node.exe");
    }
    const entry = { type: "command", command: process.execPath, args: [R.p.engine, "--ensure"], async: true, timeout: 120 };
    let found = 0;
    const groups = [];
    for (const group of hookGroups(settings)) {
      const hooks = [];
      for (const h of groupHooks(group)) {
        if (!isOurHook(h)) hooks.push(h);
        else if ((found += 1) === 1 && install) hooks.push(entry); // several of ours collapse into one
      }
      if (hooks.length || !groupHooks(group).some(isOurHook)) groups.push(Array.isArray(group && group.hooks) ? { ...group, hooks } : group);
    }
    if (!install && !found) {
      R.say(`  [=] no SessionStart hook of ours in ${R.p.settings}`);
      return 0;
    }
    if (install && !found) groups.push({ hooks: [entry] });
    settings.hooks = settings.hooks || {};
    if (groups.length) settings.hooks.SessionStart = groups;
    else delete settings.hooks.SessionStart;
    const bak = `${R.p.settings}.ccp.bak`;
    if (isFile(R.p.settings) && !isFile(bak)) await writeAtomic(R, bak, readText(R.p.settings));
    await writeAtomic(R, R.p.settings, `${JSON.stringify(settings, null, 2)}\n`);
    R.say(install ? `  [+] SessionStart hook ${found ? "refreshed" : "added"} in ${R.p.settings}` : `  [-] SessionStart hook removed from ${R.p.settings}`);
    if (install && !R.p.globalSkills.some((dir) => isUnder(R.p.engine, dir))) {
      R.say(`  warning: ${R.p.engine} is not a global install: the hook of every session now points into this folder, ` +
        `and moving or deleting it breaks the hook. A global install is recommended: npx skills@latest add warodan/${SKILL} -g`);
    }
    return 0;
  });
}

/** The engine path a hook entry of ours runs, or null. */
const hookEngine = (entry) => pathsIn(entry, [HOOK_TAG])[0] || null;
/** The node executable an exec-form hook entry runs by absolute path (what --install-hook records), or null. */
const hookNode = (entry) =>
  entry && typeof entry.command === "string" && Array.isArray(entry.args) && path.isAbsolute(entry.command) ? entry.command : null;

async function cmdStatus(R) {
  const c = readConfig(R);
  const enabled = c.error ? [...PARTS] : c.cfg.enabled;
  R.say(`config: ${c.error ? `UNREADABLE - ${c.error}` : `${c.text === null ? "none, defaults" : R.p.config}; paused: ${c.cfg.paused}; language: ${languageOf(c.cfg)}`}`);
  if (!c.error && c.cfg.buttons !== undefined) {
    const b = c.cfg.buttons;
    R.say(`buttons: ${Array.isArray(b) ? b.map((x) => (x && typeof x.id === "string" ? x.id : "?")).join(", ") || "none" : "not a list"}`);
  }
  if (R.p.customParts) R.say(`parts from: ${R.p.parts} (CCP_PARTS_DIR, not the skill's own parts/)`);
  const lib = await loadLib(R);
  R.say(`lib/layout.mjs: ${lib.error ? lib.error : "loaded"}`);
  for (const id of PARTS) {
    const m = enabled.includes(id) ? await loadPart(R, id) : null;
    R.say(`part ${id}: ${m ? `enabled; ${m.error || "module loaded"}` : "disabled"}`);
  }
  const ledger = readLedger(R);
  if (!ledger.ok) R.say(`ledger: unreadable (${ledger.why})`);
  for (const inst of findInstalls(R)) {
    R.say(`${inst.name}  (${inst.dir})`);
    for (const t of TARGETS) {
      const file = inst.files[t];
      if (!isFile(file)) {
        R.say(`  ${t}: missing`);
        continue;
      }
      const marks = markersIn(readText(file));
      const owners = unique(marks.map((m) => ownerOf(m) || "FOREIGN"));
      const want = enabled.filter((id) => partTargets(id).includes(t) && !(c.cfg && insertsNothing(id, c.cfg)));
      const orig = `${file}.orig`;
      const sha = isFile(orig) ? sha12(readText(orig)) : null;
      const led = ledgerSha(ledger, inst.version, t);
      R.say(`  ${t}: markers ${marks.length ? unique(marks).map((m) => `${m} (${ownerOf(m) || "FOREIGN"})`).join(", ") : "none"}`);
      const vsLedger = !ledger.ok ? "" : led ? (led === sha ? " = ledger" : ` != ledger ${led}`) : ", not in the ledger";
      R.say(`    expected by the config: ${want.length ? want.join(", ") : "none"}; .orig ${sha ? `present, sha1 ${sha}${vsLedger}` : "absent"}`);
      const foreign = foreignOf(marks);
      if (foreign.length) R.say(`    FOREIGN markers: ${foreign.join(", ")}`);
      const present = PARTS.filter((id) => owners.includes(id));
      if (JSON.stringify(present) !== JSON.stringify(want)) {
        R.say(`    note: the parts in the file differ from the config (found: ${present.join(", ") || "none"}) - an UNSAFE part, or the build of a previous run`);
      }
    }
  }
  let settings = null;
  try {
    settings = readSettings(R);
  } catch (err) {
    R.say(`hook: ${firstLine(err)}`);
  }
  if (settings) {
    const ours = hookEntries(settings).find(isOurHook);
    const at = ours && hookEngine(ours);
    const node = ours && hookNode(ours);
    const other = at && realKey(at) !== realKey(R.p.engine) ? `points at another copy ${at}` : "";
    if (!ours) R.say("hook: not installed (--install-hook)");
    else if (!at) R.say(`hook: installed, but its engine path does not read from ${R.p.settings} - run --install-hook`);
    else if (!isFile(at)) R.say(`hook: installed, points at ${at} (missing file) - run --install-hook`);
    else if (node && !isFile(node)) R.say(`hook: installed, ${other ? `${other}, ` : ""}runs ${node} (missing file) - run --install-hook`);
    else if (other) R.say(`hook: installed, ${other}`);
    else R.say("hook: installed");
    if (hasHook(settings, isV1Hook)) {
      R.say(`v1 trace: SessionStart hook of ${V1_SKILL} (${V1_HOOK_TAG}) in ${R.p.settings} - builds and --install-hook refuse until it is removed`);
    }
  }
  for (const dir of R.p.v1Skills) if (fs.existsSync(dir)) R.say(`v1 trace: skill folder ${dir}`);
  return 0;
}

function cmdWhere(R) {
  const installs = findInstalls(R);
  R.say(`runtime:  ${process.execPath} (node ${process.versions.node}${process.versions.electron ? ", Electron" : ""})`);
  R.say(`engine:   ${R.p.engine}`);
  R.say(`parts:    ${R.p.parts}${R.p.customParts ? " (CCP_PARTS_DIR)" : ""}`);
  R.say(`state:    ${R.p.state}`);
  R.say(`root:     ${R.p.extRoot}`);
  for (const inst of installs) {
    R.say(`install:  ${inst.dir}  (v${inst.version})`);
    for (const t of TARGETS) {
      const f = inst.files[t];
      R.say(`  ${t.padEnd(8)}${f}${isFile(f) ? "" : " (missing)"}${isFile(`${f}.orig`) ? "  [.orig present]" : ""}`);
    }
  }
  if (!installs.length) R.problem(`no Claude Code installation under ${R.p.extRoot}`);
  return installs.length ? 0 : 1;
}

async function cmdForget(R) {
  return withLock(R, async () => {
    if (!fs.existsSync(R.p.cache)) {
      R.say("  nothing cached");
      return 0;
    }
    fs.rmSync(R.p.cache);
    R.say(`  [-] removed ${R.p.cache}`);
    return 0;
  });
}

/* ------------------------------------------------------------------- entry */

const COMMANDS = {
  "--verify": "verify", "--enable": "enable", "--disable": "disable", "--revert": "revert",
  "--reapply": "reapply", "--ensure": "ensure", "--status": "status", "--install-hook": "install-hook",
  "--uninstall-hook": "uninstall-hook", "--where": "where", "--forget": "forget",
  "--language": "language", "--buttons": "buttons",
};

function parseArgs(argv) {
  const o = { cmd: null, flag: null, id: null, value: null, dryRun: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "-h" || a === "--help") o.help = true;
    else if (a === "--dry-run") o.dryRun = true;
    else if (Object.hasOwn(COMMANDS, a)) {
      if (o.cmd) throw new Usage(`one command at a time (${o.flag} and ${a})`);
      o.cmd = COMMANDS[a];
      o.flag = a;
      if (o.cmd === "enable" || o.cmd === "disable") {
        o.id = argv[(i += 1)];
        if (!PARTS.includes(o.id)) throw new Usage(`${a} needs a part id, got ${JSON.stringify(o.id)} (parts: ${PARTS.join(", ")})`);
      } else if (o.cmd === "language") {
        o.value = argv[(i += 1)];
        if (!LANGUAGES.includes(o.value)) throw new Usage(`${a} needs ${LANGUAGES.join(" or ")}, got ${JSON.stringify(o.value)}`);
      } else if (o.cmd === "buttons") {
        o.value = argv[(i += 1)];
        if (typeof o.value !== "string" || !o.value || o.value.startsWith("-")) {
          throw new Usage(`${a} needs a JSON file or none, got ${JSON.stringify(o.value)}`);
        }
      }
    } else throw new Usage(`unknown argument ${JSON.stringify(a)}`);
  }
  o.cmd = o.cmd || "build";
  if (o.dryRun && !BUILDS.includes(o.cmd)) {
    throw new Usage(`--dry-run goes only with a build (no flag, --enable, --disable, --language, --buttons, --reapply), not with ${o.flag}`);
  }
  return o;
}

/**
 * What --ensure says, as the systemMessage of its one JSON line: a rebuild (reload
 * the window), the parts left UNSAFE (ask Claude to fix the patch), any other
 * problem; null when there is nothing to say.
 */
function ensureMessage(R) {
  const say = [];
  if (R.wrote.length) say.push(`rebuilt for ${R.wrote.join(", ")}; reload the VS Code window to see it (Ctrl+Shift+P -> Developer: Reload Window).`);
  if (R.unsafeIds.size) say.push(`Not applied (UNSAFE): ${[...R.unsafeIds].join(", ")}; ask Claude to fix the Claude Code chat patch.`);
  else if (R.problems.length) say.push("A problem at session start; ask Claude to check the Claude Code chat patch.");
  if (R.problems.length) say.push(`Details: ${R.problems.join(" | ")}`);
  return say.length ? `${ENSURE_PREFIX} ${say.join(" ")}` : null;
}

/**
 * Run the CLI with `argv` against `env` (paths are derived from it on every
 * call). `io` is the test seam: { writeFile(file, text), lockWaitMs, platform, node };
 * the CLI never sets it. Resolves to the exit code; output goes to the console.
 * --ensure prints nothing but one JSON line {"systemMessage": ...} when it has
 * something to say (the hook runs async: plain output would reach no one), and
 * always resolves to 0.
 */
export async function run(argv, env = process.env, io = {}) {
  const ensure = argv.includes("--ensure");
  const R = {
    p: pathsOf(env),
    io: {
      writeFile: io.writeFile || ((file, text) => fs.writeFileSync(file, text, "utf8")),
      lockWaitMs: io.lockWaitMs === undefined ? LOCK_WAIT_MS : io.lockWaitMs,
    },
    quiet: ensure,
    problems: [],
    wrote: [],
    unsafeIds: new Set(),
    modules: new Map(),
    lib: null,
    code: null,
  };
  R.say = (line) => R.quiet || console.log(line);
  R.problem = (line) => (R.quiet ? R.problems.push(line.trim()) : console.log(line));
  let code;
  try {
    const nodeVersion = io.node || process.versions.node;
    const [major, minor] = nodeVersion.split(".").map(Number);
    if (major < MIN_NODE[0] || (major === MIN_NODE[0] && minor < MIN_NODE[1])) {
      throw new Fatal(`${SKILL} needs Node.js ${MIN_NODE.join(".")} or newer; this is ${nodeVersion} (${process.execPath}).`);
    }
    const o = parseArgs(argv);
    if (o.help) {
      console.log(HELP);
      return 0;
    }
    const platform = io.platform || process.platform;
    if (platform !== "win32") {
      throw new Fatal(`Windows only for now: ${SKILL} finds and patches the Claude Code extension of VS Code on Windows, and this is ${platform}.`);
    }
    if (BUILDS.includes(o.cmd)) code = await cmdBuild(R, o);
    else if (o.cmd === "ensure") code = await cmdEnsure(R);
    else if (o.cmd === "revert") code = await cmdRevert(R);
    else if (o.cmd === "verify") code = await cmdVerify(R);
    else if (o.cmd === "status") code = await cmdStatus(R);
    else if (o.cmd === "where") code = cmdWhere(R);
    else if (o.cmd === "forget") code = await cmdForget(R);
    else code = await cmdHook(R, o.cmd === "install-hook");
  } catch (err) {
    if (ensure) R.problems.push(err instanceof Fatal ? err.message.replace(/\s*\n\s*/g, " ") : firstLine(err));
    else if (err instanceof Usage) console.error(`${err.message}\n${USAGE}`);
    else console.error(err instanceof Fatal ? err.message : (err && err.stack) || String(err));
    code = 1;
  }
  if (!ensure) return code;
  const message = ensureMessage(R);
  if (message) console.log(JSON.stringify({ systemMessage: message }));
  return 0; // --ensure never fails a session start
}

function isEntryPoint() {
  try {
    return Boolean(process.argv[1]) && fs.realpathSync(fileURLToPath(import.meta.url)) === fs.realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  run(process.argv.slice(2), process.env).then(
    (code) => (process.exitCode = code),
    (err) => {
      console.error((err && err.stack) || String(err));
      process.exitCode = 1;
    }
  );
}
