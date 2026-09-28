// Fake `chat-media`: both targets, one comment edit at the end of each.
export default {
  id: "chat-media",
  targets: ["webview", "host"],
  plan(target, src) {
    const text = target === "host" ? "\n/*CC-OPEN*/\n" : "\n/*CC-CTX*/\n";
    return { edits: [{ at: src.length, text }], requires: [], symbols: {}, notes: [] };
  },
};
