// Fake `chat-media` whose plan() throws LayoutError on host only (T-E9).
export default {
  id: "chat-media",
  targets: ["webview", "host"],
  plan(target, src, ctx) {
    if (target === "host") throw new ctx.LayoutError("fake host anchor not found");
    return { edits: [{ at: src.length, text: "\n/*CC-CTX*/\n" }], requires: [] };
  },
};
