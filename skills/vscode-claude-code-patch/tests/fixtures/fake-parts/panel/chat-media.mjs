// Fake `chat-media` with two edits at the panel point, right after "/" (T-E15).
export default {
  id: "chat-media",
  targets: ["webview", "host"],
  plan(target, src, ctx) {
    if (target === "host") return { edits: [], requires: [] };
    if (!ctx.toolbar) throw new ctx.LayoutError(ctx.toolbarError);
    const at = ctx.toolbar.afterSlashAt;
    return { edits: [{ at, text: "/*CC-CTX*/" }, { at, text: "/*CC-URL*/" }], requires: [] };
  },
};
