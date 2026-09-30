# When an anchor moved (UNSAFE)

Read this at steps 3-5 of [self-repair.md](self-repair.md): `--verify` printed
`UNSAFE: <part>/<target>: ...` for a new extension version. Recon only reads the
pristine code of that version; the fix goes into the staging copy, never into a
bundle. The derivations, their windows and their error texts are listed
in [internals.md](internals.md).

## 1. Read the line, pick the family

| the UNSAFE line | family | file to edit |
| --- | --- | --- |
| `context-meter/webview` and `chat-icons/webview` with the same reason, `layout: not found: ...` above them | (a) composer panel | `lib/layout.mjs` (`ANCHOR`, the `Layout` constructor) |
| `chat-icons/webview` alone: `("/compact",[])`, `let ...("/compact",[]) handler`, `onCompact guard` (needed by send buttons), `session:`, `panel body`, `no busy signal` (needed by command and send buttons) | (a) composer panel, the buttons' own points | `parts/chat-icons.mjs` |
| `chat-icons/webview: buttons[<i>].<field>: ...` | not an anchor: the config's button list | fix it with `--buttons <file>` ([composer-addons.md](composer-addons.md)) |
| `chat-media/webview` | (b) code block and markdown | `parts/chat-media.mjs` (`ANCHORS`, `planWebview`); `assets/webview-helpers.js` only if the runtime contract itself changed |
| `chat-media/host` | (c) extension host | `parts/chat-media.mjs` (`HOST_RES`, `planHost`), `assets/host-snippets.mjs` |
| `chat-mark/webview`: `M1`..`M4` | (d) the prompt box's insert path | `parts/chat-mark.mjs` (guards); `assets/mark-helpers.js` only if the runtime contract changed |
| `chat-files/webview`: `F-anchor`, `F-manager`, `F-binding`, `F-context`, `F-activeSession`, `F-row`, `F-ReadCoalesced`, `F-fileReads` | (d) the session manager and the window rows | `parts/chat-files.mjs` (`ANCHOR`, guards); `assets/files-helpers.js` if the row shape changed |

What the message says:

- `anchor 'X' found 0 times` - the literal is gone: renamed (moved) or removed (vanished). `found 2 times` - it now occurs twice: make it longer, not looser.
- `<label>: /re/ not found within N chars before|after P` - the anchor is there, but the derived piece is not within the window: its shape changed, or it moved farther away.
- `<label>: /re/ matched N times (expected exactly 1)` - a whole-file regex (host H1, H2, the W3 filter, the W4 handler signature, `sendRequest`) no longer matches exactly once.
- Any error name other than `LayoutError` (`TypeError`, `RangeError`) - the part's code broke on the new build; read the part at the step the message names.

Rule out the cheap cause first. When the anchor is found and one derived name
is not, it is usually a minified name the regex cannot spell, not a
restructure: names contain `$`, and `$` alone is a name (2.1.280 has
`session=$` and `useCallback=$0`). Every derivation uses `[\w$]+`, and any
name put into a `new RegExp` goes through `escapeRe()`. Look at what stands at
the place before rewriting anything.

## 2. Set up and take the fixture

The blocks below are for Git Bash (the Bash tool). Each Bash tool call starts
fresh, so repeat the variable lines in every call. Use forward slashes in
variables; a doubled backslash typed into the Bash tool reaches the program as
one.

```bash
VER=2.1.290                                    # the new version, from --verify
BASE="$(cygpath -m "$LOCALAPPDATA")/vscode-claude-code-patch"
FX="$BASE/fixtures/$VER"; STAGE="$BASE/staging/vscode-claude-code-patch"
W="$FX/index.js.orig"; H="$FX/extension.js"
```

Take the fixture: the pristine webview and host of that version plus a
`manifest.json`, into `%LOCALAPPDATA%\vscode-claude-code-patch\fixtures\<version>`.
The `.orig` is the pristine copy when it exists (the other parts may already be
built on this version); the command refuses a file that carries `CC-` markers.
It takes the version and finds everything else itself:

```bash
node -e '
const fs = require("fs"), p = require("path"), crypto = require("crypto");
const version = process.argv[1];
const root = p.join(process.env.USERPROFILE, ".vscode", "extensions");
const ext = fs.readdirSync(root).filter((n) => n.startsWith("anthropic.claude-code-" + version + "-")).map((n) => p.join(root, n))[0];
if (!ext) throw new Error("no anthropic.claude-code-" + version + "-* in " + root);
const out = p.join(process.env.LOCALAPPDATA, "vscode-claude-code-patch", "fixtures", version);
const pick = (f) => (fs.existsSync(f + ".orig") ? f + ".orig" : f);
const from = { "index.js.orig": pick(p.join(ext, "webview", "index.js")), "extension.js": pick(p.join(ext, "extension.js")) };
const files = {};
for (const [name, src] of Object.entries(from)) {
  const buf = fs.readFileSync(src);
  if (/\/\*CC-[A-Z]+(?::[\w-]+)?\*\//.test(buf.toString("utf8"))) throw new Error(src + " carries CC markers: not pristine");
  files[name] = { size: buf.length, sha1: crypto.createHash("sha1").update(buf).digest("hex") };
}
fs.mkdirSync(out, { recursive: true });
for (const [name, src] of Object.entries(from)) fs.copyFileSync(src, p.join(out, name));
fs.writeFileSync(p.join(out, "manifest.json"), JSON.stringify({ version, files }, null, 2) + "\n");
console.log(out + "\n" + JSON.stringify({ version, files }, null, 2));
' "$VER"
```

The fixture is Anthropic code: it stays under `%LOCALAPPDATA%`, never in git, a
skill folder or a synced folder. The same command gives a user their own
fixture for the test suite (`CCP_FIXTURES` = the folder it prints).

Census of every anchor the skill knows, read from the copy's own constants
(each line should say 1, the last one 0 0):

```bash
node --input-type=module -e '
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
const [skill, fx] = process.argv.slice(1);
const load = (rel) => import(pathToFileURL(path.join(skill, rel)).href);
const { ANCHOR } = await load("lib/layout.mjs");
const { ANCHORS, HOST_RES } = await load("parts/chat-media.mjs");
const { ANCHOR: FILES } = await load("parts/chat-files.mjs");
const w = fs.readFileSync(path.join(fx, "index.js.orig"), "utf8");
const h = fs.readFileSync(path.join(fx, "extension.js"), "utf8");
const hits = (s, lit) => s.split(lit).length - 1;
console.log("panel  ", hits(w, ANCHOR), JSON.stringify(ANCHOR));
for (const lit of [...Object.values(ANCHORS), "(\"/compact\",[])", FILES]) console.log("webview", hits(w, lit), JSON.stringify(lit));
for (const [k, re] of Object.entries(HOST_RES)) console.log("host   ", [...h.matchAll(new RegExp(re.source, "g"))].length, k);
console.log("__cc   ", hits(w, "__cc"), hits(h, "__cc"), "(webview, host: must be 0 0)");
' "$STAGE" "$FX"
```

The census types the buttons' anchor `("/compact",[])` itself: `parts/chat-icons.mjs`
keeps it in a constant it does not export. After re-teaching that anchor, edit
the census line too, or it keeps counting the old literal.

Two probes do the rest of the recon. **Literal:** every hit of a string, with
its offset and the text around it (arguments: file, literal, chars before, chars
after):

```bash
node -e '
const [file, lit, before = 200, after = 400] = process.argv.slice(1);
const s = require("fs").readFileSync(file, "utf8");
let n = 0;
for (let i = s.indexOf(lit); i >= 0; i = s.indexOf(lit, i + 1)) {
  n++;
  console.log("@" + i, JSON.stringify(s.slice(Math.max(0, i - before), i + lit.length + +after)));
}
console.log(n, "hit(s) of", JSON.stringify(lit));
' "$W" 'title:"Show command menu (/)"' 300 600
```

**Regex:** every match of a regex source copied from the part, with its
distance from an anchor literal (arguments: file, regex source, anchor):

```bash
node -e '
const [file, source, near] = process.argv.slice(1);
const s = require("fs").readFileSync(file, "utf8");
const at = near ? s.indexOf(near) : -1;
let n = 0;
for (const m of s.matchAll(new RegExp(source, "g"))) {
  if (++n <= 20) console.log("@" + m.index, at >= 0 ? "(" + (m.index - at) + " from the anchor)" : "", JSON.stringify(m.slice(0, 6)));
}
console.log(n, "match(es)");
' "$W" 'function ([\w$]+)\(\{content:([\w$]+),context:([\w$]+),isPartialText:([\w$]+)\}\)\{' 'title:`Image blocked: ${'
```

**Moved or vanished.** A literal found 0 times: probe a shorter, distinctive
piece of it (`Show command menu`, `codeBlockWrapper`, `Image blocked`,
`urlTransform`, `fileOpener`, `revealInExplorer`, `processRequest(`). A hit that
plays the same role is a move: update the anchor. No hit of the shorter piece
does not yet mean a vanish: the text may only have been reworded. Look for the same role by its
structure first: the neighbouring anchors of the census that still stand, and
the regex probe of the derivations around it without the literal (with a
neighbour as the anchor argument, or none). Code of the same shape where the old
literal stood is a reworded anchor: take the new text. Only when the structure
is gone too is it a vanish: the feature was rebuilt, and the new shape has to be
found from what it does. A
derivation `not found within N`: run the regex probe without the window. A match
in the same component at a larger distance is a move (widen that window, no
more than the component); no match is a changed shape (rewrite the regex from
the code the literal probe shows).

## 3a. The composer panel

The panel is the chat input's toolbar; the ring and the buttons stand in the slot
after its `/` button. `ANCHOR = 'title:"Show command menu (/)"'` is the tooltip
of that button; every other field of `Layout` is derived from it (table in
internals).

```bash
# tooltips of the new build: the slash-command button's is the candidate anchor
grep -o 'title:"[^"]\{0,40\}"' "$W" | sort | uniq -c | sort -rn | head -40
# the command registry the ring and the command buttons run commands through
grep -o 'commandRegistry[^;]\{0,80\}' "$W" | head
grep -o 'findCommandByLabel(' "$W" | wc -l; grep -o 'executeCommand(' "$W" | wc -l
```

The bundles are minified into long lines holding many hits each, so count
occurrences with `grep -o ... | wc -l`; `grep -c` counts lines (on 2.1.281:
21 lines against 57 hits of `executeCommand(`).

Then print the 900 chars before the anchor and the panel after it with the
literal probe (`... "$W" '<anchor>' 900 1500`): `children:[X(`,
`className:Y.menuButton`, `onInsertAtMention:`, the `X("button",{` around the
anchor followed by `,`, and `X("div",{className:Y.spacer}),` must all be there.
For the buttons (a send button needs the `/compact` handler, command and send
buttons the busy signal): the literal probe on `("/compact",[])` (it sits inside the
handler `let A=()=>{B("/compact",[])}`, which must start within 200 chars before
it, and `onCompact:A` must appear within 1500 chars after the panel's call
site), and `session:` in the panel signature with `<session>.busy.value` in its
body.

A ring that quietly turned into a text count or a plain `context` button is not
an UNSAFE, only a lost signal: `--status` no longer lists `CC-PIE`. Look for
`<session>.usageData.value.totalTokens` and the stock counter `X(Y,{usedTokens:`
in the panel (`hasUsage` and `pieOffAt` in internals).

If the slash button, the spacer or the registry is gone, the old behaviour may
be impossible: say what is still possible and let the user decide. Edit
`lib/layout.mjs` for the panel, `parts/chat-icons.mjs` for the buttons' own
points. Tests that spell these anchors literally - move their literal with a
re-taught anchor:

- the panel anchor `title:"Show command menu (/)"`: `tests/engine.test.mjs`
  (T-E21) and `tests/layout.test.mjs` ("readToolbar never throws") in their
  expected error texts, and `tests/lib/xpatch.mjs` (`ANCHOR`). The last one
  stays silent: with its anchor missing, the foreign patcher inserts at offset
  9 of the file and T-N3 passes without testing anything.
- `("/compact",[])`: `tests/icons.test.mjs` (`COMPACT`) and
  `tests/integration.test.mjs` (`COMPACT`), plus the census above.

## 3b. The code block and the markdown renderer

`chat-media` finds the markdown component and the code block component through
five literals (`ANCHORS` in `parts/chat-media.mjs`), each exactly once:

| literal | what it marks |
| --- | --- |
| `.codeBlockWrapper,children:[` | the code block wrapper (W1 helper block before its component, W6 card after `<pre>`, `jsxs`) |
| `` title:`Image blocked: ${ `` | the markdown component `H$` (W2), which W3-W5 are measured from |
| `.urlTransform\|\|` (in the file: two plain bars) | react-markdown's default URL filter (W3) |
| `"Copy Link"` | the window of the `useRef`/`useEffect` names |
| `fileOpener={open:` | the channel guard: requests travel the stock `fileOpener` path |

Probe each failing one with the literal probe, then its derivation with the
regex probe, the regex copied from `planWebview` and the literal as the anchor.
For a label measured from `H$` (W3, W4, W5, the W1 `pre:` cross-check, the
`useState`/`useCallback` names), take `H$`'s offset from the W2 probe: the
window starts at the end of its signature. A W2 failure hides every label after
it: fix W2 first. The helper block needs `comms.connection.value.sendRequest`
and React's `jsx`, `jsxs` and four hooks; if the bundle stopped exposing one of
them, `assets/webview-helpers.js` has to change, not only a regex.
`integration.test.mjs` spells `` title:`Image blocked: ${ `` literally (`W2`,
T-J6): if you re-teach it, move that literal with it.

## 3c. The extension host (`extension.js`)

A mistake here stops every chat of the window from opening, so the host goes
through the host harness before anything is written. The two places are whole
regexes (`HOST_RES` in `parts/chat-media.mjs`), each exactly once:

- H1 - the folder branch of the host's `openFile`: `let U=V.Uri.file(P);try{if(F.statSync(P).isDirectory()){V.commands.executeCommand("revealInExplorer",U);return}}catch{}`; from 2.1.284 with an exists flag, `let U=V.Uri.file(P),G=!0;try{...}catch{G=!1}` (group 4 the flag, group 6 the catch body; `planHost` takes both or neither, and `CC-OPEN` then acts only when the flag is set). `CC-OPEN` goes right after the catch; groups 1 and 3 are the uri and the path.
- H2 - the start of the host's own request handler: `async processRequest(R,C){if(R.request.type==="get_current_selection")`. The five request handlers go right after `{`; group 1 is the request.

```bash
grep -o '.\{0,200\}"revealInExplorer".\{0,120\}' "$H"
grep -o 'async processRequest([^)]*){.\{0,120\}' "$H"
grep -o '"get_current_selection"' "$H" | wc -l
```

On 2.1.280 the host holds `async processRequest(` twice: the handler H2 patches
(class `M7 extends Jj`, an `if/else` chain on `request.type` that starts with
`get_current_selection` and ends in `return super.processRequest($,J)`), and the
base class's `switch`, where the stock `open_file` and the `Unknown request type`
error live. The patch belongs at the start of whichever function first receives
the webview's request object and returns the answer; the handlers read its
`request.type`, `path`, `mode` and `knownMtimeMs`. Edit `HOST_RES` and `planHost`; the names
reach the snippets only through `hostSnippets({ req, uri, path, exists })`. Change a
snippet in `assets/host-snippets.mjs` only if the request object itself changed.
`media.test.mjs` and `integration.test.mjs` spell `"revealInExplorer"` and
`"get_current_selection"` literally, and `media.test.mjs` expects `async
processRequest(` twice: move them with the anchor.

Before anything is written, the host harness must pass on the new fixture (pass
test files by absolute path: a relative one is looked up in the current folder
first, which may be another copy of the skill):

```bash
CCP_FIXTURES="$FX" node "$STAGE/tests/run.mjs" "$STAGE/tests/host-harness.test.mjs"
```

Green means exit 0 with `fail 0` and `skipped 0` in the summary: a skipped
`plan()` variant (no fixture) did not test the new names.

## 3d. The prompt box and the window rows (`chat-mark`, `chat-files`)

Both parts append their helpers at the end of the bundle, so only their guards
can fail; each guard, its regex and the names it found on earlier versions are in
[internals.md](internals.md#chat-mark-and-chat-files). `M1`..`M3` check that
text handed to the prompt box without an `@` stays plain text: probe the M1
regex with the regex probe (no anchor argument), then `atMentionEvents` and
`insertAtMention:` with the literal probe. `F-anchor` is
`{hostReportsDocumentCloses:!0});` (the census counts it); the statement right
after it must create the session manager, and the window row class must still
read `class X{type;content;parentToolUseId;sdkParentToolUseId;`. A row class
with other fields means `assets/files-helpers.js` reads the rows wrongly too:
change both.

## 4. Back to the protocol

Continue with step 6 of [self-repair.md](self-repair.md): the staging suite on
the new fixture (`CCP_FIXTURES="$FX" node "$STAGE/tests/run.mjs"`, in the
background), `--verify` from staging (`node "$STAGE/claude_code_patch.mjs" --verify`:
every part `SAFE TO PATCH`), the diff for upstream, then `tools/mirror.mjs` puts
staging over the live folder, `--verify` and a no-flag run from the live folder
apply it, and the report names what changed. The suite itself never runs from
the live folder: its runner refuses an engine under `~/.claude` or
`~/.agents/skills`, or the one the SessionStart hook runs.
