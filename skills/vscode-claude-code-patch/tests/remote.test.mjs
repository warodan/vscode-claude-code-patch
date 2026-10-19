// VS Code Remote-SSH: the build for a Linux server. R-1 the engine finds only the
// -linux- installations under ~/.vscode-server/extensions there, and Windows only
// its own folder (R-2); R-3..R-5 the asset variants (//@win32, //@posix) and the
// POSIX paths of the Linux webview; R-6 plan() with the linux platform changes only
// CC-HELP, CC-REVEAL and CC-READIMG; R-7..R-9 the Linux host snippets on real
// files: caps without the Windows apps, read_image on POSIX paths (100 MB ceiling
// kept), reveal in VS Code's Explorer and the notification for a path outside the
// workspace, each with fixed names and with the names plan() derives from the fixture. vscode and child_process are stubs: nothing is launched.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { loadFixtures, skipWithoutFixtures } from "./lib/fixtures.mjs";
import { withSandbox } from "./lib/sandbox.mjs";
import { loadPart, runPlan, build, parseWebview, parseHost, tempDir } from "./lib/b-harness.mjs";
import { helpersText, pickVariant, variantOf, PLATFORM_VARIANTS } from "../parts/chat-media.mjs";
import { helpersText as filesText } from "../parts/chat-files.mjs";
import { hostSnippets, H2_ORDER, PLATFORMS } from "../assets/host-snippets.mjs";

const fx = loadFixtures();
const noFx = skipWithoutFixtures(fx);
const NAMES = { jsx: "__tJsx", jsxs: "__tJsxs", useRef: "__tUseRef", useEffect: "__tUseEffect",
  useState: "__tUseState", useCallback: "__tUseCallback", urlFilter: "__tUrlFilter", copyButton: "__tCopy", css: "__tCss" };
const LINUX_CAPS = ["open", "reveal", "read_image"];
const ASSET = fs.readFileSync(new URL("../assets/webview-helpers.js", import.meta.url), "utf8");

// ---- R-1, R-2: where the engine looks ----------------------------------------------
/** Put the fixture bundles into <home>/<rel> (an installation folder), when not there yet. */
function install(sb, ...rel) {
  const dir = path.join(sb.dir, ...rel);
  if (!fs.existsSync(path.join(dir, "extension.js"))) {
    fs.mkdirSync(path.join(dir, "webview"), { recursive: true });
    fs.writeFileSync(path.join(dir, "webview", "index.js"), fx.read("index.js.orig"));
    fs.writeFileSync(path.join(dir, "extension.js"), fx.read("extension.js"));
  }
  return dir;
}
const layout = (sb) => ({
  linux: install(sb, ".vscode-server", "extensions", `anthropic.claude-code-${fx.version}-linux-x64`),
  decoy: install(sb, ".vscode-server", "extensions", `anthropic.claude-code-${fx.version}-win32-x64`),
  win: install(sb, ".vscode", "extensions", `anthropic.claude-code-${fx.version}-win32-x64`),
});
const read = (dir, target) => fs.readFileSync(path.join(dir, ...(target === "host" ? ["extension.js"] : ["webview", "index.js"])), "utf8");

test("R-1 Linux: only the -linux- installations under ~/.vscode-server/extensions; the build is the Linux variant and parses", { skip: noFx }, () =>
  withSandbox({ enabled: ["context-meter", "chat-media", "chat-mark", "chat-files"] }, async (sb) => {
    const L = layout(sb);
    const where = await sb.run(["--where"], { platform: "linux" });
    assert.equal(where.code, 0, where.out + where.err);
    assert.ok(where.out.includes(`root:     ${path.join(sb.dir, ".vscode-server", "extensions")}`), where.out);
    assert.ok(where.out.includes(`install:  ${L.linux}`), where.out);
    assert.ok(!where.out.includes(L.decoy) && !where.out.includes(L.win), "a win32 build or the Windows folder on Linux");
    const verify = await sb.run(["--verify"], { platform: "linux" });
    assert.equal(verify.code, 0, verify.out);
    for (const id of ["context-meter", "chat-media", "chat-mark", "chat-files"]) assert.match(verify.out, new RegExp(`^  ${id}: SAFE TO PATCH$`, "m"));
    const r = await sb.run([], { platform: "linux" });
    assert.equal(r.code, 0, r.out);
    const [web, host] = [read(L.linux, "webview"), read(L.linux, "host")];
    assert.ok(web.includes('if(/^\\/[^\\/\\s<>"|?*]+\\/[^\\r\\n<>"|?*]*$/.test(p))return p'), "the POSIX __ccPathOf");
    assert.ok(host.includes('executeCommand("revealInExplorer",__ccU)') && host.includes("/^\\/(?!\\/)[^\\0]*$/.test(__ccP)"), "the Linux reveal and read_image");
    assert.ok(!host.includes('spawn("explorer.exe",[\'"\'+__ccQ'), "no explorer.exe in the Linux reveal");
    parseWebview(web);
    parseHost(host);
    assert.equal(read(L.decoy, "webview"), fx.read("index.js.orig"), "the win32 folder under .vscode-server is not touched");
    assert.equal(read(L.win, "webview"), fx.read("index.js.orig"), "the Windows folder is not touched on Linux");
    // --install-hook records this node and this engine, as on Windows.
    assert.equal((await sb.run(["--install-hook"], { platform: "linux" })).code, 0);
    const entry = JSON.parse(fs.readFileSync(sb.statePath("settings.json"), "utf8")).hooks.SessionStart[0].hooks[0];
    assert.deepEqual([entry.command, entry.args.at(-1)], [process.execPath, "--ensure"]);
  }));

test("R-2 Windows: only ~/.vscode/extensions, every anthropic.claude-code-* folder; .vscode-server is never looked at", { skip: noFx }, () =>
  withSandbox({ enabled: ["chat-media"] }, async (sb) => {
    const L = layout(sb);
    const where = await sb.run(["--where"], { platform: "win32" });
    assert.equal(where.code, 0, where.out + where.err);
    assert.ok(where.out.includes(`install:  ${L.win}`), where.out);
    assert.ok(!where.out.includes(".vscode-server"), where.out);
    assert.equal((await sb.run([], { platform: "win32" })).code, 0);
    const host = read(L.win, "host");
    assert.ok(host.includes('spawn("explorer.exe"') && !host.includes("__ccV.workspace.getWorkspaceFolder(__ccU)"), "the Windows reveal");
    assert.equal(read(L.linux, "host"), fx.read("extension.js"), "the Linux folder is not touched on Windows");
    const dar = await sb.run(["--where"], { platform: "darwin" });
    assert.equal(dar.code, 1);
    assert.match(dar.err, /^Windows and Linux only for now: .*, and this is darwin\.$/);
  }));

test("R-10 Linux: no installation names the desktop limit; --install-hook with VS Code Server's own node warns and installs", () =>
  withSandbox({ set: "two" }, async (sb) => {
    const server = path.join(sb.dir, ".vscode-server");
    fs.rmSync(server, { recursive: true, force: true }); // on a Linux host the sandbox installs there
    const where = await sb.run(["--where"], { platform: "linux" });
    assert.equal(where.code, 1);
    assert.match(where.out, /^no Claude Code installation under .*\(Linux: only the Remote-SSH server copy is patched, not desktop VS Code\)$/m);
    const own = path.join(server, "bin", "0123abcd", "node");
    fs.mkdirSync(path.dirname(own), { recursive: true });
    fs.writeFileSync(own, "");
    const hook = () => JSON.parse(fs.readFileSync(sb.statePath("settings.json"), "utf8")).hooks.SessionStart[0].hooks[0].command;
    const h = await sb.run(["--install-hook"], { platform: "linux", execPath: own });
    assert.equal(h.code, 0, h.out + h.err);
    assert.match(h.out, /warning: .*0123abcd.node is VS Code Server's own node: .*--install-hook again/);
    assert.equal(hook(), own, "recorded anyway: a warning, not a refusal");
    const plain = await sb.run(["--install-hook"], { platform: "linux" });
    assert.doesNotMatch(plain.out, /VS Code Server's own node/);
    assert.equal(hook(), process.execPath);
  }));

// ---- R-3: the asset variants --------------------------------------------------------
test("R-3 variants: //@win32 and //@posix blocks, the else form, the errors; Windows text = the asset without //@posix blocks", () => {
  const L = (s) => s.split("\n");
  assert.deepEqual(pickVariant(L("a\n//@win32\nw\n//@posix\np\n//@end\nb"), "win32"), ["a", "w", "b"]);
  assert.deepEqual(pickVariant(L("a\n//@win32\nw\n//@posix\np\n//@end\nb"), "posix"), ["a", "p", "b"]);
  assert.deepEqual(pickVariant(L("a\n  //@posix  \np\n//@end"), "win32"), ["a"]);
  for (const bad of ["//@end", "//@win32\n//@win32\n//@end", "//@posix\nx", "//@posix\n//@end\n//@end"]) {
    assert.throws(() => pickVariant(L(bad), "win32"), TypeError, bad);
  }
  assert.deepEqual(PLATFORM_VARIANTS, { win32: "win32", linux: "posix" });
  assert.deepEqual(PLATFORMS, ["win32", "linux"]);
  for (const bad of ["darwin", "", null]) assert.throws(() => variantOf(bad), TypeError, String(bad));
  assert.throws(() => hostSnippets({ req: "p", uri: "W", path: "z", platform: "darwin" }), TypeError);
  assert.equal(helpersText(NAMES), helpersText(NAMES, "en", "win32"), "no platform = Windows");
  assert.notEqual(helpersText(NAMES, "en", "linux"), helpersText(NAMES));
  // The Windows text is exactly the asset without the //@posix blocks: the build of every earlier version.
  const noPosix = ASSET.replace(/^\/\/@posix\n[\s\S]*?^\/\/@end\n/gm, "");
  const asOld = noPosix.split(/\r?\n/).filter((l) => l.trim() !== "" && !/^\s*\/\//.test(l)).map((l) => l.trim()).join("\n");
  let names = asOld;
  for (const [k, v] of Object.entries({ jsx: "__CC_JSX__", jsxs: "__CC_JSXS__", useRef: "__CC_USEREF__", useEffect: "__CC_USEEFFECT__",
    useState: "__CC_USESTATE__", useCallback: "__CC_USECALLBACK__", urlFilter: "__CC_URLFILTER__", copyButton: "__CC_COPY__", css: "__CC_CSS__" })) {
    names = names.split(v).join(NAMES[k]);
  }
  assert.equal(helpersText(NAMES), names.split("__CC_LANG__").join("en") + "\n");
  const s = hostSnippets({ req: "p", uri: "W", path: "z" }), w = hostSnippets({ req: "p", uri: "W", path: "z", platform: "win32" });
  const l = hostSnippets({ req: "p", uri: "W", path: "z", platform: "linux" });
  assert.deepEqual(s, w, "no platform = Windows");
  assert.deepEqual(Object.keys(l).filter((k) => l[k] !== s[k]).sort(), ["readimg", "reveal"], "Linux differs in reveal and read_image only");
});

// ---- R-4, R-5: the Linux webview ----------------------------------------------------
function webviewWith(platform) {
  const sb = {
    __tJsx: (type, props, key) => ({ type, props, key }), __tJsxs: (type, props, key) => ({ type, props, key }),
    __tUseRef: (v) => ({ current: v }), __tUseEffect: () => {}, __tUseState: (v) => [v, () => {}], __tUseCallback: (f) => f,
    __tUrlFilter: (u) => "FILTERED:" + u, __tCopy: function CopyButton() {}, __tCss: { codeBlockWrapper: "w", copyButton: "c" },
    __ccCtx: { comms: { connection: { value: null } } },
  };
  vm.createContext(sb);
  vm.runInContext(helpersText(NAMES, "en", platform), sb);
  vm.runInContext(filesText("en"), sb);
  return sb;
}

test("R-4 Linux webview: absolute POSIX paths alone in a block are paths; a slash command, // and a lone /word are not; drive paths still are", () => {
  const sb = webviewWith("linux");
  const ok = [
    ["/srv/app/shots/a.png", "/srv/app/shots/a.png"], ["/data/app/x y/z.png", "/data/app/x y/z.png"], ["/home/user/", "/home/user/"],
    ["/mnt/d/a", "/mnt/d/a"], ["  /srv/a.png\n", "/srv/a.png"], ["/opt/x:y/b.txt", "/opt/x:y/b.txt"],
    ["C:/a/b", "C:\\a\\b"], ["C:\\a\\b.png", "C:\\a\\b.png"],
  ];
  for (const [i, o] of ok) assert.equal(sb.__ccPathOf(i), o, i);
  for (const bad of ["/restart", "/usage", "/srv", "//server/share/a.png", "/a\n/b/c", "/a|b/c", "srv/a.png",
    "/restart foo/bar", "/*CC-RUN*/", "/a b/c", "~/a/b", "./a/b", 7]) {
    assert.equal(sb.__ccPathOf(bad), null, String(bad));
  }
  assert.equal(webviewWith("win32").__ccPathOf("/srv/app/a.png"), null, "the Windows build keeps drive paths only");
  const kinds = { "/srv/a.png": "image", "/srv/a/": "folder", "/srv/app/x.PSD": "psd", "/home/user/.claude": "folder", "/srv/a.md": "file", "/srv/a.pdf": "noeditor" };
  for (const [p, k] of Object.entries(kinds)) assert.equal(sb.__ccKind(p), k, p);
  const card = sb.__ccCodeBar(["/srv/app/shots/a.png\n"]);
  assert.deepEqual([card.props.path, card.props.kind], ["/srv/app/shots/a.png", "image"]);
  assert.equal(sb.__ccCodeBar(["/restart\n"]), null);
});

test("R-5 Linux webview: links and images to /abs and file:///abs paths, the files panel, the buttons a Linux host allows", () => {
  const sb = webviewWith("linux");
  const cases = [
    ["/srv/app/a.png", "/srv/app/a.png"], ["file:///srv/app/a.png", "/srv/app/a.png"], ["/data/app/a%20b.png", "/data/app/a b.png"],
    ["file:///C:/x.png", "C:\\x.png"], ["C:%5Cx%5Cy.md", "C:\\x\\y.md"],
    ["//host/x/y", null], ["file://host/share/a.png", null], ["https://example.com/a.png", null], ["docs/a.md", null], ["/restart", null],
  ];
  for (const [u, p] of cases) assert.equal(sb.__ccDecodeHref(u), p, u);
  assert.equal(sb.__ccUrl("/srv/app/a.png"), "/srv/app/a.png");
  assert.equal(sb.__ccUrl("https://x.y/a"), "FILTERED:https://x.y/a");
  assert.equal(webviewWith("win32").__ccDecodeHref("/srv/app/a.png"), null);
  const img = sb.__ccImg("file:///srv/app/b.png", "alt");
  assert.deepEqual([img.props.path, img.props.kind, img.props.alt], ["/srv/app/b.png", "image", "alt"]);
  const text = "Look:\n```\n/srv/app/shots/a.png\n```\nand [b](/data/app/b.png), also `/srv/inline.png` and\n```\n/usage\n```\n";
  assert.deepEqual(Array.from(sb.__ccFilesText(text)), ["/srv/app/shots/a.png", "/data/app/b.png"]);
  const b = (...a) => Array.from(sb.__ccButtons(...a));
  assert.deepEqual(b("image", LINUX_CAPS, true, "ok"), ["open", "reveal"], "no Default app");
  assert.deepEqual(b("psd", LINUX_CAPS, true, null), ["reveal"], "no Photoshop");
  assert.deepEqual(b("folder", LINUX_CAPS, true, null), ["folder"]);
  assert.deepEqual(b("file", LINUX_CAPS, true, null), ["open", "reveal"]);
});

// ---- R-6: plan() for Linux ---------------------------------------------------------
test("R-6 plan() with platform linux: only CC-HELP, CC-REVEAL and CC-READIMG differ; no platform = win32; both builds parse", { skip: noFx }, async () => {
  const media = await loadPart("chat-media");
  const src = { webview: fx.read("index.js.orig"), host: fx.read("extension.js"), version: fx.version };
  const opts = (platform) => ({ language: "en", buttons: [], ...(platform ? { platform } : {}) });
  const plan = (target, platform) => runPlan(media, target, { ...src, options: opts(platform) });
  for (const target of ["webview", "host"]) {
    const none = plan(target), win = plan(target, "win32"), lin = plan(target, "linux");
    assert.deepEqual(win.edits, none.edits, `${target}: no platform = win32`);
    assert.deepEqual(lin.symbols, win.symbols);
    const differ = lin.edits.filter((e, i) => e.text !== win.edits[i].text).map((e) => e.text.match(/\/\*(CC-[A-Z]+)\*\//)[1]);
    assert.deepEqual(differ.sort(), target === "webview" ? ["CC-HELP"] : ["CC-READIMG", "CC-REVEAL"], target);
    assert.deepEqual(lin.edits.map((e) => e.at), win.edits.map((e) => e.at));
    (target === "webview" ? parseWebview : parseHost)(build(src[target], lin.edits));
  }
  assert.throws(() => plan("host", "darwin"), (e) => e.name === "LayoutError" && /unknown platform/.test(e.message));
});

// ---- R-7..R-9: the Linux host snippets on real files ---------------------------------
// Real files under the OS temp dir, named by POSIX paths. On Windows such a path is
// rooted at the current drive, so the temp dir must be on it; otherwise R-7..R-9 skip.
const ROOT = tempDir("remote");
after(() => fs.rmSync(ROOT, { recursive: true, force: true }));
const posixOf = (p) => (process.platform === "win32" ? p.replace(/^[A-Za-z]:/, "").replace(/\\/g, "/") : p);
const sameDrive = process.platform !== "win32" || ROOT.slice(0, 2).toLowerCase() === process.cwd().slice(0, 2).toLowerCase();
const noDrive = !sameDrive && "the temp dir is not on the current drive: a POSIX path cannot name it here";
const WS = posixOf(path.join(ROOT, "ws")), OUT = posixOf(path.join(ROOT, "out"));
fs.mkdirSync(path.join(ROOT, "ws", "maps"), { recursive: true });
fs.mkdirSync(path.join(ROOT, "out"));
const PNG_1PX = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
const putFile = (dir, name, data) => { fs.writeFileSync(path.join(ROOT, dir, name), data); return `${dir === "ws" ? WS : OUT}/${name}`; };
const WS_PNG = putFile("ws", "a.png", PNG_1PX), OUT_PNG = putFile("out", "b c.png", PNG_1PX), OUT_TXT = putFile("out", "n.txt", "x");
const BIG = putFile("out", "big.png", "");
fs.truncateSync(path.join(ROOT, "out", "big.png"), 104857601); // sparse: the size is what counts

const AsyncFunction = (async () => {}).constructor;
// The snippets R-7..R-9 run: once with fixed names, and once as plan() derives them for Linux from
// the fixture's own host, so a repair that re-teaches a host anchor is tested on the new names too.
const fixedLinux = hostSnippets({ req: "p", uri: "W", path: "z", platform: "linux" });
const LINUX_VARIANTS = [{ name: "fixed names", req: "p", h2: H2_ORDER.map((k) => fixedLinux[k]) }];
if (fx) {
  const plan = runPlan(await loadPart("chat-media"), "host",
    { webview: fx.read("index.js.orig"), host: fx.read("extension.js"), version: fx.version, options: { language: "en", buttons: [], platform: "linux" } });
  const pick = (marker) => plan.edits.find((e) => e.text.includes(`/*${marker}*/`)).text;
  LINUX_VARIANTS.push({ name: `plan() on ${fx.version}, request ${plan.symbols.request}`, req: plan.symbols.request,
    h2: ["CC-CAPS", "CC-REVEAL", "CC-READIMG", "CC-PHOTOS", "CC-PS"].map(pick) });
} else {
  test("R-7..R-9 on the Linux inserts plan() returned", { skip: noFx }, () => {});
}

function linuxStand({ choice, v = LINUX_VARIANTS[0] } = {}) {
  const log = [], fsCalls = [];
  const uri = (p) => ({ scheme: "file", fsPath: p });
  const vscode = {
    Uri: { file: uri },
    workspace: { getWorkspaceFolder: (u) => (u.fsPath === WS || u.fsPath.startsWith(WS + "/") ? { uri: uri(WS), name: "ws", index: 0 } : undefined) },
    commands: { executeCommand: async (...a) => { log.push(["executeCommand", ...a]); } },
    window: { showInformationMessage: (...a) => { log.push(["showInformationMessage", ...a]); return Promise.resolve(choice); } },
    env: { clipboard: { writeText: async (t) => { log.push(["clipboard", t]); } }, openExternal: async (u) => { log.push(["openExternal", u]); } },
  };
  const fsRec = new Proxy(fs, { get(t, k) {
    if (k === "promises") return new Proxy(fs.promises, { get: (pt, pk) => (typeof pt[pk] === "function" ? (...a) => { fsCalls.push(String(pk)); return pt[pk](...a); } : pt[pk]) });
    const v = t[k];
    return typeof v === "function" && /Sync$/.test(String(k)) ? (...a) => { fsCalls.push(String(k)); return v(...a); } : v;
  } });
  const cp = { spawn: () => { throw new Error("nothing may be launched"); }, execFile: () => { throw new Error("nothing may be looked up"); } };
  const req = (m) => ({ vscode, fs: fsRec, path: path.posix, child_process: cp })[m];
  const fn = new AsyncFunction(v.req, "require", "process", v.h2.join("") + 'return "FALLTHROUGH";');
  const proc = { platform: "linux", env: { CC_PHOTOSHOP_EXE: "/opt/ps/Photoshop.exe" } };
  return { log, fsCalls, run: (request) => fn({ request }, req, proc) };
}
const settle = () => new Promise((r) => setImmediate(r));

for (const v of LINUX_VARIANTS) {
  test(`R-7 Linux host: caps name neither Default app nor Photoshop; both app requests refuse without launching [${v.name}]`, { skip: noDrive }, async () => {
    const h = linuxStand({ v });
    assert.deepEqual(await h.run({ type: "cc_host_caps" }), { type: "cc_host_caps_response", v: 1, caps: LINUX_CAPS });
    assert.deepEqual(await h.run({ type: "cc_open_in_photos", path: WS_PNG }), { type: "cc_open_in_photos_response", ok: false, error: "Windows only" });
    assert.deepEqual(await h.run({ type: "cc_open_in_photoshop", path: WS_PNG }), { type: "cc_open_in_photoshop_response", ok: false, error: "Windows only" });
    assert.deepEqual([h.log, h.fsCalls], [[], []]);
    assert.equal(await h.run({ type: "get_current_selection" }), "FALLTHROUGH");
  });

  test(`R-8 Linux host: read_image reads POSIX paths on the server, keeps the 100 MB ceiling, refuses drive and relative paths before stat [${v.name}]`, { skip: noDrive }, async () => {
    const h = linuxStand({ v });
    for (const p of [WS_PNG, OUT_PNG]) {
      const r = await h.run({ type: "cc_read_image", path: p });
      assert.equal(r.ok, true, p);
      assert.equal(r.dataUrl, "data:image/png;base64," + PNG_1PX.toString("base64"));
      assert.deepEqual((await h.run({ type: "cc_read_image", path: p, knownMtimeMs: r.mtimeMs })).notModified, true);
    }
    h.fsCalls.length = 0;
    assert.deepEqual(await h.run({ type: "cc_read_image", path: BIG }), { type: "cc_read_image_response", ok: false, error: "too large", size: 104857601 });
    assert.ok(!h.fsCalls.includes("readFile"), "a file over 100 MB is not read");
    h.fsCalls.length = 0;
    for (const p of ["C:\\x\\a.png", "C:/x/a.png", "a.png", "//srv/a.png", OUT_TXT, WS_PNG + "\0.png"]) {
      assert.deepEqual(await h.run({ type: "cc_read_image", path: p }), { type: "cc_read_image_response", ok: false, error: "unsupported path" }, p);
    }
    assert.deepEqual(h.fsCalls, [], "no stat for a refused path");
    const missing = await h.run({ type: "cc_read_image", path: `${OUT}/nope.png` });
    assert.match(missing.error, /^ENOENT/);
    assert.deepEqual(h.log, []);
  });

  test(`R-9 Linux host: reveal selects in VS Code's Explorer inside the workspace; outside it offers Copy path / Open folder in new window [${v.name}]`, { skip: noDrive }, async () => {
    let h = linuxStand({ v });
    const OK = { type: "cc_reveal_in_os_response", ok: true };
    for (const [p, mode] of [[WS_PNG, "select"], [WS_PNG, "open"], [`${WS}/maps`, "open"], [WS, "select"]]) {
      h.log.length = 0;
      assert.deepEqual(await h.run({ type: "cc_reveal_in_os", path: p, mode }), OK, `${p} ${mode}`);
      assert.deepEqual(h.log, [["executeCommand", "revealInExplorer", { scheme: "file", fsPath: p }]], `${p} ${mode}`);
    }
    // Outside the workspace: a notification, nothing else until a click.
    h.log.length = 0;
    assert.deepEqual(await h.run({ type: "cc_reveal_in_os", path: OUT_PNG, mode: "select" }), { ...OK, outside: true });
    await settle();
    assert.deepEqual(h.log.map((l) => l.slice(0, 1).concat(l.slice(2))), [["showInformationMessage", "Copy path", "Open folder in new window"]]);
    assert.ok(h.log[0][1].startsWith(OUT_PNG + " is outside the folders of this window"), h.log[0][1]);
    h = linuxStand({ choice: "Copy path", v });
    await h.run({ type: "cc_reveal_in_os", path: OUT_PNG, mode: "select" });
    await settle();
    assert.deepEqual(h.log.at(-1), ["clipboard", OUT_PNG]);
    h = linuxStand({ choice: "Open folder in new window", v });
    await h.run({ type: "cc_reveal_in_os", path: OUT_PNG, mode: "select" });
    await h.run({ type: "cc_reveal_in_os", path: OUT, mode: "open" });
    await settle();
    assert.deepEqual(h.log.filter((l) => l[0] === "executeCommand"), [
      ["executeCommand", "vscode.openFolder", { scheme: "file", fsPath: OUT }, { forceNewWindow: true }],
      ["executeCommand", "vscode.openFolder", { scheme: "file", fsPath: OUT }, { forceNewWindow: true }],
    ], "a file opens its folder, a folder itself");
    // Refusals: no stat for a path that is not absolute POSIX; a missing one says ENOENT.
    h = linuxStand({ v });
    for (const p of ["C:\\x", "x/y", "//srv/x", ""]) {
      assert.deepEqual(await h.run({ type: "cc_reveal_in_os", path: p, mode: "open" }),
        { type: "cc_reveal_in_os_response", ok: false, error: "path must be absolute" }, p);
    }
    assert.deepEqual(h.fsCalls, []);
    assert.match((await h.run({ type: "cc_reveal_in_os", path: `${WS}/nope.png`, mode: "select" })).error, /^ENOENT/);
    assert.deepEqual(h.log, []);
  });
}
