// Fake `chat-media`: two edits at one point, each with one marker of its own row, that
// together spell a third one (/*CC-URL*/) - only the recount after assembly sees it.
export default {
  id: "chat-media",
  targets: ["webview", "host"],
  plan(target, src) {
    if (target === "host") return { edits: [{ at: src.length, text: "\n/*CC-OPEN*/\n" }], requires: [] };
    return { edits: [{ at: src.length, text: "\n/*CC-CTX*/ /*CC-" }, { at: src.length, text: "URL*/ /*CC-LINK*/\n" }], requires: [] };
  },
};
