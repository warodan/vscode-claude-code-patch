// Fake `chat-media` whose host edit does not parse (T-E10); its twin without the error is two/.
export default {
  id: "chat-media",
  targets: ["webview", "host"],
  plan(target, src) {
    const text = target === "host" ? "\n/*CC-OPEN*/ }{ \n" : "\n/*CC-CTX*/\n";
    return { edits: [{ at: src.length, text }], requires: [] };
  },
};
