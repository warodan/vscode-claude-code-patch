// Fake `chat-media` whose edit carries a marker of another part's row (T-E13).
export default {
  id: "chat-media",
  targets: ["webview", "host"],
  plan(target, src) {
    const text = target === "host" ? "\n/*CC-OPEN*/\n" : "\n/*CC-ICON:finish*/\n";
    return { edits: [{ at: src.length, text }], requires: [] };
  },
};
