// Fake `chat-icons` with two edits at the panel point, right after "/" (T-E15).
export default {
  id: "chat-icons",
  targets: ["webview"],
  plan(target, src, ctx) {
    if (!ctx.toolbar) throw new ctx.LayoutError(ctx.toolbarError);
    const at = ctx.toolbar.afterSlashAt;
    return { edits: [{ at, text: "/*CC-ICON:handoff*/" }, { at, text: "/*CC-ICON:finish*/" }], requires: [] };
  },
};
