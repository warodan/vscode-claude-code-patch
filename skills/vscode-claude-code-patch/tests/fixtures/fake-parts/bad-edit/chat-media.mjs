// Fake `chat-media` with an edit outside the file on host (the contract: 0 <= at <= src.length).
export default {
  id: "chat-media",
  targets: ["webview", "host"],
  plan(target, src) {
    return { edits: [{ at: target === "host" ? src.length + 1 : src.length, text: target === "host" ? "/*CC-OPEN*/" : "/*CC-CTX*/" }], requires: [] };
  },
};
