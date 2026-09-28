// chat-media: T-M1, T-M2, T-M3 and T-M5, the host capabilities and path refusals, and the
// chat-media side of T-N5, T-N6, T-N10. First phase: plan() runs through the stub
// harness (tests/lib/b-harness.mjs), never through the engine. T-M4 is in
// tests/host-harness.test.mjs.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { loadFixtures, skipWithoutFixtures, skipUnlessReference } from "./lib/fixtures.mjs";
import {
  loadPart, runPlan, planError, contractProblems, markerCounts, MARKERS, build, unbuild, sha1,
  parseWebview, parseHost, nodeCheck, editOnce, editRange, definitionOf, toolbarOf,
} from "./lib/b-harness.mjs";
import { ANCHORS, HOST_RES, PLACEHOLDERS, LANGUAGES, LANG_PLACEHOLDER, helpersText } from "../parts/chat-media.mjs";
import { hostSnippets, H2_ORDER } from "../assets/host-snippets.mjs";
import { matchBracket, makeCtx } from "../lib/layout.mjs";

const fx = loadFixtures();
const media = await loadPart("chat-media");
const icons = await loadPart("chat-icons");
// chat-icons draws only configured buttons: two of them plan 2x CC-SEND + 2 icons.
const ICON_OPTIONS = { language: "en", buttons: [
  { id: "handoff", icon: "export", tooltip: "Hand off", action: { type: "command", command: "/handoff" } },
  { id: "finish", icon: "pass", tooltip: "Finish", action: { type: "send", text: "done" } },
] };
const src = fx ? { webview: fx.read("index.js.orig"), host: fx.read("extension.js"), version: fx.version } : null;
const noFx = skipWithoutFixtures(fx), refOnly = skipUnlessReference(fx);
const plans = src ? { webview: runPlan(media, "webview", src), host: runPlan(media, "host", src) } : null;

// Interface texts as the webview shows them, per language; the helpers default to en.
const TEXT = {
  en: {
    open: "Open", reveal: "Show in folder", folder: "Open folder", photoshop: "Photoshop", photos: "Default app",
    loading: "loading\u2026", missing: "file not found", unavailable: "preview unavailable",
    failed: "could not open: ", close: "Close (Esc)", big: (n) => "too large to preview (" + n + " MB)",
  },
  ru: {
    open: "\u041e\u0442\u043a\u0440\u044b\u0442\u044c", reveal: "\u0412 \u043f\u0430\u043f\u043a\u0435",
    folder: "\u041e\u0442\u043a\u0440\u044b\u0442\u044c \u043f\u0430\u043f\u043a\u0443", photoshop: "Photoshop",
    photos: "\u0424\u043e\u0442\u043e\u0433\u0440\u0430\u0444\u0438\u0438",
    loading: "\u0437\u0430\u0433\u0440\u0443\u0437\u043a\u0430\u2026",
    missing: "\u0444\u0430\u0439\u043b \u043d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d",
    unavailable: "\u043f\u0440\u0435\u0432\u044c\u044e \u043d\u0435\u0434\u043e\u0441\u0442\u0443\u043f\u043d\u043e",
    failed: "\u043d\u0435 \u043e\u0442\u043a\u0440\u044b\u043b\u043e\u0441\u044c: ", close: "\u0417\u0430\u043a\u0440\u044b\u0442\u044c (Esc)",
    big: (n) => "\u0444\u0430\u0439\u043b \u0431\u043e\u043b\u044c\u0448\u043e\u0439 (" + n +
      " \u041c\u0411), \u043f\u043e\u044d\u0442\u043e\u043c\u0443 \u043f\u043e\u043a\u0430 \u0431\u0435\u0437 \u043a\u0430\u0440\u0442\u0438\u043d\u043a\u0438",
  },
};
const TXT = TEXT.en;
const CYR = "C:\\Users\\example\\\u0442\u0435\u0441\u0442 \u043f\u0430\u043f\u043a\u0430\\\u043a\u0430\u0440\u0442\u0438\u043d\u043a\u0430.png";

// ---- T-M1 ----------------------------------------------------------------------
test("T-M1 anchors: every chat-media anchor and host derivation occurs exactly once", { skip: noFx }, () => {
  for (const a of Object.values(ANCHORS)) assert.equal(src.webview.split(a).length - 1, 1, a);
  for (const [k, re] of Object.entries(HOST_RES)) assert.equal([...src.host.matchAll(new RegExp(re, "g"))].length, 1, k);
  assert.deepEqual(contractProblems("chat-media", "webview", src.webview, plans.webview), []);
  assert.deepEqual(contractProblems("chat-media", "host", src.host, plans.host), []);
  assert.deepEqual(plans.webview.requires, []);
});

test("T-M1 names and offsets equal the 2.1.280 reference tables; W2-W6 texts byte for byte", { skip: refOnly }, () => {
  const names = { jsx: "F", jsxs: "R", useRef: "e", useEffect: "o", useState: "p", useCallback: "$0", urlFilter: "$x1" };
  const w = plans.webview;
  assert.deepEqual(w.edits.map((e) => [e.at, e.text]), [
    [3683376, "/*CC-HELP*/" + helpersText(names)],
    [3682283, "/*CC-CTX*/if(J)globalThis.__ccCtx=J;"],
    [3682462, "/*CC-URL*/urlTransform:__ccUrl,"],
    [3683252, "/*CC-LINK*/if(__ccLink($,J,Z))return;"],
    [3683031, "/*CC-MDIMG*/{let __ccR=__ccImg(q,U);if(__ccR)return __ccR}"],
    [3683571, ",/*CC-CODE*/__ccCodeBar($)"],
  ]);
  assert.deepEqual(w.symbols, { ...names, markdownComponent: "H$", context: "J", markdown: "e71", link: "Jy0", codeBlock: "Zy0" });
  assert.equal(src.webview.indexOf(ANCHORS.code) + ANCHORS.code.length - 1, 3683472);
  assert.equal(matchBracket(src.webview, 3683472), 3683571);
  const s = hostSnippets({ req: "$", uri: "W", path: "z" });
  assert.deepEqual(plans.host.edits.map((e) => [e.at, e.text]),
    [...H2_ORDER.map((k) => [3470874, s[k]]), [3479274, s.open]]);
  assert.deepEqual(plans.host.symbols, { request: "$", uri: "W", path: "z" });
});

// ---- T-M2, T-M3 ----------------------------------------------------------------
test("T-M2 trial builds compile: webview plain and strict, host in the CJS wrapper and node --check", { skip: noFx }, () => {
  const webview = build(src.webview, [...plans.webview.edits, ...runPlan(icons, "webview", { ...src, options: ICON_OPTIONS }).edits]);
  const host = build(src.host, plans.host.edits);
  assert.deepEqual(markerCounts(host), MARKERS["chat-media"].host);
  parseWebview(webview);
  parseHost(host);
  assert.deepEqual(nodeCheck(host), { status: 0, stderr: "" });
  // Negative control: the same checks see a broken host insert.
  const broken = build(src.host, [...plans.host.edits, { at: plans.host.edits[0].at, text: "/*CC-X*/if(" }]);
  assert.throws(() => parseHost(broken), SyntaxError);
  assert.notEqual(nodeCheck(broken).status, 0);
});

test("T-M3 pure insertion: cutting the inserts out gives back the pristine sha1 of both targets", { skip: noFx }, () => {
  for (const target of ["webview", "host"]) {
    const built = build(src[target], plans[target].edits);
    assert.equal(built.length, src[target].length + plans[target].edits.reduce((n, e) => n + e.text.length, 0));
    assert.equal(sha1(unbuild(built, plans[target].edits)), sha1(src[target]), target);
  }
});

// ---- T-M5: the CC-HELP block in vm with React stubs ---------------------------------
const NAMES = { jsx: "__tJsx", jsxs: "__tJsxs", useRef: "__tUseRef", useEffect: "__tUseEffect",
  useState: "__tUseState", useCallback: "__tUseCallback", urlFilter: "__tUrlFilter" };
const HELP = helpersText(NAMES);
const tick = () => new Promise((r) => setImmediate(r));
const flush = async () => { for (let i = 0; i < 10; i++) await tick(); };

/** A chat window: the helpers in a vm context, a recording connection, a manual clock. */
function newWindow({ connected = true, language = "en" } = {}) {
  const clock = { now: 1e6, seq: 0, timers: [] };
  const sent = [];
  const connection = { sendRequest: (req) => new Promise((resolve, reject) => sent.push({ req, resolve, reject })) };
  const sb = {
    Date: { now: () => clock.now },
    setTimeout: (fn, ms) => { clock.timers.push({ id: ++clock.seq, at: clock.now + ms, fn }); return clock.seq; },
    clearTimeout: (id) => { clock.timers = clock.timers.filter((t) => t.id !== id); },
    __tJsx: (type, props, key) => ({ type, props, key }),
    __tJsxs: (type, props, key) => ({ type, props, key }),
    __tUseRef: (v) => ({ current: v }), __tUseEffect: () => {}, __tUseState: (v) => [v, () => {}], __tUseCallback: (f) => f,
    __tUrlFilter: (u) => "FILTERED:" + u,
    __ccCtx: connected ? { comms: { connection: { value: connection } } } : { comms: { connection: { value: null } } },
  };
  vm.createContext(sb);
  vm.runInContext(language === "en" ? HELP : helpersText(NAMES, language), sb);
  sb.__ccThumb = async (u) => "thumb:" + u;
  const advance = async (ms) => {
    clock.now += ms;
    for (let due; (due = clock.timers.filter((t) => t.at <= clock.now).sort((a, b) => a.at - b.at)[0]);) {
      clock.timers = clock.timers.filter((t) => t !== due);
      due.fn();
      await flush();
    }
    await flush();
  };
  const types = () => sent.map((s) => s.req.type);
  return { sb, sent, clock, advance, types, connection };
}

/**
 * A minimal React for __ccCard in window w: hooks by call order, effects
 * after each render (the old one cleaned up when its deps change), setState marks
 * the card for a re-render, the root's ref gets a node, a fake IntersectionObserver.
 */
function cardRuntime(w) {
  const cards = [], observers = [];
  let cur = null, at = 0;
  const slot = (init) => { const k = at++; if (!(k in cur.hooks)) cur.hooks[k] = init(); return cur.hooks[k]; };
  Object.assign(w.sb, {
    __tUseState: (v) => { const h = slot(() => ({ v })), card = cur; return [h.v, (f) => { h.v = typeof f === "function" ? f(h.v) : f; card.dirty = true; }]; },
    __tUseRef: (v) => slot(() => ({ current: v })),
    __tUseEffect: (fn, deps) => { const h = slot(() => ({})); if (!h.deps || deps.some((d, j) => d !== h.deps[j])) { h.deps = deps; h.run = fn; } },
    IntersectionObserver: class { constructor(cb) { this.cb = cb; this.live = true; observers.push(this); } observe(el) { this.el = el; } disconnect() { this.live = false; } },
  });
  w.sb.__ccCtx.fileOpener = { open() {} };
  const render = (card) => {
    cur = card; at = 0; card.dirty = false;
    card.el = w.sb.__ccCard(card.props);
    cur = null;
    if (card.el && card.el.props.ref) card.el.props.ref.current = card.node;
    for (const h of card.hooks) if (h.run) { const fn = h.run; h.run = null; if (h.cleanup) h.cleanup(); h.cleanup = fn() || null; }
  };
  return {
    mount(path) { const card = { props: { path, kind: w.sb.__ccKind(path) }, hooks: [], node: { path } }; cards.push(card); render(card); return card; },
    unmount(card) { for (const h of card.hooks) if (h.cleanup) h.cleanup(); cards.splice(cards.indexOf(card), 1); },
    see(card) { for (const o of observers) if (o.live && o.el === card.node) o.cb([{ isIntersecting: true, target: o.el }]); },
    async settle() { await flush(); for (let i = 0; i < 5 && cards.some((c) => c.dirty); i++) for (const c of cards) if (c.dirty) render(c); },
    text: (card) => shown(card.el),
  };
}
/** What a rendered card shows: text, [button], img:<src>; parts joined by |. */
const shown = (el) => el == null || el === false ? "" : typeof el !== "object" ? String(el)
  : Array.isArray(el) ? el.map(shown).filter(Boolean).join("|")
  : el.type === "img" ? "img:" + el.props.src
  : el.type === "button" ? "[" + shown(el.props.children) + "]" : shown(el.props.children);
const btns = (...keys) => keys.map((k) => "[" + TXT[k] + "]").join("|");
const ALL_CAPS = ["open", "reveal", "read_image", "photos", "photoshop"];
const THUMB = "[img:thumb:data:image/png;base64,AA]";
// A promise that never settles must fail its test, not hang the file (node --test has no default timeout).
const T20 = { timeout: 20000 };
const okImage = (mtimeMs = 5) => ({ type: "cc_read_image_response", ok: true, dataUrl: "data:image/png;base64,AA", size: 2, mtimeMs });

test("T-M5 CC-HELP: only top-level __cc function declarations; placeholders only in the body of __ccB", () => {
  const raw = helpersText(Object.fromEntries(Object.keys(PLACEHOLDERS).map((k) => [k, "__never_defined_" + k])));
  const sb = vm.createContext({});
  vm.runInContext(raw, sb); // nothing may run at load time: the bundle names are not there yet
  const names = Object.keys(sb);
  assert.ok(names.length > 20);
  for (const n of names) {
    assert.match(n, /^__cc[A-Z]\w*$/, n);
    assert.equal(typeof sb[n], "function", n);
    assert.ok(!["__ccRun", "__ccCan", "__ccBtnWindow", "__ccSendText", "__ccR", "__ccT"].includes(n), n);
  }
  const text = helpersText(Object.fromEntries(Object.entries(PLACEHOLDERS).map(([k, v]) => [k, v])));
  const start = text.indexOf("function __ccB(){");
  assert.equal(text.split("function __ccB(").length - 1, 1);
  const bodyStart = start + "function __ccB()".length;
  const bodyEnd = matchBracket(text, bodyStart);
  for (const m of text.matchAll(/__CC_[A-Z]+__/g)) {
    assert.ok(m.index > bodyStart && m.index < bodyEnd, `${m[0]} outside the body of __ccB`);
  }
  assert.equal([...text.matchAll(/__CC_[A-Z]+__/g)].length, Object.keys(PLACEHOLDERS).length);
  assert.match(text.slice(bodyStart, bodyEnd + 1), /^\{return\{[\w:,]+\}\}$/, "__ccB declares nothing");
  assert.equal(/[^\x00-\x7e]/.test(HELP), false, "non-ASCII only as \\u escapes");
  assert.equal(/\/\*/.test(HELP), false, "no block comments: nothing that could look like a marker");
});

test("T-M5 __ccPathOf and __ccKind", () => {
  const { sb } = newWindow();
  const ok = [["C:\\a\\b.png", "C:\\a\\b.png"], ["C:/a/b", "C:\\a\\b"], ["C:\\", "C:\\"], ["  d:\\x y\\z.md\n", "d:\\x y\\z.md"]];
  for (const [i, o] of ok) assert.equal(sb.__ccPathOf(i), o, i);
  for (const bad of ["C:\\a\nC:\\b", "a\\b.png", "C:\\a|b.png", "https://x.com/a.png", "\\\\server\\share\\a.png", "C:x.png", 7]) {
    assert.equal(sb.__ccPathOf(bad), null, String(bad));
  }
  const kinds = {
    image: ["a.png", "a.JPG", "a.jpeg", "a.webp", "a.gif", "a.bmp"], psd: ["a.psd", "a.PSB"],
    folder: ["C:\\a\\", "C:\\a/", "C:\\a\\b", "C:\\Users\\example\\.claude", "C:\\x\\..", "C:\\"],
    noeditor: "pdf doc docx xls xlsx ppt pptx zip 7z rar exe dll msi tif tiff heic heif mp3 wav".split(" ").map((e) => "a." + e),
    file: ["a.md", "a.svg", "a.txt", "C:\\x\\.env.local"],
  };
  for (const [kind, list] of Object.entries(kinds)) {
    for (const p of list) assert.equal(sb.__ccKind(p.includes("\\") ? p : "C:\\x\\" + p), kind, p);
  }
});

test("T-M5 __ccButtons: capability gates every button, a large image keeps all three", () => {
  const { sb } = newWindow();
  const all = ["open", "reveal", "read_image", "photos", "photoshop"];
  const b = (...a) => Array.from(sb.__ccButtons(...a));
  assert.deepEqual(b("image", all, true, "ok"), ["open", "photos", "reveal"]);
  assert.deepEqual(b("image", all, true, "large"), ["open", "photos", "reveal"]);
  assert.deepEqual(b("image", all, false, "large"), ["photos", "reveal"]);
  assert.deepEqual(b("image", ["reveal", "photos"], true, null), ["photos", "reveal"]);
  assert.deepEqual(b("image", [], true, null), []);
  assert.deepEqual(b("psd", all, true, null), ["photoshop", "reveal"]);
  assert.deepEqual(b("psd", ["reveal"], true, null), ["reveal"]);
  const noApps = ["open", "reveal", "read_image"]; // a host without Photoshop, or not on Windows
  assert.deepEqual(b("psd", noApps, true, null), ["reveal"]);
  assert.deepEqual(b("image", noApps, true, "ok"), ["open", "reveal"]);
  assert.deepEqual(b("folder", all, true, null), ["folder"]);
  assert.deepEqual(b("folder", ["open"], true, null), []);
  assert.deepEqual(b("noeditor", all, true, null), ["reveal"]);
  assert.deepEqual(b("file", all, true, null), ["open", "reveal"]);
  assert.deepEqual(b("file", [], true, null), ["open"]);
  assert.deepEqual(b("file", all, false, null), ["reveal"]);
});

test("T-M5 __ccMb and the card captions", () => {
  const { sb } = newWindow();
  assert.equal(sb.__ccMb(8388609), 9);
  assert.equal(sb.__ccMb(79691776), 76);
  assert.equal(sb.__ccMb(8388608), 8);
  assert.equal(sb.__ccStatus(null), TXT.loading);
  assert.equal(sb.__ccStatus({ state: "ok", thumb: "t" }), null);
  assert.equal(sb.__ccStatus({ state: "large", size: 8388609 }), TXT.big(9));
  assert.equal(sb.__ccStatus({ state: "missing" }), TXT.missing);
  assert.equal(sb.__ccStatus({ state: "unavailable" }), TXT.unavailable);
});

test("T-M5 __ccDecodeHref: the one gate for addresses", () => {
  const { sb } = newWindow();
  const cases = [
    ["C:%5CUsers%5Cexample%5Ca.png", "C:\\Users\\example\\a.png"],
    [encodeURI(CYR).replace(/\\/g, "%5C"), CYR],
    ["file:///C:/x.png", "C:\\x.png"],
    ["C:%5C50%25off.png", "C:\\50%off.png"],
    ["c:%5cx%5cy.md", "c:\\x\\y.md"],
    ["file://server/share/a.png", null], ["C:%5Ca%7Cb.png", null], ["https://example.com/a.png", null],
    ["javascript:alert(1)", null], ["docs/a.md", null], ["C:%5Cbad%E0.png", null],
  ];
  for (const [u, p] of cases) assert.equal(sb.__ccDecodeHref(u), p, u);
});

test("T-M5 __ccUrl on the output of the bundle's own URL normalizer", { skip: noFx }, () => {
  const wq = bundleNormalizer(src.webview);
  const { sb } = newWindow();
  const paths = ["C:\\Users\\example\\a.png", CYR, "D:\\x\\y.md", "c:\\lower\\z.txt", "C:/fwd/a.png"];
  for (const p of paths) {
    const u = wq(p);
    if (p.includes("\\")) assert.match(u, /%5C/, "the normalizer re-encodes backslashes");
    assert.equal(sb.__ccUrl(u), u, p);
    assert.equal(sb.__ccDecodeHref(u), p.replace(/\//g, "\\"), p);
  }
  for (const u of ["javascript:alert(1)", "data:image/png;base64,AA", "http://example.com/a.png"]) {
    assert.equal(sb.__ccUrl(u), "FILTERED:" + u, u);
  }
});

/** The bundle's mdast URI normalizer (WQ on 2.1.280): the one name called as both href: and src:. */
function bundleNormalizer(bundle) {
  const called = (key) => new Set([...bundle.matchAll(new RegExp(key + ":([\\w$]+)\\(", "g"))].map((m) => m[1]));
  const src = called("src");
  const names = [...called("href")].filter((n) => src.has(n));
  assert.equal(names.length, 1, "href:<normalizer>( and src:<normalizer>( name one function");
  const [name] = names;
  let code = definitionOf(bundle, name);
  for (let i = 0; i < 10; i++) {
    const ctx = vm.createContext({});
    try {
      vm.runInContext(code, ctx);
      ctx[name]("C:\\a b\u0442");
      return (s) => ctx[name](s);
    } catch (e) {
      const missing = /^([\w$]+) is not defined$/.exec(e.message);
      if (!missing) throw e;
      code = definitionOf(bundle, missing[1]) + "\n" + code;
    }
  }
  throw new Error("normalizer dependencies did not resolve");
}

test("T-M5 __ccFit and __ccZoom: the point under the cursor stays, the scale is clamped", () => {
  const { sb } = newWindow();
  assert.deepEqual({ ...sb.__ccFit(1000, 500, 2000, 500) }, { s: 0.5, tx: 0, ty: 125 });
  assert.deepEqual({ ...sb.__ccFit(1000, 1000, 100, 50) }, { s: 1, tx: 450, ty: 475 });
  const v = { s: 1, tx: 10, ty: 20, fit: 0.5 };
  for (const dy of [-100, 100, -1e5, 1e5]) {
    const z = sb.__ccZoom(v, 300, 200, dy);
    assert.ok(Math.abs((300 - z.tx) / z.s - 290) < 1e-9 && Math.abs((200 - z.ty) / z.s - 180) < 1e-9, `dy ${dy}`);
    assert.ok(z.s >= 0.25 && z.s <= 16, `scale ${z.s}`);
  }
  assert.equal(sb.__ccZoom(v, 0, 0, -1e5).s, 16);
  assert.equal(sb.__ccZoom(v, 0, 0, 1e5).s, 0.25);
  assert.ok(Math.abs(sb.__ccZoom(v, 0, 0, -100).s - Math.exp(0.15)) < 1e-12);
});

test("T-M5 __ccReq: timeout and {type:\"error\"} are refusals, no connection sends nothing", T20, async () => {
  const w = newWindow();
  const late = w.sb.__ccReq({ type: "cc_open_in_photos", path: "C:\\a.png" }, 15000);
  await w.advance(15000);
  assert.deepEqual({ ...(await late) }, { ok: false, error: "timeout", why: "timeout" });
  w.sent[0].resolve({ ok: true });
  await flush();
  const host = w.sb.__ccReq({ type: "x" }, 15000);
  w.sent[1].reject(new Error("Unknown request type."));
  assert.deepEqual({ ...(await host) }, { ok: false, error: "Unknown request type.", why: "host" });
  const off = newWindow({ connected: false });
  assert.equal((await off.sb.__ccReq({ type: "x" }, 15000)).why, "noconn");
  assert.equal(off.sent.length, 0);
});

test("T-M5 __ccCaps: a timeout is asked again, {type:\"error\"} is remembered as []", T20, async () => {
  const w = newWindow();
  const a = w.sb.__ccCaps(), b = w.sb.__ccCaps();
  assert.deepEqual(w.types(), ["cc_host_caps"], "one request in flight");
  await w.advance(5000);
  assert.deepEqual(Array.from(await a), []);
  assert.deepEqual(Array.from(await b), []);
  const c = w.sb.__ccCaps();
  assert.equal(w.sent.length, 2, "a timed-out answer is not remembered");
  w.sent[1].reject(new Error("Unknown request type."));
  assert.deepEqual(Array.from(await c), []);
  await w.sb.__ccCaps();
  assert.equal(w.sent.length, 2, "the host's refusal is remembered");
  const w2 = newWindow();
  const d = w2.sb.__ccCaps();
  w2.sent[0].resolve({ type: "cc_host_caps_response", v: 1, caps: ["open", "reveal"] });
  assert.deepEqual(Array.from(await d), ["open", "reveal"]);
  assert.deepEqual(Array.from(await w2.sb.__ccCaps()), ["open", "reveal"]);
  assert.equal(w2.sent.length, 1);
  const w3 = newWindow();
  const closed = w3.sb.__ccCaps();
  w3.sent[0].reject(new Error("Connection closed"));
  assert.deepEqual(Array.from(await closed), []);
  w3.sb.__ccCaps();
  assert.equal(w3.sent.length, 2, "a closed connection is not the host's answer");
  const w4 = newWindow({ connected: false });
  assert.deepEqual(Array.from(await w4.sb.__ccCaps()), []);
  w4.sb.__ccCtx.comms.connection.value = w4.connection;
  w4.sb.__ccCaps();
  assert.equal(w4.sent.length, 1, "no connection is not the host's answer");
});

test("T-M5 capabilities come late: cards load and get buttons", T20, async () => {
  for (const how of ["timeout", "noconn"]) {
    const w = newWindow({ connected: how !== "noconn" }), r = cardRuntime(w);
    const img = r.mount("C:\\x\\a.png"), pdf = r.mount("C:\\x\\doc.pdf"), unseen = r.mount("C:\\x\\b.png");
    r.see(img);
    await r.settle();
    if (how === "timeout") {
      assert.deepEqual(w.types(), ["cc_host_caps"], how + ": one request for all cards");
      await w.advance(5000);
    } else {
      assert.deepEqual(w.types(), [], how);
      w.sb.__ccCtx.comms.connection.value = w.connection;
    }
    await r.settle();
    assert.equal(r.text(img), TXT.loading, how + ": no buttons while the capabilities are unknown");
    assert.equal(r.text(pdf), "", how);
    const before = w.sent.length;
    await w.advance(4999);
    assert.equal(w.sent.length, before, how + ": nothing asked before 5 s");
    await w.advance(1);
    assert.deepEqual(w.types().slice(before), ["cc_host_caps"], how + ": asked again 5 s after the failure");
    w.sent.at(-1).resolve({ type: "cc_host_caps_response", v: 1, caps: ALL_CAPS });
    await r.settle();
    assert.equal(r.text(pdf), btns("reveal"), how + ": a mounted card gets its buttons");
    assert.deepEqual(w.sent.slice(before + 1).map((s) => [s.req.type, s.req.path]), [["cc_read_image", "C:\\x\\a.png"]],
      how + ": the card that has been visible loads its preview, the unseen one does not");
    w.sent.at(-1).resolve(okImage());
    await r.settle();
    assert.equal(r.text(img), THUMB + "|" + btns("open", "photos", "reveal"), how + ": preview and buttons");
    assert.equal(r.text(unseen), TXT.loading + "|" + btns("open", "photos", "reveal"), how);
    await w.advance(600000);
    assert.equal(w.sent.length, before + 2, how + ": nothing more is asked");
  }
});

test("T-M5 card effects: a visible card loads once the capabilities allow it, re-renders on its answers", T20, async () => {
  const w = newWindow(), r = cardRuntime(w);
  const a = r.mount("C:\\x\\a.png");
  w.sent[0].resolve({ type: "cc_host_caps_response", v: 1, caps: ALL_CAPS });
  await r.settle();
  assert.equal(r.text(a), TXT.loading + "|" + btns("open", "photos", "reveal"));
  assert.deepEqual(w.types(), ["cc_host_caps"], "nothing is loaded before the card is visible");
  r.see(a);
  await r.settle();
  assert.deepEqual({ ...w.sent[1].req }, { type: "cc_read_image", path: "C:\\x\\a.png" });
  w.sent[1].resolve(okImage());
  await r.settle();
  assert.equal(r.text(a), THUMB + "|" + btns("open", "photos", "reveal"));
  const m = r.mount("C:\\x\\m.png");
  r.see(m);
  await r.settle();
  w.sent[2].resolve({ ok: false, error: "ENOENT: no such file or directory" });
  await r.settle();
  assert.equal(r.text(m), TXT.missing + "|" + btns("open", "photos", "reveal"));
  await w.advance(2000);
  w.sb.__ccNotify("C:\\x\\a.png");
  w.sb.__ccNotify("C:\\x\\m.png");
  await r.settle();
  assert.deepEqual(w.sent.slice(3).map((s) => s.req.path), ["C:\\x\\m.png"], "a notification reloads a card without a preview, not one with it");
  const bare = newWindow(), rb = cardRuntime(bare);
  const c = rb.mount("C:\\x\\a.png");
  rb.see(c);
  bare.sent[0].resolve({ type: "cc_host_caps_response", v: 1, caps: ["open", "reveal", "photos"] });
  await rb.settle();
  assert.deepEqual(bare.types(), ["cc_host_caps"], "no read_image: no preview request");
  assert.equal(rb.text(c), btns("open", "photos", "reveal"), "no read_image: buttons only");
});

test("T-M5 capabilities asked again 5 s, 15 s, 60 s after failures while a card is mounted, one timer", T20, async () => {
  const w = newWindow(), r = cardRuntime(w);
  const asked = () => w.types().filter((t) => t === "cc_host_caps").length;
  const lone = w.sb.__ccCaps();
  await w.advance(5000);
  await lone;
  assert.equal(w.clock.timers.length, 0, "no card mounted: no timer");
  const folder = r.mount("C:\\x\\");
  assert.equal(asked(), 2, "a new card asks at once");
  await w.advance(5000);
  for (const [gap, n] of [[5000, 3], [15000, 4], [60000, 5]]) {
    assert.equal(w.clock.timers.length, 1, `one pending timer before the ${gap} ms re-ask`);
    await w.advance(gap - 1);
    assert.equal(asked(), n - 1, `not before ${gap} ms`);
    await w.advance(1);
    assert.equal(asked(), n, `asked again ${gap} ms after the failure`);
    await w.advance(5000);
  }
  assert.equal(w.clock.timers.length, 0, "the third re-ask failed: no timer");
  await w.advance(600000);
  assert.equal(asked(), 5);
  const pdf = r.mount("C:\\x\\doc.pdf");
  assert.equal(asked(), 6);
  await w.advance(5000);
  await w.advance(5000);
  assert.equal(asked(), 7, "the next call started a new schedule: 5 s again");
  await w.advance(5000);
  w.sb.__ccCaps();
  assert.equal(asked(), 8);
  assert.equal(w.clock.timers.length, 1, "a call while a re-ask is pending replaces it: only the request's own timeout");
  await w.advance(5000);
  assert.equal(w.clock.timers.length, 1);
  await w.advance(5000);
  assert.equal(asked(), 9, "and starts a new schedule: 5 s again");
  await w.advance(5000);
  r.unmount(folder);
  r.unmount(pdf);
  await w.advance(15000);
  assert.equal(asked(), 9, "no card mounted when the timer fires: nothing asked");
  const img = r.mount("C:\\x\\a.png");
  w.sent.at(-1).resolve({ type: "cc_host_caps_response", v: 1, caps: ALL_CAPS });
  await r.settle();
  assert.equal(r.text(img), TXT.loading + "|" + btns("open", "photos", "reveal"));
  await w.advance(600000);
  assert.equal(asked(), 10, "the host's answer ends it");
  assert.equal(w.clock.timers.length, 0);
});

test("T-M5 preview loading: two in flight, shared per path, knownMtimeMs, freshness 1 s", T20, async () => {
  const w = newWindow();
  const [a, b, c] = ["C:\\a.png", "C:\\b.png", "C:\\c.png"].map((p) => w.sb.__ccLoadImage(p));
  const b2 = w.sb.__ccLoadImage("C:\\b.png");
  await flush();
  assert.deepEqual(w.sent.map((s) => s.req.path), ["C:\\a.png", "C:\\b.png"], "two in flight, one per path");
  w.sent[0].resolve(okImage(77));
  assert.equal((await a).thumb, "thumb:data:image/png;base64,AA");
  await flush();
  assert.equal(w.sent.length, 3, "the third leaves after the first answer");
  assert.equal(w.sent[2].req.path, "C:\\c.png");
  w.sent[1].resolve(okImage());
  w.sent[2].resolve(okImage());
  assert.equal(await b, await b2);
  await c;
  await w.advance(500);
  await w.sb.__ccLoadImage("C:\\a.png");
  assert.equal(w.sent.length, 3, "answered 0.5 s ago: no request");
  await w.advance(1000);
  const again = w.sb.__ccLoadImage("C:\\a.png");
  await flush();
  assert.equal(w.sent.length, 4, "answered 1.5 s ago: asked again");
  assert.deepEqual({ ...w.sent[3].req }, { type: "cc_read_image", path: "C:\\a.png", knownMtimeMs: 77 });
  w.sent[3].resolve({ type: "cc_read_image_response", ok: true, notModified: true, size: 2, mtimeMs: 77 });
  const e = await again;
  assert.equal(e.state, "ok");
  assert.equal(e.thumb, "thumb:data:image/png;base64,AA", "notModified keeps the cached thumbnail");
});

test("T-M5 preview answers map to the card states", T20, async () => {
  const w = newWindow();
  const load = async (p, answer) => {
    const job = w.sb.__ccLoadImage(p);
    await flush();
    answer(w.sent.at(-1));
    return w.sb.__ccStatus(await job);
  };
  assert.equal(await load("C:\\1.png", (s) => s.resolve({ ok: false, error: "ENOENT: no such file or directory, stat 'C:\\1.png'" })), TXT.missing);
  assert.equal(await load("C:\\2.png", (s) => s.resolve({ ok: false, error: "EACCES: permission denied" })), TXT.unavailable);
  assert.equal(await load("C:\\3.png", (s) => s.resolve({ ok: false, error: "too large", size: 79691776 })), TXT.big(76));
  assert.equal(await load("C:\\4.png", (s) => s.reject(new Error("Unknown request type."))), TXT.unavailable);
  w.sb.__ccThumb = async () => null;
  assert.equal(await load("C:\\5.png", (s) => s.resolve(okImage())), TXT.unavailable);
  const timed = w.sb.__ccLoadImage("C:\\6.png");
  await flush();
  await w.advance(15000);
  assert.equal(w.sb.__ccStatus(await timed), TXT.unavailable);
  const off = newWindow({ connected: false });
  assert.equal(off.sb.__ccStatus(await off.sb.__ccLoadImage("C:\\7.png")), TXT.unavailable);
  assert.equal(off.sent.length, 0);
});

test("T-M5 preview cache: at most 200 paths, the least recently used goes first", T20, async () => {
  const w = newWindow();
  const answerAll = async () => { await flush(); for (const s of w.sent.splice(0)) s.resolve(okImage()); await flush(); };
  for (let i = 0; i < 200; i++) { const j = w.sb.__ccLoadImage(`C:\\p${i}.png`); await answerAll(); await j; }
  const cache = w.sb.__ccMedia.cache;
  assert.equal(cache.size, 200);
  await w.sb.__ccLoadImage("C:\\p0.png"); // a use, within 1 s: no request
  const j = w.sb.__ccLoadImage("C:\\p200.png");
  await answerAll();
  await j;
  assert.equal(cache.size, 200);
  assert.ok(cache.has("C:\\p0.png"), "a recently used path stays");
  assert.ok(!cache.has("C:\\p1.png"), "the least recently used path goes");
});

test("T-M5 __ccLink: takes over drive paths synchronously, acts after the capabilities", T20, async () => {
  const w = newWindow();
  const calls = [];
  const ev = () => ({ preventDefault: () => calls.push("pd"), stopPropagation: () => calls.push("sp") });
  const opened = [];
  const opener = { open: (p) => opened.push(p) };
  assert.equal(w.sb.__ccLink(ev(), "C:%5Cx%5Ca.png", opener), true);
  assert.deepEqual(calls, ["pd", "sp"], "before the first await");
  assert.deepEqual(w.types(), ["cc_host_caps"]);
  w.sent[0].resolve({ type: "cc_host_caps_response", v: 1, caps: ["open", "reveal", "read_image", "photos", "photoshop"] });
  await flush();
  assert.deepEqual(opened, ["C:\\x\\a.png"], "an image link opens in VS Code");
  assert.equal(w.sb.__ccLink(ev(), "C:%5Cx%5Cdoc.pdf", null), true);
  await flush();
  assert.deepEqual({ ...w.sent[1].req }, { type: "cc_reveal_in_os", mode: "select", path: "C:\\x\\doc.pdf" });
  assert.equal(w.sb.__ccLink(ev(), "file:///C:/x/notes.md", null), true);
  await flush();
  assert.equal(w.sent.length, 2, "a plain file without a fileOpener has no action");
  calls.length = 0;
  for (const href of ["docs/a.md", "https://example.com/", "#top"]) assert.equal(w.sb.__ccLink(ev(), href, opener), false);
  assert.deepEqual(calls, []);
  const bare = newWindow();
  assert.equal(bare.sb.__ccLink(ev(), "C:%5Cx%5Cdoc.pdf", opener), true);
  bare.sent[0].reject(new Error("Unknown request type."));
  await flush();
  assert.deepEqual(bare.types(), ["cc_host_caps"], "an unpatched host gets no action");
});

test("T-M5 cards: code block and markdown image build a card; the card renders by state", () => {
  const { sb } = newWindow();
  const code = { type: "code", props: { children: ["C:\\x\\", { type: "b", props: { children: "a.png" } }, "\n"] } };
  const card = sb.__ccCodeBar(code);
  assert.equal(card.type, sb.__ccCard);
  assert.deepEqual({ ...card.props }, { path: "C:\\x\\a.png", kind: "image" });
  assert.equal(sb.__ccCodeBar({ props: { children: "C:\\a.png\nC:\\b.png" } }), null);
  assert.equal(sb.__ccImg("C:%5Cx%5Cb.psd", "alt").props.kind, "psd");
  assert.equal(sb.__ccImg("https://example.com/a.png", "alt"), null);
  const kids = (el) => el.props.children;
  assert.equal(kids(kids(sb.__ccCard({ path: "C:\\a.png", kind: "image" }))[0]), TXT.loading);
  const s = sb.__ccMedia;
  s.caps = ["open", "reveal", "read_image", "photos"];
  sb.__ccCtx.fileOpener = { open() {} };
  s.cache.set("C:\\a.png", { state: "ok", thumb: "T", at: 0 });
  let el = sb.__ccCard({ path: "C:\\a.png", kind: "image" });
  assert.equal(kids(el)[0].type, "button");
  assert.equal(kids(el)[0].props.children.props.src, "T");
  assert.deepEqual(Array.from(kids(kids(el)[1]), (b) => b.props.children), [TXT.open, TXT.photos, TXT.reveal]);
  s.cache.set("C:\\a.png", { state: "large", size: 8388609, at: 0 });
  el = sb.__ccCard({ path: "C:\\a.png", kind: "image" });
  assert.equal(kids(kids(el)[0]), TXT.big(9));
  assert.deepEqual(Array.from(kids(kids(el)[1]), (b) => b.props.children), [TXT.open, TXT.photos, TXT.reveal]);
  s.caps = ["reveal"];
  el = sb.__ccCard({ path: "C:\\a.png", kind: "image" });
  assert.deepEqual(kids(el).length, 1, "no read_image: buttons only");
  const stop = [];
  el.props.onClick({ preventDefault: () => stop.push("pd"), stopPropagation: () => stop.push("sp") });
  assert.deepEqual(stop, ["pd", "sp"], "the card root swallows clicks");
});

// ---- UI language -------------------------------------------------------------------
test("T-M5 label tables: en and ru carry the same keys; the helpers show the language they were built with", () => {
  assert.deepEqual([...LANGUAGES], ["en", "ru"]);
  const code = fs.readFileSync(new URL("../assets/webview-helpers.js", import.meta.url), "utf8")
    .split(/\r?\n/).filter((line) => !/^\s*\/\//.test(line)).join("\n");
  assert.equal(code.split(LANG_PLACEHOLDER).length - 1, 1, "one language placeholder outside comments");
  assert.ok(code.indexOf(LANG_PLACEHOLDER) > code.indexOf("function __ccTxt(") &&
    code.indexOf(LANG_PLACEHOLDER) < code.indexOf("function __ccState("), "the placeholder sits in __ccTxt");
  const keys = {};
  for (const language of LANGUAGES) {
    const { sb } = newWindow({ language }), T = TEXT[language], t = { ...sb.__ccTxt() };
    keys[language] = Object.keys(t);
    for (const v of Object.values(t)) assert.ok(typeof v === "string" && v.length > 0, language);
    for (const k of ["open", "reveal", "folder", "photoshop", "photos", "loading", "missing", "unavailable", "failed", "close"]) {
      assert.equal(t[k], T[k], `${language} ${k}`);
    }
    assert.equal(sb.__ccStatus({ state: "large", size: 8388609 }), T.big(9), language);
    assert.equal(sb.__ccFailText({ error: "unsupported path" }), T.failed + "unsupported path", language);
    assert.equal(sb.__ccFailText({ error: "ENOENT: no such file" }), T.missing, language);
    sb.__ccState().caps = ["open", "reveal", "read_image", "photos"];
    sb.__ccCtx.fileOpener = { open() {} };
    const row = sb.__ccCard({ path: "C:\\a.png", kind: "image" }).props.children[1];
    assert.deepEqual(Array.from(row.props.children, (x) => x.props.children), [T.open, T.photos, T.reveal], language);
  }
  assert.deepEqual(keys.en, keys.ru);
  assert.equal(helpersText(NAMES), helpersText(NAMES, "en"));
  assert.equal(/[^\x20-\x7e]/.test(Object.values(TEXT.en).filter((v) => typeof v === "string").join("").replace(/\u2026/g, "")), false);
  for (const bad of ["de", "", "EN", null]) assert.throws(() => helpersText(NAMES, bad), /unknown language/);
});

/** plan() with ctx.options as the engine passes them; `options` undefined = no options at all. */
function planWithOptions(part, target, sources, options) {
  const { toolbar, toolbarError } = toolbarOf(sources.webview);
  const ctx = makeCtx({ version: sources.version, target, src: sources[target], toolbar, toolbarError });
  return part.plan(target, sources[target], options === undefined ? ctx : Object.freeze({ ...ctx, options }));
}

test("chat-media plan(): the configured language reaches CC-HELP; none means en, an unknown one is refused", { skip: noFx }, () => {
  const names = Object.fromEntries(Object.keys(PLACEHOLDERS).map((k) => [k, plans.webview.symbols[k]]));
  const help = (options) => planWithOptions(media, "webview", src, options).edits[0].text;
  const opts = (language) => Object.freeze({ language, buttons: Object.freeze([]) });
  assert.equal(plans.webview.edits[0].text, "/*CC-HELP*/" + helpersText(names, "en"));
  assert.equal(help(undefined), "/*CC-HELP*/" + helpersText(names, "en"));
  assert.equal(help(opts("en")), "/*CC-HELP*/" + helpersText(names, "en"));
  assert.equal(help(opts("ru")), "/*CC-HELP*/" + helpersText(names, "ru"));
  const ru = planWithOptions(media, "webview", src, opts("ru"));
  assert.deepEqual(ru.edits.slice(1), plans.webview.edits.slice(1), "only the helper block depends on the language");
  parseWebview(build(src.webview, ru.edits));
  assert.deepEqual(planWithOptions(media, "host", src, opts("ru")).edits, plans.host.edits, "the host has no texts");
  for (const bad of ["de", "", 7]) {
    assert.throws(() => help(opts(bad)), (e) => e.name === "LayoutError" && /unknown language/.test(e.message), String(bad));
  }
});

// ---- host: capabilities and refused paths, on the snippet texts ---------------------
const AsyncFunction = (async () => {}).constructor;
/**
 * The five H2 snippets as one async function over a fake process (platform, env),
 * a fake fs holding `files`, and a child_process whose `reg` answers `reg`.
 * Every fs and child_process call is recorded; nothing is launched.
 */
function hostStand({ platform = "win32", env = {}, files = [], reg = { err: new Error("not found"), out: "" }, execThrows = false } = {}) {
  const calls = [], low = (s) => s.toLowerCase();
  const under = (d) => files.filter((f) => low(f).startsWith(low(d) + "\\"));
  const fsFake = {
    existsSync: (p) => { calls.push(["existsSync", p]); return files.some((f) => low(f) === low(p)) || under(p).length > 0; },
    readdirSync: (d) => { calls.push(["readdirSync", d]); return [...new Set(under(d).map((f) => f.slice(d.length + 1).split("\\")[0]))]; },
    promises: { stat: async (p) => { calls.push(["stat", p]); throw new Error(`ENOENT: no such file or directory, stat '${p}'`); } },
  };
  const cpFake = {
    execFile(cmd, args, opts, cb) {
      calls.push(["execFile", cmd, args, opts]);
      if (execThrows) throw new Error("spawn reg ENOENT");
      setImmediate(() => cb(reg.err, reg.out));
    },
    spawn(...a) { calls.push(["spawn", ...a]); throw new Error("nothing may be launched here"); },
  };
  const req = (m) => ({ fs: fsFake, path: path.win32, child_process: cpFake, vscode: {} })[m];
  const s = hostSnippets({ req: "p", uri: "W", path: "z" });
  const fn = new AsyncFunction("p", "require", "process", H2_ORDER.map((k) => s[k]).join("") + 'return "FALLTHROUGH";');
  return { calls, run: (request) => fn({ request }, req, { platform, env }) };
}

test("host caps: photos only on Windows, photoshop only when an exe was found; the lookup never throws or launches", T20, async (t) => {
  t.after(() => { delete globalThis.__ccPsExe; });
  const BASE = ["open", "reveal", "read_image"], PF = "C:\\Program Files", ADOBE = PF + "\\Adobe";
  const RELEASE = ADOBE + "\\Adobe Photoshop 2025\\Photoshop.exe", BETA = ADOBE + "\\Adobe Photoshop (Beta)\\Photoshop.exe";
  const caps = async (opts) => {
    delete globalThis.__ccPsExe;
    const h = hostStand(opts), r = await h.run({ type: "cc_host_caps" });
    assert.deepEqual(Object.keys(r), ["type", "v", "caps"]);
    assert.equal(r.type, "cc_host_caps_response");
    assert.equal(r.v, 1);
    assert.ok(!h.calls.some((c) => c[0] === "spawn"), "caps launched something");
    return { caps: Array.from(r.caps), calls: h.calls, regs: h.calls.filter((c) => c[0] === "execFile") };
  };
  // No Photoshop: no App Paths key, nothing under Program Files\Adobe.
  let c = await caps({ env: { ProgramW6432: PF } });
  assert.deepEqual(c.caps, [...BASE, "photos"]);
  assert.equal(c.regs.length, 1);
  assert.deepEqual([c.regs[0][1], c.regs[0][2].at(-1), c.regs[0][3].timeout, c.regs[0][3].windowsHide], ["reg", "/ve", 1500, true]);
  assert.equal(globalThis.__ccPsExe, undefined);
  // Program Files\Adobe: the release before the beta, remembered for the Photoshop button.
  c = await caps({ env: { ProgramW6432: PF }, files: [BETA, RELEASE] });
  assert.deepEqual(c.caps, [...BASE, "photos", "photoshop"]);
  assert.equal(globalThis.__ccPsExe, RELEASE);
  // The App Paths key, REG_EXPAND_SZ with a variable.
  const out = "\r\nHKEY_LOCAL_MACHINE\\SOFTWARE\\...\\Photoshop.exe\r\n    (Default)    REG_EXPAND_SZ    %ProgramFiles%\\PS\\Photoshop.exe\r\n\r\n";
  c = await caps({ env: { ProgramFiles: "D:\\Apps" }, files: ["D:\\Apps\\PS\\Photoshop.exe"], reg: { err: null, out } });
  assert.deepEqual(c.caps, [...BASE, "photos", "photoshop"]);
  assert.equal(globalThis.__ccPsExe, "D:\\Apps\\PS\\Photoshop.exe");
  // CC_PHOTOSHOP_EXE: no registry; one that does not exist and nothing else found: no button.
  c = await caps({ env: { CC_PHOTOSHOP_EXE: "E:\\ps\\Photoshop.exe" }, files: ["E:\\ps\\Photoshop.exe"] });
  assert.deepEqual([c.caps, c.regs.length], [[...BASE, "photos", "photoshop"], 0]);
  c = await caps({ env: { CC_PHOTOSHOP_EXE: "E:\\gone\\Photoshop.exe", ProgramW6432: PF } });
  assert.deepEqual([c.caps, c.regs.length], [[...BASE, "photos"], 0]);
  // A remembered exe that vanished gives way to the search.
  delete globalThis.__ccPsExe;
  const h = hostStand({ env: { ProgramW6432: PF }, files: [RELEASE] });
  globalThis.__ccPsExe = "E:\\old\\Photoshop.exe";
  assert.deepEqual(Array.from((await h.run({ type: "cc_host_caps" })).caps), [...BASE, "photos", "photoshop"]);
  assert.equal(globalThis.__ccPsExe, RELEASE);
  // `reg` that cannot start: still an answer, without Photoshop.
  c = await caps({ execThrows: true });
  assert.deepEqual(c.caps, [...BASE, "photos"]);
  // Not Windows: neither app button, nothing looked up.
  c = await caps({ platform: "linux", env: { CC_PHOTOSHOP_EXE: "E:\\ps\\Photoshop.exe" }, files: ["E:\\ps\\Photoshop.exe"] });
  assert.deepEqual([c.caps, c.calls], [BASE, []]);
  // An unknown request still falls through untouched.
  const quiet = hostStand();
  assert.equal(await quiet.run({ type: "get_current_selection" }), "FALLTHROUGH");
  assert.deepEqual(quiet.calls, []);
});

test("host: a colon after the drive (an NTFS stream) is refused in every branch before stat", T20, async (t) => {
  t.after(() => { delete globalThis.__ccPsExe; });
  const h = hostStand({ env: { CC_PHOTOSHOP_EXE: "E:\\ps\\Photoshop.exe" }, files: ["C:\\x\\f.txt", "E:\\ps\\Photoshop.exe"] });
  const cases = [
    ["cc_reveal_in_os", "C:\\x\\f.txt:s"], ["cc_reveal_in_os", "C:\\x\\f.txt:s.png"],
    ["cc_read_image", "C:\\x\\f.txt:s.png"], ["cc_read_image", "C:\\x\\f.png::$DATA.png"],
    ["cc_open_in_photos", "C:\\x\\f.txt:s.png"], ["cc_open_in_photoshop", "C:\\x\\f.txt:s.psd"],
  ];
  for (const [type, p] of cases) {
    const r = await h.run({ type, path: p, mode: "open" });
    assert.equal(r.type, type + "_response");
    assert.equal(r.ok, false, `${type} ${p}`);
    assert.match(r.error, /^(path must be absolute|unsupported path)$/, `${type} ${p}`);
  }
  assert.deepEqual(h.calls, [], "no stat, no lookup, no launch");
  const plainPath = await h.run({ type: "cc_read_image", path: "C:\\x\\a.png" });
  assert.match(plainPath.error, /^ENOENT/);
  assert.deepEqual(h.calls.map((c) => c[0]), ["stat"], "a path without a stream still reaches stat");
});

// ---- T-N5, T-N6, T-N10: chat-media side --------------------------------------------
const rename = (a) => a.slice(0, 2) + "Q" + a.slice(3);

test("T-N5/T-N6 chat-media webview anchors renamed or doubled: chat-media refuses naming it, chat-icons plans", { skip: noFx }, () => {
  for (const a of Object.values(ANCHORS)) {
    for (const webview of [editOnce(src.webview, a, rename(a)), src.webview + "\n/*" + a + "*/"]) {
      const e = planError(media, "webview", { ...src, webview });
      assert.equal(e.name, "LayoutError");
      assert.ok(e.message.includes(a), `${e.message} should name ${a}`);
      assert.equal(runPlan(icons, "webview", { ...src, webview, options: ICON_OPTIONS }).edits.length, 4);
    }
  }
});

test("T-N5/T-N6 host H1 and H2 renamed or doubled (whole match): chat-media refuses naming it", { skip: noFx }, () => {
  const cases = { H1: ['"revealInExplorer"', '"revealInExplorex"'], H2: ['"get_current_selection"', '"get_current_selectiox"'] };
  for (const [k, [from, to]] of Object.entries(cases)) {
    const whole = HOST_RES[k].exec(src.host)[0];
    for (const host of [editOnce(src.host, whole, whole.replace(from, to)), src.host + "\n/*" + whole + "*/"]) {
      const e = planError(media, "host", { ...src, host });
      assert.equal(e.name, "LayoutError");
      assert.ok(e.message.startsWith(k + " "), e.message);
    }
  }
  assert.equal(src.host.split("async processRequest(").length - 1, 2, "a copy of the prefix alone is not a second H2");
});

test("chat-media refuses a pristine copy that already holds __cc names", { skip: noFx }, () => {
  assert.match(planError(media, "webview", { ...src, webview: src.webview + "\nvar __ccX;" }).message, /already contains __cc/);
  assert.match(planError(media, "host", { ...src, host: src.host + "\nvar __ccX;" }).message, /already contains __cc/);
});

test("T-N10 chat-media derivations that no longer match name their regex", { skip: refOnly }, () => {
  const cases = [
    ["W1 code block component", "function Zy0({children:$}){", "function Zy0({childreX:$}){"],
    ["W1 pre: cross-check", "pre:({children:q})=>F(Zy0,{children:q})", "pre:({children:q})=>F(Zy0,{children:[q]})"],
    ["W2 markdown component signature", "isPartialText:Z}){let X=", "isPartialTexX:Z}){let X="],
    ["W3 react-markdown call", "F(e71,{remarkPlugins:", "F(e71,{remarkPluginX:"],
    ["W3 filter", "function e71($){", "function e71($,_){"],
    ["W4 link onClick", "Jy0(V,q,J?.fileOpener)", "Jy0(V,q,J?.fileOpenex)"],
    ["W4 link handler signature", "function Jy0($,J,Z){", "function Jy0($,J){"],
    ["W5 markdown img", "img:({src:q,alt:U})=>{", "img:({src:q,alX:U})=>{"],
    ["jsxs", 'R("div",{className:uN.codeBlockWrapper', 'R("dXv",{className:uN.codeBlockWrapper'],
    ["hooks useRef/useEffect", "{let Y=e(null);o(()=>{function z(q){", "{let Y=e(void 0);o(()=>{function z(q){"],
    ["hooks useState/useCallback", "[Y,Q]=p(null),z=$0((", "[Y,Q]=p(void 0),z=$0(("],
    ["channel guard sendRequest", "sendRequest($,J,Z,X=", "sendRequest($,J,Z,X,Y="],
  ];
  const at = src.webview.indexOf(ANCHORS.fileOpener);
  const edits = cases.map(([label, from, to]) => [label, editOnce(src.webview, from, to)]);
  edits.push(["channel guard", editRange(src.webview, at, at + 220, "this.comms.connection.value", "this.comms.connectioX.value")]);
  for (const [label, webview] of edits) {
    const e = planError(media, "webview", { ...src, webview });
    assert.equal(e.name, "LayoutError", label);
    assert.ok(e.message.startsWith(label + ":") || e.message.startsWith(label + " "), `${label} -> ${e.message}`);
  }
});
