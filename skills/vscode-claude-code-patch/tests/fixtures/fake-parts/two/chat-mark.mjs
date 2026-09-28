// Fake `chat-mark`: webview only, one comment edit at the end of the file,
// the point where the real part appends its helpers.
export default {
  id: "chat-mark",
  targets: ["webview"],
  plan(target, src) {
    return { edits: [{ at: src.length, text: "\n/*CC-MARK*/\n" }], requires: [], symbols: {}, notes: [] };
  },
};
