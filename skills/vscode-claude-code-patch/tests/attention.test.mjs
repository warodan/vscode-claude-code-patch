import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { loadFixtures, skipWithoutFixtures } from "./lib/fixtures.mjs";
import { loadPart, runPlan, planError, build, parseWebview, editOnce } from "./lib/b-harness.mjs";
import { helpersText, LANGUAGES } from "../parts/chat-attention.mjs";

const Q = String.fromCodePoint(0x2753), EYES = String.fromCodePoint(0x1f440), WARN = String.fromCodePoint(0x26a0), VS16 = "\ufe0f";
const text = (t) => ({ content: { type: "text", text: t } });
const agent = (uuid, ...t) => ({ type: "assistant", uuid, content: t.map(text) });
const human = (t) => ({ type: "user", uuid: "u-" + t, content: [text(t)] });
const plain = (v) => JSON.parse(JSON.stringify(v));

/** The helpers in a vm context; with `dom`, a small fake document and manual timers. */
function load(language = "en", dom = false) {
  const sb = vm.createContext({ window: { IS_SESSION_LIST_ONLY: !dom } });
  let fake = null;
  if (dom) fake = fakeDocument(sb);
  vm.runInContext('"use strict";' + helpersText(language), sb);
  return { sb, fake };
}

function fakeDocument(sb) {
  const listeners = [], timers = [], intervals = [];
  class El {
    constructor(tag) { this.tagName = tag; this.children = []; this.style = {}; this.attrs = {}; this.events = {}; this.parentNode = null; this._text = ""; this.scrollTop = 0; this.scrollHeight = 0; this.clientHeight = 0; }
    get textContent() { return this._text + this.children.map((c) => c.textContent).join(""); }
    set textContent(v) { this.children = []; this._text = String(v); }
    appendChild(el) { this.children.push(el); el.parentNode = this; return el; }
    setAttribute(k, v) { this.attrs[k] = v; }
    addEventListener(k, f) { this.events[k] = f; }
    remove() { const a = this.parentNode.children; a.splice(a.indexOf(this), 1); this.parentNode = null; }
  }
  const body = new El("body"), all = (e) => [e, ...e.children.flatMap(all)];
  sb.document = {
    body, createElement: (t) => new El(t), createElementNS: (_, t) => new El(t),
    getElementById: (id) => all(body).find((e) => e.id === id) || null,
    querySelector: () => null,
    addEventListener: (k, f, c) => listeners.push({ k, f, c }),
    removeEventListener: (k, f, c) => { const i = listeners.findIndex((l) => l.k === k && l.f === f && l.c === c); if (i >= 0) listeners.splice(i, 1); },
  };
  sb.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
  sb.clearTimeout = () => {};
  sb.setInterval = (fn, ms) => { intervals.push({ fn, ms, live: true }); return intervals.length; };
  sb.clearInterval = (id) => { intervals[id - 1].live = false; };
  sb.CSS = { escape: (s) => s };
  sb.NodeFilter = { SHOW_TEXT: 4 };
  return { body, all, listeners, timers, intervals, El };
}
const rowsOf = (sb, rows) => { sb.__ccSessions = { activeSession: { value: { messages: { value: rows } } } }; };
const itemsOf = (panel) => panel.children[1].children.filter((e) => e.tagName === "button").map((b) => b.textContent);

test("A-1 marked lines at a line start count, the warning sign too; mid-sentence and fenced ones do not", () => {
  const { sb } = load();
  const lines = plain(sb.__ccAttnLines([
    `${Q} **Q1** - **Tee on hole 4?**`,
    `- ${EYES} Look at [sheet](C:\\a\\b.png)`,
    `The marker ${Q} inside a sentence`,
    "```", `${Q} inside a fence`, `${WARN} inside a fence`, "```",
    `> **${Q} quoted card**`,
    `${WARN}${VS16} **Risk:** the build is slow`,
    `1. ${WARN} plain sign`,
    `Not a ${WARN} warning`,
  ].join("\n")));
  assert.deepEqual(lines, [
    { kind: "ask", line: "Q1 - Tee on hole 4?" },
    { kind: "look", line: "Look at sheet" },
    { kind: "ask", line: "quoted card" },
    { kind: "warn", line: "Risk: the build is slow" },
    { kind: "warn", line: "plain sign" },
  ]);
});

test("A-2 every marked line of the main agent in chat order, before and after the user's prompts; subagents out", () => {
  const { sb } = load();
  const rows = [
    agent("a1", `${Q} old question`),
    human("answer"),
    agent("a2", `${Q} first`, `${EYES} second`),
    { type: "assistant", uuid: "s1", sdkParentToolUseId: "t", content: [text(`${Q} subagent`)] },
    { type: "assistant", uuid: "s2", parentToolUseId: "t", content: [text(`${WARN} subagent`)] },
    { type: "user", uuid: "r1", content: [{ content: { type: "tool_result" } }] },
    agent("a3", `${WARN} third`),
    human("ok"),
  ];
  assert.deepEqual(plain(sb.__ccAttnCollect(rows)).map((i) => [i.key, i.uuid, i.n, i.kind, i.line]), [
    ["a1:0", "a1", 0, "ask", "old question"], ["a2:0", "a2", 0, "ask", "first"], ["a2:1", "a2", 1, "look", "second"],
    ["a3:0", "a3", 0, "warn", "third"],
  ]);
  assert.deepEqual(plain(sb.__ccAttnCollect([])), []);
  assert.equal(sb.__ccAttnCollect("not rows"), null);
  assert.equal(sb.__ccAttnCollect([{ type: "assistant" }, 7]), null, "rows without a content list are not window rows");
});

test("A-3 both label tables have the same keys", () => {
  const keys = LANGUAGES.map((l) => Object.keys(load(l).sb.__ccAttnLabels()).sort().join());
  assert.equal(new Set(keys).size, 1);
  assert.equal(load("ru").sb.__ccAttnLabels().title, "\u041e\u0442\u043c\u0435\u0447\u0435\u043d\u043d\u044b\u0435 \u0441\u0442\u0440\u043e\u043a\u0438 \u0447\u0430\u0442\u0430");
  assert.equal(/[^\x00-\x7e]/.test(helpersText("ru")), false, "non-ASCII only as \\u escapes");
});

test("A-4 the button: under the files button, an SVG outline, once; none in the session list", () => {
  const { sb, fake } = load("en", true);
  assert.equal(fake.body.children.length, 1, "booted at load");
  sb.__ccAttnBoot();
  assert.equal(fake.body.children.length, 1, "once");
  const b = fake.body.children[0];
  assert.equal(b.id, "cc-attn-button");
  assert.match(b.style.cssText, /top:30px;right:4px;width:22px;height:22px/);
  assert.equal(b.title, sb.__ccAttnLabels().title);
  assert.equal(b.children[0].tagName, "svg");
  assert.equal(b.children[0].children[0].attrs.stroke, "currentColor");
  const off = load("en", false);
  assert.doesNotThrow(() => off.sb.__ccAttnBoot());
});

test("A-5 the list: every marked line in order, a click jumps, stays open; the button, x and Esc close it", () => {
  const { sb, fake } = load("en", true);
  const T = sb.__ccAttnLabels();
  rowsOf(sb, [agent("a1", `${Q} one`), human("x"), agent("a2", `${EYES} two`, `${WARN} three`)]);
  const button = fake.body.children[0];
  button.events.click();
  const panel = fake.body.children[1];
  assert.equal(panel.id, "cc-attn-panel");
  assert.equal(panel.children[0].children[0].textContent, T.title);
  assert.deepEqual(itemsOf(panel), [`${Q} one`, `${EYES} two`, `${WARN}${VS16} three`]);
  // A click jumps to the line and leaves the list open.
  const jumped = [];
  sb.__ccAttnJump = (it) => { jumped.push(it.key); return true; };
  panel.children[1].children[1].events.click();
  assert.deepEqual(jumped, ["a2:0"]);
  assert.equal(fake.body.children.length, 2, "still open");
  assert.equal(panel.children[2].textContent, "");
  // Not on screen: a line in the list says so for 4 s.
  sb.__ccAttnJump = () => false;
  panel.children[1].children[0].events.click();
  assert.equal(panel.children[2].textContent, T.lost);
  assert.equal(fake.timers.at(-1).ms, 4000);
  fake.timers.at(-1).fn();
  assert.equal(panel.children[2].textContent, "");
  // While open it follows the chat once a second.
  const tick = fake.intervals[0];
  assert.equal(tick.ms, 1000);
  sb.__ccSessions.activeSession.value.messages.value.push(agent("a3", `${Q} four`));
  tick.fn();
  assert.deepEqual(itemsOf(panel).at(-1), `${Q} four`);
  // The button again closes it; its timer and Esc listener go with it.
  button.events.click();
  assert.equal(fake.body.children.length, 1);
  assert.equal(tick.live, false);
  assert.equal(fake.listeners.length, 0);
  // The x closes it; so does Esc, but not while the image viewer is open.
  button.events.click();
  fake.body.children[1].children[0].children[1].events.click();
  assert.equal(fake.body.children.length, 1);
  button.events.click();
  const esc = { key: "Escape", preventDefault() {}, stopPropagation() {} };
  sb.__ccMedia = { viewer: () => {} };
  fake.listeners[0].f(esc);
  assert.equal(fake.body.children.length, 2, "the viewer owns Esc");
  sb.__ccMedia.viewer = null;
  assert.equal(fake.listeners[0].c, true, "captured");
  fake.listeners[0].f(esc);
  assert.equal(fake.body.children.length, 1);
});

test("A-6 empty and unreadable chats say so", () => {
  for (const language of LANGUAGES) {
    const { sb, fake } = load(language, true), T = sb.__ccAttnLabels();
    rowsOf(sb, [agent("a1", "nothing marked"), human("x")]);
    sb.__ccAttnToggle();
    assert.equal(fake.body.children[1].children[1].textContent, T.empty, language);
    sb.__ccAttnToggle();
    delete sb.__ccSessions;
    sb.__ccAttnToggle();
    assert.equal(fake.body.children[1].children[1].textContent, T.unreadable, language);
  }
});

test("A-7 a jump finds the line in its message by text, outlines it, and reports a message off screen", () => {
  const { sb, fake } = load("en", true);
  const para = (t) => { const el = new fake.El("p"); el.textContent = t; el.closest = () => el; el.scrollIntoView = (o) => { el.scrolled = o; }; return el; };
  const first = para(`${Q} other line`), second = para(`${WARN}${VS16} the build is slow`);
  const nodes = [first, second].map((p) => ({ nodeValue: p.textContent, parentElement: p }));
  const host = {};
  sb.document.querySelector = (sel) => (sel === '[data-bookmark-uuid="a2"]' ? host : null);
  sb.document.createTreeWalker = (root) => { assert.equal(root, host); let i = 0; return { nextNode: () => nodes[i++] || null }; };
  assert.equal(sb.__ccAttnJump({ uuid: "a2", n: 0, kind: "warn", line: "the build is slow" }), true);
  assert.deepEqual(plain(second.scrolled), { block: "center", behavior: "smooth" });
  assert.match(second.style.outline, /solid/);
  fake.timers.at(-1).fn();
  assert.equal(second.style.outline, undefined, "the outline goes after 1.6 s");
  assert.equal(first.scrolled, undefined);
  assert.equal(sb.__ccAttnJump({ uuid: "gone", n: 0, kind: "ask", line: "x" }), false);
  assert.equal(sb.__ccAttnJump({ uuid: null, n: 0, kind: "ask", line: "x" }), false);
});

const fx = loadFixtures();
test("A-8 plan(): guards A1-A3 on the fixture, one insert at the end that parses", { skip: skipWithoutFixtures(fx) }, async () => {
  const part = await loadPart("chat-attention");
  const src = { webview: fx.read("index.js.orig"), host: fx.read("extension.js"), version: fx.version };
  if (!src.webview.includes('"data-bookmark-uuid":')) {
    // Builds before the rendered message carried its row's uuid (2.1.280) are refused, not guessed at.
    const e = planError(part, "webview", src);
    assert.equal(e.name, "LayoutError");
    assert.ok(e.message.startsWith("A1:"), e.message);
    return;
  }
  const plan = runPlan(part, "webview", src);
  assert.equal(plan.edits.length, 1);
  assert.equal(plan.edits[0].at, src.webview.length);
  assert.ok(plan.edits[0].text.startsWith("\n/*CC-ATTN*/"));
  parseWebview(build(src.webview, plan.edits));
  const row = /class ([\w$]+)\{type;content;parentToolUseId;sdkParentToolUseId;/.exec(src.webview);
  const rowEnd = src.webview.indexOf("}", row.index);
  const rowText = src.webview.slice(row.index, rowEnd);
  for (const [label, webview] of [
    ["A1", editOnce(src.webview, '"data-bookmark-uuid":', '"data-bookmark-uuix":')],
    ["A2", editOnce(src.webview, rowText, rowText.replace(/\buuid;/, "uuix;"))],
    ["A3", src.webview + "\nvar __ccX;"],
  ]) {
    const e = planError(part, "webview", { ...src, webview });
    assert.equal(e.name, "LayoutError", label);
    assert.ok(e.message.startsWith(label + ":"), `${label} -> ${e.message}`);
  }
});
