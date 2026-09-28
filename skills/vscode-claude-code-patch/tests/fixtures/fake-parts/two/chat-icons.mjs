// Fake `chat-icons`: webview only, one comment edit at the start of the file.
export default {
  id: "chat-icons",
  targets: ["webview"],
  plan() {
    return { edits: [{ at: 0, text: "/*CC-SEND*/" }], requires: [], symbols: {}, notes: [] };
  },
};
