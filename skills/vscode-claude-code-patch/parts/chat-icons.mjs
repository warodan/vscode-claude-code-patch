// chat-icons part: the user's own buttons in the chat composer, right of the
// context ring, from the config (`buttons`, set with --buttons <file>). A button
// runs a slash command through the command registry (the engine's run-plumbing),
// sends a text exactly as Enter would, or inserts one line at the end of the
// prompt box without sending it (the panel's own onInsertAtMention, the callback
// its "Add context" menu uses). Command and send buttons are greyed out and
// disabled while Claude works - a message sent mid-turn would be picked up
// mid-turn - and a panel without a busy signal gets none of them (the safe side);
// an insert button only edits the draft, so it stays usable. A command the
// registry does not list (yet) leaves its button grey. No buttons configured:
// nothing is inserted, and that is not an error.
//
// Config text reaches the bundle only through lit(): a JS string literal with `\`,
// `"` and `/` escaped and everything outside printable ASCII as \u escapes, so it
// can never become code, close a comment or spell a CC marker. The one raw splice
// is the id in the marker CC-ICON:<id>, safe by its pattern.

/** At most this many buttons: each is a 26px button in a narrow composer that does not wrap. */
export const MAX_BUTTONS = 5;
export const MAX_TOOLTIP = 80;
export const MAX_LABEL = 3;
export const MAX_TEXT = 2000;
export const MAX_INSERT = 500;
const ID_RE = /^[a-z0-9-]{1,24}$/;
// A registry label: a slash and a name (plugin skills as /plugin:skill), no arguments.
const COMMAND_RE = /^\/[A-Za-z0-9][\w.:-]{0,63}$/;
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
const CONTROL_IN_TEXT = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/; // a sent text may hold \n, \r and \t
const KEYS = ["id", "icon", "label", "tooltip", "action"];
const ACTION_KEYS = Object.freeze({ command: ["type", "command"], send: ["type", "text"], insert: ["type", "text"] });
const busyGated = (b) => b.action.type !== "insert";

// Codicon glyphs (CC BY 4.0, microsoft/vscode-codicons) from the codicon font the
// extension ships, as paths in a 16x16 box; "star" is the glyph star-full.
export const ICONS = Object.freeze({
  "arrow-right": "M9 13.9 14 8.9 14 8.2 9 3.2 8.3 3.9 12.4 8.1 2 8.1 2 9 12.4 9 8.3 13.2Z",
  export: "M13.1 7 10.7 4.6 11.4 3.9 15 7.5 11.4 11.1 10.7 10.4 13.1 8H3V7ZM1 4H2V11H1Z",
  check: "M14.5 3.3 6 13.3 5.2 13.3 1.8 8.5 2.6 7.9 5.6 12.2 13.7 2.7Z",
  pass:
    "M6.3 10.9H7L11.5 6.3L10.8 5.6L6.6 9.8L4.7 7.9L4 8.6ZM8.6 1Q9.8 1.1 10.9 1.6" +
    "Q11.9 2.1 12.8 3Q14.8 5.2 14.8 8.1Q14.8 10.4 13.2 12.5Q12.4 13.4 11.4 14.1" +
    "Q10.4 14.7 9.2 14.9Q6.7 15.4 4.6 14.2Q3.5 13.6 2.7 12.7Q1.9 11.8 1.5 10.7" +
    "Q1.1 9.5 1 8.3Q0.9 7.1 1.3 6Q2.1 3.5 4.1 2.2Q5.1 1.5 6.2 1.2Q7.4 0.9 8.6 1Z" +
    "M9.1 13.9Q11.1 13.4 12.5 11.8Q13.8 10 13.7 8Q13.7 6.8 13.3 5.7" +
    "Q12.8 4.5 12 3.7Q10.5 2.1 8.4 2Q7.4 1.9 6.4 2.2Q5.4 2.4 4.6 3" +
    "Q2.9 4.3 2.3 6.3Q1.7 8.4 2.5 10.3Q3.4 12.3 5.2 13.3Q6.1 13.8 7.1 14" +
    "Q8.1 14.1 9.1 13.9Z",
  sync:
    "M2 8.3 0.8 9.5 0 8.7 2.1 6.7 2.8 6.7 5 8.8 4.2 9.5 3 8.4Q3.1 10 4.2 11.3 5.3 12.5 7 12.9 8.6 13.2 10.1 12.5 " +
    "11.6 11.8 12.4 10.3L13.2 10.9Q12.2 12.7 10.4 13.5 8.5 14.3 6.6 13.8 4.6 13.4 3.4 11.8 2.1 10.3 2 8.3Z" +
    "M13 7.8 11.8 6.6 11 7.3 13.1 9.4 13.9 9.4 15.9 7.4 15.2 6.6 14 7.8Q13.9 5.8 12.7 4.3 11.5 2.7 9.5 2.2 " +
    "7.6 1.7 5.8 2.4 3.9 3.1 2.9 4.9L3.7 5.4Q4.5 4 6.1 3.4 7.6 2.7 9.2 3.1 10.8 3.6 11.9 4.9 12.9 6.1 13 7.8Z",
  pulse: "M11.8 9 10 3 9 3 7.1 9.7 6 4.7 5 4.7 3.8 9 1 9 1 10 4.2 10 4.7 9.6 5.4 6.9 6.6 12 7.6 12 9.5 5 10.9 9.7 11.4 10 15 10 15 9Z",
  graph:
    "M1.5 14 15 14 15 13 2 13 2 0 1 0 1 13.5ZM3 11.5 3 3.5 3.5 3 5.5 3 6 3.5 6 11.5 5.5 12 3.5 12ZM5 11 5 4 4 4 4 11Z" +
    "M11 1.5 11 11.5 11.5 12 13.5 12 14 11.5 14 1.5 13.5 1 11.5 1ZM13 2 13 11 12 11 12 2Z" +
    "M7 11.5 7 5.5 7.5 5 9.5 5 10 5.5 10 11.5 9.5 12 7.5 12ZM9 11 9 6 8 6 8 11Z",
  comment: "M14.5 2 1.5 2 1 2.5 1 11.5 1.5 12 4 12 4 14.5 4.9 14.9 7.7 12 14.5 12 15 11.5 15 2.5ZM14 11 7.5 11 7.1 11.1 5 13.3 5 11.5 4.5 11 2 11 2 3 14 3Z",
  rocket:
    "M14.5 1Q12 1 9.5 2.2 7.6 3.3 5.7 5L1.5 5 1 5.5 1 8.5 1.2 8.9 7.1 14.9 7.5 15 10.5 15 11 14.5 11 10.3" +
    "Q12.7 8.4 13.8 6.5 15 4 15 1.5ZM2 6 4.6 6Q3.4 7.3 2.4 8.7L2 8.3ZM7.7 14 7.3 13.6Q8.7 12.6 10 11.4L10 14Z" +
    "M6.6 12.9 3.1 9.4Q4 8.2 5.1 6.9 7 5 8.9 3.8 11.5 2.2 14 2 13.8 4.5 12.2 7.1 11 9 9.1 10.9 7.8 12 6.6 12.9Z" +
    "M4 15 4 14 2 14 2 12 1 12 1 15ZM10.8 7.3Q11.1 6.8 11 6.2 10.8 5.6 10.3 5.3 9.8 4.9 9.2 5 8.6 5.2 8.2 5.7 " +
    "7.9 6.2 8 6.8 8.2 7.4 8.7 7.8 9.2 8.1 9.8 8 10.4 7.8 10.8 7.3Z",
  debug:
    "M7.1 9 5.1 7 5.8 6.3 7.9 8.5 10 6.3 10.7 7 8.7 9.1 10.7 11.1 10 11.8 7.9 9.6 5.8 11.7 5.1 11Z" +
    "M11.3 3.4 11.3 4 12.2 4 14.1 2.1 14.8 2.8 13 4.6 13 4.6Q13.6 6.2 13.6 7.9L13.5 8.6 15.9 8.6 15.9 9.6 13.4 9.6 " +
    "13.4 9.6Q13.1 11.3 12.3 12.6L12.3 12.6 14.6 14.9 13.9 15.6 11.7 13.4 11.6 13.5Q10.9 14.3 9.9 14.8 9 15.3 " +
    "7.9 15.3 6.9 15.3 6 14.8 5 14.3 4.3 13.4L4.2 13.3 2 15.5 1.4 14.8 3.6 12.6 3.6 12.5Q2.8 11.2 2.5 9.6L2.5 9.6 " +
    "0 9.6 0 8.6 2.3 8.6 2.3 7.9Q2.3 6.2 2.9 4.7L2.9 4.6 1.1 2.8 1.8 2.1 3.7 4 4.6 4 4.6 3.4Q4.6 2.5 5.1 1.7 " +
    "5.5 0.9 6.3 0.5 7 0 7.9 0 8.9 0 9.6 0.5 10.4 0.9 10.9 1.7 11.3 2.5 11.3 3.4Z" +
    "M5.6 3.4 5.6 4 10.3 4 10.3 3.4Q10.3 2.3 9.7 1.7 9 1 8 1 7 1 6.3 1.7 5.6 2.3 5.6 3.4Z" +
    "M12.1 5 12.1 5 3.8 5 3.8 5Q3.3 6.4 3.3 7.9 3.3 9.2 3.7 10.4 4.1 11.6 4.7 12.5 5.4 13.4 6.2 13.8 7 14.3 " +
    "7.9 14.3 8.9 14.3 9.7 13.8 10.5 13.4 11.2 12.5 11.8 11.6 12.2 10.4 12.6 9.2 12.6 7.9 12.6 6.3 12.1 5Z",
  trash:
    "M10 3 13 3 13 4 12 4 12 13 11 14 4 14 3 13 3 4 2 4 2 3 5 3 5 2Q5 1.6 5.3 1.3 5.6 1 6 1L9 1Q9.4 1 9.7 1.3 " +
    "10 1.6 10 2ZM9 2 6 2 6 3 9 3ZM4 13 11 13 11 4 4 4ZM6 5 5 5 5 12 6 12ZM7 5 8 5 8 12 7 12ZM9 5 10 5 10 12 9 12Z",
  book:
    "M14.5 2 9 2 8.6 2.1 8 2.8 7.4 2.1 7 2 1.5 2 1 2.5 1 12.5 1.5 13 6.8 13 7.6 13.9 8.4 13.9 9.2 13 14.5 13 15 12.5 " +
    "15 2.5ZM7.5 12.3 7.3 12.2 7 12 2 12 2 3 6.8 3 7.5 3.7ZM14 12 9 12 8.6 12.2 8.5 12.3 8.5 3.7 9.2 3 14 3Z" +
    "M6 5 3 5 3 6 6 6ZM6 9 3 9 3 10 6 10ZM3 7 6 7 6 8 3 8ZM13 5 10 5 10 6 13 6ZM10 7 13 7 13 8 10 8ZM10 9 13 9 13 10 10 10Z",
  star: "M9.6 6.2 8 1 6.4 6.2 1 6.2 5.4 9.7 3.7 15 8 11.7 12.3 15 10.6 9.7 15 6.2Z",
});

// The part's own texts by language; Russian only as \u escapes.
const TEXTS = Object.freeze({
  en: {
    busy: "Unavailable: Claude is still working",
    notLoaded: (command) => `${command} is not loaded yet or not installed`,
  },
  ru: {
    busy: "\u041d\u0435\u0434\u043e\u0441\u0442\u0443\u043f\u043d\u043e: Claude \u0435\u0449\u0451 \u0440\u0430\u0431\u043e\u0442\u0430\u0435\u0442",
    notLoaded: (command) => "\u041a\u043e\u043c\u0430\u043d\u0434\u0430 " + command +
      " \u0435\u0449\u0451 \u043d\u0435 \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u043b\u0430\u0441\u044c \u0438\u043b\u0438 \u043d\u0435 \u0443\u0441\u0442\u0430\u043d\u043e\u0432\u043b\u0435\u043d\u0430",
  },
});

// A text button: the stock .menuButton is a 26px circle, so its width and shape are overridden.
const LABEL_STYLE = 'style:{width:"auto",minWidth:"26px",padding:"0 6px",fontSize:"11px",lineHeight:"1",whiteSpace:"nowrap",borderRadius:"5px"}';

const COMPACT_ANCHOR = '("/compact",[])';
const ID = "[\\w$]+";

/** A JS string literal: `\`, `"` and `/` escaped, every character outside printable ASCII as a \u escape. */
function lit(text) {
  const body = String(text).replace(/[\\"/]/g, "\\$&")
    .replace(/[^\x20-\x7e]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
  return '"' + body + '"';
}

/** Length in characters (code points), not UTF-16 units. */
const chars = (s) => [...s].length;
const isLine = (s, max) => typeof s === "string" && s.trim() !== "" && chars(s) <= max && !CONTROL.test(s);
const describe = (v) => (Array.isArray(v) ? "a list" : v === null ? "null" : typeof v);

/**
 * The buttons of the config, checked: a list of at most MAX_BUTTONS objects
 *   { id, icon | label, tooltip, action: { type: "command", command } | { type: "send" | "insert", text } }.
 * Throws an Error naming the first bad field ("buttons[1].tooltip: ..."); returns a frozen copy.
 */
export function validateButtons(list) {
  if (!Array.isArray(list)) throw new Error(`buttons: expected a list, got ${describe(list)}`);
  if (list.length > MAX_BUTTONS) throw new Error(`buttons: ${list.length} buttons, at most ${MAX_BUTTONS}`);
  const seen = new Set();
  return Object.freeze(list.map((b, i) => {
    const fail = (field, why) => {
      throw new Error(`buttons[${i}]${field ? `.${field}` : ""}: ${why}`);
    };
    if (!b || typeof b !== "object" || Array.isArray(b)) fail("", `expected an object, got ${describe(b)}`);
    const extra = Object.keys(b).filter((k) => !KEYS.includes(k));
    if (extra.length) fail("", `unknown key ${extra.join(", ")} (keys: ${KEYS.join(", ")})`);
    if (typeof b.id !== "string" || !ID_RE.test(b.id)) fail("id", "1-24 characters from a-z, 0-9 and -");
    if (seen.has(b.id)) fail("id", `${JSON.stringify(b.id)} is used twice`);
    seen.add(b.id);
    if ((b.icon === undefined) === (b.label === undefined)) fail("", "needs exactly one of icon and label");
    if (b.icon !== undefined && !(typeof b.icon === "string" && Object.hasOwn(ICONS, b.icon))) {
      fail("icon", `unknown icon ${JSON.stringify(b.icon)} (icons: ${Object.keys(ICONS).join(", ")})`);
    }
    if (b.label !== undefined && !isLine(b.label, MAX_LABEL)) fail("label", `1-${MAX_LABEL} characters, no control characters`);
    if (!isLine(b.tooltip, MAX_TOOLTIP)) fail("tooltip", `required, 1-${MAX_TOOLTIP} characters, no control characters`);
    const a = b.action;
    if (!a || typeof a !== "object" || Array.isArray(a) || !Object.hasOwn(ACTION_KEYS, a.type)) {
      fail("action", 'needs a type: "command", "send" or "insert"');
    }
    const aExtra = Object.keys(a).filter((k) => !ACTION_KEYS[a.type].includes(k));
    if (aExtra.length) fail("action", `unknown key ${aExtra.join(", ")} for type ${a.type} (keys: ${ACTION_KEYS[a.type].join(", ")})`);
    if (a.type === "command" && !(typeof a.command === "string" && COMMAND_RE.test(a.command))) {
      fail("action.command", 'a slash command as the command menu lists it, e.g. "/usage": no spaces, no arguments (a send button can carry arguments)');
    }
    if (a.type === "send" && !(typeof a.text === "string" && a.text.trim() !== "" && chars(a.text) <= MAX_TEXT && !CONTROL_IN_TEXT.test(a.text))) {
      fail("action.text", `required, 1-${MAX_TEXT} characters`);
    }
    if (a.type === "insert" && !isLine(a.text, MAX_INSERT)) {
      fail("action.text", `required, one line of 1-${MAX_INSERT} characters (the prompt box takes no line breaks this way)`);
    }
    const out = { id: b.id, tooltip: b.tooltip, action: Object.freeze({ ...a }) };
    if (b.icon !== undefined) out.icon = b.icon;
    else out.label = b.label;
    return Object.freeze(out);
  }));
}

/** Run fn; a LayoutError it throws is re-thrown with `label` in front. */
function derive(ctx, label, fn) {
  try {
    return fn();
  } catch (e) {
    if (e && e.name === "LayoutError") throw new ctx.LayoutError(`${label}: ${e.message}`);
    throw e;
  }
}

function svg(J, d) {
  return `${J}("svg",{width:"26",height:"26",viewBox:"-5 -5 26 26","aria-hidden":!0,style:{display:"block"},` +
    `children:${J}("path",{d:${JSON.stringify(d)},fill:"currentColor"})})`;
}

/** One button as a call to the bundle's JSX helper, inside the panel's render. */
function buttonJs(b, tb, T) {
  const J = tb.jsx, busy = `${tb.session}.busy.value`, a = b.action;
  const head = `/*CC-ICON:${b.id}*/${J}("button",{type:"button",className:${tb.styles}.menuButton,"data-cc-icon":${lit(b.id)},`;
  const face = b.icon !== undefined ? `children:${svg(J, ICONS[b.icon])}` : `${LABEL_STYLE},children:${lit(b.label)}`;
  if (a.type === "command") {
    // Guarded: a missing prop would throw at render and take the composer down, not just the button.
    const cmd = lit(a.command), can = `(__ccCan&&__ccCan(${cmd}))`;
    return head + `disabled:${busy}||!${can},` +
      `title:${busy}?${lit(T.busy)}:${can}?${lit(b.tooltip)}:${lit(T.notLoaded(a.command))},` +
      `onClick:()=>{try{__ccRun(${cmd})}catch{}},${face}}),`;
  }
  if (a.type === "insert") {
    // The panel's onInsertAtMention: appends at the end of the draft, with a space before it where needed.
    const ins = tb.insertFn;
    return head + `disabled:!${ins},title:${lit(b.tooltip)},` +
      `onClick:()=>{try{${ins}&&${ins}(${lit(a.text)})}catch{}},${face}}),`;
  }
  return head + `disabled:${busy},` +
    `title:${busy}?${lit(T.busy)}:${lit(b.tooltip)},` +
    `onClick:()=>{try{__ccSendText(${lit(a.text)})}catch{}},${face}}),`;
}

export default {
  id: "chat-icons",
  targets: ["webview"],
  validateButtons,
  plan(target, src, ctx) {
    const E = ctx.LayoutError;
    if (target !== "webview") throw new E(`chat-icons has no target ${target}`);
    const options = ctx.options || {};
    const buttons = validateButtons(options.buttons === undefined ? [] : options.buttons);
    if (!buttons.length) return { edits: [], requires: [], symbols: {}, notes: ["no buttons configured; --buttons <file> adds them"] };
    const T = TEXTS[options.language] || TEXTS.en;
    const tb = ctx.toolbar;
    if (tb === null) throw new E(ctx.toolbarError || "composer panel not recognized");
    if (ctx.count("__cc") !== 0) throw new E("pristine webview already contains __cc names");

    const edits = [];
    const symbols = { jsx: tb.jsx, css: tb.styles, session: tb.session };
    if (buttons.some((b) => b.action.type === "send")) {
      // The panel's own send function, from its /compact handler.
      const compactAt = ctx.once(COMPACT_ANCHOR);
      const compactRe = new RegExp(`let (${ID})=\\(\\)=>\\{(${ID})\\("\\/compact",\\[\\]\\)\\}`);
      // Any match contains ("/compact",[]), which occurs exactly once: it is the anchor.
      const cm = derive(ctx, 'let ...("/compact",[]) handler', () => ctx.lastBefore(compactRe, compactAt, 200));
      // The send function is in scope at the call site only if the handler is passed there.
      const onCompactRe = new RegExp(`onCompact:${ctx.escapeRe(cm[1])}(?![\\w$])`);
      derive(ctx, "onCompact guard", () => ctx.firstAfter(onCompactRe, tb.callPropsAt, 1500));
      edits.push(
        { at: tb.signatureEnd, text: ",onSendText:__ccSendText/*CC-SEND*/" },
        { at: tb.callPropsAt, text: `onSendText:(__ccT)=>${cm[2]}(__ccT,[]),/*CC-SEND*/` },
      );
      Object.assign(symbols, { send: cm[2], compact: cm[1] });
    }

    // Command and send buttons are disabled while the session is busy; no signal, no buttons.
    if (buttons.some(busyGated)) {
      if (!tb.session) throw new E("session: no session:(ID) in the composer panel signature");
      const bodyOpen = tb.signatureEnd + 2;
      const bodyClose = derive(ctx, "panel body", () => ctx.matchBracket(bodyOpen));
      const busyRe = new RegExp(`(?<![.\\w$])${ctx.escapeRe(tb.session)}\\.busy\\.value`);
      if (!busyRe.test(src.slice(bodyOpen, bodyClose + 1))) throw new E("no busy signal");
    }

    // List order is screen order: one point, applyEdits keeps list order there.
    for (const b of buttons) edits.push({ at: tb.afterSlashAt, text: buttonJs(b, tb, T) });
    return {
      edits,
      requires: buttons.some((b) => b.action.type === "command") ? ["run-plumbing"] : [],
      symbols,
      notes: [],
    };
  },
};
