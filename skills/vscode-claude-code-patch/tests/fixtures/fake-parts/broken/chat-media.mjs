// Fake `chat-media` module that does not load: a syntax error (T-E13).
export default {
  id: "chat-media",
  targets: ["webview", "host"],
  plan(target, src) {
    return { edits: [{ at: src.length, text: "\n/*CC-CTX*/\n" }] ;
  },
};
