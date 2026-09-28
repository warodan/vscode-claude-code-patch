// chat-icons: the composer buttons from the config (T-I1..T-I6) and the chat-icons side
// of T-N5, T-N6, T-N10. plan() runs through the stub harness (tests/lib/b-harness.mjs);
// what --verify and a build say about these cases is in integration.test.mjs and
// engine.test.mjs.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { loadFixtures, skipWithoutFixtures, skipUnlessReference } from "./lib/fixtures.mjs";
import {
  loadPart, runPlan, planError, contractProblems, build, markerCounts, editOnce, editRange, toolbarOf, parseWebview,
} from "./lib/b-harness.mjs";
import { ICONS, MAX_BUTTONS, validateButtons } from "../parts/chat-icons.mjs";
import { ANCHOR, matchBracket } from "../lib/layout.mjs";

const fx = loadFixtures();
const icons = await loadPart("chat-icons");
const media = await loadPart("chat-media");
const src = fx ? { webview: fx.read("index.js.orig"), host: fx.read("extension.js"), version: fx.version } : null;
const noFx = skipWithoutFixtures(fx), refOnly = skipUnlessReference(fx);
const COMPACT = '("/compact",[])';

const HANDOFF = { id: "handoff", icon: "export", tooltip: "Hand off to a new session", action: { type: "command", command: "/handoff" } };
const FINISH = { id: "finish", icon: "pass", tooltip: "Finish: send \"Your work is done\"", action: { type: "send", text: "Your work is done" } };
const INSERT = { id: "note", label: "N", tooltip: "Insert a note", action: { type: "insert", text: "please check the tests" } };
const TWO = [HANDOFF, FINISH];
const opts = (buttons, language = "en") => ({ language, buttons });
const planWith = (buttons, language, webview = src.webview) => runPlan(icons, "webview", { ...src, webview, options: opts(buttons, language) });
const errorWith = (buttons, webview = src.webview) => planError(icons, "webview", { ...src, webview, options: opts(buttons) });
const plan = src ? planWith(TWO) : null;

const svg = (d) => `F("svg",{width:"26",height:"26",viewBox:"-5 -5 26 26","aria-hidden":!0,style:{display:"block"},` +
  `children:F("path",{d:${JSON.stringify(d)},fill:"currentColor"})})`;
const BUSY = '"Unavailable: Claude is still working"';

// The two buttons on 2.1.280: jsx F, styles M7, session $, send function Z. In the literals
// every "/" is written "\/" (the escaper's rule: config text can never close a comment).
const EXPECTED = [
  [5151926, ",onSendText:__ccSendText/*CC-SEND*/"],
  [5198124, "onSendText:(__ccT)=>Z(__ccT,[]),/*CC-SEND*/"],
  [5155012, '/*CC-ICON:handoff*/F("button",{type:"button",className:M7.menuButton,"data-cc-icon":"handoff",' +
    'disabled:$.busy.value||!(__ccCan&&__ccCan("\\/handoff")),' +
    `title:$.busy.value?${BUSY}:(__ccCan&&__ccCan("\\/handoff"))?"Hand off to a new session":"\\/handoff is not loaded yet or not installed",` +
    `onClick:()=>{try{__ccRun("\\/handoff")}catch{}},children:${svg(ICONS.export)}}),`],
  [5155012, '/*CC-ICON:finish*/F("button",{type:"button",className:M7.menuButton,"data-cc-icon":"finish",' +
    "disabled:$.busy.value," +
    `title:$.busy.value?${BUSY}:"Finish: send \\"Your work is done\\"",` +
    `onClick:()=>{try{__ccSendText("Your work is done")}catch{}},children:${svg(ICONS.pass)}}),`],
];

/**
 * Each button of a plan, evaluated with stubs for the panel's names: { id, props, title(busy, can), click() }.
 * The JSX helper returns { type, props }; click() returns [the function called, its argument].
 */
function evalButtons(p, webview = src.webview) {
  const tb = toolbarOf(webview).toolbar;
  const names = [tb.jsx, tb.session, tb.styles, tb.insertFn, "__ccCan", "__ccRun", "__ccSendText"];
  assert.equal(new Set(names).size, names.length, `panel names collide: ${names}`);
  return p.edits.filter((e) => e.text.startsWith("/*CC-ICON:")).map((e) => {
    const id = e.text.match(/^\/\*CC-ICON:([\w-]+)\*\//)[1];
    const make = (busy, can, calls) => new Function(...names, `return [${e.text.slice(e.text.indexOf("*/") + 2)}][0];`)(
      (type, props) => ({ type, props }),
      { busy: { value: busy } },
      { menuButton: "mb" },
      (text) => calls.push(["insert", text]),
      () => can,
      (text) => calls.push(["run", text]),
      (text) => calls.push(["send", text]));
    return {
      id,
      props: make(false, true, []).props,
      title: (busy, can) => make(busy, can, []).props.title,
      disabled: (busy, can) => make(busy, can, []).props.disabled,
      click() {
        const calls = [];
        make(false, true, calls).props.onClick();
        return calls;
      },
    };
  });
}

test("T-I1 two buttons on the reference: points, names and texts byte for byte", { skip: refOnly }, () => {
  assert.deepEqual(plan.edits.map((e) => [e.at, e.text]), EXPECTED);
  assert.deepEqual(plan.requires, ["run-plumbing"]);
  assert.deepEqual(plan.symbols, { jsx: "F", css: "M7", session: "$", send: "Z", compact: "l6" });
});

test("T-I1 contract: one marker of its family per edit, run-plumbing for a command, list order = screen order", { skip: noFx }, () => {
  assert.deepEqual(contractProblems("chat-icons", "webview", src.webview, plan), []);
  const built = build(src.webview, plan.edits);
  assert.deepEqual(markerCounts(built), { "CC-SEND": 2, "CC-ICON:handoff": 1, "CC-ICON:finish": 1 });
  assert.ok(built.indexOf("/*CC-ICON:handoff*/") < built.indexOf("/*CC-ICON:finish*/"));
  assert.equal(plan.edits[2].at, plan.edits[3].at, "both buttons at the slot after /");
  assert.doesNotThrow(() => parseWebview(built));
  const [handoff, finish] = evalButtons(plan);
  assert.deepEqual([handoff.props["data-cc-icon"], handoff.props.className], ["handoff", "mb"]);
  assert.deepEqual(handoff.click(), [["run", "/handoff"]]);
  assert.deepEqual(finish.click(), [["send", "Your work is done"]]);
  assert.deepEqual([handoff.title(false, true), handoff.title(false, false), handoff.title(true, true)],
    ["Hand off to a new session", "/handoff is not loaded yet or not installed", "Unavailable: Claude is still working"]);
  assert.deepEqual([handoff.disabled(false, true), handoff.disabled(false, false), handoff.disabled(true, true)], [false, true, true]);
  assert.deepEqual([finish.disabled(false, true), finish.disabled(true, true)], [false, true]);
});

test("T-I2 no buttons (absent, empty list): nothing inserted, nothing required, a note - even without a panel", { skip: noFx }, () => {
  const noPanel = editOnce(src.webview, ANCHOR, ANCHOR.replace("Show", "Shox"));
  for (const webview of [src.webview, noPanel]) {
    for (const options of [undefined, opts([]), { language: "ru" }]) {
      const p = runPlan(icons, "webview", { ...src, webview, options });
      assert.deepEqual([p.edits, p.requires], [[], []]);
      assert.match(p.notes[0], /no buttons configured/);
    }
  }
});

test("T-I3 each kind asks only for what it uses: send -> CC-SEND, command -> run-plumbing, insert -> the panel's insert callback", { skip: noFx }, () => {
  const send = planWith([FINISH]);
  assert.deepEqual([send.requires, Object.keys(markerCounts(build(src.webview, send.edits))).sort()], [[], ["CC-ICON:finish", "CC-SEND"]]);
  const command = planWith([HANDOFF]);
  assert.deepEqual([command.requires, Object.keys(markerCounts(build(src.webview, command.edits)))], [["run-plumbing"], ["CC-ICON:handoff"]]);
  const insert = planWith([INSERT]);
  assert.deepEqual([insert.requires, insert.edits.length], [[], 1]);
  const [note] = evalButtons(insert);
  assert.deepEqual(note.click(), [["insert", "please check the tests"]]);
  assert.equal(note.props.children, "N", "a label button shows its text");
  assert.equal(note.props.title, "Insert a note");
  assert.equal(note.props.disabled, false, "an insert button is not gated on the busy signal");
  // An insert-only set needs no busy signal and no /compact handler.
  const tb = toolbarOf(src.webview).toolbar;
  const bodyEnd = matchBracket(src.webview, tb.signatureEnd + 2) + 1;
  const noBusy = editRange(src.webview, tb.signatureEnd, bodyEnd, `${tb.session}.busy.value`, `${tb.session}.busX.value`);
  assert.equal(planWith([INSERT], "en", noBusy).edits.length, 1);
  assert.equal(planWith([INSERT], "en", editOnce(src.webview, COMPACT, '("Qcompact",[])')).edits.length, 1);
  assert.equal(planWith([HANDOFF], "en", editOnce(src.webview, COMPACT, '("Qcompact",[])')).edits.length, 1, "a command button needs no /compact");
});

test("T-I4 language ru: the part's own tooltips in Russian as \\u escapes; the source stays ASCII", { skip: noFx }, () => {
  const ru = planWith(TWO, "ru");
  const text = ru.edits.map((e) => e.text).join("");
  assert.equal(/[^\x20-\x7e]/.test(text), false, "the inserted text is printable ASCII");
  const [handoff, finish] = evalButtons(ru);
  assert.equal(handoff.title(true, true), "\u041d\u0435\u0434\u043e\u0441\u0442\u0443\u043f\u043d\u043e: Claude \u0435\u0449\u0451 \u0440\u0430\u0431\u043e\u0442\u0430\u0435\u0442");
  assert.equal(handoff.title(false, false), "\u041a\u043e\u043c\u0430\u043d\u0434\u0430 /handoff \u0435\u0449\u0451 \u043d\u0435 \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u043b\u0430\u0441\u044c \u0438\u043b\u0438 \u043d\u0435 \u0443\u0441\u0442\u0430\u043d\u043e\u0432\u043b\u0435\u043d\u0430");
  assert.equal(finish.title(false, true), FINISH.tooltip, "the user's own tooltip is the user's");
  const source = fs.readFileSync(new URL("../parts/chat-icons.mjs", import.meta.url), "utf8");
  assert.equal(/[^\x00-\x7e]/.test(source), false, "Russian text only as \\u escapes");
});

test("T-I5 escaping: config text never becomes code, a comment end or a marker, and reads back as written", { skip: noFx }, () => {
  const [LS, PS] = [String.fromCharCode(0x2028), String.fromCharCode(0x2029)];
  const EMOJI = String.fromCodePoint(0x1f600);
  const nasty = [
    'quote " and backslash \\ end',
    "back`tick ${template} and emoji " + EMOJI + " and " + String.fromCharCode(0x044f, 0x0437),
    "*/ closes /* opens",
    "/*CC-ICON:x*/ fake marker /*CC-RUN*/ " + LS + " line and paragraph separators " + PS,
    "</script><script>alert(1)</script>",
  ];
  const buttons = nasty.map((t, i) => ({
    id: `b-${i}`, label: EMOJI, tooltip: t.split(LS).join(" ").split(PS).join(" ").slice(0, 80),
    action: i % 2 ? { type: "send", text: `${t}\nsecond line\ttab` } : { type: "command", command: "/usage" },
  }));
  assert.equal(buttons.length, MAX_BUTTONS);
  const p = planWith(buttons);
  assert.deepEqual(contractProblems("chat-icons", "webview", src.webview, p), []);
  const built = build(src.webview, p.edits);
  assert.doesNotThrow(() => parseWebview(built));
  const counts = markerCounts(built);
  assert.deepEqual(Object.keys(counts).sort(), ["CC-ICON:b-0", "CC-ICON:b-1", "CC-ICON:b-2", "CC-ICON:b-3", "CC-ICON:b-4", "CC-SEND"]);
  const got = evalButtons(p);
  buttons.forEach((b, i) => {
    assert.equal(got[i].props.title, b.tooltip, `tooltip ${i}`);
    assert.equal(got[i].props.children, b.label);
    assert.deepEqual(got[i].click(), [b.action.type === "send" ? ["send", b.action.text] : ["run", "/usage"]], `action ${i}`);
  });
});

test("T-I6 validateButtons: every bad field is named, a good list comes back frozen", () => {
  const ok = { id: "a", icon: "check", tooltip: "t", action: { type: "command", command: "/usage" } };
  const bad = [
    ["not a list", { id: "a" }, /^buttons: expected a list/],
    ["six buttons", Array.from({ length: 6 }, (_, i) => ({ ...ok, id: `b${i}` })), /at most 5/],
    ["not an object", ["x"], /^buttons\[0\]: expected an object/],
    ["unknown key", [{ ...ok, colour: "red" }], /^buttons\[0\]: unknown key colour/],
    ["id upper case", [{ ...ok, id: "Go" }], /^buttons\[0\]\.id: /],
    ["id too long", [{ ...ok, id: "a".repeat(25) }], /^buttons\[0\]\.id: /],
    ["id with a space", [{ ...ok, id: "a b" }], /^buttons\[0\]\.id: /],
    ["id twice", [ok, { ...ok }], /^buttons\[1\]\.id: "a" is used twice/],
    ["icon and label", [{ ...ok, label: "x" }], /^buttons\[0\]: needs exactly one of icon and label/],
    ["neither", [{ id: "a", tooltip: "t", action: ok.action }], /needs exactly one of icon and label/],
    ["unknown icon", [{ ...ok, icon: "banana" }], /^buttons\[0\]\.icon: unknown icon "banana" \(icons: arrow-right, /],
    ["label of four", [{ id: "a", label: "abcd", tooltip: "t", action: ok.action }], /^buttons\[0\]\.label: /],
    ["no tooltip", [{ ...ok, tooltip: undefined }], /^buttons\[0\]\.tooltip: required/],
    ["tooltip 81", [{ ...ok, tooltip: "x".repeat(81) }], /^buttons\[0\]\.tooltip: /],
    ["tooltip newline", [{ ...ok, tooltip: "a\nb" }], /^buttons\[0\]\.tooltip: /],
    ["blank tooltip", [{ ...ok, tooltip: "   " }], /^buttons\[0\]\.tooltip: /],
    ["no action", [{ ...ok, action: undefined }], /^buttons\[0\]\.action: needs a type/],
    ["unknown type", [{ ...ok, action: { type: "open" } }], /^buttons\[0\]\.action: needs a type/],
    ["extra action key", [{ ...ok, action: { type: "send", text: "x", command: "/y" } }], /^buttons\[0\]\.action: unknown key command/],
    ["command with args", [{ ...ok, action: { type: "command", command: "/review 12" } }], /^buttons\[0\]\.action\.command: /],
    ["command without /", [{ ...ok, action: { type: "command", command: "usage" } }], /^buttons\[0\]\.action\.command: /],
    ["empty send", [{ ...ok, action: { type: "send", text: " " } }], /^buttons\[0\]\.action\.text: /],
    ["send 2001", [{ ...ok, action: { type: "send", text: "x".repeat(2001) } }], /^buttons\[0\]\.action\.text: /],
    ["send with NUL", [{ ...ok, action: { type: "send", text: "a\u0000b" } }], /^buttons\[0\]\.action\.text: /],
    ["insert two lines", [{ ...ok, action: { type: "insert", text: "a\nb" } }], /^buttons\[0\]\.action\.text: .*one line/],
    ["insert 501", [{ ...ok, action: { type: "insert", text: "x".repeat(501) } }], /^buttons\[0\]\.action\.text: /],
  ];
  for (const [what, list, re] of bad) {
    assert.throws(() => validateButtons(list), (e) => (re.test(e.message) ? true : assert.fail(`${what}: ${e.message}`)), what);
  }
  const good = validateButtons([
    ok,
    { id: "b-2", label: "\ud83d\ude00\ud83d\ude00\ud83d\ude00", tooltip: "x".repeat(80), action: { type: "send", text: "x".repeat(2000) } },
    { id: "c", label: "Go", tooltip: "t", action: { type: "insert", text: "one line" } },
  ]);
  assert.equal(good.length, 3);
  assert.ok(Object.isFrozen(good) && Object.isFrozen(good[0]) && Object.isFrozen(good[0].action));
  assert.equal(Object.keys(ICONS).length >= 10, true);
  for (const [name, d] of Object.entries(ICONS)) assert.match(d, /^M[\d. MLHVQZ-]+Z$/, name);
});

test("T-I1 guards: no busy signal, no onCompact at the call site, __cc names, no panel -> LayoutError", { skip: refOnly }, () => {
  const tb = toolbarOf(src.webview).toolbar;
  const bodyEnd = matchBracket(src.webview, tb.signatureEnd + 2) + 1;
  const noBusy = editRange(src.webview, tb.signatureEnd, bodyEnd, "$.busy.value", "$.busX.value");
  for (const buttons of [[HANDOFF], [FINISH]]) {
    const e1 = errorWith(buttons, noBusy);
    assert.equal(e1.name, "LayoutError");
    assert.equal(e1.message, "no busy signal");
  }
  const noCompact = editRange(src.webview, tb.callPropsAt, tb.callPropsAt + 1500, "onCompact:l6", "onCompact:l7");
  assert.match(errorWith(TWO, noCompact).message, /^onCompact guard: /);
  assert.match(errorWith(TWO, src.webview + "\nvar __ccX;").message, /already contains __cc/);
  const e3 = errorWith(TWO, editOnce(src.webview, ANCHOR, ANCHOR.replace("Show", "Shox")));
  assert.equal(e3.name, "LayoutError");
  assert.ok(e3.message.includes(ANCHOR), e3.message);
  assert.match(errorWith([{ ...HANDOFF, icon: "nope" }]).message, /^buttons\[0\]\.icon: unknown icon/, "a bad config is the reason, not the layout");
});

test("T-N5/T-N6 chat-icons anchor renamed or doubled: chat-icons refuses naming it, chat-media plans", { skip: noFx }, () => {
  for (const webview of [editOnce(src.webview, COMPACT, '("Qcompact",[])'), src.webview + "\n/*" + COMPACT + "*/"]) {
    const e = errorWith(TWO, webview);
    assert.equal(e.name, "LayoutError");
    assert.ok(e.message.includes(COMPACT), e.message);
    assert.equal(runPlan(media, "webview", { ...src, webview }).edits.length, 6);
  }
});

test("T-N10 chat-icons derivations that no longer match name their regex", { skip: refOnly }, () => {
  const tb = toolbarOf(src.webview).toolbar;
  const noHandler = editOnce(src.webview, 'let l6=()=>{Z("/compact",[])}', 'let l6=()=>{Z("/compact",[]);}');
  assert.match(errorWith(TWO, noHandler).message, /^let \.\.\.\("\/compact",\[\]\) handler: /);
  const sigStart = src.webview.lastIndexOf(`function ${tb.toolbar}(`, tb.signatureEnd);
  const noSession = editRange(src.webview, sigStart, tb.signatureEnd, `session:${tb.session},`, `sessioX:${tb.session},`);
  const e = errorWith([HANDOFF], noSession);
  assert.equal(e.name, "LayoutError");
  assert.match(e.message, /^session: /);
});
