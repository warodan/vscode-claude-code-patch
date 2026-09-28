// What an --ensure run said. The SessionStart hook runs async, where plain output
// reaches no one, so --ensure prints nothing but one JSON line {"systemMessage": ...}
// on stdout when it has something to say, never anything on stderr, and exits 0.

import assert from "node:assert/strict";

/** The systemMessage of an --ensure result ({ code, out, err }); "" when it printed nothing. */
export function sysMsg(r) {
  assert.equal(r.code, 0, `--ensure always exits 0\n${r.out}\n${r.err}`);
  assert.equal(r.err, "", `--ensure writes nothing to stderr:\n${r.err}`);
  const out = r.out.replace(/\r?\n$/, "");
  if (out === "") return "";
  assert.ok(!out.includes("\n"), `--ensure printed more than one line:\n${r.out}`);
  const said = JSON.parse(out);
  assert.deepEqual(Object.keys(said), ["systemMessage"], out);
  assert.equal(typeof said.systemMessage, "string");
  return said.systemMessage;
}
