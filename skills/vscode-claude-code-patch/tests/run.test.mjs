// Self-test of tests/run.mjs: snapshot, bait env, compare, isolation guard (live
// copies refused), the skip count, and the isolation sentinel of tests/lib/sandbox.mjs.
// Moved out of tests/layout.test.mjs, which keeps only T-E20.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { runSuite, guardSpec, nodeProblem } from "./run.mjs";

describe("tests/run.mjs self-test", () => {
  let tmp;
  let home;
  let inst;
  const OLD = new Date("2020-01-02T03:04:05Z");
  const fwd = (p) => p.replace(/\\/g, "/");

  before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ccp-selftest-"));
    home = path.join(tmp, "home");
    inst = path.join(home, ".vscode", "extensions", "anthropic.claude-code-9.9.9-win32-x64");
    fs.mkdirSync(path.join(inst, "webview"), { recursive: true });
    fs.mkdirSync(path.join(home, ".claude"));
    const seed = { [path.join(inst, "webview", "index.js")]: "a", [path.join(inst, "extension.js")]: "b",
      [path.join(home, ".claude", "settings.json")]: "{}", [path.join(home, ".claude", "vscode-claude-chat-context-meter.local.json")]: "{}" };
    for (const [p, text] of Object.entries(seed)) {
      fs.writeFileSync(p, text);
      fs.utimesSync(p, OLD, OLD);
    }
  });
  after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  // A throwaway root holding one test file (and optionally a fake engine), run by runSuite.
  // `body` is one probe test's code, or an array of them (one file each); `head` is extra
  // top-level code of every probe file (an import); `at` puts the root elsewhere, `guardHome`
  // guards another home.
  function nested(name, body, engine, head = "", { at = null, guardHome = home } = {}) {
    const root = at || path.join(tmp, name);
    fs.mkdirSync(path.join(root, "tests"), { recursive: true });
    const files = [].concat(body).map((code, i) => {
      const file = path.join(root, "tests", `probe${i}.test.mjs`);
      fs.writeFileSync(file, `import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport fs from "node:fs";\nimport os from "node:os";\nimport path from "node:path";\n${head}\ntest("probe", () => {\n${code}\n});\n`);
      return fwd(file);
    });
    if (engine) fs.writeFileSync(path.join(root, "claude_code_patch.mjs"), engine);
    const lines = [];
    const res = runSuite({ root, files, env: process.env, guard: guardSpec({ USERPROFILE: guardHome, HOME: guardHome }), stdio: "pipe", log: (l) => lines.push(l) });
    return { ...res, log: lines.join("\n"), paths: res.violations.map((v) => path.resolve(v.after.path || v.before.path).toLowerCase()) };
  }

  const BAIT_CHECK = `
    const bait = process.env.USERPROFILE;
    assert.ok(bait && path.resolve(bait).toLowerCase().startsWith(path.resolve(os.tmpdir()).toLowerCase() + path.sep), "USERPROFILE is not a temp bait: " + bait);
    for (const v of ["HOME", "APPDATA", "LOCALAPPDATA", "CCP_STATE_DIR"]) assert.equal(process.env[v], bait, v);
    assert.equal(os.homedir(), bait);
    assert.notEqual(path.resolve(bait).toLowerCase(), ${JSON.stringify(path.resolve(process.env.USERPROFILE || ".").toLowerCase())}, "bait inherited from the parent");
    assert.deepEqual(fs.readdirSync(bait), []);
    assert.ok(process.env.CCP_FIXTURES);`;

  test("guardSpec: extension root and state dirs from the given environment only", () => {
    const spec = guardSpec({ USERPROFILE: home, HOME: home, CCP_STATE_DIR: path.join(tmp, "state") });
    assert.deepEqual(spec.extRoots, [path.join(home, ".vscode", "extensions")]);
    assert.deepEqual(spec.stateDirs, [path.join(home, ".claude"), path.join(tmp, "state")]);
    assert.deepEqual(spec.skillRoots, [path.join(home, ".agents", "skills")]);
  });

  // The probe leaves a mark once it has run: a nested `node --test` can exit 0 having run nothing.
  const ranMark = (slug) => path.join(tmp, `ran-${slug}`);
  const MARK = (slug) => `fs.writeFileSync(${JSON.stringify(ranMark(slug))}, "");`;

  test("clean run: the child gets the bait environment, nothing flagged, exit 0", () => {
    const r = nested("clean", `${BAIT_CHECK}\n${MARK("clean")}`);
    assert.ok(fs.existsSync(ranMark("clean")), `the probe did not run\n${r.output}`);
    assert.equal(r.testExit, 0, r.output);
    assert.deepEqual([r.exitCode, r.violations.length, r.baitLeaks.length, r.refused], [0, 0, 0, null], r.log);
    assert.ok(r.checked >= 10, String(r.checked));
  });

  test("test files run one at a time (--test-concurrency=1)", () => {
    const lock = JSON.stringify(path.join(tmp, "concurrency.lock"));
    const probe = `fs.writeFileSync(${lock}, "", { flag: "wx" });\nAtomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 400);\nfs.rmSync(${lock});`;
    const r = nested("serial", [probe, probe]);
    assert.deepEqual([r.testExit, r.exitCode], [0, 0], r.output);
  });

  test("dirty run: rewrite with same bytes, new files, change, delete and bait write are all caught", () => {
    const P = (p) => JSON.stringify(p);
    const settings = path.join(home, ".claude", "settings.json");
    const created = [path.join(home, ".claude", "vscode-claude-code-patch.local.json"), path.join(home, ".claude", "vscode-claude-code-patch.other"),
      path.join(inst, "webview", "index.js.ccp-tmp-1"), path.join(inst, "extension.js.orig")];
    const changed = path.join(inst, "webview", "index.js");
    const deleted = path.join(home, ".claude", "vscode-claude-chat-context-meter.local.json");
    const r = nested("dirty", `${BAIT_CHECK}
      fs.writeFileSync(${P(settings)}, "{}");
      for (const p of ${P(created)}) fs.writeFileSync(p, "n");
      fs.writeFileSync(${P(changed)}, "A");
      fs.utimesSync(${P(changed)}, new Date(${OLD.getTime()}), new Date(${OLD.getTime()})); // same size and mtime: only sha1 differs
      fs.rmSync(${P(deleted)});
      const state = process.env.CCP_STATE_DIR;
      if (!state || !path.resolve(state).toLowerCase().startsWith(path.resolve(os.tmpdir()).toLowerCase())) throw new Error("no bait");
      fs.writeFileSync(path.join(state, "leak.json"), "{}");`);
    assert.equal(r.testExit, 0, r.output);
    assert.equal(r.exitCode, 2);
    for (const p of [settings, ...created, changed, deleted]) assert.ok(r.paths.includes(p.toLowerCase()), `not flagged: ${p}\n${r.log}`);
    const same = r.violations.find((v) => v.after.path.toLowerCase() === settings.toLowerCase());
    assert.deepEqual([same.after.size, same.after.sha1], [same.before.size, same.before.sha1]);
    assert.equal(r.baitLeaks.length, 1);
    assert.match(r.log, /REAL FILE CHANGED/);
    assert.match(r.log, /BAIT WRITTEN/);
  });

  // The fake engine answers `--where`.
  const ENGINE = (body) => `import fs from "node:fs";\nimport os from "node:os";\nimport path from "node:path";\nif (process.argv[2] !== "--where") process.exit(9);\n${body}\n`;
  const SANDBOX_PRINT = `const root = path.join(process.env.USERPROFILE, ".vscode", "extensions");\nfor (const n of fs.readdirSync(root)) console.log(path.join(root, n, "webview", "index.js"));`;

  test("isolation guard: --where that sees only the sandbox lets the suite run", () => {
    const r = nested("iso-ok", MARK("ok"), ENGINE(SANDBOX_PRINT));
    assert.deepEqual([r.refused, r.exitCode], [null, 0], r.log);
    assert.ok(fs.existsSync(ranMark("ok")));
    assert.match(r.log, /--where saw only the sandbox/);
  });

  for (const [name, extra] of [
    ["prints a foreign installation", () => `console.log(path.join(os.tmpdir(), "elsewhere", ".vscode", "extensions", "anthropic.claude-code-2.1.280-win32-x64"));`],
    ["prints the guarded state dir", () => `console.log(${JSON.stringify(path.join(home, ".claude"))});`],
    ["exits 1", () => "process.exit(1);"],
    ["prints nothing", null],
  ]) {
    test(`isolation guard: --where ${name} -> suite refused, no test runs, exit 2`, () => {
      const slug = name.replace(/\W+/g, "-");
      const r = nested(`iso-${slug}`, MARK(slug), ENGINE(extra ? `${SANDBOX_PRINT}\n${extra()}` : ""));
      assert.equal(r.exitCode, 2);
      assert.ok(r.refused, r.log);
      assert.equal(r.testExit, null);
      assert.ok(!fs.existsSync(ranMark(slug)), "the suite ran although the guard refused");
      assert.match(r.log, /SUITE NOT STARTED/);
    });
  }

  // tests/lib/sandbox.mjs throws at import unless CCP_RUN_BAIT, set only by run.mjs, lies under
  // the OS temp dir and equals USERPROFILE, HOME, APPDATA and CCP_STATE_DIR. A child `node --test` started here gets
  // neither this process's NODE_TEST_CONTEXT nor its CCP_RUN_BAIT.
  test("a test file started without run.mjs refuses", { timeout: 120000 }, () => {
    const NOT_ISOLATED = "tests/lib/sandbox.mjs: not isolated - run the suite through node tests/run.mjs";
    const head = `import { makeSandbox } from ${JSON.stringify(new URL("./lib/sandbox.mjs", import.meta.url).href)};`;
    const standin = path.join(tmp, "standin");
    fs.mkdirSync(path.join(standin, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(standin, ".claude", "settings.json"), "{\"theme\":\"real\"}\n");
    const bait = fs.mkdtempSync(path.join(tmp, "bait-"));
    const direct = (slug, set) => {
      const file = path.join(tmp, `sentinel-${slug}.test.mjs`);
      fs.writeFileSync(file, `import { test } from "node:test";\nimport fs from "node:fs";\n${head}\ntest("probe", () => fs.writeFileSync(${JSON.stringify(ranMark(slug))}, typeof makeSandbox));\n`);
      const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(NODE_TEST_CONTEXT|NODE_OPTIONS|CCP_RUN_BAIT|USERPROFILE|HOME|APPDATA|LOCALAPPDATA|CCP_STATE_DIR)$/i.test(k)));
      const r = spawnSync(process.execPath, ["--test", fwd(file)], { env: { ...env, ...set }, encoding: "utf8", timeout: 60000 });
      return { slug, code: r.status, out: `${r.stdout || ""}${r.stderr || ""}${r.error ? `\n${r.error.message}` : ""}`, ran: fs.existsSync(ranMark(slug)) };
    };
    const refused = (r) => {
      assert.equal(r.code, 1, `${r.slug}: node --test exit\n${r.out}`);
      assert.ok(r.out.includes(NOT_ISOLATED), `${r.slug}: no sentinel message\n${r.out}`);
      assert.ok(!r.ran, `${r.slug}: the probe test ran`);
    };
    // A home without the runner: a (stand-in) home, no CCP_RUN_BAIT. Nothing in the home changes.
    const seen = () => JSON.stringify([fs.readdirSync(standin, { recursive: true }).sort(), fs.readFileSync(path.join(standin, ".claude", "settings.json"), "utf8")]);
    const was = seen();
    refused(direct("home", { USERPROFILE: standin, HOME: standin, APPDATA: path.join(standin, "AppData", "Roaming"), LOCALAPPDATA: path.join(standin, "AppData", "Local") }));
    assert.equal(seen(), was, "the stand-in home changed");
    // The marker present, one of the four elsewhere or unset.
    const all = { CCP_RUN_BAIT: bait, USERPROFILE: bait, HOME: bait, APPDATA: bait, CCP_STATE_DIR: bait };
    for (const v of ["USERPROFILE", "HOME", "APPDATA", "CCP_STATE_DIR"]) refused(direct(`other-${v}`, { ...all, [v]: standin }));
    const { CCP_STATE_DIR: _, ...noState } = all;
    refused(direct("no-state-dir", noState));
    // All five agree, but on a folder outside the OS temp dir (a real home set by hand): refused.
    const notTemp = path.join(path.parse(os.tmpdir()).root, "ccp-no-such-home");
    refused(direct("not-temp", Object.fromEntries(Object.keys(all).map((k) => [k, notTemp]))));
    // Equal up to case and a trailing separator: the file loads and its test runs.
    const ok = direct("equal", { ...all, CCP_RUN_BAIT: `${bait.toUpperCase()}${path.sep}` });
    assert.deepEqual([ok.code, ok.ran], [0, true], ok.out);
    // Through run.mjs: its own bait replaces the CCP_RUN_BAIT this process inherited.
    const r = nested("sentinel-run", `assert.equal(typeof makeSandbox, "function");\n${MARK("sentinel-run")}`, null, head);
    assert.ok(fs.existsSync(ranMark("sentinel-run")), `the probe did not run\n${r.output}`);
    assert.deepEqual([r.testExit, r.exitCode, r.baitLeaks.length], [0, 0, 0], r.log);
  });

  test("isolation guard: an engine under ~/.agents/skills or ~/.claude, or the one the hook runs, is a live copy -> refused", () => {
    for (const where of [[".agents", "skills"], [".claude", "skills"]]) {
      const slug = `live-${where[0].slice(1)}`;
      const at = path.join(home, ...where, "vscode-claude-code-patch");
      const r = nested(slug, MARK(slug), ENGINE(SANDBOX_PRINT), "", { at });
      assert.deepEqual([r.exitCode, r.testExit], [2, null], r.log);
      assert.match(r.refused, /lies under .*run the suite in a copy outside the live folders/);
      assert.ok(!fs.existsSync(ranMark(slug)));
      fs.rmSync(at, { recursive: true, force: true });
    }
    const home2 = path.join(tmp, "home2");
    fs.mkdirSync(path.join(home2, ".claude"), { recursive: true });
    const hooked = path.join(tmp, "hooked");
    const hook = { type: "command", command: "node", args: [path.join(hooked, "claude_code_patch.mjs"), "--ensure"] };
    fs.writeFileSync(path.join(home2, ".claude", "settings.json"), JSON.stringify({ hooks: { SessionStart: [{ hooks: [hook] }] } }));
    const r = nested("hooked", MARK("hooked"), ENGINE(SANDBOX_PRINT), "", { guardHome: home2 });
    assert.deepEqual([r.exitCode, r.testExit], [2, null], r.log);
    assert.match(r.refused, /is the one the SessionStart hook in .*settings\.json runs/);
    assert.ok(!fs.existsSync(ranMark("hooked")));
  });

  test("Node older than 20.10 is refused with a readable line (the suite's flags need it)", () => {
    for (const v of ["18.20.4", "20.9.0", "16.20.2"]) assert.match(nodeProblem(v), new RegExp(`^\\[run\\.mjs\\] the suite needs Node 20\\.10 or newer, this is ${v.replace(/\./g, "\\.")} \\(`), v);
    for (const v of ["20.10.0", "20.18.1", "22.0.0", "24.3.0"]) assert.equal(nodeProblem(v), null, v);
  });

  test("the skips are counted and grouped by reason at the end", () => {
    const head = `test("skipped one", { skip: "author-only material" }, () => {});\ntest("skipped two", { skip: "author-only material" }, () => {});\n` +
      `test("skipped three", { skip: "another reason" }, () => {});`;
    const r = nested("skips", MARK("skips"), null, head);
    assert.deepEqual([r.exitCode, r.testExit], [0, 0], r.log);
    assert.deepEqual(r.skipped.map((s) => s.reason).sort(), ["another reason", "author-only material", "author-only material"]);
    assert.match(r.log, /^\[run\.mjs\] skipped: 3, by reason:\n {2}2 x author-only material\n {2}1 x another reason$/m);
    const none = nested("no-skips", MARK("no-skips"));
    assert.deepEqual(none.skipped, []);
    assert.match(none.log, /^\[run\.mjs\] skipped: none$/m);
  });
});
