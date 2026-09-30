// T-M4: the host harness. The six host inserts run exactly as
// plan() returned them on the fixture - derived names, not the snippet source -
// and again built by the same substitution with the request named p, e, v, n
// (the host's own names). vscode, spawn and execFile are stubs: nothing is launched,
// `reg` included. Files live in a fresh folder under the OS temp dir; two of them are
// ~100 MB each (the preview ceiling), removed after the run - a killed run leaves them there.

import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import { loadFixtures, skipWithoutFixtures } from "./lib/fixtures.mjs";
import { loadPart, runPlan, tempDir } from "./lib/b-harness.mjs";
import { hostSnippets, H2_ORDER } from "../assets/host-snippets.mjs";

const fx = loadFixtures();
const AsyncFunction = (async () => {}).constructor;
const CAPS = ["open", "reveal", "read_image", "photos", "photoshop"];
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

// ---- files -------------------------------------------------------------------
const ROOT = tempDir("host");
const DIR = path.join(ROOT, "\u0442\u0435\u0441\u0442 \u043f\u0430\u043f\u043a\u0430");
const put = (name, data) => { const p = path.join(DIR, name); fs.writeFileSync(p, data); return p; };
fs.mkdirSync(DIR);
const PNG = put("\u043a\u0430\u0440\u0442\u0438\u043d\u043a\u0430.png", PNG_1PX);
const PSD = put("\u043c\u0430\u043a\u0435\u0442.psd", "8BPS-dummy");
const TXT = put("note.txt", "x");
const EDGE = put("edge.png", Buffer.alloc(104857600));
const BIG = put("big.png", Buffer.alloc(104857601));
const PHOTO_PATHS = ["plain.png", "a b.png", "a,b.png", "a#b.png", "R&D shot.png", "50%off.png"].map((n) => put(n, PNG_1PX));
const PF = path.join(ROOT, "pf");
for (const d of ["Adobe Photoshop 2026", "Adobe Photoshop (Beta)"]) {
  fs.mkdirSync(path.join(PF, "Adobe", d), { recursive: true });
  fs.writeFileSync(path.join(PF, "Adobe", d, "Photoshop.exe"), "");
}
const REG_EXE = path.join(ROOT, "reg", "Photoshop.exe");
fs.mkdirSync(path.dirname(REG_EXE));
fs.writeFileSync(REG_EXE, "");

const savedEnv = { ProgramW6432: process.env.ProgramW6432, CC_PHOTOSHOP_EXE: process.env.CC_PHOTOSHOP_EXE };
process.env.ProgramW6432 = PF;
delete process.env.CC_PHOTOSHOP_EXE;
after(() => {
  for (const [k, v] of Object.entries(savedEnv)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  delete globalThis.__ccPsExe;
  fs.rmSync(ROOT, { recursive: true, force: true });
});

// ---- stubs -------------------------------------------------------------------
class FakeChild extends EventEmitter {
  unref() { this.unrefd = true; return this; }
}
const world = { log: [], fsCalls: [], children: [], reg: { err: null, out: "" } };
const vscodeStub = {
  Uri: { file: (p) => ({ scheme: "file", fsPath: p }) },
  commands: { executeCommand: async (...a) => { world.log.push(["executeCommand", ...a]); } },
  env: { openExternal: async (u) => { world.log.push(["openExternal", u]); return true; } },
};
const cpStub = {
  spawn(cmd, args, opts) {
    const child = new FakeChild();
    world.log.push(["spawn", cmd, args, opts]);
    world.children.push({ cmd, args, opts, child });
    return child;
  },
  execFile(cmd, args, opts, cb) {
    world.log.push(["execFile", cmd, args, opts]);
    if (cmd !== "reg") throw new Error("unexpected execFile " + cmd);
    setImmediate(() => cb(world.reg.err, world.reg.out));
    return new FakeChild();
  },
};
// Real fs behind a recorder: every *Sync call and every fs.promises call is logged.
const fsStub = new Proxy(fs, {
  get(target, key) {
    if (key === "promises") {
      return new Proxy(fs.promises, {
        get: (t, k) => (typeof t[k] === "function" ? (...a) => { world.fsCalls.push("async:" + String(k)); return t[k](...a); } : t[k]),
      });
    }
    const v = target[key];
    if (typeof v === "function" && /Sync$/.test(String(key))) return (...a) => { world.fsCalls.push("sync:" + String(key)); return v(...a); };
    return v;
  },
});
const fakeRequire = (m) => {
  if (m === "vscode") return vscodeStub;
  if (m === "child_process") return cpStub;
  if (m === "fs") return fsStub;
  if (m === "path") return path;
  throw new Error("unexpected require " + m);
};
function reset() {
  world.log.length = 0; world.fsCalls.length = 0; world.children.length = 0;
  world.reg = { err: null, out: "" };
  delete globalThis.__ccPsExe;
}

// ---- variants ----------------------------------------------------------------
const hostPlan = fx ? runPlan(await loadPart("chat-media"), "host", { webview: fx.read("index.js.orig"), host: fx.read("extension.js") }) : null;
const pick = (edits, marker) => edits.find((e) => e.text.includes(`/*${marker}*/`)).text;
const variants = [];
if (hostPlan) {
  const { request, uri, path: p, exists } = hostPlan.symbols;
  variants.push({ name: `plan() on ${fx.version} (request ${request})`, req: request, uri, path: p, exists,
    h2: ["CC-CAPS", "CC-REVEAL", "CC-READIMG", "CC-PHOTOS", "CC-PS"].map((m) => pick(hostPlan.edits, m)),
    open: pick(hostPlan.edits, "CC-OPEN") });
} else {
  test("T-M4 on the inserts plan() returned", { skip: skipWithoutFixtures(fx) }, () => {});
}
for (const req of ["p", "e", "v", "n"]) {
  const s = hostSnippets({ req, uri: "W", path: "z" });
  variants.push({ name: `request named ${req}`, req, uri: "W", path: "z", h2: H2_ORDER.map((k) => s[k]), open: s.open });
}

function stand(v) {
  const fn = new AsyncFunction(v.req, "require", v.h2.join("") + 'return "FALLTHROUGH";');
  // openFile's exists flag (from 2.1.284) is a parameter as well; a CC-OPEN without one never reads it.
  const open = new Function(v.path, v.uri, v.exists ?? "__ccNoFlag", "require", v.open + 'return "showTextDocument";');
  return {
    run: (request) => fn({ request }, fakeRequire),
    open: (p, exists = true) => open(p, { fsPath: p }, exists, fakeRequire),
  };
}
const spawned = () => world.log.filter((l) => l[0] === "spawn");
const stats = () => world.fsCalls.filter((c) => /stat/.test(c)).length;
// Every spawn: detached, stdio ignore, unref, an error listener; an error event must not throw.
function assertSafeSpawns() {
  assert.ok(world.children.length > 0, "a spawn was expected");
  for (const { opts, child } of world.children) {
    assert.equal(opts.detached, true);
    assert.equal(opts.stdio, "ignore");
    assert.equal(child.unrefd, true, "unref() not called");
    assert.ok(child.listenerCount("error") > 0, "no error listener");
    assert.doesNotThrow(() => child.emit("error", new Error("spawn failed")));
  }
}

for (const v of variants) {
  const S = stand(v);

  test(`T-M4 ${v.name}: caps verbatim, unknown request falls through, no insert throws`, async () => {
    reset();
    assert.deepEqual(await S.run({ type: "cc_host_caps" }),
      { type: "cc_host_caps_response", v: 1, caps: CAPS });
    reset(); // the caps answer may look for Photoshop; only the fall-through must touch nothing
    assert.equal(await S.run({ type: "get_current_selection" }), "FALLTHROUGH");
    assert.equal(world.log.length + world.fsCalls.length, 0);
  });

  test(`T-M4 ${v.name}: read_image - data, notModified, 100 MB edge, refusals, async fs only`, async () => {
    reset();
    const ok = await S.run({ type: "cc_read_image", path: PNG });
    const st = fs.statSync(PNG);
    assert.deepEqual(ok, { type: "cc_read_image_response", ok: true,
      dataUrl: "data:image/png;base64," + PNG_1PX.toString("base64"), size: st.size, mtimeMs: st.mtimeMs });
    assert.deepEqual(await S.run({ type: "cc_read_image", path: PNG, knownMtimeMs: st.mtimeMs }),
      { type: "cc_read_image_response", ok: true, notModified: true, size: st.size, mtimeMs: st.mtimeMs });
    const other = await S.run({ type: "cc_read_image", path: PNG, knownMtimeMs: st.mtimeMs - 1000 });
    assert.equal(other.ok, true);
    assert.ok(other.dataUrl, "an older knownMtimeMs must get the file");
    const edge = await S.run({ type: "cc_read_image", path: EDGE });
    assert.equal(edge.ok, true);
    assert.equal(edge.size, 104857600);
    assert.equal(Buffer.from(edge.dataUrl.split(",")[1], "base64").length, 104857600);
    assert.ok(world.fsCalls.includes("async:readFile"));
    const mark = world.fsCalls.length;
    assert.deepEqual(await S.run({ type: "cc_read_image", path: BIG }),
      { type: "cc_read_image_response", ok: false, error: "too large", size: 104857601 });
    assert.ok(!world.fsCalls.slice(mark).some((c) => /readFile/.test(c)), "a too-large file must not be read");
    for (const p of ["x.png", TXT]) {
      assert.deepEqual(await S.run({ type: "cc_read_image", path: p }),
        { type: "cc_read_image_response", ok: false, error: "unsupported path" });
    }
    const missing = await S.run({ type: "cc_read_image", path: path.join(DIR, "nope.png") });
    assert.equal(missing.ok, false);
    assert.match(missing.error, /^ENOENT/);
    assert.deepEqual(world.fsCalls.filter((c) => c.startsWith("sync:")), [], "sync fs call in the image branch");
    assert.equal(world.log.length, 0);
  });

  test(`T-M4 ${v.name}: \\\\server\\share and \\foo are refused in every branch without stat`, async () => {
    reset();
    const cases = [
      ["cc_reveal_in_os", ["\\\\server\\share\\a.png", "\\foo"]],
      ["cc_read_image", ["\\\\server\\share\\a.png", "\\foo.png"]],
      ["cc_open_in_photos", ["\\\\server\\share\\a.png", "\\foo.png"]],
      ["cc_open_in_photoshop", ["\\\\server\\share\\a.psd", "\\foo.psd"]],
    ];
    for (const [type, paths] of cases) {
      for (const p of paths) {
        const r = await S.run({ type, path: p, mode: "open" });
        assert.equal(r.type, type + "_response");
        assert.equal(r.ok, false, `${type} ${p}`);
        assert.equal(typeof r.error, "string");
      }
    }
    assert.equal(stats(), 0, "stat was called on a path without a drive letter");
    assert.equal(world.log.length, 0);
  });

  test(`T-M4 ${v.name}: reveal - select, open folder, drive root, open on a file, missing`, async () => {
    reset();
    const okReveal = { type: "cc_reveal_in_os_response", ok: true };
    assert.deepEqual(await S.run({ type: "cc_reveal_in_os", path: PNG, mode: "select" }), okReveal);
    assert.deepEqual(world.log, [["executeCommand", "revealFileInOS", { scheme: "file", fsPath: PNG }]]);
    world.log.length = 0;
    assert.deepEqual(await S.run({ type: "cc_reveal_in_os", path: PNG, mode: "open" }), okReveal);
    assert.equal(world.log[0][1], "revealFileInOS", "open on a file selects it in its folder");
    world.log.length = 0;
    assert.deepEqual(await S.run({ type: "cc_reveal_in_os", path: DIR + "\\", mode: "open" }), okReveal);
    assert.deepEqual(await S.run({ type: "cc_reveal_in_os", path: "C:\\", mode: "open" }), okReveal);
    assert.deepEqual(spawned().map((l) => [l[1], l[2], l[3].windowsVerbatimArguments]),
      [["explorer.exe", ['"' + DIR + '"'], true], ["explorer.exe", ['"C:\\."'], true]]);
    assertSafeSpawns();
    const missing = await S.run({ type: "cc_reveal_in_os", path: path.join(DIR, "nope"), mode: "select" });
    assert.equal(missing.ok, false);
    assert.match(missing.error, /^ENOENT/);
  });

  test(`T-M4 ${v.name}: Photos - one quoted explorer.exe argument for every path, refusals`, async () => {
    reset();
    for (const p of [PNG, ...PHOTO_PATHS]) {
      assert.deepEqual(await S.run({ type: "cc_open_in_photos", path: p }), { type: "cc_open_in_photos_response", ok: true });
    }
    assert.deepEqual(spawned().map((l) => [l[1], l[2]]), [PNG, ...PHOTO_PATHS].map((p) => ["explorer.exe", ['"' + p + '"']]));
    for (const l of spawned()) assert.equal(l[3].windowsVerbatimArguments, true);
    assertSafeSpawns();
    reset();
    for (const p of [PSD, TXT]) {
      assert.deepEqual(await S.run({ type: "cc_open_in_photos", path: p }),
        { type: "cc_open_in_photos_response", ok: false, error: "unsupported path" });
    }
    assert.equal(world.children.length, 0);
  });

  test(`T-M4 ${v.name}: Photoshop - reg with timeout, cache, error event, fallback search`, async () => {
    reset();
    world.reg.out = `\r\nHKEY_LOCAL_MACHINE\\...\\Photoshop.exe\r\n    (Default)    REG_SZ    ${REG_EXE}\r\n\r\n`;
    const first = await S.run({ type: "cc_open_in_photoshop", path: PSD });
    assert.deepEqual(first, { type: "cc_open_in_photoshop_response", ok: true, exe: REG_EXE });
    const regs = world.log.filter((l) => l[0] === "execFile");
    assert.equal(regs.length, 1);
    assert.equal(regs[0][1], "reg");
    assert.equal(regs[0][3].timeout, 5000, "reg needs a timeout");
    assert.equal(regs[0][3].windowsHide, true);
    assert.equal((await S.run({ type: "cc_open_in_photoshop", path: PSD })).exe, REG_EXE);
    assert.equal(world.log.filter((l) => l[0] === "execFile").length, 1, "the found exe is remembered");
    assert.deepEqual(spawned().map((l) => [l[1], l[2]]), [[REG_EXE, [PSD]], [REG_EXE, [PSD]]]);
    assert.equal(globalThis.__ccPsExe, REG_EXE);
    assertSafeSpawns(); // emits "error" on each child
    assert.equal(globalThis.__ccPsExe, undefined, "an error event forgets the exe");
    // No registry answer: search Program Files\Adobe, release before beta.
    reset();
    world.reg.err = new Error("not found");
    const release = path.join(PF, "Adobe", "Adobe Photoshop 2026", "Photoshop.exe");
    assert.equal((await S.run({ type: "cc_open_in_photoshop", path: PSD })).exe, release);
    // A remembered exe that vanished goes straight to the search, without reg.
    reset();
    globalThis.__ccPsExe = path.join(ROOT, "gone", "Photoshop.exe");
    assert.equal((await S.run({ type: "cc_open_in_photoshop", path: PSD })).exe, release);
    assert.equal(world.log.filter((l) => l[0] === "execFile").length, 0);
    reset();
    const txt = await S.run({ type: "cc_open_in_photoshop", path: TXT });
    assert.deepEqual(txt, { type: "cc_open_in_photoshop_response", ok: false, error: "unsupported path" });
    assert.equal(world.children.length, 0);
  });

  test(`T-M4 ${v.name}: CC-OPEN sends images, video and markdown to vscode.open, the rest to the editor`, () => {
    reset();
    const ext = ["C:\\x\\a.JPG", "C:\\x\\clip.mp4", "C:\\x\\doc.md", "C:\\x\\v.svg", "C:\\x\\n.MARKDOWN", "C:\\x\\notes.md.txt"];
    assert.deepEqual([PNG, ...ext].map((p) => S.open(p)),
      [undefined, undefined, undefined, undefined, "showTextDocument", undefined, "showTextDocument"]);
    assert.deepEqual(world.log.map((l) => [l[1], l[2].fsPath]),
      [["vscode.open", PNG], ["vscode.open", ext[0]], ["vscode.open", ext[1]], ["vscode.open", ext[2]], ["vscode.open", ext[4]]]);
    if (v.exists !== undefined) {
      // The flag cleared (the stat threw): every path goes on to the stock code, which warns.
      reset();
      assert.deepEqual([PNG, ...ext].map((p) => S.open(p, false)), Array(7).fill("showTextDocument"), `${v.exists} cleared`);
      assert.deepEqual(world.log, []);
    }
  });
}

test("T-M4 CC-OPEN built with the exists flag of 2.1.284: set, it routes as without one; cleared, it steps aside", () => {
  const open = hostSnippets({ req: "p", uri: "W", path: "z", exists: "G" }).open;
  assert.ok(open.startsWith("/*CC-OPEN*/if(G&&/"), open);
  const S = stand({ req: "p", uri: "W", path: "z", exists: "G", h2: [], open });
  const paths = [PNG, "C:\\x\\clip.mp4", "C:\\x\\doc.md", "C:\\x\\v.svg"];
  reset();
  assert.deepEqual(paths.map((p) => S.open(p, true)), [undefined, undefined, undefined, "showTextDocument"]);
  assert.deepEqual(world.log.map((l) => [l[1], l[2].fsPath]), paths.slice(0, 3).map((p) => ["vscode.open", p]));
  reset();
  assert.deepEqual(paths.map((p) => S.open(p, false)), Array(4).fill("showTextDocument"));
  assert.deepEqual(world.log, []);
});
