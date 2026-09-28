import fs from "node:fs";

export const ANCHOR = "{hostReportsDocumentCloses:!0});";
/** Languages of the label table in the asset; the configured one replaces __CC_LANG__. */
export const LANGUAGES = Object.freeze(["en", "ru"]);
export function helpersText(language = "en") {
  if (!LANGUAGES.includes(language)) throw new TypeError(`chat-files: unknown language ${JSON.stringify(language)}`);
  return fs.readFileSync(new URL("../assets/files-helpers.js", import.meta.url), "utf8")
    .split(/\r?\n/).filter((s) => s.trim() && !/^\s*\/\//.test(s)).map((s) => s.trim()).join("\n")
    .split("__CC_LANG__").join(language) + "\n";
}
function derive(ctx, label, fn) {
  try { return fn(); } catch (e) {
    if (e && e.name === "LayoutError") throw new ctx.LayoutError(`${label}: ${e.message}`);
    throw e;
  }
}
function guard(ctx, label, ok) {
  if (!ok) throw new ctx.LayoutError(`${label}: layout mismatch`);
}

export default {
  id: "chat-files",
  targets: ["webview"],
  plan(target, src, ctx) {
    if (target !== "webview") throw new ctx.LayoutError(`chat-files: unsupported target ${target}`);
    const at = derive(ctx, "F-anchor", () => ctx.once(ANCHOR)), end = at + ANCHOR.length;
    const m = /^([\w$]+)=new ([\w$]+)\(([\w$]+),([\w$]+)\);/.exec(src.slice(end));
    guard(ctx, "F-manager", m);
    const before = src.slice(Math.max(0, at - 300), at);
    guard(ctx, "F-binding", before.includes(`,${m[1]}=void 0,`));
    guard(ctx, "F-context", before.includes(`,${m[4]}=new `));
    const cls = derive(ctx, "F-activeSession", () => ctx.once(`class ${m[2]}{`)) + `class ${m[2]}{`.length;
    guard(ctx, "F-activeSession", src.slice(cls, cls + 3000).includes("activeSession="));
    guard(ctx, "F-row", ctx.count(/class [\w$]+\{type;content;parentToolUseId;sdkParentToolUseId;/) === 1);
    guard(ctx, "F-ReadCoalesced", src.includes('"ReadCoalesced"'));
    guard(ctx, "F-fileReads", ctx.count("input:{fileReads:") === 1);
    guard(ctx, "F-pristine", ctx.count("__cc") === 0);
    const language = ctx.options?.language ?? "en";
    if (!LANGUAGES.includes(language)) throw new ctx.LayoutError(`chat-files: unknown language ${JSON.stringify(language)}`);
    return {
      edits: [
        { at: end + m[0].length, text: `/*CC-SESS*/globalThis.__ccSessions=${m[1]};globalThis.__ccFilesCtx=${m[4]};try{__ccFilesBoot()}catch(__ccE){}` },
        { at: src.length, text: "\n/*CC-FILES*/" + helpersText(language) },
      ],
      requires: [], symbols: { manager: m[1], managerClass: m[2], context: m[4] }, notes: [],
    };
  },
};
