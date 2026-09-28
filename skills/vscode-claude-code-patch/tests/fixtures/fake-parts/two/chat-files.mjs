// Fake `chat-files`: webview only, its two markers as comment edits at the end
// of the file (the real part puts CC-SESS mid-file and appends CC-FILES).
export default {
  id: "chat-files",
  targets: ["webview"],
  plan(target, src) {
    return {
      edits: [{ at: src.length, text: "\n/*CC-SESS*/\n" }, { at: src.length, text: "\n/*CC-FILES*/\n" }],
      requires: [], symbols: {}, notes: [],
    };
  },
};
