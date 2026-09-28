// The real parts through the real engine (T-J1..T-J10) - only through its exported run()
// and only in the sandbox of tests/lib/sandbox.mjs (no `set`: the engine uses the real
// parts/ next to it). Every sandbox gets the two test buttons below, so chat-icons has
// something to insert. Tests that edit a fixture bundle run without a ledger entry.

import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { loadFixtures, loadSibling, skipWithoutFixtures, skipWithoutV1 } from "./lib/fixtures.mjs";
import { withSandbox as sandbox } from "./lib/sandbox.mjs";
import { sysMsg } from "./lib/ensure.mjs";
import { readToolbar, matchBracket } from "../lib/layout.mjs";

const fx = loadFixtures();
const NO_FX = skipWithoutFixtures(fx);
const LONG = 300000; // node --test never times out a promise that never settles
// Literal lists, not the engine's PARTS: a wrong engine list cannot agree with itself.
const PARTS = ["context-meter", "chat-media", "chat-icons", "chat-mark", "chat-files"];
const THREE = ["context-meter", "chat-media", "chat-icons"]; // the ring, media and the buttons, without mark and files
const ALL = ["engine", ...PARTS];
const without = (id) => PARTS.filter((x) => x !== id);
const PRISTINE = fx && { webview: fx.read("index.js.orig"), host: fx.read("extension.js") };
// T-J7 builds on every version it finds next to CCP_FIXTURES, whatever CCP_FIXTURES says.
const BOTH_VERSIONS = ["2.1.280", "2.1.283"];
// The test buttons: one runs a command, one sends a text - every chat-icons marker appears.
const BUTTONS = [
  { id: "handoff", icon: "export", tooltip: "Hand off to a new session", action: { type: "command", command: "/handoff" } },
  { id: "finish", icon: "pass", tooltip: "Finish", action: { type: "send", text: "Your work is done" } },
];
const withSandbox = (options, fn) => sandbox({ buttons: BUTTONS, ...options }, fn);

// The marker table: marker -> [owner, count] with the two test buttons. Kept here on
// purpose, not read from the engine, so a wrong engine table cannot agree with itself.
const TABLE = {
  webview: {
    "CC-RUN": ["engine", 2], "CC-BTN:context": ["context-meter", 1], "CC-PIE": ["context-meter", 1],
    "CC-HELP": ["chat-media", 1], "CC-CTX": ["chat-media", 1], "CC-URL": ["chat-media", 1],
    "CC-LINK": ["chat-media", 1], "CC-MDIMG": ["chat-media", 1], "CC-CODE": ["chat-media", 1],
    "CC-SEND": ["chat-icons", 2], "CC-ICON:handoff": ["chat-icons", 1], "CC-ICON:finish": ["chat-icons", 1],
    "CC-MARK": ["chat-mark", 1], "CC-FILES": ["chat-files", 1], "CC-SESS": ["chat-files", 1],
  },
  host: {
    "CC-OPEN": ["chat-media", 1], "CC-CAPS": ["chat-media", 1], "CC-REVEAL": ["chat-media", 1],
    "CC-READIMG": ["chat-media", 1], "CC-PHOTOS": ["chat-media", 1], "CC-PS": ["chat-media", 1],
  },
};
const MARK = /\/\*(CC-[A-Z]+(?::[\w-]+)?)\*\//g;

const sha12 = (text) => crypto.createHash("sha1").update(text, "utf8").digest("hex").slice(0, 12);
const markerList = (text) => [...text.matchAll(MARK)].map((m) => m[1]);

function markerCounts(text) {
  const out = {};
  for (const name of markerList(text)) out[name] = (out[name] || 0) + 1;
  return out;
}

/** The table's counts of `owners` on `target`; CC-PIE is x0/1 off the reference version. */
function wanted(target, owners, got, f = fx) {
  const want = {};
  for (const [name, [owner, n]] of Object.entries(TABLE[target])) if (owners.includes(owner)) want[name] = n;
  if (!f.isReference && want["CC-PIE"] && !got["CC-PIE"]) delete want["CC-PIE"];
  return want;
}

function assertCounts(text, target, owners, f = fx) {
  const got = markerCounts(text);
  assert.deepEqual(got, wanted(target, owners, got, f), `${f.version} ${target}: marker counts against the table for ${owners.join(", ")}`);
}

/** The engine's parse checks; throws SyntaxError when a target does not parse. */
function parse(target, text) {
  if (target === "webview") {
    new vm.Script(text, { filename: "index.js" });
    new vm.Script(`"use strict";${text}`, { filename: "index.js (strict)" });
  } else {
    new vm.Script(`(function (exports, require, module, __filename, __dirname) {${text}\n})`, { filename: "extension.js" });
  }
}

/** `src` with the only occurrence of `from` replaced by `to` (a fixture edit). */
function swapOnce(src, from, to) {
  assert.equal(src.split(from).length - 1, 1, `fixture: ${from} must occur exactly once`);
  return src.replace(from, () => to);
}

/** One explicit build in a fresh sandbox (default: every part, the test buttons), then --status. */
function buildIn(enabled, f = fx, webview = null) {
  return withSandbox({ fx: f, enabled, webview }, async (sb) => {
    const r = await sb.run();
    const status = await sb.run(["--status"]);
    return {
      code: r.code, log: `${r.out}\n${r.err}`, status: status.out, tmp: sb.tmpFiles(),
      webview: sb.read("webview"), host: sb.read("host"), orig: { webview: sb.orig("webview"), host: sb.orig("host") },
    };
  });
}
const memo = (fn) => { let p = null; return () => (p ||= fn()); };
const fullBuild = memo(() => buildIn(PARTS));
const noMediaBuild = memo(() => buildIn(without("chat-media")));
const threeBuild = memo(() => buildIn(THREE));
const withoutBuilds = new Map();
/** The build of every part but `id`, on the current fixture (memoised). */
const withoutBuild = (id) => (withoutBuilds.has(id) || withoutBuilds.set(id, buildIn(without(id))), withoutBuilds.get(id));

/** Every part: counts = the marker table, both targets parse, .orig pristine, --status owns every marker. */
function assertFullBuild(b, f, pristine) {
  assert.equal(b.code, 0, b.log);
  for (const id of PARTS) assert.match(b.log, new RegExp(`^  \\[\\+\\] ${id} applied$`, "m"), `${f.version}: ${id}`);
  for (const t of ["webview", "host"]) {
    assertCounts(b[t], t, ALL, f);
    assert.doesNotThrow(() => parse(t, b[t]), `${f.version} ${t} must parse`);
    assert.equal(b.orig[t], pristine[t], `${f.version} ${t}.orig is the pristine copy byte for byte`);
    const line = b.status.match(new RegExp(`^  ${t}: markers (.*)$`, "m"));
    assert.ok(line, b.status);
    const want = Object.entries(wanted(t, ALL, markerCounts(b[t]), f)).map(([name]) => `${name} (${TABLE[t][name][0]})`);
    assert.deepEqual(line[1].split(", ").sort(), want.sort(), `${f.version} --status ${t}`);
  }
  assert.doesNotMatch(b.status, /FOREIGN/);
  assert.deepEqual(b.tmp, []);
}

test("T-J1 all five parts on the fixture: marker counts equal the table, both targets parse, --status owns every marker",
  { skip: NO_FX, timeout: LONG }, async () => {
    assertFullBuild(await fullBuild(), fx, PRISTINE);
  });

test("T-J2 a host anchor broken (whole H1 / H2 match): chat-media applied to no target, the four others applied",
  { skip: NO_FX, timeout: LONG }, async () => {
    const noMedia = await noMediaBuild();
    assert.equal(noMedia.code, 0, noMedia.log);
    const cases = [
      ["H1", '"revealInExplorer"', '"revealInExplorex"', ["--ensure"]],
      ["H2", '"get_current_selection"', '"get_current_selectiox"', []],
    ];
    for (const [anchor, from, to, args] of cases) {
      const host = swapOnce(PRISTINE.host, from, to);
      await withSandbox({ fx, host }, async (sb) => {
        const r = await sb.run(args);
        const why = `UNSAFE: chat-media/host: (LayoutError: )?${anchor} `; // the reason names the anchor
        if (args[0] === "--ensure") {
          assert.match(sysMsg(r), new RegExp(`Not applied \\(UNSAFE\\): chat-media; ask Claude to fix the Claude Code chat patch\\. Details: ${why}`));
        } else {
          assert.equal(r.code, 1, r.out);
          const unsafe = r.out.split("\n").filter((l) => l.includes("UNSAFE"));
          assert.equal(unsafe.length, 1, r.out);
          assert.match(unsafe[0], new RegExp(`^  ${why}`));
        }
        assert.doesNotMatch(`${r.out}\n${r.err}`, /UNSAFE: (context-meter|chat-icons|chat-mark|chat-files)/);
        assert.equal(sb.read("webview"), noMedia.webview, `${anchor}: webview = the build without chat-media byte for byte`);
        assert.equal(sb.read("host"), host, `${anchor}: extension.js untouched`);
        assert.equal(sb.orig("host"), null, `${anchor}: no extension.js.orig`);
        assert.deepEqual(sb.tmpFiles(), []);
      });
    }
  });

test("T-J3 panel order: the ring button, CC-ICON:handoff, CC-ICON:finish - side by side at the one slot after /",
  { skip: NO_FX, timeout: LONG }, async () => {
    const { webview } = await fullBuild();
    const { toolbar, toolbarError } = readToolbar(PRISTINE.webview);
    assert.ok(toolbar, toolbarError);
    const at = toolbar.afterSlashAt;
    const before = PRISTINE.webview.slice(at - 60, at);
    const after = PRISTINE.webview.slice(at, at + 60);
    assert.equal(webview.split(before).length - 1, 1, "the text before the slot is unique in the build");
    const start = webview.indexOf(before) + before.length;
    const end = webview.indexOf(after, start);
    assert.ok(end > start, "the slot holds inserted text");
    // Pristine `before` and `after` are adjacent: everything between them is inserted at the slot.
    assert.deepEqual(markerList(webview.slice(start, end)), ["CC-BTN:context", "CC-ICON:handoff", "CC-ICON:finish"]);
  });

test("T-J4 --disable chat-media = the four others byte for byte, extension.js pristine without .orig; --enable gives T-J1 back",
  { skip: NO_FX, timeout: LONG }, async () => {
    const full = await fullBuild();
    const noMedia = await noMediaBuild();
    assert.equal(full.code, 0, full.log);
    assert.equal(noMedia.code, 0, noMedia.log);
    assertCounts(noMedia.webview, "webview", ALL.filter((id) => id !== "chat-media"));
    assert.equal(noMedia.host, PRISTINE.host);
    assert.equal(noMedia.orig.host, null);
    await withSandbox({ fx }, async (sb) => {
      assert.equal((await sb.run()).code, 0);
      assert.equal(sb.read("webview"), full.webview);
      const d = await sb.run(["--disable", "chat-media"]);
      assert.equal(d.code, 0, d.out);
      assert.equal(sb.read("webview"), noMedia.webview, "webview = the build without chat-media byte for byte");
      assert.equal(sb.read("host"), PRISTINE.host, "extension.js pristine byte for byte");
      assert.equal(sb.orig("host"), null, "extension.js.orig removed");
      assert.equal(sb.orig("webview"), PRISTINE.webview);
      assert.deepEqual(sb.json("config").enabled, without("chat-media"));
      const e = await sb.run(["--enable", "chat-media"]);
      assert.equal(e.code, 0, e.out);
      assert.equal(sb.read("webview"), full.webview, "webview = the T-J1 build byte for byte");
      assert.equal(sb.read("host"), full.host, "extension.js = the T-J1 build byte for byte");
      assert.equal(sb.orig("host"), PRISTINE.host);
      assert.deepEqual(sb.tmpFiles(), []);
    });
  });

test("T-J5 moving in from v1: v1 wrote the ring (index.v1.js), clean .orig, v1 ledger entry -> all five built, no refusal",
  { skip: skipWithoutV1(fx), timeout: LONG }, async () => {
    const full = await fullBuild();
    const v1 = fx.read("index.v1.js");
    assert.deepEqual(markerCounts(v1), { "CC-BTN:context": 1, "CC-RUN": 2, "CC-PIE": 1 }, "index.v1.js carries v1's ring");
    const entry = {
      date: "2026-09-22", symbols: { jsx: "F" }, buttons: ["context:/context:usage"], side: "slash",
      sha1_pristine: sha12(PRISTINE.webview), targets: { host: { sha1_pristine: sha12(PRISTINE.host) } },
    };
    await withSandbox({ fx, webview: v1, ledger: { [fx.version]: entry } }, async (sb) => {
      sb.writeOrig("webview", PRISTINE.webview);
      const v1Files = ["vscode-claude-chat-context-meter.local.json", "vscode-claude-chat-context-meter.ledger.json",
        "vscode-claude-chat-context-meter.runtime", "settings.json.ccm.bak"];
      for (const f of v1Files) fs.writeFileSync(path.join(sb.state, f), `v1 ${f}\n`);
      const v1State = () => Object.entries(sb.snapshot()).filter(([k]) => v1Files.includes(path.basename(k)));
      const v1Before = v1State();
      const r = await sb.run();
      assert.equal(r.code, 0, `${r.out}\n${r.err}`);
      assert.doesNotMatch(`${r.out}\n${r.err}`, /UNSAFE|REFUSED|Fatal/);
      assert.equal(sb.read("webview"), full.webview, "webview = the T-J1 build byte for byte");
      assert.equal(sb.read("host"), full.host, "extension.js = the T-J1 build byte for byte");
      assert.equal(sb.orig("webview"), PRISTINE.webview);
      assert.equal(sb.orig("host"), PRISTINE.host);
      assert.deepEqual(sb.json("ledger")[fx.version], entry, "the v1 ledger entry is kept as copied");
      assert.equal(v1Before.length, v1Files.length);
      assert.deepEqual(v1State(), v1Before, "v1 state files byte for byte");
    });
  });

test("T-J6 engine statuses when one part's anchor breaks: UNSAFE only at that part in --verify, the others built, exit 1",
  { skip: NO_FX, timeout: LONG }, async () => {
    const { toolbar } = readToolbar(PRISTINE.webview);
    const a = toolbar.signatureEnd;
    const b = matchBracket(PRISTINE.webview, a + 2) + 1;
    const busy = `${toolbar.session}.busy.value`;
    const panel = PRISTINE.webview.slice(a, b);
    assert.ok(panel.includes(busy), "the panel body holds the busy signal");
    const noBusy = PRISTINE.webview.slice(0, a) + panel.split(busy).join(`${toolbar.session}.busX.value`) + PRISTINE.webview.slice(b);
    const W2 = "title:`Image blocked: ${";
    const COMPACT = '("/compact",[])';
    const cases = [
      ["chat-media", swapOnce(PRISTINE.webview, W2, "title:`Image blockex: ${"), W2],
      ["chat-icons", swapOnce(PRISTINE.webview, COMPACT, '("Qcompact",[])'), COMPACT],
      ["chat-icons", noBusy, "no busy signal"],
    ];
    for (const [part, webview, reason] of cases) {
      await withSandbox({ fx, webview }, async (sb) => {
        const v = await sb.run(["--verify"]);
        assert.equal(v.code, 1, v.out);
        const unsafe = v.out.split("\n").filter((l) => l.includes("UNSAFE"));
        assert.equal(unsafe.length, 1, v.out);
        assert.ok(unsafe[0].startsWith(`  UNSAFE: ${part}/webview: `) && unsafe[0].includes(reason), unsafe[0]);
        for (const other of PARTS.filter((id) => id !== part)) assert.match(v.out, new RegExp(`^  ${other}: SAFE TO PATCH$`, "m"));
        const r = await sb.run();
        assert.equal(r.code, 1, r.out);
        const owners = ALL.filter((id) => id !== part);
        assertCounts(sb.read("webview"), "webview", owners);
        if (part === "chat-media") {
          assert.equal(sb.read("host"), PRISTINE.host, "chat-media applied to no target");
          assert.equal(sb.orig("host"), null);
        } else assertCounts(sb.read("host"), "host", owners);
        assert.doesNotThrow(() => parse("webview", sb.read("webview")));
      });
    }
  });

// ---- chat-mark and chat-files through the real engine ----

for (const version of BOTH_VERSIONS) {
  const sibling = fx ? loadSibling(version) : { fx: null, skip: NO_FX };
  test(`T-J7 all five parts on ${version} (next to CCP_FIXTURES): counts = the table, parse, --status owns every marker`,
    { skip: sibling.skip, timeout: LONG }, async () => {
      const f = sibling.fx;
      assert.equal(f.version, version);
      const b = await buildIn(PARTS, f);
      assertFullBuild(b, f, { webview: f.read("index.js.orig"), host: f.read("extension.js") });
      for (const name of ["CC-MARK", "CC-FILES", "CC-SESS"]) assert.equal(markerCounts(b.webview)[name], 1, `${version}: ${name}`);
      for (const id of PARTS) assert.match(b.status, new RegExp(`^part ${id}: enabled; module loaded$`, "m"), `${version} --status`);
    });
}

test("T-J8 --disable chat-mark / chat-files: webview = the build without it byte for byte, extension.js = the three-part build",
  { skip: NO_FX, timeout: LONG }, async () => {
    const full = await fullBuild();
    const three = await threeBuild();
    assert.equal(full.code, 0, full.log);
    assert.equal(three.code, 0, three.log);
    const own = { "chat-mark": ["CC-MARK"], "chat-files": ["CC-FILES", "CC-SESS"] };
    for (const id of ["chat-mark", "chat-files"]) {
      const ref = await withoutBuild(id);
      assert.equal(ref.code, 0, ref.log);
      assert.notEqual(ref.webview, full.webview, `${id} changes nothing in the full build`);
      await withSandbox({ fx }, async (sb) => {
        assert.equal((await sb.run()).code, 0);
        assert.equal(sb.read("webview"), full.webview);
        const d = await sb.run(["--disable", id]);
        assert.equal(d.code, 0, d.out);
        const w = sb.read("webview");
        for (const m of own[id]) assert.ok(!w.includes(`/*${m}*/`), `--disable ${id} left ${m} in`);
        assert.equal(w, ref.webview, `--disable ${id}: webview = the build without it byte for byte`);
        assert.equal(sb.read("host"), three.host, `--disable ${id}: extension.js = the three-part build byte for byte`);
        assert.equal(sb.orig("host"), PRISTINE.host);
        assert.deepEqual(sb.json("config").enabled, without(id));
        assert.deepEqual(sb.tmpFiles(), []);
      });
    }
  });

test("T-J9 a broken anchor of chat-files (F-anchor) or of chat-mark (M1): UNSAFE only at that part, the four others built, exit 1",
  { skip: NO_FX, timeout: LONG }, async () => {
    const three = await threeBuild();
    assert.equal(three.code, 0, three.log);
    const ANCHOR = "{hostReportsDocumentCloses:!0});";
    const M1 = /function ([\w$]+)\(([\w$]+)\)\{if\(!\2\.startsWith\("@"\)\|\|\2==="@"\)return \2;/g;
    const m1 = [...PRISTINE.webview.matchAll(M1)];
    assert.equal(m1.length, 1, "fixture: the M1 function must occur exactly once");
    // Both edits keep the bundle parsing: a renamed key, and `B` -> `B&&!0` (same value, no match).
    const cases = [
      ["chat-files", swapOnce(PRISTINE.webview, ANCHOR, "{hostReportsDocumentCloseX:!0});"), "F-anchor"],
      ["chat-mark", swapOnce(PRISTINE.webview, m1[0][0], m1[0][0].replace('==="@")', '==="@"&&!0)')), "M1"],
    ];
    for (const [part, webview, reason] of cases) {
      assert.doesNotThrow(() => parse("webview", webview), `${part}: the broken fixture still parses`);
      const others = without(part);
      const ref = await buildIn(others, fx, webview);
      assert.equal(ref.code, 0, ref.log);
      await withSandbox({ fx, webview }, async (sb) => {
        const v = await sb.run(["--verify"]);
        assert.equal(v.code, 1, v.out);
        const unsafe = v.out.split("\n").filter((l) => l.includes("UNSAFE"));
        assert.equal(unsafe.length, 1, v.out);
        assert.ok(unsafe[0].startsWith(`  UNSAFE: ${part}/webview: `) && unsafe[0].includes(`${reason}: `), unsafe[0]);
        for (const other of others) assert.match(v.out, new RegExp(`^  ${other}: SAFE TO PATCH$`, "m"));
        const r = await sb.run();
        assert.equal(r.code, 1, r.out);
        assert.equal(r.out.split("\n").filter((l) => l.includes("UNSAFE")).length, 1, r.out);
        const w = sb.read("webview");
        assertCounts(w, "webview", ALL.filter((id) => id !== part));
        assert.equal(w, ref.webview, `${part}: webview = the build of the four others byte for byte`);
        assert.equal(sb.read("host"), three.host, `${part}: extension.js = the three-part build byte for byte`);
        assert.doesNotThrow(() => parse("webview", w));
      });
    }
  });

test("T-J10 a three-part config: mark and files are not built (--ensure, build); --enable chat-mark builds it, config lists four; --enable chat-files, five",
  { skip: NO_FX, timeout: LONG }, async () => {
    const three = await threeBuild();
    assert.equal(three.code, 0, three.log);
    assertCounts(three.webview, "webview", ["engine", ...THREE]);
    assertCounts(three.host, "host", ["engine", ...THREE]);
    const markOnly = await withoutBuild("chat-files"); // = the three parts + chat-mark
    assert.equal(markOnly.code, 0, markOnly.log);
    await withSandbox({ fx, enabled: THREE }, async (sb) => {
      const e = await sb.run(["--ensure"]); // the SessionStart hook after the skill update
      assert.match(sysMsg(e), /rebuilt for /);
      assert.doesNotMatch(sysMsg(e), /UNSAFE|Details/);
      assert.equal(sb.read("webview"), three.webview, "--ensure: webview = the three-part build byte for byte");
      assert.equal(sb.read("host"), three.host);
      const b = await sb.run();
      assert.equal(b.code, 0, b.out);
      assert.equal(sb.read("webview"), three.webview, "build: webview = the three-part build byte for byte");
      assert.deepEqual(sb.json("config").enabled, THREE);
      const s = await sb.run(["--status"]);
      for (const id of ["chat-mark", "chat-files"]) assert.match(s.out, new RegExp(`^part ${id}: disabled$`, "m"));
      const r = await sb.run(["--enable", "chat-mark"]);
      assert.equal(r.code, 0, r.out);
      assertCounts(sb.read("webview"), "webview", ["engine", ...THREE, "chat-mark"]);
      assert.equal(sb.read("webview"), markOnly.webview, "--enable chat-mark: webview = the build of the four byte for byte");
      assert.equal(sb.read("host"), three.host);
      assert.deepEqual(sb.json("config").enabled, [...THREE, "chat-mark"]);
      const f = await sb.run(["--enable", "chat-files"]);
      assert.equal(f.code, 0, f.out);
      assertCounts(sb.read("webview"), "webview", ["engine", ...THREE, "chat-mark", "chat-files"]);
      assert.equal(sb.read("host"), three.host, "--enable chat-files: extension.js stays the three-part build");
      assert.deepEqual(sb.json("config").enabled, [...THREE, "chat-mark", "chat-files"]);
    });
  });
