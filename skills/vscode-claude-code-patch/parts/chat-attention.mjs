import fs from "node:fs";

/** Languages of the label table in the asset; the configured one replaces __CC_LANG__. */
export const LANGUAGES = Object.freeze(["en", "ru"]);
export function helpersText(language = "en") {
  if (!LANGUAGES.includes(language)) throw new TypeError(`chat-attention: unknown language ${JSON.stringify(language)}`);
  return fs.readFileSync(new URL("../assets/attention-helpers.js", import.meta.url), "utf8")
    .split(/\r?\n/).filter((s) => s.trim() && !/^\s*\/\//.test(s)).map((s) => s.trim()).join("\n")
    .split("__CC_LANG__").join(language) + "\n";
}

function only(ctx, label, needle) {
  const n = ctx.count(needle);
  if (n !== 1) throw new ctx.LayoutError(`${label}: expected exactly one match, found ${n}`);
}

// Experimental. The contents list reads the rows chat-files exposes (__ccSessions) and finds
// the rendered message by its data-bookmark-uuid; the guards pin what the runtime relies on.
export default {
  id: "chat-attention",
  targets: ["webview"],
  plan(target, src, ctx) {
    if (target !== "webview") throw new ctx.LayoutError(`chat-attention: unsupported target ${target}`);
    only(ctx, "A1", '"data-bookmark-uuid":');
    only(ctx, "A2", /class [\w$]+\{type;content;parentToolUseId;sdkParentToolUseId;[^}]*\buuid;/);
    if (ctx.count("__cc")) throw new ctx.LayoutError("A3: pristine contains __cc");
    const language = ctx.options?.language ?? "en";
    if (!LANGUAGES.includes(language)) throw new ctx.LayoutError(`chat-attention: unknown language ${JSON.stringify(language)}`);
    return { edits: [{ at: src.length, text: "\n/*CC-ATTN*/" + helpersText(language) }], requires: [], symbols: {}, notes: [] };
  },
};
