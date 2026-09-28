// Fake `chat-media` whose plan() throws a TypeError on host only (T-E9).
export default {
  id: "chat-media",
  targets: ["webview", "host"],
  plan(target, src) {
    if (target === "host") return null.edits;
    return { edits: [{ at: src.length, text: "\n/*CC-CTX*/\n" }], requires: [] };
  },
};
