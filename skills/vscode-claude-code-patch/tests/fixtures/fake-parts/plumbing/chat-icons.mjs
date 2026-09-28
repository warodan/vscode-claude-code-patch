// Fake `chat-icons` that asks for the engine's run-plumbing and needs no panel itself (T-E21).
export default {
  id: "chat-icons",
  targets: ["webview"],
  plan() {
    return { edits: [{ at: 0, text: "/*CC-SEND*/" }], requires: ["run-plumbing"] };
  },
};
