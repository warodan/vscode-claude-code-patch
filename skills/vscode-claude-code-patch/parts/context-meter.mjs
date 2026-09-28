// Part `context-meter`: the context button of v1 (vscode-claude-chat-context-meter,
// patch_claude_code_ui.mjs, sha1 aa355bc1b3e7), ported so the webview it builds in
// English is byte for byte what v1 wrote with its default config (test T-E1).
//
// One button, `context:/context:usage`, in the slot right after the built-in "/"
// button: a ring plus a short token count ("(o) 184k") read off the session's usage
// signal - the one already feeding the stock counter, which this switches off - so
// it costs no subscription and no extra render. Clicking runs /context through the
// command registry. The registry reaches the panel through the engine's
// `run-plumbing` edits, which this part always asks for.
//
// Degrades like v1: no usage signal -> a plain run button; no place to switch the
// stock counter off (or no array-children helper) -> the count without the ring.
//
// Imports nothing by relative path: everything arrives in `ctx`, the language in
// ctx.options.language ("en" | "ru": the tooltips and the plain button's label).

const BUTTON_ID = "context";
const TEXT = "/context";
const RUN_PROP = "__ccRun";
const CAN_PROP = "__ccCan";
const DASH = "—"; // em dash, as v1 wrote it into the tooltips

// Ring colour: muted sage below this many tokens and this share of the window,
// the native clay orange above either.
const GREEN_BELOW_TOKENS = 256000;
const RING_GREEN = "#6b9a5f";
const ORANGE_ABOVE_PERCENT = 60;

// The window size arrives only with a completed turn; the last one is remembered
// across reloads (localStorage, versioned key) and session switches (a global).
const WINDOW_MEMO_KEY = "ccBtnContextWindowFull";
const WINDOW_MEMO_LEGACY_KEY = "ccBtnContextWindow";
const WINDOW_MEMO_GLOBAL = "__ccBtnWindow";

// Last resort before the first completed turn: guess the window from the model id.
const BIG_WINDOW_SUFFIX = "[1m]";
const BIG_WINDOW_TOKENS = 1000000;
const DEFAULT_WINDOW_TOKENS = 200000;

// Tooltips and the plain button's label, as they go between the quotes of the JS the
// part writes: English as v1 wrote it (the em dash raw), Russian as \u escapes.
const TEXTS_EN = {
  loading: `${TEXT} ${DASH} commands still loading`,
  run: `Run ${TEXT}`,
  usedBefore: "",
  usedAfter: " of context used",
  of: "% of ",
  click: ` ${DASH} click to run ${TEXT}`,
  label: BUTTON_ID,
};
const TEXTS_RU = {
  loading: `${TEXT} ${DASH} \u043a\u043e\u043c\u0430\u043d\u0434\u044b \u0435\u0449\u0451 \u0437\u0430\u0433\u0440\u0443\u0436\u0430\u044e\u0442\u0441\u044f`,
  run: `\u0417\u0430\u043f\u0443\u0441\u0442\u0438\u0442\u044c ${TEXT}`,
  usedBefore: "\u041a\u043e\u043d\u0442\u0435\u043a\u0441\u0442: ",
  usedAfter: "",
  of: "% \u0438\u0437 ",
  click: ` ${DASH} \u043d\u0430\u0436\u043c\u0438\u0442\u0435, \u0447\u0442\u043e\u0431\u044b \u0437\u0430\u043f\u0443\u0441\u0442\u0438\u0442\u044c ${TEXT}`,
  label: "\u043a\u043e\u043d\u0442\u0435\u043a\u0441\u0442",
};
/** Every character outside printable ASCII as a \u escape, for text inside a JS string literal. */
const escapeNonAscii = (text) => text.replace(/[^\x20-\x7e]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
const TEXTS = { en: TEXTS_EN, ru: Object.fromEntries(Object.entries(TEXTS_RU).map(([k, v]) => [k, escapeNonAscii(v)])) };

const BUTTON_STYLE =
  'style:{width:"auto",padding:"0 6px",fontSize:"11px",lineHeight:"1",' +
  'whiteSpace:"nowrap",borderRadius:"5px"}';

// Ring + label. The stock .menuButton is a 26px circle, so width, shape and layout
// are overridden; the left padding is 0 because the ring's box carries its own slack.
const USAGE_BUTTON_STYLE =
  'style:{width:"auto",height:"26px",padding:"0 5px 0 0",' +
  'display:"inline-flex",alignItems:"center",justifyContent:"center",gap:"3px",' +
  'fontSize:"11px",lineHeight:"1",whiteSpace:"nowrap",borderRadius:"5px"}';

/** v1 wantsRing: our button carries the ring only where both pieces were found. */
function wantsRing(lay, mode) {
  return Boolean(lay.jsxs && lay.pieOffAt !== null) && mode === "usage";
}

/**
 * The ring: a faint full circle plus an arc swept to `cp` percent, in the stock
 * counter's geometry (20x20 box, r=5, 1.5 stroke). Do not crop the viewBox: the
 * stylesheet sizes the svg to 26px, so the viewBox is the scale, not the box.
 */
function buildRingJs(lay) {
  const circle = (props) => `${lay.jsx}("circle",{cx:"10",cy:"10",r:"5",fill:"none",${props}})`;
  const track = circle('stroke:"currentColor",strokeOpacity:"0.22",strokeWidth:"1.5"');
  // `!(cp>=x)` rather than `cp<x`: cp is null while the window is unknown.
  const colour =
    `ct<${GREEN_BELOW_TOKENS}&&!(cp>=${ORANGE_ABOVE_PERCENT})` +
    `?"${RING_GREEN}":"var(--app-claude-clay-button-orange)"`;
  const arc = circle(
    `stroke:${colour},strokeWidth:"1.5",strokeLinecap:"round",` +
      'strokeDasharray:"31.42",strokeDashoffset:31.42*(1-Math.max(0,Math.min(100,cp||0))/100),' +
      'transform:"rotate(-90 10 10)"'
  );
  return (
    `${lay.jsxs}("svg",{width:"20",height:"20",viewBox:"0 0 20 20",fill:"none",` +
    `style:{display:"block",flexShrink:0},children:[${track},cp>0&&${arc}]})`
  );
}

/** Fallback window from the model id; nothing at all where no signal was found. */
function buildGuessedWindowJs(lay) {
  if (!lay.modelSignals.length) return "";
  const read = lay.modelSignals.map((name) => `(${lay.session}.${name}&&${lay.session}.${name}.value)`).join("||");
  return (
    "if(!(cw>0)){var cm=String(" +
    `${read}||""` +
    `).toLowerCase();cg=1;cw=cm.slice(-${BIG_WINDOW_SUFFIX.length})===` +
    `"${BIG_WINDOW_SUFFIX}"?${BIG_WINDOW_TOKENS}:${DEFAULT_WINDOW_TOKENS}}`
  );
}

/**
 * Contents and tooltip of the usage button, as a spread of {children,title},
 * evaluated inline in the panel's render: the whole window as the denominator
 * (1M reads as 1M), whole thousands only so the width does not jitter.
 */
function buildUsageLabelJs(ready, lay, ring, t) {
  const value = `${lay.session}.usageData.value`;
  const short =
    'var cf=function(cv){return cv>=1e6?+(cv/1e6).toFixed(1)+"M":Math.round(cv/1000)+"k"},' +
    'cs=ct<=0?"0":ct<1000?"<1k":cf(ct);';
  const label = ring ? `[${buildRingJs(lay)},cs]` : "cs";
  return (
    "..." +
    "(()=>{" +
    `var cr=${ready},cu=(${lay.session}.usageData&&${value})||{},` +
    "cw=cu.contextWindow||0," +
    "ct=cu.totalTokens||0,cg=0;" +
    `if(cw>0){try{globalThis.${WINDOW_MEMO_GLOBAL}=cw;` +
    `localStorage.setItem("${WINDOW_MEMO_KEY}",cw);` +
    `localStorage.removeItem("${WINDOW_MEMO_LEGACY_KEY}")}catch(ce){}}` +
    `else{try{cw=+globalThis.${WINDOW_MEMO_GLOBAL}||` +
    `+localStorage.getItem("${WINDOW_MEMO_KEY}")||0}catch(ce){cw=0}}` +
    buildGuessedWindowJs(lay) +
    "var cp=cw>0?Math.min(100,Math.round(ct/cw*100)):null;" +
    short +
    "return{" +
    `children:${label},` +
    `title:!cr?"${t.loading}":` +
    `ct<=0?"${t.run}":` +
    `${t.usedBefore ? `"${t.usedBefore}"+` : ""}cs${t.usedAfter ? `+"${t.usedAfter}"` : ""}` +
    `+(cp===null?"":" ("+cp+"${t.of}"+(cg?"~":"")+cf(cw)+")")+"${t.click}"` +
    "}})()"
  );
}

/**
 * The button, as a call to the bundle's own JSX helper. Disabled until the CLI
 * has registered the slash commands: a stray "/context" typed into the input
 * would be worse than a dead button, and the panel re-renders on registry changes.
 */
function buildButtonJs(mode, lay, t) {
  const insert = `${lay.insertFn}&&${lay.insertFn}("${TEXT}")`;
  const ring = wantsRing(lay, mode);
  const helper = ring ? lay.jsxs : lay.jsx; // array children need jsxs
  const style = ring ? USAGE_BUTTON_STYLE : BUTTON_STYLE;
  const ready = `${CAN_PROP}&&${CAN_PROP}("${TEXT}")`;
  const action = `${RUN_PROP}?${RUN_PROP}("${TEXT}"):(${insert})`;
  let extra = `disabled:!(${ready}),`;
  let label;
  if (mode === "usage") {
    label = buildUsageLabelJs(ready, lay, ring, t);
  } else {
    extra += `title:(${ready})?"${t.run}":"${t.loading}",`;
    label = `children:"${t.label}"`;
  }
  return (
    `/*CC-BTN:${BUTTON_ID}*/${helper}` +
    '("button",{type:"button",' +
    `className:${lay.styles}.menuButton,` +
    `${extra}${style},` +
    `onClick:()=>{${action}},` +
    `${label}}),`
  );
}

export default {
  id: "context-meter",
  targets: ["webview"],
  plan(target, src, ctx) {
    if (target !== "webview") throw new ctx.LayoutError(`context-meter has no ${target} target`);
    const lay = ctx.toolbar;
    if (!lay) throw new ctx.LayoutError(ctx.toolbarError);
    // v1 resolveModes: no live figure in this build -> a plain run button.
    const mode = lay.hasUsage ? "usage" : "run";
    const t = TEXTS[ctx.options && ctx.options.language] || TEXTS.en;
    const edits = [];
    if (wantsRing(lay, mode)) edits.push({ at: lay.pieOffAt, text: "/*CC-PIE*/return null;" });
    edits.push({ at: lay.afterSlashAt, text: buildButtonJs(mode, lay, t) });
    const notes = [
      lay.hasUsage
        ? `usage: live from ${lay.session}.usageData, full window; ` +
          (wantsRing(lay, mode) ? "ring drawn, stock counter off" : "text only (no place to switch the stock counter off)")
        : "usage: live figure not found in this build - plain run button",
    ];
    return { edits, requires: ["run-plumbing"], symbols: lay.symbols(), notes };
  },
};
