// The config, the flags and the messages of the engine: the base install without a
// config (T-C1), language and buttons kept through every write and handed to the parts
// (T-C2..T-C4, T-C10), --ensure's fingerprint of the code (T-C5), --status on the hook
// and its node (T-C6), v1 refused (T-C7), Windows only (T-C8), the warning for a project copy
// (T-C9), Node older than 16.9 refused (T-C11); a UTF-8 BOM in a JSON file is read (T-C3, T-C6).
// Every test runs in a sandbox with the fake parts; where the buttons must be checked for
// real, the real chat-icons is copied into the sandbox's parts folder.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { loadFixtures } from "./lib/fixtures.mjs";
import { withSandbox, BUILD_DIR, ENGINE, FAKE_PARTS } from "./lib/sandbox.mjs";
import { sysMsg } from "./lib/ensure.mjs";

const fx = loadFixtures();
const PRISTINE = { webview: fx.read("index.js.orig"), host: fx.read("extension.js") };
const SCHEMA = "ccp-config/1";
const BASE = ["context-meter", "chat-media", "chat-mark", "chat-files"]; // literal, not the engine's DEFAULT_ENABLED
const BS = String.fromCharCode(92);
const has = (text, marker) => text.includes(`/*${marker}*/`);
const BUTTONS = [
  { id: "handoff", icon: "export", tooltip: "Hand off to a new session", action: { type: "command", command: "/handoff" } },
  { id: "finish", label: "OK", tooltip: "Finish", action: { type: "send", text: "Your work is done" } },
];

/** The real chat-icons among the fake parts, so the buttons are checked and drawn for real. */
const realIcons = (sb) => fs.copyFileSync(path.join(BUILD_DIR, "parts", "chat-icons.mjs"), path.join(sb.partsDir, "chat-icons.mjs"));
const writeJson = (sb, name, value) => {
  const file = path.join(sb.dir, name);
  fs.writeFileSync(file, JSON.stringify(value));
  return file;
};

test("T-C1 no config file: the base parts with the ring, English; a build by the defaults writes no config; --disable takes the ring out", () =>
  withSandbox({ set: "two", enabled: null }, async (sb) => {
    const r = await sb.run();
    assert.equal(r.code, 0, r.out);
    const w = sb.read("webview");
    assert.ok(has(w, "CC-CTX") && has(w, "CC-MARK") && has(w, "CC-FILES") && has(sb.read("host"), "CC-OPEN"));
    assert.ok(has(w, "CC-BTN:context"), "the ring is in the base install");
    assert.ok(!has(w, "CC-SEND") && !w.includes("/*CC-ICON:"), "the buttons are the add-on");
    assert.equal(sb.json("config"), null);
    const s = (await sb.run(["--status"])).out;
    assert.match(s, /^config: none, defaults; paused: false; language: en$/m);
    assert.match(s, /^part context-meter: enabled; /m);
    assert.match(s, /^part chat-icons: disabled$/m);
    assert.equal((await sb.run(["--disable", "context-meter"])).code, 0);
    assert.deepEqual(sb.json("config"), { schema: SCHEMA, paused: false, enabled: BASE.filter((id) => id !== "context-meter") });
    assert.ok(!has(sb.read("webview"), "CC-BTN:context"));
  }));

test("T-C2 --language and --buttons are stored, reach the parts, and survive --enable, --disable, --revert; --buttons none removes them", () =>
  withSandbox({ set: "two", enabled: ["context-meter", "chat-media"] }, async (sb) => {
    realIcons(sb);
    const file = writeJson(sb, "buttons.json", BUTTONS);
    assert.equal((await sb.run(["--language", "ru"])).code, 0);
    assert.deepEqual(sb.json("config"), { schema: SCHEMA, paused: false, enabled: ["context-meter", "chat-media"], language: "ru" });
    const kontekst = `${BS}u041a${BS}u043e${BS}u043d${BS}u0442${BS}u0435${BS}u043a${BS}u0441${BS}u0442`;
    assert.ok(sb.read("webview").includes(`"${kontekst}: "`), "the ring got the language");
    const b = await sb.run(["--buttons", file]);
    assert.equal(b.code, 0, b.out);
    assert.deepEqual(sb.json("config"),
      { schema: SCHEMA, paused: false, enabled: ["context-meter", "chat-media", "chat-icons"], language: "ru", buttons: BUTTONS });
    const w = sb.read("webview");
    assert.ok(has(w, "CC-ICON:handoff") && has(w, "CC-ICON:finish") && has(w, "CC-SEND") && has(w, "CC-RUN"));
    assert.ok(w.includes(`${BS}u041d${BS}u0435${BS}u0434`), "chat-icons got the language");
    assert.match((await sb.run(["--status"])).out, /^buttons: handoff, finish$/m);
    for (const args of [["--enable", "chat-mark"], ["--disable", "chat-mark"], ["--disable", "chat-icons"], ["--revert"], ["--enable", "chat-icons"]]) {
      assert.equal((await sb.run(args)).code, 0, args.join(" "));
      const c = sb.json("config");
      assert.deepEqual([c.language, c.buttons], ["ru", BUTTONS], `${args.join(" ")} dropped them`);
    }
    assert.equal(sb.json("config").paused, false);
    assert.equal((await sb.run(["--buttons", "none"])).code, 0);
    assert.deepEqual(sb.json("config"), { schema: SCHEMA, paused: false, enabled: ["context-meter", "chat-media"], language: "ru" });
    assert.ok(!has(sb.read("webview"), "CC-ICON:handoff"));
    assert.equal((await sb.run(["--language", "en"])).code, 0);
    assert.equal(sb.json("config").language, "en");
    assert.ok(!sb.read("webview").includes(kontekst));
  }));

test("T-C3 a bad button list: --buttons refuses and writes nothing; hand-edited into the config it takes out only chat-icons", () =>
  withSandbox({ set: "two", enabled: ["context-meter", "chat-media"] }, async (sb) => {
    realIcons(sb);
    const cases = [
      [writeJson(sb, "bad-icon.json", [{ ...BUTTONS[0], icon: "banana" }]), /buttons\[0\]\.icon: unknown icon "banana" \(icons: /],
      [writeJson(sb, "empty.json", []), /holds no button; --buttons none removes them/],
      [writeJson(sb, "object.json", { id: "x" }), /holds no list of buttons/],
      [path.join(sb.dir, "missing.json"), /is not a readable JSON file/],
    ];
    const before = sb.snapshot();
    for (const [file, re] of cases) {
      const r = await sb.run(["--buttons", file]);
      assert.equal(r.code, 1, file);
      assert.match(r.err, re);
      assert.match(r.err, /nothing written$/);
      assert.deepEqual(sb.snapshot(), before, `${file}: something was written`);
    }
    const wrapped = writeJson(sb, "wrapped.json", { buttons: BUTTONS });
    assert.equal((await sb.run(["--buttons", wrapped])).code, 0, "{\"buttons\": [...]} is taken too");
    assert.deepEqual(sb.json("config").buttons, BUTTONS);
    const bom = path.join(sb.dir, "bom.json");
    fs.writeFileSync(bom, `\uFEFF${JSON.stringify(BUTTONS.slice(0, 1))}`); // what Windows PowerShell 5.1 `Set-Content -Encoding UTF8` writes
    const withBom = await sb.run(["--buttons", bom]);
    assert.equal(withBom.code, 0, `a file with a UTF-8 BOM is taken\n${withBom.err}`);
    assert.deepEqual(sb.json("config").buttons, BUTTONS.slice(0, 1));
    sb.setConfig({ ...sb.json("config"), buttons: [{ ...BUTTONS[0], id: "Bad Id" }] });
    const v = await sb.run(["--verify"]);
    assert.equal(v.code, 1);
    assert.match(v.out, /^ {2}UNSAFE: chat-icons\/webview: buttons\[0\]\.id: /m);
    for (const id of ["context-meter", "chat-media"]) assert.match(v.out, new RegExp(`^  ${id}: SAFE TO PATCH$`, "m"));
    const r = await sb.run();
    assert.equal(r.code, 1);
    const w = sb.read("webview");
    assert.ok(has(w, "CC-BTN:context") && has(w, "CC-CTX") && !has(w, "CC-ICON:handoff") && !has(w, "CC-SEND"));
    sb.setConfig({ ...sb.json("config"), buttons: "not a list" });
    assert.match((await sb.run(["--verify"])).out, /UNSAFE: chat-icons\/webview: buttons: expected a list, got string/);
    assert.match((await sb.run(["--status"])).out, /^buttons: not a list$/m);
  }));

test("T-C4 an unknown language is a config error; --revert rewrites the defaults and keeps the buttons", () =>
  withSandbox({ set: "two", language: "de", buttons: BUTTONS }, async (sb) => {
    const before = sb.snapshot();
    const r = await sb.run();
    assert.equal(r.code, 1);
    assert.match(r.err, /language "de" is not one of en, ru/);
    assert.deepEqual(sb.snapshot(), before);
    assert.match(sysMsg(await sb.run(["--ensure"])), /Details: config .*: language "de" is not one of en, ru; doing nothing/);
    assert.deepEqual(sb.snapshot(), before);
    const v = await sb.run(["--revert"]);
    assert.equal(v.code, 0);
    assert.match(v.out, /rewritten with the defaults, its buttons kept/);
    assert.deepEqual(sb.json("config"), { schema: SCHEMA, paused: true, enabled: BASE, buttons: BUTTONS });
  }));

test("T-C5 --ensure: a part left UNSAFE is tried again once its code changes; language and buttons are in the fingerprint", () =>
  withSandbox({ parts: ["host-layout-error/chat-media.mjs"], enabled: ["context-meter", "chat-media"] }, async (sb) => {
    assert.match(sysMsg(await sb.run(["--ensure"])), /Not applied \(UNSAFE\): chat-media; ask Claude to fix the Claude Code chat patch\./);
    assert.equal(sysMsg(await sb.run(["--ensure"])), "", "same code, same config: the fast path, nothing said");
    fs.copyFileSync(path.join(FAKE_PARTS, "two", "chat-media.mjs"), path.join(sb.partsDir, "chat-media.mjs")); // the repair lands
    const fixed = sysMsg(await sb.run(["--ensure"]));
    assert.match(fixed, /rebuilt for /);
    assert.doesNotMatch(fixed, /UNSAFE/);
    assert.ok(has(sb.read("host"), "CC-OPEN"));
    for (const change of [{ language: "ru" }, { buttons: BUTTONS }]) {
      const cache = JSON.stringify(sb.json("local"));
      sb.setConfig({ ...sb.json("config"), ...change });
      sysMsg(await sb.run(["--ensure"]));
      assert.notEqual(JSON.stringify(sb.json("local")), cache, `${Object.keys(change)[0]}: --ensure did not rebuild`);
    }
  }));

test("T-C6 --status says where the hook points: this engine, a missing file, another copy, a missing node; v1 traces in ~/.agents/skills too", () =>
  withSandbox({ set: "two" }, async (sb) => {
    const settings = sb.statePath("settings.json");
    const hookLine = async () => (await sb.run(["--status"])).out.match(/^hook: .*$/m)[0];
    const point = (entry) => fs.writeFileSync(settings, JSON.stringify({ hooks: { SessionStart: [{ hooks: [entry] }] } }));
    assert.equal(await hookLine(), "hook: not installed (--install-hook)");
    assert.equal((await sb.run(["--install-hook"])).code, 0);
    assert.equal(await hookLine(), "hook: installed");
    const other = path.join(sb.dir, "other", "claude_code_patch.mjs");
    fs.mkdirSync(path.dirname(other));
    fs.copyFileSync(ENGINE, other);
    point({ type: "command", command: "node", args: [other, "--ensure"] });
    assert.equal(await hookLine(), `hook: installed, points at another copy ${other}`);
    const gone = path.join(sb.dir, "gone", "claude_code_patch.mjs");
    point({ type: "command", command: "node", args: [gone, "--ensure"] });
    assert.equal(await hookLine(), `hook: installed, points at ${gone} (missing file) - run --install-hook`);
    const lostNode = path.join(sb.dir, "old-node", "node.exe"); // Node reinstalled elsewhere
    point({ type: "command", command: lostNode, args: [ENGINE, "--ensure"] });
    assert.equal(await hookLine(), `hook: installed, runs ${lostNode} (missing file) - run --install-hook`);
    point({ type: "command", command: lostNode, args: [other, "--ensure"] });
    assert.equal(await hookLine(), `hook: installed, points at another copy ${other}, runs ${lostNode} (missing file) - run --install-hook`);
    point({ type: "command", command: process.execPath, args: [ENGINE, "--ensure"] });
    assert.equal(await hookLine(), "hook: installed", "the recorded node exists");
    point({ type: "command", command: `node "${ENGINE}" --ensure` });
    assert.equal(await hookLine(), "hook: installed", "the shell form");
    const entry = { type: "command", command: process.execPath, args: [ENGINE, "--ensure"] };
    fs.writeFileSync(settings, `\uFEFF${JSON.stringify({ hooks: { SessionStart: [{ hooks: [entry] }] } })}`);
    assert.equal(await hookLine(), "hook: installed", "settings.json with a UTF-8 BOM reads");
    assert.equal((await sb.run(["--install-hook"])).code, 0);
    assert.ok(!fs.readFileSync(settings, "utf8").startsWith("\uFEFF"), "written back without the BOM");
    fs.mkdirSync(path.join(sb.dir, ".agents", "skills", "vscode-claude-chat-context-meter"), { recursive: true });
    assert.match((await sb.run(["--status"])).out, /^v1 trace: skill folder .*\.agents\\skills\\vscode-claude-chat-context-meter$/m);
  }));

test("T-C7 while v1's hook is there, in any form, builds and --install-hook refuse naming v1's commands; --revert and --status work", () =>
  withSandbox({ set: "two" }, async (sb) => {
    assert.equal((await sb.run()).code, 0);
    const v1Dir = path.join(sb.dir, ".agents", "skills", "vscode-claude-chat-context-meter");
    fs.mkdirSync(v1Dir, { recursive: true });
    fs.writeFileSync(path.join(v1Dir, "patch_claude_code_ui.mjs"), "// v1\n");
    const script = `"${path.join(v1Dir, "patch_claude_code_ui.mjs")}"`;
    const forms = {
      node: { type: "command", command: "node", args: [path.join(v1Dir, "patch_claude_code_ui.mjs"), "--ensure"], async: true },
      ps1: { type: "command", command: `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${path.join(v1Dir, "run.ps1")}" --ensure` },
      sh: { type: "command", command: `sh "${v1Dir.split(path.sep).join("/")}/run.sh" --ensure` },
    };
    for (const [form, entry] of Object.entries(forms)) {
      fs.writeFileSync(sb.statePath("settings.json"), JSON.stringify({ hooks: { SessionStart: [{ hooks: [entry] }] } }));
      sb.setConfig({ schema: SCHEMA, paused: false, enabled: ["context-meter"] }); // stale: --ensure's slow path
      const before = sb.snapshot();
      for (const args of [[], ["--enable", "chat-media"], ["--dry-run"], ["--language", "ru"], ["--install-hook"]]) {
        const r = await sb.run(args);
        const what = `${form}: ${args.join(" ") || "build"}`;
        assert.equal(r.code, 1, what);
        assert.match(r.err, /^The v1 skill vscode-claude-chat-context-meter still patches this chat from its SessionStart hook/, what);
        for (const step of ["--uninstall-hook", "--revert"]) assert.ok(r.err.includes(`node ${script} ${step}`), `${what}\n${r.err}`);
        assert.ok(r.err.includes("npx skills@latest remove -g vscode-claude-chat-context-meter"), what);
        assert.deepEqual(sb.snapshot(), before, `${what} wrote something`);
      }
      assert.match(sysMsg(await sb.run(["--ensure"])), /Details: The v1 skill vscode-claude-chat-context-meter still patches .* 1\. node "/);
      assert.deepEqual(sb.snapshot(), before, `${form}: --ensure wrote something`);
      assert.match((await sb.run(["--status"])).out, /^v1 trace: SessionStart hook of vscode-claude-chat-context-meter /m);
    }
    assert.equal((await sb.run(["--revert"])).code, 0, "--revert works while v1's hook is there");
    assert.deepEqual([sb.read("webview"), sb.read("host")], [PRISTINE.webview, PRISTINE.host]);
    assert.equal((await sb.run(["--uninstall-hook"])).code, 0);
    assert.equal(JSON.parse(fs.readFileSync(sb.statePath("settings.json"), "utf8")).hooks.SessionStart[0].hooks.length, 1, "v1's entry is not ours to remove");
  }));

test("T-C8 not on Windows: every command but --help exits 1 with one line and writes nothing; --ensure says it and exits 0", () =>
  withSandbox({ set: "two" }, async (sb) => {
    const before = sb.snapshot();
    const line = "Windows only for now: vscode-claude-code-patch finds and patches the Claude Code extension of VS Code on Windows, and this is darwin.";
    for (const args of [[], ["--verify"], ["--status"], ["--where"], ["--revert"], ["--install-hook"], ["--language", "ru"], ["--forget"]]) {
      const r = await sb.run(args, { platform: "darwin" });
      assert.deepEqual([r.code, r.out, r.err], [1, "", line], args.join(" "));
    }
    assert.match(sysMsg(await sb.run(["--ensure"], { platform: "linux" })), /Details: Windows only for now: .*, and this is linux\.$/);
    const h = await sb.run(["--help"], { platform: "linux" });
    assert.equal(h.code, 0);
    assert.match(h.out, /^Patch the Claude Code chat in VS Code/);
    assert.deepEqual(sb.snapshot(), before);
  }));

test("T-C11 Node older than 16.9: every command, --help included, exits 1 with one line and writes nothing; --ensure says it and exits 0", () =>
  withSandbox({ set: "two" }, async (sb) => {
    const before = sb.snapshot();
    for (const args of [[], ["--verify"], ["--status"], ["--revert"], ["--install-hook"], ["--help"]]) {
      const r = await sb.run(args, { node: "16.8.0" });
      assert.deepEqual([r.code, r.out], [1, ""], args.join(" "));
      assert.match(r.err, /^vscode-claude-code-patch needs Node\.js 16\.9 or newer; this is 16\.8\.0 \(.+\)\.$/, args.join(" "));
    }
    assert.match(sysMsg(await sb.run(["--ensure"], { node: "14.21.3" })), /Details: vscode-claude-code-patch needs Node\.js 16\.9 or newer; this is 14\.21\.3 /);
    assert.deepEqual(sb.snapshot(), before);
    for (const node of ["16.9.0", "22.1.0"]) assert.equal((await sb.run(["--status"], { node })).code, 0, node);
  }));

test("T-C9 --install-hook from a copy outside ~/.agents/skills and ~/.claude/skills warns and installs; a global copy does not warn", () =>
  withSandbox({ set: "two" }, async (sb) => {
    const r = await sb.run(["--install-hook"]); // the suite's engine is not under the sandbox home
    assert.equal(r.code, 0);
    assert.match(r.out, /warning: .*claude_code_patch\.mjs is not a global install: .*npx skills@latest add warodan\/vscode-claude-code-patch -g$/m);
    const hookArgs = () => JSON.parse(fs.readFileSync(sb.statePath("settings.json"), "utf8")).hooks.SessionStart[0].hooks[0].args;
    assert.deepEqual(hookArgs(), [ENGINE, "--ensure"]);
    for (const root of [[".agents", "skills"], [".claude", "skills"]]) {
      const copy = path.join(sb.dir, ...root, "vscode-claude-code-patch", "claude_code_patch.mjs");
      fs.mkdirSync(path.dirname(copy), { recursive: true });
      fs.copyFileSync(ENGINE, copy);
      const g = sb.cli(["--install-hook"], {}, copy);
      assert.equal(g.code, 0, g.err);
      assert.doesNotMatch(g.out, /warning/);
      assert.match(g.out, /SessionStart hook refreshed/);
      assert.deepEqual(hookArgs(), [copy, "--ensure"]);
    }
  }));

test("T-C10 chat-icons without buttons: SAFE, nothing to insert (said by --verify and a build), not an error, no note in --status", () =>
  withSandbox({ set: "two", enabled: ["chat-icons"] }, async (sb) => {
    realIcons(sb);
    const v = await sb.run(["--verify"]);
    assert.equal(v.code, 0, v.out);
    assert.match(v.out, /^  chat-icons: SAFE TO PATCH\n    chat-icons: nothing to insert \(no buttons configured; --buttons <file> adds them\)$/m);
    const r = await sb.run();
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /^  \[=\] chat-icons: nothing to insert/m);
    assert.deepEqual([sb.read("webview"), sb.orig("webview")], [PRISTINE.webview, null]);
    const s = (await sb.run(["--status"])).out;
    assert.match(s, /^ {4}expected by the config: none;/m);
    assert.doesNotMatch(s, /note: the parts in the file differ/);
    assert.equal(sysMsg(await sb.run(["--ensure"])), "");
  }));
