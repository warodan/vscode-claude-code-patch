// chat-media part: buttons under absolute paths, image previews and a viewer in
// the chat webview, and the host side that answers them in extension.js.
//
// Webview: seven inserts W1-W7 around the markdown renderer; W1 carries the CC-HELP
// block (assets/webview-helpers.js) with the bundle's derived names and the
// configured language (ctx.options.language, "en" without one) filled in.
// Host: CC-OPEN in openFile's folder branch (H1) and five request handlers at the
// start of processRequest (H2), from assets/host-snippets.mjs.
// ctx.options.platform ("win32" without one; "linux" on a VS Code Remote-SSH
// server) picks the variant of both: the Windows texts are those of every
// earlier build, the Linux ones also take absolute POSIX paths.
// plan() reads nothing but its own asset and never writes.

import fs from "node:fs";
import { hostSnippets, H2_ORDER } from "../assets/host-snippets.mjs";

const ID = "[\\w$]+";

/**
 * Regex source of a destructured parameter `{k1:a,k2:b,...}` that holds `keys` in
 * any order, among any other props: a build that adds one (2.1.286 added
 * `links:X="live"` to the markdown component) still matches. Each key's local name
 * is one capture group, in the order of `keys`. Defaults holding `{` or `}` are
 * not understood.
 */
function props(...keys) {
  return `\\{${keys.map((k) => `(?=(?:[^{}]*,)?${k}:(${ID}))`).join("")}[^{}]*\\}`;
}

/** Languages of the label tables in the assets; each table has one entry per language. */
export const LANGUAGES = Object.freeze(["en", "ru"]);
/** Placeholder of the label tables, replaced by the language at build time. */
export const LANG_PLACEHOLDER = "__CC_LANG__";

/** The five webview anchors of chat-media. */
export const ANCHORS = Object.freeze({
  code: ".codeBlockWrapper,children:[",
  imageBlocked: "title:`Image blocked: ${",
  urlTransform: ".urlTransform||",
  copyLink: '"Copy Link"',
  fileOpener: "fileOpener={open:",
});

/**
 * Host derivations; each must match exactly once. From 2.1.284 the uri line of H1
 * also declares an exists flag that the catch clears (`let U=V.Uri.file(P),G=!0;`
 * ... `catch{G=!1}`): group 4 is the flag, group 6 the catch body; planHost takes
 * both or neither, and CC-OPEN then acts only when the flag is set.
 */
export const HOST_RES = Object.freeze({
  H1: /let ([\w$]+)=([\w$]+)\.Uri\.file\(([\w$]+)\)(?:,([\w$]+)=!0)?;try\{if\(([\w$]+)\.statSync\(\3\)\.isDirectory\(\)\)\{\2\.commands\.executeCommand\("revealInExplorer",\1\);return\}\}catch\{((?:\4=!1)?)\}/,
  H2: /async processRequest\(([\w$]+),([\w$]+)\)\{if\(\1\.request\.type==="get_current_selection"\)/,
});

/** Placeholders of the CC-HELP block by the name they stand for. */
export const PLACEHOLDERS = Object.freeze({
  jsx: "__CC_JSX__",
  jsxs: "__CC_JSXS__",
  useRef: "__CC_USEREF__",
  useEffect: "__CC_USEEFFECT__",
  useState: "__CC_USESTATE__",
  useCallback: "__CC_USECALLBACK__",
  urlFilter: "__CC_URLFILTER__",
  copyButton: "__CC_COPY__",
  css: "__CC_CSS__",
});

/**
 * Host platforms a build is made for, and the asset variant each one takes: the
 * engine's own platform (it runs where the extension is installed), so a VS Code
 * Remote-SSH server gets the posix variant and Windows the text it always had.
 */
export const PLATFORM_VARIANTS = Object.freeze({ win32: "win32", linux: "posix" });

/** The asset variant of `platform`; TypeError for a platform without one. */
export function variantOf(platform = "win32") {
  if (!Object.hasOwn(PLATFORM_VARIANTS, platform)) throw new TypeError(`unknown platform ${JSON.stringify(platform)}`);
  return PLATFORM_VARIANTS[platform];
}

/**
 * The lines of an asset for one variant: a block opened by a full line `//@win32`
 * or `//@posix` runs to `//@end` or to the other variant's opening line (an
 * else branch), and is kept only for its variant; lines outside any block are
 * kept for both. The directive lines themselves go.
 */
export function pickVariant(lines, variant) {
  const out = [];
  let open = null;
  for (const line of lines) {
    const d = /^\s*\/\/@(win32|posix|end)\s*$/.exec(line);
    if (!d) {
      if (open === null || open === variant) out.push(line);
      continue;
    }
    if (d[1] === "end" ? open === null : open === d[1]) {
      throw new TypeError(`asset variants: //@${d[1]} ${open === null ? "outside a block" : "inside its own block"}`);
    }
    open = d[1] === "end" ? null : d[1];
  }
  if (open !== null) throw new TypeError(`asset variants: //@${open} is not closed by //@end`);
  return out;
}

/** The configured host platform: ctx.options.platform, "win32" without one. */
export function platformOf(ctx) {
  const platform = ctx.options?.platform ?? "win32";
  if (!Object.hasOwn(PLATFORM_VARIANTS, platform)) throw new ctx.LayoutError(`unknown platform ${JSON.stringify(platform)}`);
  return platform;
}

/**
 * The CC-HELP block with `names` and `language` substituted, without the marker,
 * in the variant of `platform`. Full-line // comments and blank lines of the
 * asset are dropped; every other line is kept on its own line, so nothing can
 * comment out the bundle code that follows.
 */
export function helpersText(names, language = "en", platform = "win32") {
  const file = new URL("../assets/webview-helpers.js", import.meta.url);
  let text = pickVariant(fs.readFileSync(file, "utf8").split(/\r?\n/), variantOf(platform))
    .filter((line) => line.trim() !== "" && !/^\s*\/\//.test(line))
    .map((line) => line.trim())
    .join("\n");
  for (const [key, placeholder] of Object.entries(PLACEHOLDERS)) {
    if (typeof names[key] !== "string" || !/^[\w$]+$/.test(names[key])) {
      throw new TypeError(`helpersText: no name for ${placeholder}`);
    }
    text = text.split(placeholder).join(names[key]);
  }
  if (!LANGUAGES.includes(language)) throw new TypeError(`helpersText: unknown language ${JSON.stringify(language)}`);
  return text.split(LANG_PLACEHOLDER).join(language) + "\n";
}

/** The configured UI language: ctx.options.language, "en" without options. */
export function languageOf(ctx) {
  const language = ctx.options?.language ?? "en";
  if (!LANGUAGES.includes(language)) throw new ctx.LayoutError(`unknown language ${JSON.stringify(language)}`);
  return language;
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

/** The only match of `re` in `src`; LayoutError naming `label` otherwise. */
function only(ctx, src, label, re) {
  const n = ctx.count(re);
  if (n !== 1) throw new ctx.LayoutError(`${label}: /${re.source}/ matched ${n} times (expected exactly 1)`);
  return re.exec(src);
}

function planWebview(src, ctx) {
  const E = ctx.LayoutError, esc = ctx.escapeRe;
  if (ctx.count("__cc") !== 0) throw new E("pristine webview already contains __cc names");
  const at = {};
  for (const [key, anchor] of Object.entries(ANCHORS)) at[key] = ctx.once(anchor);

  // Channel guard: requests travel the way the stock fileOpener sends open_file.
  const opener = src.slice(at.fileOpener, at.fileOpener + ANCHORS.fileOpener.length + 200);
  if (!opener.includes("this.comms.connection.value")) {
    throw new E("channel guard: no this.comms.connection.value within 200 chars after fileOpener={open:");
  }
  only(ctx, src, "channel guard sendRequest", new RegExp(`sendRequest\\((${ID}),(${ID}),(${ID}),(${ID})=`));

  // W2: the markdown component H$ and its context parameter.
  const h = derive(ctx, "W2 markdown component signature", () => ctx.lastBefore(new RegExp(
    `function (${ID})\\(${props("content", "context")}\\)\\{`), at.imageBlocked, 3000));
  const hBody = h.index + h[0].length, cx = h[3];
  // W3: the react-markdown call inside H$, and the stock URL filter it falls back to.
  // Up to 2.1.295 the call spells `{remarkPlugins:` itself (group 3); from 2.1.296
  // it spreads the options of a platform function first, `{...ul0(Y,X),`
  // (group 4), and our key goes after the spread so that it wins. From 2.1.301
  // the call spells `{remarkPlugins:` again, but further down (math rendering came
  // before it) and with an explicit `urlTransform:U,` destructured from that
  // platform function: our key then goes right after it, so that it wins. From
  // 2.1.304 the components map is a memo built above the call, which passes it as
  // `components:B,` and stands about 1800 chars after H$'s body.
  const md = derive(ctx, "W3 react-markdown call", () => ctx.firstAfter(new RegExp(
    `(?<![.\\w$])(${ID})\\((${ID}),\\{(?:(remarkPlugins:)|\\.\\.\\.(${ID})\\(${ID},${ID}\\),)`), hBody, 2400));
  // W7 looks for the components map of this call; W3 needs it as the end of the call's own keys.
  const comps = derive(ctx, "W7 markdown components", () => ctx.firstAfter(
    new RegExp(`components:(?:\\{|(${ID}),)`), md.index, 200));
  // W7 inserts at the start of the map: inline (`components:{`), or the memo's
  // object (`B=k0(()=>({`), which must hold the W5 img component.
  let quoteAt = comps.index + comps[0].length;
  if (comps[1] !== undefined) {
    const memo = derive(ctx, "W7 components memo", () => ctx.lastBefore(new RegExp(
      `(?<![.\\w$])${esc(comps[1])}=${ID}\\(\\(\\)=>\\(\\{`), md.index, 1200));
    quoteAt = memo.index + memo[0].length;
    const close = derive(ctx, "W7 components memo", () => ctx.matchBracket(quoteAt - 1));
    if (!/img:\(/.test(src.slice(quoteAt, close))) throw new E(`W7 components memo: ${comps[1]} holds no img: component`);
  }
  let platform = md[4], urlAt = md.index + md[0].length - (md[3] ? md[3].length : 0);
  if (md[3] !== undefined) {
    const own = new RegExp(`(?:^|,)urlTransform:(${ID}),$`).exec(src.slice(md.index + md[0].length, comps.index));
    if (own) {
      const opt = derive(ctx, "W3 platform destructure", () => ctx.lastBefore(new RegExp(
        `let\\{remarkPlugins:${ID},urlTransform:${esc(own[1])}\\}=(${ID})\\(${ID},${ID}\\)`), md.index, 1200));
      platform = opt[1];
      urlAt = comps.index;
    }
  }
  // A key of the call's own after ours would win and quietly drop our filter.
  if (src.slice(urlAt, comps.index).includes("urlTransform:")) {
    throw new E("W3 own urlTransform: the call spells urlTransform: after our insert point, not as its last key before components:");
  }
  // Its `.urlTransform||` is the anchor itself: that string occurs exactly once.
  const filter = only(ctx, src, "W3 filter", new RegExp(
    `function ${esc(md[2])}\\((${ID})\\)\\{[\\s\\S]{0,600}?\\1\\.urlTransform\\|\\|(${ID})`));
  // From 2.1.296 the platform function gives live Windows links a filter of its
  // own: it keeps drive-path hrefs and otherwise falls back to the stock one.
  // Ours replaces it, so ours falls back to it.
  let urlFilter = filter[2];
  if (platform !== undefined) {
    const opts = only(ctx, src, "W3 platform options", new RegExp(
      `function ${esc(platform)}\\(${ID},${ID}\\)\\{return [^{}]*\\?\\{remarkPlugins:${ID},urlTransform:(${ID})\\}:\\{remarkPlugins:${ID},urlTransform:void 0\\}\\}`));
    only(ctx, src, "W3 platform filter", new RegExp(
      `function ${esc(opts[1])}\\((${ID}),${ID}\\)\\{[^{}]*return ${esc(filter[2])}\\(\\1\\)\\}`));
    urlFilter = opts[1];
  }
  // W4: the link click handler and its parameters. Up to 2.1.281 the opener is
  // read off the context (`J?.fileOpener`); from 2.1.282 each text chunk is drawn
  // by a memo component that receives it as a prop (`{source:U,fileOpener:Z,...}`).
  // From 2.1.296 the handler also takes the platform as a fourth argument.
  const click = derive(ctx, "W4 link onClick", () => ctx.firstAfter(new RegExp(
    `onClick:\\((${ID})\\)=>(${ID})\\(\\1,(${ID}),(?:${esc(cx)}\\?\\.fileOpener|(${ID}))(?:,${ID})?\\)`), hBody, 1800));
  if (click[4] !== undefined) {
    const prop = src.slice(hBody, click.index);
    if (!new RegExp(`\\{source:${ID},fileOpener:${esc(click[4])},`).test(prop)) {
      throw new E(`W4 link onClick: ${click[4]} is not the chunk component's fileOpener prop`);
    }
  }
  const link = only(ctx, src, "W4 link handler signature", new RegExp(
    `function ${esc(click[2])}\\((${ID}),(${ID}),(${ID})(?:,${ID})?\\)\\{`));
  // W5: the markdown img component.
  const img = derive(ctx, "W5 markdown img", () => ctx.firstAfter(new RegExp(
    `img:\\(${props("src", "alt")}\\)=>\\{`), hBody, 2500));
  // W1 / W6: the code block component, cross-checked by H$'s pre: mapping.
  const code = derive(ctx, "W1 code block component", () => ctx.lastBefore(new RegExp(
    `function (${ID})\\(${props("children")}\\)\\{`), at.code, 400));
  const pre = derive(ctx, "W1 pre: cross-check", () => ctx.firstAfter(new RegExp(
    `pre:\\(${props("children")}\\)=>(${ID})\\(${esc(code[1])},\\{children:\\1\\}\\)`), hBody, 2500));
  const arrayClose = derive(ctx, "W6 code block children", () =>
    ctx.matchBracket(at.code + ANCHORS.code.length - 1));
  // W7: a blockquote gets the code block's copy button. One more key in the
  // components map of the react-markdown call (`quoteAt`, found under W3); the copy
  // button is the component the code block draws first in its wrapper, right after the W1 anchor.

  // Names for the CC-HELP block.
  const css = derive(ctx, "jsxs css module", () => ctx.lastBefore(new RegExp(
    `(?<![.\\w$])(${ID})\\.codeBlockWrapper,children:\\[`), at.code, 64));
  const jsxs = derive(ctx, "jsxs", () => ctx.lastBefore(new RegExp(
    `(?<![.\\w$])(${ID})\\("div",\\{className:${esc(css[1])}\\.codeBlockWrapper`), at.code, 200));
  const refEffect = derive(ctx, "hooks useRef/useEffect", () => ctx.lastBefore(new RegExp(
    `\\{let (${ID})=(${ID})\\(null\\);(${ID})\\(\\(\\)=>\\{function`), at.copyLink, 900));
  const stateCallback = derive(ctx, "hooks useState/useCallback", () => ctx.firstAfter(new RegExp(
    `\\[(${ID}),(${ID})\\]=(${ID})\\(null\\),(${ID})=(${ID})\\(\\(`), hBody, 300));
  const copy = derive(ctx, "W7 copy button", () => ctx.firstAfter(new RegExp(
    `${esc(pre[2])}\\((${ID}),\\{getText:\\(\\)=>(${ID})\\.current\\?\\.textContent\\?\\?"",className:${esc(css[1])}\\.copyButton\\}\\)`),
    at.code + ANCHORS.code.length, 0));

  const names = {
    jsx: pre[2], jsxs: jsxs[1], useRef: refEffect[2], useEffect: refEffect[3],
    useState: stateCallback[3], useCallback: stateCallback[5], urlFilter,
    copyButton: copy[1], css: css[1],
  };
  const help = helpersText(names, languageOf(ctx), platformOf(ctx));
  if (/__CC_[A-Z]+__/.test(help)) throw new E("CC-HELP: a placeholder is left after substitution");
  const [ev, href, fileOpener] = [link[1], link[2], link[3]];
  return {
    edits: [
      { at: code.index, text: "/*CC-HELP*/" + help },
      { at: hBody, text: `/*CC-CTX*/if(${cx})globalThis.__ccCtx=${cx};` },
      { at: urlAt, text: "/*CC-URL*/urlTransform:__ccUrl," },
      { at: link.index + link[0].length, text: `/*CC-LINK*/if(__ccLink(${ev},${href},${fileOpener}))return;` },
      { at: img.index + img[0].length, text: `/*CC-MDIMG*/{let __ccR=__ccImg(${img[1]},${img[2]});if(__ccR)return __ccR}` },
      { at: arrayClose, text: `,/*CC-CODE*/__ccCodeBar(${code[2]})` },
      { at: quoteAt, text: "/*CC-QUOTE*/blockquote:__ccQuote," },
    ],
    requires: [],
    symbols: { ...names, markdownComponent: h[1], context: cx, markdown: md[2], link: click[2], codeBlock: code[1] },
    notes: [],
  };
}

function planHost(src, ctx) {
  const E = ctx.LayoutError;
  if (ctx.count("__cc") !== 0) throw new E("pristine extension.js already contains __cc names");
  const h1 = only(ctx, src, "H1 openFile folder branch", HOST_RES.H1);
  // A flag the catch does not clear is a shape no build has had. (A reset without
  // a declared flag does not match H1 at all: \4 then matches only the empty name.)
  if ((h1[4] === undefined) !== (h1[6] === "")) {
    throw new E(`H1 openFile folder branch: exists flag ${h1[4] ?? "(none)"} and catch{${h1[6]}} do not pair`);
  }
  // A paired flag is true exactly when the stat did not throw; CC-OPEN reads it so
  // that a missing file goes on to the stock warning.
  const exists = h1[4];
  const h2 = only(ctx, src, "H2 processRequest", HOST_RES.H2);
  const snippets = hostSnippets({ req: h2[1], uri: h1[1], path: h1[3], exists, platform: platformOf(ctx) });
  const h2At = h2.index + `async processRequest(${h2[1]},${h2[2]}){`.length;
  return {
    edits: [
      ...H2_ORDER.map((key) => ({ at: h2At, text: snippets[key] })),
      { at: h1.index + h1[0].length, text: snippets.open },
    ],
    requires: [],
    symbols: { request: h2[1], uri: h1[1], path: h1[3], ...(exists === undefined ? {} : { exists }) },
    notes: [],
  };
}

export default {
  id: "chat-media",
  targets: ["webview", "host"],
  plan(target, src, ctx) {
    if (target === "webview") return planWebview(src, ctx);
    if (target === "host") return planHost(src, ctx);
    throw new ctx.LayoutError(`chat-media has no target ${target}`);
  },
};
