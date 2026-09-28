import fs from "node:fs";

/** Languages of the label table in the asset; the configured one replaces __CC_LANG__. */
export const LANGUAGES = Object.freeze(["en", "ru"]);
export function helpersText(language = "en") {
  if (!LANGUAGES.includes(language)) throw new TypeError(`chat-mark: unknown language ${JSON.stringify(language)}`);
  return fs.readFileSync(new URL("../assets/mark-helpers.js", import.meta.url), "utf8")
    .split(/\r?\n/).filter((s) => s.trim() && !/^\s*\/\//.test(s)).map((s) => s.trim()).join("\n")
    .split("__CC_LANG__").join(language) + "\n";
}

function only(ctx, src, label, re) {
  const n = ctx.count(re);
  if (n !== 1) throw new ctx.LayoutError(`${label}: expected exactly one match, found ${n}`);
  return re.exec(src);
}

export default {
  id: "chat-mark",
  targets: ["webview"],
  plan(target, src, ctx) {
    if (target !== "webview") throw new ctx.LayoutError(`chat-mark: unsupported target ${target}`);
    const m1 = only(ctx, src, "M1", /function ([\w$]+)\(([\w$]+)\)\{if\(!\2\.startsWith\("@"\)\|\|\2==="@"\)return \2;/);
    only(ctx, src, "M2", /\.atMentionEvents\.add\(/);
    only(ctx, src, "M3", new RegExp(`insertAtMention:\\(([\\w$]+),([\\w$]+)\\)=>\\{let [\\w$]+=${ctx.escapeRe(m1[1])}\\(\\1\\)`));
    if (ctx.count("__cc")) throw new ctx.LayoutError("M4: pristine contains __cc");
    const language = ctx.options?.language ?? "en";
    if (!LANGUAGES.includes(language)) throw new ctx.LayoutError(`chat-mark: unknown language ${JSON.stringify(language)}`);
    return { edits: [{ at: src.length, text: "\n/*CC-MARK*/" + helpersText(language) }], requires: [], symbols: { mention: m1[1] }, notes: [] };
  },
};
