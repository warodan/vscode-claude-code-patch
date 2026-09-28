// Prose guards: sentences of SKILL.md that carry a rule an agent must not lose.
// Each one must stand verbatim in SKILL.md (whitespace normalised; a sentence may
// be pinned by its opening words). The mutation is the deletion or rewording of a
// sentence: either turns this file red. Change a sentence here and in SKILL.md
// together, on purpose.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SKILL_MD = fileURLToPath(new URL("../SKILL.md", import.meta.url));
const ENGINE = fileURLToPath(new URL("../claude_code_patch.mjs", import.meta.url));

export const PROSE = {
  // How the engine writes.
  P1: "Every write rebuilds the patched files from the pristine copy; nothing is ever patched on top of a patched file.",
  P2: "UNSAFE means nothing was written for that part. Never hand-edit either bundle.",
  P3: "--revert restores every patched file byte for byte and keeps it that way: the SessionStart hook re-applies nothing until you apply again.",
  P4: "extension.js is patched only by the chat-media part; the ring and the composer buttons never touch it.",
  P5: "If extension.js does not parse, no Claude Code chat opens in that window: the engine writes it only when the trial build parses, and replaces it only by renaming a complete, verified copy over it.",
  P7: "A changed host anchor is applied only after the host harness passes.",
  P8: "Every change becomes visible only after Developer: Reload Window.",
  P14: "chat-mark and chat-files never touch extension.js; each can be disabled without losing the image cards.",
  // What the user gets.
  P6: "A card appears only under an absolute Windows path alone in a fenced code block, or under a markdown image or link whose target is an absolute drive path; a workspace-relative link gets no card.",
  P9: "Images over 100 MB get no preview; their buttons still work.",
  P11: "Insert path inserts the plain image path into the prompt box, never an @-mention: the image is not loaded into context.",
  P12: "Rectangle regions are written as [x1,y1,x2,y2] in pixels of the original file, origin top-left.",
  P13: "The files panel lists only what the main agent showed in this chat; files touched only by subagents are not in it.",
  // Installing, running and repairing.
  P10: "Two patchers rebuilding the same files erase each other's work: while the SessionStart hook of vscode-claude-chat-context-meter (v1) is present, every build and --install-hook refuse.",
  P15: "Write the rule into a CLAUDE.md only after the user says yes; append it, never rewrite the file.",
  P16: '--ensure never fails a session start: it prints one JSON line {"systemMessage": ...} when it has something to say, nothing otherwise, and always exits 0.',
  P17: "A self-repair lands in the installed copy, and the next npx skills update replaces it: offer to send the fix upstream.",
  P18: "One command per run; --dry-run goes only with a build",
};

const norm = (text) => text.replace(/\s+/g, " ").trim();
const skill = norm(fs.readFileSync(SKILL_MD, "utf8"));

for (const [id, sentence] of Object.entries(PROSE)) {
  test(`${id} stands verbatim in SKILL.md`, () => {
    assert.ok(skill.includes(norm(sentence)), `${id} is missing from ${SKILL_MD}: "${sentence}"`);
  });
}

// SKILL.md quotes --help in full; a changed help text must reach it too.
test("SKILL.md quotes --help verbatim", () => {
  const r = spawnSync(process.execPath, [ENGINE, "--help"], { encoding: "utf8", timeout: 60000 });
  assert.equal(r.status, 0, r.stderr);
  const help = r.stdout.replace(/\r\n/g, "\n").trimEnd();
  const raw = fs.readFileSync(SKILL_MD, "utf8").replace(/\r\n/g, "\n");
  assert.ok(raw.includes("```\n" + help + "\n```"), "the --help block of SKILL.md differs from claude_code_patch.mjs --help");
});
