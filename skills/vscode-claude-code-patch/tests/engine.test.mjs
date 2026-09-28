// Engine tests T-E2..T-E15, T-E17..T-E19, T-E21..T-E25 (config, flags and messages of the
// release: tests/config.test.mjs). Every test runs in a sandbox (tests/lib/sandbox.mjs)
// with fake chat-media / chat-icons / chat-mark / chat-files parts from
// tests/fixtures/fake-parts and a copy of the real ring. A sandbox's config enables every
// part unless the test says otherwise, so a parts folder used that way carries all five
// (`two` holds the four fakes; other sets add NEW_FAKES).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { loadFixtures } from "./lib/fixtures.mjs";
import { makeSandbox, withSandbox, BUILD_DIR, ENGINE, FAKE_PARTS } from "./lib/sandbox.mjs";
import { xpatch } from "./lib/xpatch.mjs";
import { sysMsg } from "./lib/ensure.mjs";

const fx = loadFixtures();
const PRISTINE = { webview: fx.read("index.js.orig"), host: fx.read("extension.js") };
const CM_MEDIA = ["context-meter", "chat-media"];
const ALL_PARTS = ["context-meter", "chat-media", "chat-icons", "chat-mark", "chat-files"]; // literal, not the engine's PARTS
const BASE_PARTS = ["chat-media", "chat-mark", "chat-files"]; // no config file: the base install
const NEW_FAKES = ["two/chat-mark.mjs", "two/chat-files.mjs"];
const HOLDS = { timeout: 120000 }; // tests that hold a file or a lock
const has = (text, marker) => text.includes(`/*${marker}*/`);
const ext = (sb) => Object.fromEntries(Object.entries(sb.snapshot()).filter(([k]) => k.startsWith(".vscode")));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lines = (r) => `${r.out}\n${r.err}`;
const sha12 = (text) => crypto.createHash("sha1").update(text, "utf8").digest("hex").slice(0, 12);

/** Wait up to 10 s for a helper child's flag file; fail naming `what` at the deadline or when the child dies first. */
async function waitFlag(file, what, child) {
  let gone = null;
  child.once("error", (err) => (gone = `did not start (${err.message})`));
  child.once("exit", (code) => (gone = `exited with ${code}`));
  for (const until = Date.now() + 10000; !fs.existsSync(file); await sleep(20)) {
    if (gone && !fs.existsSync(file)) throw new Error(`${what}: the helper ${gone} before ${file} appeared`);
    if (Date.now() > until) {
      child.kill();
      throw new Error(`${what}: ${file} did not appear within 10 s`);
    }
  }
}

/** A path inside a single-quoted PowerShell string: a `'` in it (a user folder like O'Brien) is doubled. */
const psq = (p) => p.replace(/'/g, "''");

/** PowerShell opens `file` sharing nothing (reads fail with EBUSY) until the returned release() is awaited. */
async function holdFile(sb, file) {
  const [flag, go] = ["held", "go"].map((n) => path.join(sb.dir, `${n}-${path.basename(file)}`));
  const ps = `$f=[System.IO.File]::Open('${psq(file)}','Open','Read','None'); New-Item -ItemType File '${psq(flag)}' | Out-Null; ` +
    `$n=0; while (!(Test-Path '${psq(go)}') -and $n -lt 6000) { Start-Sleep -Milliseconds 10; $n++ }; $f.Close()`;
  const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { stdio: "ignore", env: sb.env });
  const exited = new Promise((resolve) => child.on("exit", resolve));
  await waitFlag(flag, `PowerShell holding ${file}`, child);
  return async () => {
    fs.writeFileSync(go, "");
    await exited;
    fs.rmSync(flag, { force: true });
    fs.rmSync(go, { force: true });
  };
}

let ring = null;
/** The webview of a build with the ring alone (on 2.1.280 = index.v1.js, T-E1). */
async function ringOnly() {
  ring ??= await withSandbox({ set: "two", enabled: ["context-meter"] }, async (sb) => {
    assert.equal((await sb.run()).code, 0);
    return sb.read("webview");
  });
  return ring;
}

/**
 * A child process holding the sandbox lock for `ms` (its text names the child's pid, as the
 * engine writes it), then running `thenJs` and releasing it; resolves once held.
 */
async function holdLock(sb, ms, thenJs = "") {
  const lock = sb.statePath("lock");
  const js = `const fs=require("fs");const [l]=process.argv.slice(1);const fd=fs.openSync(l,"wx");` +
    `fs.writeSync(fd,process.pid+" "+new Date().toISOString()+"\\n");fs.writeFileSync(l+".held","");` +
    `setTimeout(()=>{${thenJs};fs.closeSync(fd);fs.unlinkSync(l)},${ms})`;
  const child = spawn(process.execPath, ["-e", js, lock], { stdio: "ignore" });
  const exited = new Promise((resolve) => child.on("exit", resolve));
  await waitFlag(`${lock}.held`, "the lock holder", child);
  return { exited, pid: child.pid };
}

test("T-E2 ring -> --enable fake -> --disable is the ring-only build byte for byte; --revert gives both pristine", () =>
  withSandbox({ set: "two", enabled: ["context-meter"] }, async (sb) => {
    assert.equal((await sb.run()).code, 0);
    const ringText = sb.read("webview");
    assert.equal((await sb.run(["--enable", "chat-media"])).code, 0);
    assert.ok(has(sb.read("webview"), "CC-CTX") && has(sb.read("host"), "CC-OPEN"));
    assert.equal((await sb.run(["--disable", "chat-media"])).code, 0);
    assert.equal(sb.read("webview"), ringText);
    assert.equal(sb.read("host"), PRISTINE.host);
    assert.equal(sb.orig("host"), null);
    assert.equal((await sb.run(["--enable", "chat-media"])).code, 0);
    assert.equal((await sb.run(["--revert"])).code, 0);
    assert.equal(sb.read("webview"), PRISTINE.webview);
    assert.equal(sb.read("host"), PRISTINE.host);
    assert.deepEqual([sb.orig("webview"), sb.orig("host")], [null, null]);
  }));

test("T-E3 a .orig carrying any CC-[A-Z]+ marker -> UNSAFE, nothing written", () =>
  withSandbox({ set: "two" }, async (sb) => {
    sb.writeOrig("webview", `${PRISTINE.webview}\n/*CC-ZZZ*/\n`);
    const before = ext(sb);
    const r = await sb.run();
    assert.equal(r.code, 1);
    assert.match(r.out, /UNSAFE: context-meter\/webview: .*CC-ZZZ/);
    assert.deepEqual(ext(sb), before);
  }));

test("T-E4 known version, pristine sha1 differs from the ledger -> UNSAFE, nothing written", () =>
  withSandbox({ set: "two", ledger: { [fx.version]: { targets: { host: { sha1_pristine: "000000000000" } } } } }, async (sb) => {
    const before = ext(sb);
    const r = await sb.run(["--disable", "context-meter"]);
    assert.equal(r.code, 1);
    assert.match(r.out, /UNSAFE: chat-media\/host: .*the ledger says 000000000000/);
    assert.equal(sb.read("host"), PRISTINE.host);
    assert.equal(sb.orig("host"), null);
    assert.ok(!has(sb.read("webview"), "CC-CTX"));
    assert.equal(ext(sb)[path.relative(sb.dir, sb.path("host"))], before[path.relative(sb.dir, sb.path("host"))]);
  }));

test("T-E5 markers without .orig: in webview every part is refused, in host only the two-target part", async () => {
  await withSandbox({ set: "two" }, async (sb) => {
    sb.write("webview", await ringOnly());
    const before = ext(sb);
    const r = await sb.run();
    assert.equal(r.code, 1);
    for (const id of ALL_PARTS) assert.match(r.out, new RegExp(`UNSAFE: ${id}/webview: .*index\\.js\\.orig is missing`));
    assert.deepEqual(ext(sb), before);
  });
  await withSandbox({ set: "two" }, async (sb) => {
    sb.write("host", `${PRISTINE.host}\n/*CC-OPEN*/\n`);
    const r = await sb.run();
    assert.equal(r.code, 1);
    assert.match(r.out, /UNSAFE: chat-media\/host: .*extension\.js\.orig is missing/);
    assert.equal(sb.read("host"), `${PRISTINE.host}\n/*CC-OPEN*/\n`);
    const w = sb.read("webview");
    assert.ok(has(w, "CC-BTN:context") && has(w, "CC-SEND") && !has(w, "CC-CTX"));
  });
});

test("T-E6 lock: waits for a holder, removes a stale one, gives up after the wait, re-reads the config", HOLDS, async () => {
  await withSandbox({ set: "two", enabled: CM_MEDIA }, async (sb) => {
    const held = await holdLock(sb, 2000);
    const t0 = Date.now();
    const r = await sb.run();
    assert.equal(r.code, 0);
    assert.ok(Date.now() - t0 >= 1500, "the run did not wait for the lock");
    assert.ok(has(sb.read("webview"), "CC-CTX"));
    await held.exited;
  });
  await withSandbox({ set: "two", enabled: CM_MEDIA }, async (sb) => {
    fs.writeFileSync(sb.statePath("lock"), "x");
    const old = (Date.now() - 200000) / 1000;
    fs.utimesSync(sb.statePath("lock"), old, old);
    assert.equal((await sb.run([], { lockWaitMs: 1000 })).code, 0);
    assert.ok(has(sb.read("webview"), "CC-CTX"));
  });
  await withSandbox({ set: "two", enabled: CM_MEDIA }, async (sb) => {
    fs.writeFileSync(sb.statePath("lock"), "x");
    const manual = await sb.run([], { lockWaitMs: 300 });
    assert.equal(manual.code, 1);
    assert.match(manual.err, /lock is held by another run since/);
    const ensure = await sb.run(["--ensure"], { lockWaitMs: 300 });
    assert.match(sysMsg(ensure), /ask Claude to check the Claude Code chat patch\. Details: the lock is held/);
    assert.equal(sb.read("webview"), PRISTINE.webview);
  });
  await withSandbox({ set: "two", enabled: CM_MEDIA }, async (sb) => {
    const cfg = JSON.stringify({ schema: "ccp-config/1", paused: false, enabled: ["context-meter"] });
    const held = await holdLock(sb, 1000, `fs.writeFileSync(${JSON.stringify(sb.statePath("config"))},${JSON.stringify(cfg)})`);
    assert.equal((await sb.run()).code, 0);
    await held.exited;
    assert.ok(!has(sb.read("webview"), "CC-CTX"), "the waiting run built by the config it read before the lock");
    assert.equal(sb.orig("host"), null);
  });
  await withSandbox({ set: "two", enabled: CM_MEDIA }, async (sb) => {
    // --ensure's twin: it saw stale targets, waited, and the holder (a --revert) paused meanwhile
    const cfg = JSON.stringify({ schema: "ccp-config/1", paused: true, enabled: CM_MEDIA });
    const held = await holdLock(sb, 1000, `fs.writeFileSync(${JSON.stringify(sb.statePath("config"))},${JSON.stringify(cfg)})`);
    const e = await sb.run(["--ensure"]);
    await held.exited;
    assert.equal(sysMsg(e), "");
    assert.deepEqual([sb.read("webview"), sb.read("host")], [PRISTINE.webview, PRISTINE.host], "--ensure built by the config it read before the lock");
  });
});

test("T-E7 an update under a non-default config: --ensure builds exactly the enabled parts in the new folder", () =>
  withSandbox({ set: "two" }, async (sb) => {
    assert.equal((await sb.run(["--disable", "chat-media"])).code, 0);
    const inst = path.join(path.dirname(sb.inst), "anthropic.claude-code-9.9.9-win32-x64");
    fs.mkdirSync(path.join(inst, "webview"), { recursive: true });
    fs.copyFileSync(fx.path("index.js.orig"), path.join(inst, "webview", "index.js"));
    fs.copyFileSync(fx.path("extension.js"), path.join(inst, "extension.js"));
    const r = await sb.run(["--ensure"]);
    assert.match(sysMsg(r), /^Claude Code chat patch \(vscode-claude-code-patch\): rebuilt for 9\.9\.9; reload the VS Code window to see it/);
    const w = fs.readFileSync(path.join(inst, "webview", "index.js"), "utf8");
    assert.ok(has(w, "CC-BTN:context") && has(w, "CC-SEND") && has(w, "CC-MARK") && has(w, "CC-FILES"));
    assert.ok(!has(w, "CC-CTX"));
    assert.equal(fs.readFileSync(path.join(inst, "extension.js"), "utf8"), PRISTINE.host);
    assert.ok(!fs.existsSync(path.join(inst, "extension.js.orig")));
  }));

test("T-E8 --ensure rebuilds on a config change and on a change of the skill's code, and on nothing else", () =>
  withSandbox({ set: "two" }, async (sb) => {
    assert.equal((await sb.run()).code, 0);
    const built = ext(sb);
    assert.equal(sysMsg(await sb.run(["--ensure"])), "", "nothing changed: nothing said");
    assert.deepEqual(ext(sb), built);
    sb.setConfig({ schema: "ccp-config/1", paused: false, enabled: CM_MEDIA });
    assert.match(sysMsg(await sb.run(["--ensure"])), /rebuilt for /);
    assert.ok(!has(sb.read("webview"), "CC-SEND") && has(sb.read("webview"), "CC-CTX"));
    const part = path.join(sb.partsDir, "chat-media.mjs");
    fs.writeFileSync(part, fs.readFileSync(part, "utf8").replace('"\\n/*CC-CTX*/\\n"', '"\\n/*CC-CTX*/0;\\n"'));
    assert.match(sysMsg(await sb.run(["--ensure"])), /rebuilt for /, "a part's code changed: an update is applied at the next session start");
    assert.ok(sb.read("webview").includes("/*CC-CTX*/0;"));
    const now = ext(sb);
    const cache = sb.json("local");
    assert.equal(sysMsg(await sb.run(["--ensure"])), "");
    assert.deepEqual(ext(sb), now);
    assert.deepEqual(sb.json("local"), cache);
  }));

for (const [set, kind] of [["host-layout-error", "LayoutError"], ["host-type-error", "TypeError"]]) {
  test(`T-E9 plan() throws ${kind} on host -> the part is on no target, the ring is applied, --ensure says so`, () =>
    withSandbox({ parts: [`${set}/chat-media.mjs`], enabled: CM_MEDIA }, async (sb) => {
      const r = await sb.run(["--ensure"]);
      assert.match(sysMsg(r), new RegExp(`^Claude Code chat patch \\(vscode-claude-code-patch\\): rebuilt for ${fx.version.replace(/\./g, "\\.")}; ` +
        "reload the VS Code window .* Not applied \\(UNSAFE\\): chat-media; ask Claude to fix the Claude Code chat patch\\. " +
        `Details: UNSAFE: chat-media/host: ${kind}`));
      assert.equal(sb.read("webview"), await ringOnly());
      assert.deepEqual([sb.read("host"), sb.orig("host")], [PRISTINE.host, null]);
    }));
}

test("T-E10 a host edit that does not parse -> Fatal, no target written, the line names host; its twin passes", async () => {
  await withSandbox({ parts: ["host-syntax/chat-media.mjs"], enabled: CM_MEDIA }, async (sb) => {
    const before = ext(sb);
    const r = await sb.run();
    assert.equal(r.code, 1);
    assert.match(r.out, /UNSAFE: parse host: /);
    assert.match(r.out, /Fatal: host does not parse/);
    assert.deepEqual(ext(sb), before);
  });
  await withSandbox({ parts: ["two/chat-media.mjs"], enabled: CM_MEDIA }, async (sb) => {
    assert.equal((await sb.run()).code, 0);
    assert.ok(has(sb.read("host"), "CC-OPEN"));
  });
});

test("T-E11 a corrupted tmp (picked by file name) never lands; host is written before webview, .orig before its target", async () => {
  const corrupt = (re) => ({ writeFile: (f, text) => fs.writeFileSync(f, re.test(path.basename(f)) ? text.slice(0, 100) : text) });
  await withSandbox({ set: "two", enabled: CM_MEDIA }, async (sb) => {
    const r = await sb.run([], corrupt(/^extension\.js\.ccp-tmp-/));
    assert.equal(r.code, 1);
    assert.equal(sb.read("host"), PRISTINE.host);
    assert.equal(sb.read("webview"), await ringOnly());
    assert.deepEqual(sb.tmpFiles(), []);
  });
  await withSandbox({ set: "two", enabled: CM_MEDIA }, async (sb) => {
    const r = await sb.run([], corrupt(/^extension\.js\.orig\.ccp-tmp-/));
    assert.equal(r.code, 1);
    assert.deepEqual([sb.read("host"), sb.orig("host")], [PRISTINE.host, null]);
    assert.equal(sb.read("webview"), await ringOnly());
    assert.deepEqual(sb.tmpFiles(), []);
  });
  await withSandbox({ set: "two", enabled: CM_MEDIA }, async (sb) => {
    const r = await sb.run([], corrupt(/^index\.js\.ccp-tmp-/));
    assert.equal(r.code, 1);
    assert.equal(sb.read("webview"), PRISTINE.webview);
    assert.ok(has(sb.read("host"), "CC-OPEN"));
    assert.deepEqual(sb.tmpFiles(), []);
  });
});

test("T-E12 hook: one entry of ours, duplicates collapse, uninstall takes only ours, .ccp.bak once, bad JSON and v1 refuse", () =>
  withSandbox({ set: "two" }, async (sb) => {
    const settings = sb.statePath("settings.json");
    const other = { type: "command", command: "other-tool" };
    const ours = { type: "command", command: "node", args: ["x\\claude_code_patch.mjs", "--ensure"] };
    const v1 = { type: "command", command: "node", args: ["y\\patch_claude_code_ui.mjs", "--ensure"] };
    const seed = { theme: "dark", hooks: { SessionStart: [{ hooks: [other, ours] }, { hooks: [ours] }] } };
    fs.writeFileSync(settings, JSON.stringify(seed));
    const entries = () => JSON.parse(fs.readFileSync(settings, "utf8")).hooks.SessionStart.flatMap((g) => g.hooks);
    assert.equal((await sb.run(["--install-hook"])).code, 0);
    const mine = entries().filter((h) => JSON.stringify(h).includes("claude_code_patch.mjs"));
    assert.equal(mine.length, 1);
    assert.deepEqual(mine[0].args, [ENGINE, "--ensure"]);
    assert.deepEqual([mine[0].command, mine[0].async, mine[0].timeout], [process.execPath, true, 120]);
    assert.equal(fs.readFileSync(`${settings}.ccp.bak`, "utf8"), JSON.stringify(seed));
    assert.equal((await sb.run(["--install-hook"])).code, 0);
    assert.equal(fs.readFileSync(`${settings}.ccp.bak`, "utf8"), JSON.stringify(seed));
    assert.equal((await sb.run(["--uninstall-hook"])).code, 0);
    assert.deepEqual(entries(), [other]);
    assert.equal(JSON.parse(fs.readFileSync(settings, "utf8")).theme, "dark");
    for (const text of ["{ not json", JSON.stringify({ hooks: { SessionStart: [{ hooks: [other, v1] }] } })]) {
      fs.writeFileSync(settings, text);
      assert.equal((await sb.run(["--install-hook"])).code, 1);
      assert.equal(fs.readFileSync(settings, "utf8"), text);
    }
    assert.equal((await sb.run(["--uninstall-hook"])).code, 0);
    assert.deepEqual(entries(), [other, v1]);
  }));

test("T-E13 a module that does not load, a marker off its row, a broken lib/layout.mjs", async () => {
  await withSandbox({ set: "two" }, async (sb) => {
    assert.equal((await sb.run()).code, 0);
    fs.copyFileSync(path.join(FAKE_PARTS, "broken", "chat-media.mjs"), path.join(sb.partsDir, "chat-media.mjs"));
    const r = await sb.run();
    assert.equal(r.code, 1);
    assert.match(r.out, /UNSAFE: chat-media: module did not load: SyntaxError/);
    assert.doesNotMatch(r.out, /foreign/i);
    const w = sb.read("webview");
    assert.ok(has(w, "CC-BTN:context") && has(w, "CC-SEND") && !has(w, "CC-CTX"));
    assert.ok(has(sb.read("host"), "CC-OPEN"), "host with a failed part must be left as it is");
    assert.match((await sb.run(["--status"])).out, /part chat-media: enabled; module did not load/);
    assert.equal((await sb.run(["--revert"])).code, 0);
    assert.deepEqual([sb.read("webview"), sb.read("host")], [PRISTINE.webview, PRISTINE.host]);
  });
  await withSandbox({ parts: ["wrong-marker/chat-media.mjs", "two/chat-icons.mjs", ...NEW_FAKES] }, async (sb) => {
    const r = await sb.run();
    assert.equal(r.code, 1);
    assert.match(r.out, /UNSAFE: chat-media\/webview: edit 0 carries CC-ICON:finish, not one of its own/);
    assert.ok(has(sb.read("webview"), "CC-SEND") && has(sb.read("webview"), "CC-BTN:context"));
    assert.equal(sb.read("host"), PRISTINE.host);
  });
  await withSandbox({ set: "two" }, async (sb) => {
    assert.equal((await sb.run()).code, 0);
    const copy = path.join(sb.dir, "engine-copy");
    fs.mkdirSync(path.join(copy, "lib"), { recursive: true });
    fs.copyFileSync(ENGINE, path.join(copy, "claude_code_patch.mjs"));
    fs.writeFileSync(path.join(copy, "lib", "layout.mjs"), "export const broken = ;\n");
    const engine = path.join(copy, "claude_code_patch.mjs");
    sb.setConfig({ schema: "ccp-config/1", paused: false, enabled: CM_MEDIA });
    const before = ext(sb);
    const e = sb.cli(["--ensure"], {}, engine); // the config changed: the slow path
    assert.match(sysMsg(e), /Not applied \(UNSAFE\): context-meter, chat-media; .*lib\/layout\.mjs failed to load/);
    const r = sb.cli([], {}, engine);
    assert.equal(r.code, 1);
    for (const id of CM_MEDIA) assert.match(r.out, new RegExp(`UNSAFE: ${id}: lib/layout\\.mjs failed to load`));
    assert.deepEqual(ext(sb), before);
    assert.equal(sb.cli(["--revert"], {}, engine).code, 0);
    assert.deepEqual([sb.read("webview"), sb.read("host")], [PRISTINE.webview, PRISTINE.host]);
  });
});

test("T-E14 --revert holds against --ensure, --reapply builds; restored targets get a fresh cache entry (fast path); " +
  "paused is written before the first target; foreign markers are thrown away and named", async () => {
  await withSandbox({ set: "two" }, async (sb) => {
    assert.equal((await sb.run()).code, 0);
    const fastPath = async () => {
      fs.writeFileSync(sb.statePath("lock"), "held");
      const r = await sb.run(["--ensure"], { lockWaitMs: 200 });
      fs.rmSync(sb.statePath("lock"));
      return r.code === 0 && r.out === "" && r.err === "";
    };
    assert.equal((await sb.run(["--disable", "chat-media"])).code, 0);
    assert.equal(sb.orig("host"), null);
    assert.ok(await fastPath(), "--ensure after --disable of the last host part left the fast path");
    let pausedFirst = null; // the config on disk when --revert writes its first target tmp
    const writeFile = (f, text) => {
      if (pausedFirst === null && /^(index|extension)\.js\.ccp-tmp-/.test(path.basename(f))) pausedFirst = sb.json("config").paused;
      fs.writeFileSync(f, text);
    };
    assert.equal((await sb.run(["--revert"], { writeFile })).code, 0);
    assert.equal(pausedFirst, true, "--revert restored a target before it wrote paused");
    const reverted = ext(sb);
    const pausedConfig = sb.json("config");
    sb.setConfig({ ...pausedConfig, paused: false });
    assert.ok(await fastPath(), "--ensure after --revert left the fast path");
    sb.setConfig(pausedConfig);
    assert.equal((await sb.run(["--forget"])).code, 0); // no cache left: only `paused` holds --ensure back
    assert.equal((await sb.run(["--ensure"])).code, 0);
    assert.deepEqual(ext(sb), reverted);
    assert.equal((await sb.run(["--reapply"])).code, 0);
    assert.ok(has(sb.read("webview"), "CC-BTN:context"));
    assert.equal(sb.json("config").paused, false);
  });
  await withSandbox({ set: "two" }, async (sb) => {
    assert.equal((await sb.run()).code, 0);
    for (const t of ["host", "webview"]) xpatch(sb.path(t), "patch-end");
    const r = await sb.run(["--revert"]);
    assert.equal(r.code, 0, lines(r));
    assert.deepEqual([sb.read("webview"), sb.read("host"), sb.orig("webview"), sb.orig("host")], [PRISTINE.webview, PRISTINE.host, null, null]);
    for (const t of ["host", "webview"]) assert.match(r.out, new RegExp(`\\] ${t} restored .*; foreign markers thrown away: CC-MEDIA`));
  });
});

test("T-E15 at one panel point: the ring, then part one's edits in list order, then part two's", () =>
  withSandbox({ set: "panel", parts: NEW_FAKES }, async (sb) => {
    assert.equal((await sb.run()).code, 0);
    const w = sb.read("webview");
    const order = ["CC-BTN:context", "CC-CTX", "CC-URL", "CC-ICON:handoff", "CC-ICON:finish"].map((m) => w.indexOf(`/*${m}*/`));
    assert.ok(order.every((at) => at > 0));
    assert.deepEqual(order, [...order].sort((a, b) => a - b));
    const end = order[4] + "/*CC-ICON:finish*/".length;
    assert.equal(w.slice(order[1], end), "/*CC-CTX*//*CC-URL*//*CC-ICON:handoff*//*CC-ICON:finish*/");
  }));

test("module checks: id not the file name, targets off the table, an edit outside the file -> UNSAFE", async () => {
  const reasons = { "bad-id": /its id "chat-icons" is not the file name/, "bad-targets": /its targets \["webview"\] differ/, "bad-edit": /\/host: edit 0 is not an insertion/ };
  for (const [set, reason] of Object.entries(reasons)) {
    await withSandbox({ parts: [`${set}/chat-media.mjs`], enabled: CM_MEDIA }, async (sb) => {
      const r = await sb.run();
      assert.equal(r.code, 1, set);
      assert.match(r.out, new RegExp(`UNSAFE: chat-media.*${reason.source}`));
      assert.equal(sb.read("webview"), await ringOnly());
      assert.equal(sb.read("host"), PRISTINE.host);
    });
  }
});

test("recount: edits that together spell another marker make their part UNSAFE; the rest builds", () =>
  withSandbox({ parts: ["split-marker/chat-media.mjs"], enabled: CM_MEDIA }, async (sb) => {
    const r = await sb.run();
    assert.equal(r.code, 1);
    assert.match(r.out, /UNSAFE: chat-media\/webview: marker count after assembly differs from its edits/);
    assert.equal(sb.read("webview"), await ringOnly());
    assert.equal(sb.read("host"), PRISTINE.host);
  }));

test("T-E17 a damaged .orig (truncated, or sha1 off the ledger) is never restored: --revert and --disable refuse", async () => {
  for (const damage of ["truncate", "ledger"]) {
    await withSandbox({ set: "two" }, async (sb) => {
      assert.equal((await sb.run()).code, 0);
      fs.rmSync(sb.statePath("ledger")); // truncation alone: only the parse check can refuse it
      if (damage === "truncate") sb.writeOrig("host", PRISTINE.host.slice(0, PRISTINE.host.length >> 1));
      else sb.setJson("ledger", { [fx.version]: { targets: { host: { sha1_pristine: "000000000000" } } } });
      const host = sb.read("host");
      const r = await sb.run(["--revert"]);
      assert.equal(r.code, 1);
      assert.match(r.out, /host NOT restored/);
      assert.equal(sb.read("host"), host);
      const d = await sb.run(["--disable", "chat-media"]);
      assert.equal(d.code, 1);
      assert.equal(sb.read("host"), host);
      assert.notEqual(sb.orig("host"), null);
    });
  }
});

test("T-E18 rename: a read-only target stays as it was, a target held open is written by retrying, a leftover tmp goes", HOLDS, async () => {
  await withSandbox({ set: "two", enabled: CM_MEDIA }, async (sb) => {
    fs.chmodSync(sb.path("host"), 0o444);
    try {
      const r = await sb.run();
      assert.equal(r.code, 1);
      assert.equal(sb.read("host"), PRISTINE.host);
      assert.deepEqual(sb.tmpFiles(), []);
    } finally {
      fs.chmodSync(sb.path("host"), 0o666);
    }
  });
  await withSandbox({ set: "two", enabled: CM_MEDIA }, async (sb) => {
    // a restore that cannot rewrite its target keeps .orig (the only pristine copy): --disable and --revert
    assert.equal((await sb.run()).code, 0);
    const host = sb.read("host");
    fs.chmodSync(sb.path("host"), 0o444);
    try {
      for (const args of [["--disable", "chat-media"], ["--revert"]]) {
        const r = await sb.run(args);
        assert.equal(r.code, 1, args.join(" "));
        assert.equal(sb.read("host"), host, `${args[0]} changed the read-only host`);
        assert.equal(sb.orig("host"), PRISTINE.host, `${args[0]} lost extension.js.orig`);
      }
    } finally {
      fs.chmodSync(sb.path("host"), 0o666);
    }
  });
  await withSandbox({ set: "two", enabled: CM_MEDIA }, async (sb) => {
    // PowerShell opens the webview sharing only Read (a Node reader would share Delete too), and
    // holds it until our webview tmp is written plus 300 ms, so the hold overlaps the rename.
    const [flag, go] = [path.join(sb.dir, "held"), path.join(sb.dir, "go")];
    const ps = `$f=[System.IO.File]::Open('${psq(sb.path("webview"))}','Open','Read','Read'); New-Item -ItemType File '${psq(flag)}' | Out-Null; ` +
      `while (!(Test-Path '${psq(go)}')) { Start-Sleep -Milliseconds 10 }; Start-Sleep -Milliseconds 300; $f.Close()`;
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { stdio: "ignore", env: sb.env });
    const exited = new Promise((resolve) => child.on("exit", resolve));
    await waitFlag(flag, "PowerShell holding the webview", child);
    const writeFile = (f, text) => {
      fs.writeFileSync(f, text);
      if (/^index\.js\.ccp-tmp-/.test(path.basename(f))) fs.writeFileSync(go, "");
    };
    const r = await sb.run([], { writeFile });
    fs.writeFileSync(go, ""); // a run that never wrote the tmp must not leave the holder waiting
    await exited;
    assert.equal(r.code, 0, lines(r));
    assert.ok(has(sb.read("webview"), "CC-CTX"));
  });
  await withSandbox({ set: "two", enabled: CM_MEDIA }, async (sb) => {
    const leftover = `${sb.path("webview")}.ccp-tmp-99999`;
    fs.writeFileSync(leftover, "half a file");
    assert.equal((await sb.run()).code, 0);
    assert.ok(!fs.existsSync(leftover));
    assert.ok(has(sb.read("webview"), "CC-CTX"));
  });
});

test("T-E19 CLI promises: dry-run, exit codes, --forget, --status on v1, paused, bad config, unknown flags", async () => {
  await withSandbox({ set: "two" }, async (sb) => {
    const all = sb.snapshot();
    for (const args of [["--dry-run"], ["--enable", "chat-media", "--dry-run"], ["--disable", "chat-icons", "--dry-run"], ["--reapply", "--dry-run"],
      ["--language", "ru", "--dry-run"], ["--dry-run", "--buttons", "none"]]) {
      assert.equal((await sb.run(args)).code, 0);
      assert.deepEqual(sb.snapshot(), all, `${args.join(" ")} wrote something`);
    }
    for (const args of [["--verify"], ["--status"]]) { // --verify runs against the real installation from a half-edited copy
      assert.equal((await sb.run(args)).code, 0, args[0]);
      assert.deepEqual(sb.snapshot(), all, `${args[0]} wrote something`);
    }
    for (const args of [["--dry-run", "--install-hook"], ["--button", "x:/x"], ["--side", "right"], ["--enable", "nope"], ["--verify", "--status"],
      ["--language", "de"], ["--language"], ["--buttons"], ["--buttons", "--dry-run"], ["--language", "ru", "--buttons", "none"]]) {
      const r = await sb.run(args);
      assert.equal(r.code, 1, args.join(" "));
      assert.deepEqual(sb.snapshot(), all, `${args.join(" ")} wrote something`);
    }
    const e = await sb.run(["--ensure", "--button", "x:/x"]);
    assert.match(sysMsg(e), /Details: unknown argument "--button"/);
    assert.deepEqual(sb.snapshot(), all);
  });
  await withSandbox({ set: "two" }, async (sb) => {
    assert.equal((await sb.run()).code, 0);
    fs.writeFileSync(sb.statePath("settings.json"), JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ command: "node", args: ["patch_claude_code_ui.mjs"] }] }] } }));
    fs.mkdirSync(path.join(sb.state, "skills", "vscode-claude-chat-context-meter"), { recursive: true });
    const s = (await sb.run(["--status"])).out;
    assert.match(s, /v1 trace: SessionStart hook of vscode-claude-chat-context-meter \(patch_claude_code_ui\.mjs\)/);
    assert.match(s, /v1 trace: skill folder .*vscode-claude-chat-context-meter/);
    fs.rmSync(sb.statePath("settings.json")); // the builds below refuse while v1's hook is there
    const keep = fs.readdirSync(sb.state).filter((f) => f !== "vscode-claude-code-patch.local.json").sort();
    assert.equal((await sb.run(["--forget"])).code, 0);
    assert.deepEqual(fs.readdirSync(sb.state).sort(), keep);
    for (const args of [[], ["--enable", "chat-media"], ["--disable", "chat-icons"]]) {
      sb.setConfig({ schema: "ccp-config/1", paused: true, enabled: ["context-meter", "chat-media"] });
      assert.equal((await sb.run(args)).code, 0);
      assert.equal(sb.json("config").paused, false, `${args.join(" ")} left paused`);
    }
  });
  await withSandbox({ parts: ["host-syntax/chat-media.mjs"], enabled: CM_MEDIA }, async (sb) => {
    const r = await sb.run(["--ensure"]);
    assert.match(sysMsg(r), /Details: .*Fatal: host does not parse/);
  });
  await withSandbox({ set: "two" }, async (sb) => {
    fs.writeFileSync(sb.statePath("config"), '{"schema":"ccp-config/1","paused":fal');
    const before = sb.snapshot();
    const e = await sb.run(["--ensure"]);
    assert.match(sysMsg(e), /Details: config .* is unreadable/);
    assert.deepEqual(sb.snapshot(), before);
    assert.equal((await sb.run()).code, 1);
    assert.deepEqual(sb.snapshot(), before);
    assert.equal((await sb.run(["--revert"])).code, 0);
    assert.deepEqual(sb.json("config"), { schema: "ccp-config/1", paused: true, enabled: BASE_PARTS }, "rewritten with the defaults");
  });
  await withSandbox({ set: "two" }, async (sb) => {
    sb.write("webview", await ringOnly());
    const r = await sb.run(["--revert"]);
    assert.equal(r.code, 1);
    assert.match(r.out, /index\.js\.orig is missing - reinstall the extension/);
    assert.equal(sb.read("webview"), await ringOnly());
  });
});

test("T-E21 a broken panel: the ring and the run-plumbing part are UNSAFE with the toolbar reason, the rest builds", async () => {
  const lib = await import(pathToFileURL(path.join(BUILD_DIR, "lib", "layout.mjs")).href);
  const lay = new lib.Layout(PRISTINE.webview);
  const at = PRISTINE.webview.lastIndexOf(`${lay.ctx}.commandRegistry`, lay.callPropsAt);
  const cases = [
    [PRISTINE.webview.replace('title:"Show command menu (/)"', 'title:"Show the command menu (/)"'), /anchor 'title:"Show command menu \(\/\)"' found 0 times/],
    [`${PRISTINE.webview.slice(0, at)}cc${PRISTINE.webview.slice(at + lay.ctx.length)}`, /run-plumbing impossible: the panel context is named cc/],
  ];
  for (const [webview, reason] of cases) {
    await withSandbox({ parts: ["two/chat-media.mjs", "plumbing/chat-icons.mjs", ...NEW_FAKES], webview }, async (sb) => {
      const v = await sb.run(["--verify"]);
      assert.equal(v.code, 1);
      for (const id of ["context-meter", "chat-icons"]) assert.match(v.out, new RegExp(`UNSAFE: ${id}/webview: .*${reason.source}`));
      assert.match(v.out, /chat-media: SAFE TO PATCH/);
      assert.equal((await sb.run()).code, 1);
      assert.ok(has(sb.read("webview"), "CC-CTX") && !has(sb.read("webview"), "CC-RUN"));
    });
  }
});

test("T-E22 paths are taken at call time: engine imported under sandbox A, run with env B -> build in B, nothing in A", async () => {
  const a = makeSandbox({ set: "two" });
  const b = makeSandbox({ set: "two", enabled: CM_MEDIA });
  try {
    const before = a.snapshot();
    const js = `const m=await import(${JSON.stringify(pathToFileURL(ENGINE).href)});process.exitCode=await m.run([],JSON.parse(process.env.ENGINE_TEST_ENV_B));`;
    const r = spawnSync(process.execPath, ["--input-type=module", "-e", js], { env: { ...a.env, ENGINE_TEST_ENV_B: JSON.stringify(b.env) }, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(has(b.read("webview"), "CC-CTX"));
    assert.deepEqual(a.snapshot(), before);
  } finally {
    a.remove();
    b.remove();
  }
});

const LEDGER_LINE = /^ledger .*vscode-claude-code-patch\.ledger\.json is unreadable \(.+\) - fix it or delete it \(deleting drops the sha1 history of every version\)$/m;
const REVERT_WARNING = "ledger unreadable: .orig restored without the sha1 check";

test("T-E23 an unreadable ledger refuses every build, --verify and --ensure; --status says so; --revert restores without it", async () => {
  const kinds = {
    truncated: (p) => fs.writeFileSync(p, '{"2.1.280":{"date":"2026-0'),
    "not an object": (p) => fs.writeFileSync(p, "[]"),
    "a folder": (p) => fs.mkdirSync(p),
  };
  const damage = { "not an object": `${PRISTINE.host}\n/*CC-ZZZ*/\n`, "a folder": PRISTINE.host.slice(0, PRISTINE.host.length >> 1) };
  for (const [kind, spoil] of Object.entries(kinds)) {
    await withSandbox({ set: "two", enabled: CM_MEDIA }, async (sb) => {
      assert.equal((await sb.run()).code, 0);
      fs.rmSync(sb.statePath("ledger"));
      spoil(sb.statePath("ledger"));
      const before = sb.snapshot();
      for (const args of [[], ["--enable", "chat-icons"], ["--disable", "chat-media"], ["--reapply"], ["--dry-run"], ["--verify"]]) {
        const r = await sb.run(args);
        const what = `${kind}: ${args.join(" ") || "build"}`;
        assert.equal(r.code, 1, what);
        assert.match(r.err, LEDGER_LINE, what);
        assert.doesNotMatch(r.out, /SAFE TO PATCH|version |written|\[dry-run\]/, `${what} went on`);
        assert.deepEqual(sb.snapshot(), before, `${what} wrote something`);
      }
      sb.setConfig({ schema: "ccp-config/1", paused: false, enabled: ["context-meter"] }); // stale: --ensure's slow path
      const staled = sb.snapshot();
      const e = await sb.run(["--ensure"]);
      assert.match(sysMsg(e), /ask Claude to check the Claude Code chat patch\. Details: ledger .* is unreadable \(/);
      assert.deepEqual(sb.snapshot(), staled, `${kind}: --ensure wrote something`);
      const s = await sb.run(["--status"]);
      assert.equal(s.code, 0);
      assert.match(s.out, /^ledger: unreadable \(.+\)$/m);
      assert.match(s.out, /\.orig present, sha1 [0-9a-f]{12}$/m);
      assert.doesNotMatch(s.out, /= ledger|in the ledger/, `${kind}: --status compared with an unreadable ledger`);
      // --revert goes on without the sha1 check; the marker guard and the parse check stay
      if (damage[kind]) sb.writeOrig("host", damage[kind]);
      const host = sb.read("host");
      const r = await sb.run(["--revert"]);
      assert.equal(r.code, damage[kind] ? 1 : 0, lines(r));
      assert.deepEqual([sb.read("webview"), sb.orig("webview")], [PRISTINE.webview, null]);
      assert.deepEqual([sb.read("host"), sb.orig("host")], damage[kind] ? [host, damage[kind]] : [PRISTINE.host, null]);
      assert.equal(r.out.split(REVERT_WARNING).length, 2, `${kind}: the warning is not printed exactly once\n${r.out}`);
    });
  }
});

test("T-E23 the ledger is read once and merged into: other versions and v1 keys stay; a wrong v1 root sha1 refuses the webview", async () => {
  const v1 = {
    "2.1.100": { date: "2026-07-01", symbols: { jsx: "b" }, buttons: ["context:/context:usage"], side: "slash", sha1_pristine: "111111111111" },
    [fx.version]: { date: "2026-09-01", symbols: { jsx: "F" }, side: "slash", sha1_pristine: sha12(PRISTINE.webview), targets: { host: { note: "kept" } } },
  };
  await withSandbox({ set: "two", ledger: v1 }, async (sb) => {
    // a second read of the ledger before its write would see this and drop the history
    const writeFile = (f, text) => {
      fs.writeFileSync(f, text);
      if (/local\.json\.ccp-tmp-/.test(path.basename(f))) fs.writeFileSync(sb.statePath("ledger"), "{ broken");
    };
    assert.equal((await sb.run([], { writeFile })).code, 0);
    const host = { note: "kept", sha1_pristine: sha12(PRISTINE.host) };
    assert.deepEqual(sb.json("ledger"), { ...v1, [fx.version]: { ...v1[fx.version], targets: { host } } });
  });
  await withSandbox({ set: "two", ledger: { [fx.version]: { date: "2026-09-01", sha1_pristine: "000000000000" } } }, async (sb) => {
    const before = ext(sb);
    const r = await sb.run();
    assert.equal(r.code, 1);
    assert.match(r.out, /REFUSED webview: the pristine copy has sha1 [0-9a-f]{12}, the ledger says 000000000000/);
    assert.deepEqual(ext(sb), before);
  });
});

test("T-E24 one installation's unreadable file takes out only that installation: build, --ensure, --revert", HOLDS, () =>
  withSandbox({ set: "two", enabled: CM_MEDIA }, async (sb) => {
    const old = path.join(path.dirname(sb.inst), "anthropic.claude-code-0.0.1-win32-x64"); // sorts first
    const name = path.basename(old);
    const oldFile = { webview: path.join(old, "webview", "index.js"), host: path.join(old, "extension.js") };
    fs.mkdirSync(path.join(old, "webview"), { recursive: true });
    fs.writeFileSync(oldFile.webview, PRISTINE.webview);
    fs.writeFileSync(oldFile.host, PRISTINE.host);
    const underHold = async (args) => {
      const release = await holdFile(sb, oldFile.host);
      try {
        return await sb.run(args);
      } finally {
        await release();
      }
    };
    const noStack = (r) => assert.doesNotMatch(lines(r), /\n\s+at /, "a stack trace");
    const b = await underHold([]);
    assert.equal(b.code, 1);
    assert.match(b.out, new RegExp(`^  \\[!\\] ${name.replace(/\./g, "\\.")}: .*EBUSY`, "m"));
    noStack(b);
    assert.ok(has(sb.read("webview"), "CC-CTX") && has(sb.read("host"), "CC-OPEN"), "the other installation was not built");
    assert.deepEqual([fs.readFileSync(oldFile.webview, "utf8"), fs.existsSync(`${oldFile.webview}.orig`)], [PRISTINE.webview, false]);
    sb.setConfig({ schema: "ccp-config/1", paused: false, enabled: ["context-meter", "chat-media", "chat-icons"] }); // both stale
    const e = await underHold(["--ensure"]);
    const said = sysMsg(e);
    assert.ok(said.includes(`Details: [!] ${name}: `) && said.includes("EBUSY"), said);
    assert.ok(has(sb.read("webview"), "CC-SEND"), "--ensure did not rebuild the other installation");
    assert.ok(Object.keys(sb.json("local").targets).every((f) => !f.startsWith(old)), "the failed installation got a cache entry");
    assert.equal((await sb.run()).code, 0); // both built
    const oldHost = fs.readFileSync(oldFile.host, "utf8");
    const r = await underHold(["--revert"]);
    assert.equal(r.code, 1);
    assert.ok(r.out.includes(`  [!] ${name} host: `) && r.out.includes("EBUSY"), r.out);
    noStack(r);
    assert.deepEqual([sb.read("webview"), sb.read("host"), sb.orig("webview"), sb.orig("host")], [PRISTINE.webview, PRISTINE.host, null, null]);
    assert.deepEqual([fs.readFileSync(oldFile.webview, "utf8"), fs.existsSync(`${oldFile.webview}.orig`)], [PRISTINE.webview, false]);
    assert.deepEqual([fs.readFileSync(oldFile.host, "utf8"), fs.readFileSync(`${oldFile.host}.orig`, "utf8")], [oldHost, PRISTINE.host]);
    assert.equal(sb.json("config").paused, true);
  }));

test("T-E25 a lock left by a run that no longer runs is removed at once; a live, EPERM or unparsable holder keeps the wait", HOLDS, async () => {
  const dead = spawnSync(process.execPath, ["-e", "0"]).pid;
  let eperm = null;
  try {
    process.kill(4, 0);
  } catch (err) {
    eperm = err.code;
  }
  assert.equal(eperm, "EPERM", "precondition: pid 4 (System) answers EPERM on this machine");
  await withSandbox({ set: "two", enabled: CM_MEDIA }, async (sb) => {
    assert.equal((await sb.run()).code, 0);
    fs.writeFileSync(sb.statePath("lock"), `${dead} 2000-01-01T00:00:00.000Z\n`);
    const t0 = Date.now();
    const r = await sb.run(["--revert"], { lockWaitMs: 5000 });
    assert.equal(r.code, 0, lines(r));
    assert.ok(Date.now() - t0 < 4000, "--revert waited for the lock of a finished run");
    assert.ok(r.out.includes(`[-] removed a lock left by a run that is no longer running (pid ${dead})`), r.out);
    assert.deepEqual([sb.read("webview"), sb.read("host"), fs.existsSync(sb.statePath("lock"))], [PRISTINE.webview, PRISTINE.host, false]);
    const held = await holdLock(sb, 2000);
    const live = await sb.run(["--revert"], { lockWaitMs: 300 });
    assert.deepEqual([live.code, /lock is held by another run since/.test(live.err)], [1, true], `live pid ${held.pid}: ${lines(live)}`);
    await held.exited;
    for (const text of ["4 2000-01-01T00:00:00.000Z\n", `${process.pid} 2000-01-01T00:00:00.000Z\n`, `${dead}\n`, ""]) {
      fs.writeFileSync(sb.statePath("lock"), text);
      const w = await sb.run(["--revert"], { lockWaitMs: 300 });
      assert.deepEqual([w.code, /lock is held by another run since/.test(w.err)], [1, true], `${JSON.stringify(text)}: ${lines(w)}`);
      assert.equal(fs.readFileSync(sb.statePath("lock"), "utf8"), text, `${JSON.stringify(text)}: the lock was removed`);
    }
    fs.rmSync(sb.statePath("lock"));
  });
});
