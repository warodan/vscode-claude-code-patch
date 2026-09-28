// Fake `chat-media` whose targets differ from its row of the engine table.
export default {
  id: "chat-media",
  targets: ["webview"],
  plan(target, src) {
    return { edits: [{ at: src.length, text: target === "host" ? "/*CC-OPEN*/" : "/*CC-CTX*/" }], requires: [] };
  },
};
