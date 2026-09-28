// Fake `chat-media` whose module id is not its file name.
export default {
  id: "chat-icons",
  targets: ["webview", "host"],
  plan(target, src) {
    return { edits: [{ at: src.length, text: target === "host" ? "/*CC-OPEN*/" : "/*CC-CTX*/" }], requires: [] };
  },
};
