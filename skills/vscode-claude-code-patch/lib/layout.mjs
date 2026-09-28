// Composer-panel layout of the Claude Code webview bundle, the string helpers the
// engine hands to every part through `ctx`, and the one implementation of the
// same-point insertion order.
//
// Ported from v1 (vscode-claude-chat-context-meter, patch_claude_code_ui.mjs,
// sha1 aa355bc1b3e7): the Layout class and its derivations are v1's, so the ring
// sees exactly the offsets and names v1 saw. What changed on purpose:
//   - applyEdits keeps list order at one point (earlier edit = further left);
//     v1 reversed it.
//   - slot() is gone: the only slot is `afterSlashAt`.
//   - the anchor goes through once(), the same uniqueness check parts use.
//   - a Layout is frozen: parts share one instance and must not change it.
//
// No path is computed and nothing is read here; this module is pure.

/** Tooltip of the built-in slash-command button; must occur exactly once. */
export const ANCHOR = 'title:"Show command menu (/)"';

// How far from the anchor the toolbar's own pieces may sit before the layout is
// treated as "not the component we think it is" (v1 values).
const SPACER_MAX_DISTANCE = 4000;
const REGISTRY_LOOKBACK = 60000;
// Fallback auto-compact reserve, used only when the bundle's figure cannot be read.
const USAGE_RESERVE = 13000;
const MODEL_SIGNALS = ["currentMainLoopModel", "lastServedModel"];
// ctx.options when the caller passes none: English, no buttons.
const DEFAULT_OPTIONS = Object.freeze({ language: "en", buttons: Object.freeze([]) });

/** A structural mismatch: the bundle is not shaped the way a part expects. */
export class LayoutError extends Error {
  constructor(message) {
    super(message);
    this.name = "LayoutError";
  }
}

/* ----------------------------------------------------------------- helpers */

/** Escape text for use inside a RegExp source (minified names carry `$`). */
export function escapeRe(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function globalRe(re) {
  if (typeof re === "string") return new RegExp(escapeRe(re), "g");
  if (!(re instanceof RegExp)) throw new TypeError("expected a RegExp or a string");
  return new RegExp(re.source, re.flags.replace(/[gy]/g, "") + "g");
}

/**
 * Occurrences of `needle` in `src`. A string counts every start position, so
 * overlapping hits count ("aa" in "aaa" is 2); a RegExp counts its global matches.
 */
export function count(src, needle) {
  if (typeof needle !== "string") return [...src.matchAll(globalRe(needle))].length;
  if (needle === "") throw new TypeError("count: empty needle");
  let n = 0;
  for (let at = src.indexOf(needle); at !== -1; at = src.indexOf(needle, at + 1)) n += 1;
  return n;
}

/** Offset of the only occurrence of `str`; LayoutError naming it otherwise. */
export function once(src, str) {
  if (typeof str !== "string" || str === "") throw new TypeError("once: expected a non-empty string");
  const hits = count(src, str);
  if (hits !== 1) throw new LayoutError(`anchor '${str}' found ${hits} times (expected exactly 1)`);
  return src.indexOf(str);
}

/**
 * The last match of `re` that starts in [pos - maxDist, pos). The scan starts at
 * the window, so a match that begins earlier and runs into it does not hide one
 * that begins inside it. The match may extend past `pos`.
 */
export function lastBefore(src, re, pos, maxDist = Infinity) {
  const rx = globalRe(re);
  rx.lastIndex = Number.isFinite(maxDist) ? Math.max(0, pos - maxDist) : 0;
  let best = null;
  for (let m = rx.exec(src); m && m.index < pos; m = rx.exec(src)) {
    best = m;
    if (m[0] === "") rx.lastIndex += 1;
  }
  if (!best) throw new LayoutError(`${rx} not found within ${maxDist} chars before ${pos}`);
  return best;
}

/** The first match of `re` that starts in [pos, pos + maxDist]. */
export function firstAfter(src, re, pos, maxDist = Infinity) {
  const rx = globalRe(re);
  rx.lastIndex = pos;
  const m = rx.exec(src);
  if (!m || m.index - pos > maxDist) throw new LayoutError(`${rx} not found within ${maxDist} chars after ${pos}`);
  return m;
}

/**
 * Offset of the bracket closing the one at `i` ('(', '[' or '{'). Only that
 * bracket kind is counted. String and template literals are skipped whole
 * (backslash escapes honoured); `${}` inside a template, regex literals and
 * comments are not understood - the scanner of webview/probe.js.
 */
export function matchBracket(src, i) {
  const open = src[i];
  const close = { "(": ")", "[": "]", "{": "}" }[open];
  if (!close) throw new LayoutError(`no opening bracket at ${i}`);
  let depth = 0;
  for (let k = i; k < src.length; k++) {
    const c = src[k];
    if (c === '"' || c === "'" || c === "`") {
      for (k++; k < src.length && src[k] !== c; k++) if (src[k] === "\\") k++;
    } else if (c === open) {
      depth += 1;
    } else if (c === close && --depth === 0) {
      return k;
    }
  }
  throw new LayoutError(`unbalanced '${open}' at ${i}`);
}

/* ------------------------------------------------------------------ layout */

/**
 * Everything the parts need to know about the composer panel ("toolbar").
 * Every field is derived from the bundle; only the anchor is hardcoded, so a
 * rebuild with new minified names still works, while a structural change
 * throws LayoutError instead of yielding offsets into the wrong code.
 */
export class Layout {
  constructor(src) {
    this.anchorAt = once(src, ANCHOR);
    const windowStart = Math.max(0, this.anchorAt - 900);
    const window = src.slice(windowStart, this.anchorAt);

    const children = [...window.matchAll(/children:\[([\w$]+)\(/g)];
    if (children.length === 0) throw new LayoutError("no toolbar 'children:[' array before the anchor");
    const lastChild = children[children.length - 1];
    this.jsx = lastChild[1];
    this.childrenAt = windowStart + lastChild.index + "children:[".length;

    // The array-children helper (jsxs). The lookbehind keeps a member expression
    // such as `e.jsxs("div",{` from yielding the free identifier `jsxs`.
    const wrappers = [...window.matchAll(/(?<![.\w$])([\w$]+)\("div",\{/g)].filter((m) => m.index < lastChild.index);
    this.jsxs = wrappers.length ? wrappers[wrappers.length - 1][1] : null;

    const styles = window.match(/className:([\w$]+)\.menuButton/);
    if (!styles) throw new LayoutError("no CSS-module object (className:X.menuButton)");
    this.styles = styles[1];

    const insertFn = window.match(/onInsertAtMention:([\w$]+)[,}]/);
    if (!insertFn) throw new LayoutError("no text-insertion callback (onInsertAtMention:X)");
    this.insertFn = insertFn[1];

    // The slot right after the built-in slash-command button element.
    const slashButtons = [...src.slice(0, this.anchorAt).matchAll(/([\w$]+)\("button",\{/g)];
    if (slashButtons.length === 0) throw new LayoutError("no button element wrapping the anchor");
    const btn = slashButtons[slashButtons.length - 1];
    const elementEnd = matchBracket(src, btn.index + btn[1].length) + 1;
    if (!(btn.index < this.anchorAt && this.anchorAt < elementEnd)) {
      throw new LayoutError("the anchor is not inside the button element it should belong to");
    }
    if (src[elementEnd] !== ",") throw new LayoutError("unexpected token after the slash-command button element");
    this.afterSlashAt = elementEnd + 1;

    // The right-hand group starts after the flex spacer element.
    const spacer = src.slice(this.anchorAt).match(/[\w$]+\("div",\{className:[\w$]+\.spacer\}\),/);
    if (!spacer) throw new LayoutError("no toolbar spacer element (right-hand group)");
    if (spacer.index > SPACER_MAX_DISTANCE) {
      throw new LayoutError(`nearest spacer is ${spacer.index} chars past the anchor - probably a different component, refusing to guess`);
    }
    this.spacerEnd = this.anchorAt + spacer.index + spacer[0].length;

    // The panel component: the function that contains the anchor.
    const fnStart = src.lastIndexOf("function ", this.anchorAt - "function ".length);
    const name = fnStart >= 0 ? /^function ([\w$]+)\(\{/.exec(src.slice(fnStart, fnStart + 60)) : null;
    if (!name) throw new LayoutError("no toolbar component declaration (function X({...}))");
    this.toolbar = name[1];
    const sigEnd = src.indexOf("}){", fnStart);
    if (sigEnd < 0 || sigEnd > this.anchorAt) throw new LayoutError("could not delimit the toolbar component signature");
    this.signatureEnd = sigEnd; // an extra prop goes right before this '}'

    this.readUsage(src, fnStart, sigEnd);

    // Its single call site, and the context object holding the command registry.
    const calls = [...src.matchAll(new RegExp(`[\\w$]+\\(${escapeRe(this.toolbar)},\\{`, "g"))];
    if (calls.length !== 1) throw new LayoutError(`expected exactly 1 call site of ${this.toolbar}, found ${calls.length}`);
    this.callPropsAt = calls[0].index + calls[0][0].length;
    const scope = src.slice(Math.max(0, this.callPropsAt - REGISTRY_LOOKBACK), this.callPropsAt);
    const registry = [...scope.matchAll(/(?<![.\w$])([\w$]+)\.commandRegistry/g)];
    if (registry.length === 0) throw new LayoutError("command registry not in the caller's scope (run mode impossible)");
    this.ctx = registry[registry.length - 1][1];

    for (const method of ["findCommandByLabel(", "executeCommand("]) {
      if (!src.includes(method)) throw new LayoutError(`registry method ${JSON.stringify(method)} missing from the bundle`);
    }
    Object.freeze(this.modelSignals);
    Object.freeze(this);
  }

  /**
   * The session signal and the live context figure, for the ring. Optional by
   * design: nothing here throws; a build without them leaves `hasUsage` false.
   *   b(Pie,{usedTokens:<session>.usageData.value.totalTokens, contextWindow:...})
   */
  readUsage(src, fnStart, sigEnd) {
    this.session = null;
    this.hasUsage = false;
    this.usageReserve = USAGE_RESERVE;
    this.modelSignals = [];
    this.pieOffAt = null; // where the built-in counter is switched off

    const session = src.slice(fnStart, sigEnd).match(/[({,]session:([\w$]+)[,}]/);
    if (!session) return;
    this.session = session[1];

    // From the end of the signature past the spacer: the counter sits in either group.
    const body = src.slice(sigEnd, Math.min(src.length, this.spacerEnd + 3000));
    const value = `${escapeRe(this.session)}\\.usageData\\.value`;
    if (!new RegExp(`${value}\\.totalTokens`).test(body)) return;
    const reserve = this.readReserve(src, body, value);
    if (reserve === null) return;

    this.usageReserve = reserve;
    this.hasUsage = true;
    this.modelSignals = MODEL_SIGNALS.filter((signal) => src.includes(`${signal}=`));
    this.readPie(src, body);
  }

  /**
   * The auto-compact reserve in the stock counter's window expression, or null
   * when the expression is absent. Shapes: inline `<v>.contextWindow-<v>.maxOutputTokens-13000`
   * (<= 2.1.27x); helper `fn(<v>.contextWindow,<v>.maxOutputTokens)` with
   * `function fn($,J){return $-Math.min(J,CAP)-RES}` (2.1.280+).
   */
  readReserve(src, body, value) {
    const inline = body.match(new RegExp(`${value}\\.contextWindow-${value}\\.maxOutputTokens-(\\d+)`));
    if (inline) return Number(inline[1]);
    const call = body.match(new RegExp(`([\\w$]+)\\(${value}\\.contextWindow,${value}\\.maxOutputTokens\\)`));
    if (!call) return null;
    const fn = src.match(new RegExp(
      `function ${escapeRe(call[1])}\\(([\\w$]+),([\\w$]+)\\)\\{return \\1-Math\\.min\\(\\2,[\\w$]+\\)-([\\w$]+|\\d+)\\}`));
    if (!fn) return USAGE_RESERVE;
    if (/^\d+$/.test(fn[3])) return Number(fn[3]);
    const res = src.match(new RegExp(`(?:var|let|const) ${escapeRe(fn[3])}=(\\d+)[;,]`));
    return res ? Number(res[1]) : USAGE_RESERVE;
  }

  /** Where to switch the stock usage counter off: just inside its function body. */
  readPie(src, body) {
    const host = body.match(/[\w$]+\(([\w$]+),\{usedTokens:/);
    if (!host) return;
    const fnAt = src.indexOf(`function ${host[1]}(`);
    if (fnAt < 0) return;
    const bodyAt = src.indexOf("}){", fnAt);
    if (bodyAt < 0 || bodyAt - fnAt > 400) return; // not the signature we expect
    this.pieOffAt = bodyAt + "}){".length;
  }

  /** Derived names, in the shape of the v1 ledger's `symbols`. */
  symbols() {
    return {
      jsx: this.jsx,
      jsxs: this.jsxs || "-",
      css: this.styles,
      insert: this.insertFn,
      toolbar: this.toolbar,
      ctx: this.ctx,
      session: this.session || "-",
    };
  }

  describe() {
    return Object.entries(this.symbols()).map(([k, v]) => `${k}=${v}`).join(", ");
  }
}

/**
 * The panel of a pristine webview source, or null with the reason. Never throws:
 * an unexpected error (a TypeError from a regex on a new build) is a reason too.
 */
export function readToolbar(webviewSrc) {
  try {
    return { toolbar: new Layout(webviewSrc), toolbarError: null };
  } catch (err) {
    const line = String((err && err.message) || err).split("\n")[0];
    return { toolbar: null, toolbarError: err instanceof LayoutError ? line : `${(err && err.name) || "Error"}: ${line}` };
  }
}

/**
 * The `ctx` a part's plan(target, src, ctx) receives, with every
 * helper bound to `src` - the pristine copy of the target being planned.
 * `toolbar`/`toolbarError` come from readToolbar() on the pristine webview,
 * whatever the target. `options` carries the config's choices for the parts:
 * `language` ("en" | "ru") and `buttons` (chat-icons checks them); frozen.
 */
export function makeCtx({ version, target, src, toolbar, toolbarError, options = DEFAULT_OPTIONS }) {
  if (typeof src !== "string") throw new TypeError("makeCtx: src must be the target's source string");
  if (toolbar !== null && !(toolbar instanceof Layout)) throw new TypeError("makeCtx: toolbar must be a Layout or null");
  if (toolbar === null && typeof toolbarError !== "string") throw new TypeError("makeCtx: a null toolbar needs its toolbarError");
  if (!options || typeof options !== "object") throw new TypeError("makeCtx: options must be an object");
  return Object.freeze({
    version,
    target,
    LayoutError,
    toolbar,
    toolbarError: toolbar === null ? toolbarError : null,
    options: Object.isFrozen(options) ? options : Object.freeze({ ...options }),
    once: (str) => once(src, str),
    count: (needle) => count(src, needle),
    lastBefore: (re, pos, maxDist) => lastBefore(src, re, pos, maxDist),
    firstAfter: (re, pos, maxDist) => firstAfter(src, re, pos, maxDist),
    matchBracket: (i) => matchBracket(src, i),
    escapeRe,
  });
}

/* ------------------------------------------------------------------- edits */

/**
 * Insert every edit {at, text} into src in one pass. Edits at the same offset
 * land in list order - the earlier one further left - so the caller
 * concatenates the lists in part order. Insert-only; `at` must be an integer in
 * [0, src.length] and `text` a string, else RangeError / TypeError.
 */
export function applyEdits(src, edits) {
  if (typeof src !== "string") throw new TypeError("applyEdits: src must be a string");
  const list = edits.map((edit, i) => {
    const at = edit && edit.at;
    if (!Number.isInteger(at) || at < 0 || at > src.length) throw new RangeError(`applyEdits: edit ${i} has at=${at}, outside [0, ${src.length}]`);
    if (typeof edit.text !== "string") throw new TypeError(`applyEdits: edit ${i} has no string text`);
    return { at, text: edit.text, i };
  });
  list.sort((a, b) => a.at - b.at || a.i - b.i);
  const out = [];
  let prev = 0;
  for (const { at, text } of list) {
    out.push(src.slice(prev, at), text);
    prev = at;
  }
  out.push(src.slice(prev));
  return out.join("");
}
