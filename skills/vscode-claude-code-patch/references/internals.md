# Internals

How the engine and the five parts work. Read this to debug a build or to
re-teach an anchor; running the skill needs only `SKILL.md`. Offsets and names
marked 2.1.280 are that extension version's and exist for comparison; the code
derives them on every build.

Where to look:

- a build, a guard or a write behaves unexpectedly: [One build, step by step](#one-build-step-by-step),
  [Markers](#markers), [State, ledger, cache, lock, hook](#state-ledger-cache-lock-hook)
- an anchor to re-teach: [The part interface](#the-part-interface), then the part's own section:
  [composer panel](#the-composer-panel-layout-liblayoutmjs), [`context-meter`](#context-meter),
  [`chat-media` webview](#chat-media-webview), [`chat-media` host](#chat-media-host-extensionjs),
  [`chat-icons`](#chat-icons), [`chat-mark` and `chat-files`](#chat-mark-and-chat-files)
- a line of output: [Reading the output in full](#reading-the-output-in-full),
  [`--ensure` and its message](#--ensure-and-its-message), [Preview ceiling](#preview-ceiling)
- the suite: [Tests](#tests); which file does what: [Files](#files)

## Files

| file | role |
| --- | --- |
| `claude_code_patch.mjs` | engine and CLI: installations, state files, lock, hook, build, write. Imports only Node built-ins; the part modules and `lib/layout.mjs` are loaded with `import()` inside `try/catch`, and only by a build, `--verify` and `--status` |
| `lib/layout.mjs` | `Layout` (the composer panel), `LayoutError`, the `ctx` helpers (`makeCtx`, with `ctx.options`), `applyEdits` - the one implementation of the insertion order |
| `parts/context-meter.mjs` | the ring (v1's edits; in English its output is byte for byte v1's), tooltips per language |
| `parts/chat-media.mjs` | path cards, previews, viewer, links: six webview inserts and six host inserts |
| `parts/chat-icons.mjs` | the user's composer buttons from the config: `validateButtons`, the icon outlines (`ICONS`), the part's own tooltips per language |
| `parts/chat-mark.mjs` | Insert path and rectangle marks: guards only, one insert at the end of the webview |
| `parts/chat-files.mjs` | the chat files panel: one anchor (`CC-SESS`), one insert at the end |
| `assets/mark-helpers.js`, `assets/files-helpers.js` | the helper blocks of those two parts, with their label tables |
| `assets/webview-helpers.js` | source of the `CC-HELP` block chat-media inserts into the webview, with its label table |
| `assets/host-snippets.mjs` | the six host snippets |
| `tools/mirror.mjs` | exact mirror of a copy of the skill plus a sha1 comparison of both trees (self-repair) |
| `tests/` | the suite and its runner (last section) |

**Languages.** Every label, caption and tooltip a part adds, and the header chat-mark puts into
the prompt box, comes from a table per language (`en`, `ru`) with the same keys. The tables sit in
the assets and parts as ASCII (non-ASCII as `\u` escapes); a part replaces the one `__CC_LANG__`
placeholder with the configured language at build time, so both tables ship and only the chosen one
is read. Host error texts (`unsupported path`, `Photoshop.exe not found`) are English in both.

## One build, step by step

`buildInstall()` does this per installation; `--verify` and `--dry-run` run the
same steps with writing switched off.

1. **Read both targets once** (`readTargets`): `webview` = `webview\index.js`, `host` = `extension.js`. The pristine copy is `<file>.orig` when it exists, else the file itself.
2. **Guards, before any `plan()`.** Current file: a marker outside the table below (`foreign CC markers`), or markers without `.orig`, refuses the target. Pristine copy: any marker, or a sha1 (first 12 hex) different from the ledger's entry for this version and target, refuses it. A refused target prints `REFUSED <target>: <reason>` and takes every part that has this target out of the build, on every target of the installation.
3. **Panel:** `readToolbar()` builds one `Layout` on the pristine webview, or returns `null` with the reason (`layout:` line of `--verify`).
4. **Plan** every remaining enabled part, in part order, on each of its targets (`planPart`): load the module, build `ctx` (`makeCtx`, with `ctx.options` = the config's `language` and a deep-frozen copy of its `buttons`), call `plan(target, src, ctx)`, check the answer (`checkPlan`). A part whose plan has no edit on any target (`chat-icons` without buttons) is `SAFE TO PATCH` and says `nothing to insert (<its first note>)` instead of `applied`. A module that does not load, a failed check or any exception from `plan()` on any target makes the whole part UNSAFE on every target; the other parts go on. The lines: `UNSAFE: <part>/<target>: <ErrorName>: <message>` for an exception of `plan()` or a failed check (`firstLine`: the name is left out for a plain `Error`, so the engine's own checks read `UNSAFE: <part>/<target>: <message>`); `UNSAFE: <part>: <reason>` when the part's module or `lib/layout.mjs` does not load (`module did not load: ...`, `lib/layout.mjs failed to load: ...`), which applies to every target.
5. **Assemble** each target (`assemble`): `run-plumbing` first if any built part asked for it, then the edits of each built part in part order, through one `applyEdits`. Every marker is recounted: a count that differs from the number of edits carrying it makes its owner UNSAFE, and assembly repeats without it.
6. **Parse** each assembled target (`parseError`): webview with `new vm.Script(src)` and again with `"use strict";` in front (the bundle loads as a module); host inside the CommonJS wrapper `(function (exports, require, module, __filename, __dirname) {...})`. A failure on any target is `Fatal`: nothing is written to any target, exit 1. The engine does not look for the guilty part.
7. **Restore** a target that no enabled part touches but that has an `.orig`: only after the `.orig` passes the pristine guards and the parse check; otherwise it is left as it is, exit 1.
8. **Write, host first, then webview** (`writeTarget`). The `.orig` is written first, from the pristine text in memory, then the target. Every file (targets, `.orig`, state files, `settings.json`) goes through `writeAtomic`: write `<file>.ccp-tmp-<pid>` beside it, read it back and compare sha1, rename over the file, retrying a rename refused with `EPERM`, `EBUSY` or `EACCES` up to 10 times, 100 ms apart. Any failure removes the tmp and leaves the file as it was. A failed host write takes the host parts out and rebuilds the webview once without them. A failed webview write after a good host write leaves the host patched; its inserts answer only `cc_*` requests, apart from `CC-OPEN`.
9. A target whose enabled parts all failed and which has an `.orig` is left as it is: `[=] <target> left as it is: it still carries the build of a previous run`.
10. **Cache and ledger.** Each target written, restored or deliberately left gets its fingerprint in the cache; a `Fatal` or a failed write records none. A version's ledger entry gets the pristine sha1 of each built target it did not have yet. Leftover `*.ccp-tmp-*` files beside the targets and in the state folder are removed under the lock at the start of the next build or `--revert`.

**One installation's failure.** A build, `--verify` and `--ensure`
(`buildAll`) run each installation (its leftover removal and steps 1-9) inside
one `try/catch`; an error there (a target that cannot be read because another
process holds it, a folder VS Code is deleting) prints `  [!] <installation
folder>: <first line>`, gives that installation no cache entry and no ledger
addition, and the loop goes on with the next one; exit 1 (`--ensure`: a Details
entry of its systemMessage, exit 0). No stack trace is printed. Obsolete version folders that
VS Code has not deleted yet are built too; one of them held open or half deleted
gives this line instead of stopping the command.

`--revert` does not go through these steps: under the lock it writes `paused:
true` to the config first, then restores each target from its `.orig` (after the
pristine guards and the parse check; foreign markers are thrown away and named),
deletes the `.orig`, and records the fingerprints. It loads no part and no
`lib/layout.mjs`. Markers without an `.orig` are exit 1 with advice to reinstall
the extension. Each target is its own `try/catch` around read, guards, write and
unlink: an error prints `  [!] <installation folder> <target>: <first line>`, the
other target and the other installations go on, exit 1; `paused: true` stays the
first write. With an unreadable ledger it restores without the sha1 part of the
pristine guard (the marker guard and the parse check stay) and prints once
`ledger unreadable: .orig restored without the sha1 check (<ledger path>)`; the
exit code is what it would be without that.

## Markers

`ANY_MARKER = /\/\*CC-[A-Z]+(?::[\w-]+)?\*\//` - every guard sees the whole
namespace (a suffix may hold `-`, as button ids do). The owners are an engine
constant (`MARKERS`), so they are known even when a module fails to load:

| owner | target | markers |
| --- | --- | --- |
| engine (`run-plumbing`) | webview | `CC-RUN` x2 |
| `context-meter` | webview | `CC-BTN:context`, `CC-PIE` (only when the ring is drawn) |
| `chat-media` | webview | `CC-HELP`, `CC-CTX`, `CC-URL`, `CC-LINK`, `CC-MDIMG`, `CC-CODE` |
| `chat-media` | host | `CC-OPEN`, `CC-CAPS`, `CC-REVEAL`, `CC-READIMG`, `CC-PHOTOS`, `CC-PS` |
| `chat-icons` | webview | `CC-SEND` x2 (only with a send button), the family `CC-ICON:*`: one `CC-ICON:<id>` per button |
| `chat-mark` | webview | `CC-MARK` |
| `chat-files` | webview | `CC-SESS`, `CC-FILES` |

A row name ending in `:*` is a family: `chat-icons` owns every `CC-ICON:<id>`,
whatever the config holds now, so a file built with other buttons (or by an
older build) is taken over, not refused. A file patched by v1 with its default
button carries only names of this table, so it is not foreign; v1's custom
buttons (`CC-BTN:usage`, `CC-BTN:my-cmd` and so on) are.

## The part interface

```js
export default {
  id: "chat-media",              // = file name = entry in the engine's PARTS
  targets: ["webview", "host"],  // must equal the engine's MARKERS row
  plan(target, src, ctx) {       // src: the PRISTINE copy of the target; writes nothing
    return { edits: [{ at, text }], requires: [], symbols: {}, notes: [] };
    // or throw new ctx.LayoutError("what did not match")
  },
};
```

- `ctx` is frozen: `version, target, LayoutError, toolbar, toolbarError, options, once, count, lastBefore, firstAfter, matchBracket, escapeRe`; the helpers are bound to `src`. `toolbar` is the `Layout` of the pristine webview (for every target) or `null`, with `toolbarError` then. `options` is `{language, buttons}` from the config (`language` defaults to `"en"`, `buttons` to `[]`); parts read `ctx.options?.language ?? "en"`.
- `checkPlan` requires: `edits` is a list of insertions `{at, text}` with `0 <= at <= src.length`; every `text` carries exactly one marker, and it is on this part's row for this target (by name or by family); `requires` is a subset of `["run-plumbing"]`.
- The default export of `chat-icons` also carries `validateButtons`: `--buttons <file>` checks the list with it before anything is written.
- `run-plumbing` is impossible when `toolbar` is `null` or the panel's context is named `cc` or `ca` (its text declares both).
- `symbols` and `notes` are returned but not printed; the `layout:` line of `--verify` shows the panel's names.
- A name an insert declares itself starts with `__cc` (`__ccR`, `__ccT`, the host snippets' locals), so it can never collide with a minified name. Two exceptions, both v1 text kept byte for byte for T-E1: `run-plumbing` declares `cc` and `ca` (and is refused when the panel's context has one of those names), and the ring's IIFE in `parts/context-meter.mjs` declares `cr cu cw ct cg cm cp cf cs ce cv`. A clash of those eleven with the derived `session`, `jsx` or `jsxs` is not guarded yet (deferred): a future bundle that gives one of them such a name makes the composer throw on render. On 2.1.280 and 2.1.281 the three are `$`, `F`, `R`.

**Order at one point.** `applyEdits(src, edits)` sorts by `at`, ties in list
order: the earlier edit lands further left. The engine concatenates the lists as
`run-plumbing`, `context-meter`, `chat-media`, `chat-icons`, so the slot after
`/` reads: the ring button, then the user's buttons in list order.

**`run-plumbing`** (engine, requested by `context-meter` always and by
`chat-icons` when a command button is configured):
`,onRunSlash:__ccRun,onCanRunSlash:__ccCan/*CC-RUN*/` before the end of the panel
signature, and at the panel's call site two props that look a label up in
`<ctx>.commandRegistry` (`findCommandByLabel`) and run it (`executeCommand`).

## The composer panel: `Layout` (`lib/layout.mjs`)

Only the anchor is hardcoded; every other field is derived. Each failure is a
`LayoutError` with the message shown.

| field | derivation | error |
| --- | --- | --- |
| `anchorAt` | `ANCHOR = 'title:"Show command menu (/)"'`, exactly once | `anchor '...' found N times (expected exactly 1)` |
| `jsx`, `childrenAt` | last `children:\[([\w$]+)\(` in the 900 chars before the anchor | `no toolbar 'children:[' array before the anchor` |
| `jsxs` | last `([\w$]+)\("div",\{` before that, not after `.`/a name char; may be absent (`jsxs=-`) | - |
| `styles` | `className:([\w$]+)\.menuButton` in the same window | `no CSS-module object (className:X.menuButton)` |
| `insertFn` | `onInsertAtMention:([\w$]+)[,}]` in the same window | `no text-insertion callback (onInsertAtMention:X)` |
| `afterSlashAt` | the last `X("button",{` before the anchor must contain it; the slot is right after its closing `)` and the `,` that follows | `no button element wrapping the anchor`, `the anchor is not inside the button element it should belong to`, `unexpected token after the slash-command button element` |
| `spacerEnd` | `X("div",{className:Y.spacer}),` at most 4000 chars after the anchor | `no toolbar spacer element (right-hand group)`, `nearest spacer is N chars past the anchor ...` |
| `toolbar`, `signatureEnd` | the last `function ` before the anchor, which must read `function X({` (anything else is the error, not a search further back); the first `}){` after it, which must come before the anchor | `no toolbar component declaration (function X({...}))`, `could not delimit the toolbar component signature` |
| `callPropsAt` | the only `Y(<toolbar>,{` call site | `expected exactly 1 call site of X, found N` |
| `ctx` | last `X.commandRegistry` in the 60000 chars before the call site | `command registry not in the caller's scope (run mode impossible)` |
| - | `findCommandByLabel(` and `executeCommand(` exist in the bundle | `registry method "..." missing from the bundle` |
| `session` | `session:X` in the panel signature; optional | - |
| `hasUsage`, `usageReserve` | `<session>.usageData.value.totalTokens` between the signature and 3000 chars past the spacer, plus the stock counter's window expression (inline `contextWindow-maxOutputTokens-<n>`, or a helper `fn(a,b){return a-Math.min(b,CAP)-RES}`); optional | - |
| `pieOffAt` | the stock counter component (`X(Y,{usedTokens:`): just inside its body, if its `}){` is within 400 chars of `function Y(`; optional | - |

2.1.283: `jsx=F, jsxs=R, css=N7, insert=V, toolbar=YK0, ctx=X, session=$`.
2.1.280: `jsx=F, jsxs=R, css=M7, insert=V, toolbar=wB0, ctx=X, session=$`;
anchor @5154951, `afterSlashAt` @5155012, `signatureEnd` @5151926, `callPropsAt`
@5198124, `pieOffAt` @5150436. A `Layout` is frozen: parts share one instance.

## `context-meter`

- Edits: `/*CC-PIE*/return null;` at `pieOffAt` (switches the stock counter off) and the `/*CC-BTN:context*/` button at `afterSlashAt`. Always `requires: ["run-plumbing"]`.
- Modes: with the usage signal - ring and count (needs `jsxs` and `pieOffAt`) or count as text without them; without it - a plain `context` button. The button is disabled until `/context` is registered; the click runs `/context` through `__ccRun` (text insertion via `insertFn` only if the run prop is missing).
- Reading: `usageData.value.totalTokens` over the whole `contextWindow`, shown in whole thousands (`184k`), from a million with one decimal (`1.2M`). The window is remembered across reloads (`localStorage` key `ccBtnContextWindowFull`, global `__ccBtnWindow`); before the first completed turn it is guessed from the model id: `[1m]` at the end means 1000000 tokens, anything else 200000, and the tooltip marks the guess with `~`.
- Colour: `#6b9a5f` while below 256000 tokens and below 60 % of the window; `var(--app-claude-clay-button-orange)` otherwise.
- Tooltips and the plain button's label per language (`TEXTS` in the part); the English ones are v1's, so an English build is byte for byte v1's output (T-E1).

## `chat-media`, webview

Five anchor literals (`ANCHORS` in `parts/chat-media.mjs`), each exactly once in
the pristine webview; a pristine webview that already contains `__cc` is refused.

| # | insert | anchor, derivation (window) | where | 2.1.280 |
| --- | --- | --- | --- | --- |
| W1 | `/*CC-HELP*/` + the helper block | `.codeBlockWrapper,children:[`; the code block component = last `function (ID)\(\{children:(ID)\}\)\{` within 400 before it; cross-check `pre:\(\{children:(ID)\}\)=>(ID)\(<code>,\{children:\1\}\)` within 1500 after the markdown component's body | before `function Zy0(`, top level | @3683376 |
| W2 | `/*CC-CTX*/if(J)globalThis.__ccCtx=J;` | `` title:`Image blocked: ${ ``; the markdown component `H$` = last `function (ID)\(\{content:(ID),context:(ID),isPartialText:(ID)\}\)\{` within 3000 before it | start of `H$`'s body | @3682283 |
| W3 | `/*CC-URL*/urlTransform:__ccUrl,` | react-markdown's call and the stock URL filter: see the block below the table | before `remarkPlugins:` | @3682462 |
| W4 | `/*CC-LINK*/if(__ccLink($,J,Z))return;` | first `onClick:\((ID)\)=>(ID)\(\1,(ID),(<ctx>\?\.fileOpener|ID)\)` within 1200 after `H$`'s body (from 2.1.282 the third argument is the chunk memo component's prop, checked against `{source:ID,fileOpener:<it>,` between the body and the click); `function <handler>\((ID),(ID),(ID)\)\{` exactly once | start of the link handler `Jy0` | @3683252 |
| W5 | `/*CC-MDIMG*/{let __ccR=__ccImg(q,U);if(__ccR)return __ccR}` | first `img:\(\{src:(ID),alt:(ID)\}\)=>\{` within 1500 after `H$`'s body | start of the `img` component | @3683031 |
| W6 | `,/*CC-CODE*/__ccCodeBar($)` | the W1 anchor; the `]` matching its `[` (string-aware bracket scan) | before that `]`, after `<pre>` | @3683571 |

`(ID)` is `([\w$]+)`. `$`, `J`, `Z`, `q`, `U` in the inserts are the derived names
of 2.1.280. W3 holds a `|`, so it stands here verbatim. The first line finds the
react-markdown call (first match within 800 chars after `H$`'s body); the second
must match exactly once, with `<md>` = the call's group 2, and its group 2 is the
stock filter; its tail `.urlTransform||` is the anchor:

```
(?<![.\w$])(ID)\((ID),\{remarkPlugins:
function <md>\((ID)\)\{[\s\S]{0,600}?\1\.urlTransform\|\|(ID)
```

**The helper block** (`assets/webview-helpers.js`, inserted by W1): only function
declarations at the top level, nothing runs at load; full-line `//` comments and
blank lines are dropped on insertion. Bundle names reach it only through
`__ccB()`, whose body holds the placeholders the part fills:

| placeholder | derivation | 2.1.280 |
| --- | --- | --- |
| `__CC_JSX__` | `jsx` of the W1 `pre:` cross-check | `F` |
| `__CC_JSXS__` | `(?<![.\w$])(ID)\("div",\{className:<css>\.codeBlockWrapper` within 200 before the W1 anchor; `<css>` from `(?<![.\w$])(ID)\.codeBlockWrapper,children:\[` within 64 | `R` |
| `__CC_USEREF__`, `__CC_USEEFFECT__` | `\{let (ID)=(ID)\(null\);(ID)\(\(\)=>\{function` within 900 before `"Copy Link"`, groups 2 and 3 | `e`, `o` |
| `__CC_USESTATE__`, `__CC_USECALLBACK__` | `\[(ID),(ID)\]=(ID)\(null\),(ID)=(ID)\(\(` within 300 after `H$`'s body, groups 3 and 5 | `p`, `$0` |
| `__CC_URLFILTER__` | group 2 of the W3 filter regex | `$x1` |
| `__CC_LANG__` (in `__ccTxt`, outside `__ccB()`) | the configured language | `en` |

Channel guard: `this.comms.connection.value` within 200 chars after
`fileOpener={open:`, and `sendRequest\((ID),(ID),(ID),(ID)=` exactly once.
Requests go out as `globalThis.__ccCtx.comms.connection.value.sendRequest({type,
...})`, the path the stock `fileOpener` uses for `open_file`.

Runtime rules of the block: functions the bundle calls (`__ccUrl`,
`__ccCodeBar`, `__ccImg`, `__ccLink`) never throw and call no hooks; `__ccCard`
calls its hooks first and unconditionally and wraps everything else in
`try/catch`; all state lives in `globalThis.__ccMedia`, because the markdown
component re-creates the card on every render (a streaming answer re-renders on
every chunk); non-ASCII text appears only as JavaScript unicode escapes.

Behaviour:

- **Path:** the code element's text, joined and trimmed, is one line matching `^[A-Za-z]:[\\/][^\r\n<>"|?*]*$`; `/` becomes `\`. Kind by the last segment's extension (none after a leading dot, like `path.extname`): `png jpg jpeg webp gif bmp` image; `psd psb`; a trailing slash or no extension - folder; `pdf doc docx xls xlsx ppt pptx zip 7z rar exe dll msi tif tiff heic heif mp3 wav` - no editor; the rest - file.
- **Buttons** (`__ccButtons`), each drawn only when the host reported its capability: image - Open (`open`, and the stock `fileOpener`), Default app (`photos`), Show in folder (`reveal`); psd - Photoshop (`photoshop`), Show in folder; folder - Open folder (`reveal`, mode `open`); no editor - Show in folder; file - Open (only the `fileOpener`), Show in folder. Without Photoshop a psd card has only Show in folder, and a link click on a psd selects it in Explorer. A refused action shows "file not found" (error starting with `ENOENT`) or "could not open: <error>" under the buttons for 4 s.
- **Capabilities** (`__ccCaps`, `cc_host_caps`, 5 s): remembered for the window only when the host answered; an unpatched host answers `{type:"error"}`, which counts as no capabilities. Any other failure (timeout, no connection, a closed connection, a throw) is never remembered. It is asked again by the next card or link, and, while at least one card is subscribed, by one timer (`__ccCapsLater`, kept in `__ccState()`): 5 s, 15 s, then 60 s after the successive failures. After the third re-ask fails no timer is left; the next ordinary call (a new card, a link click) starts a new schedule. One request in flight, at most one pending timer; a timer exists only after a failed request, nothing runs at load. The first host answer ends the schedule and notifies every card (`__ccNotify(null)`).
- **Preview:** loaded when the card becomes visible (`IntersectionObserver`, disconnected after the first intersection). A card records per mount that it has been visible; on every notification for it (its path, or `null`) `__ccWake` starts `__ccLoadImage` for it once the capabilities are known and include `read_image` and its path has no preview yet, so a card that became visible before the capabilities arrived loads when they do. `__ccLoadImage` keeps its own sharing, queue and freshness rules: at most 2 card requests in flight per window, the rest queued; one request per path shared by its cards; 15 s from sending. A path answered less than 1 s ago is not asked again; otherwise the request carries `knownMtimeMs` and the host may answer `notModified`. The answer is shrunk at once to a webp thumbnail of at most 400 px on the longer side and shown at most 200 x 200 CSS px; the full data URL is not kept. The cache holds 200 paths, least recently used out first. Caption states: loading; too large (`__ccMb` megabytes rounded up, 1 MB = 1048576 bytes) with the buttons; file not found; preview unavailable (any other refusal, timeout, no connection, thumbnail failure); without `read_image` - buttons only.
- **Viewer** (`__ccViewer`): plain DOM on `document.body`, one per window, fetches the file itself outside the queue. Fit = `min(1, W/nw, H/nh)`, centred. Wheel on the overlay (non-passive, prevents page scroll) zooms by `exp(-deltaY*0.0015)` about the cursor, clamped to `[0.5*fit, 16]`; drag pans, a move over 3 px cancels the closing click; double-click fits; Esc (captured on `document`), a click on the backdrop or the close button closes and returns focus to the preview. The top bar shows the zoom percent, Default app, Show in folder and the close button.
- **Links and images in answer text:** `__ccDecodeHref` is the one gate: the address must match `^(?:[A-Za-z]:(?:[\\/]|%5[Cc])|file:)`, `file:///` before a drive letter is dropped, `decodeURIComponent` runs once (the raw string if it throws), and the result must pass the path check. `__ccUrl` lets such an address through react-markdown and hands everything else to the stock filter. `__ccLink` takes a click on such a link synchronously (the stock handler cannot open it), then runs the first button of its kind (Open for a plain file). `__ccImg` renders a markdown image with a drive path as the same card; anything else keeps the stock rendering.

## `chat-media`, host (`extension.js`)

Two places (`HOST_RES`), each regex exactly once in the pristine host; a pristine
host that already contains `__cc` is refused.

| place | regex | names | inserts |
| --- | --- | --- | --- |
| H1, folder branch of `openFile` | `let ([\w$]+)=([\w$]+)\.Uri\.file\(([\w$]+)\);try\{if\(([\w$]+)\.statSync\(\3\)\.isDirectory\(\)\)\{\2\.commands\.executeCommand\("revealInExplorer",\1\);return\}\}catch\{\}` | uri = group 1 (`W`), path = group 3 (`z`) | `CC-OPEN` right after the match (@3479274) |
| H2, start of `processRequest` | `async processRequest\(([\w$]+),([\w$]+)\)\{if\(\1\.request\.type==="get_current_selection"\)` | request = group 1 (`$`) | right after `{` (@3470874): `CC-CAPS`, `CC-REVEAL`, `CC-READIMG`, `CC-PHOTOS`, `CC-PS` in this order (`H2_ORDER`) |

The host bundle is CommonJS, so the snippets call `require("vscode" | "fs" |
"path" | "child_process")` directly; every name they declare starts with `__cc`.

Request protocol (the webview sends, the host answers):

| `type` | fields | success | failure |
| --- | --- | --- | --- |
| `cc_host_caps` | - | `{type:"cc_host_caps_response",v:1,caps:[...]}`: `open`, `reveal`, `read_image`; on Windows also `photos`, and `photoshop` only when an existing `Photoshop.exe` was found | an unpatched host answers `{type:"error"}` |
| `cc_reveal_in_os` | `path`, `mode`: `"open"` or `"select"` | `{type:"cc_reveal_in_os_response",ok:true}` | `{...,ok:false,error}` |
| `cc_read_image` | `path`, `knownMtimeMs?` | `{...,ok:true,dataUrl,size,mtimeMs}` or `{...,ok:true,notModified:true,size,mtimeMs}` | `{...,ok:false,error:"too large",size}` / `{...,ok:false,error}` |
| `cc_open_in_photos` | `path` | `{type:"cc_open_in_photos_response",ok:true}` | `{...,ok:false,error}` |
| `cc_open_in_photoshop` | `path` | `{type:"cc_open_in_photoshop_response",ok:true,exe}` | `{...,ok:false,error}` |
| `open_file` (stock) | `filePath`, `location` | `{type:"open_file_response"}`, no success flag | - |

- `CC-OPEN`: in `openFile`, a path ending in `png jpg jpeg gif webp bmp ico avif mp4 webm md markdown` goes to `vscode.open` (the image tab; for markdown the editor `workbench.editorAssociations` names, often the preview); the rest continues to the stock editor.
- `cc_host_caps`: `photos` is advertised only on Windows; `photoshop` only after the Photoshop lookup below (with a 1.5 s `reg` timeout, since the webview waits 5 s for the answer) found an existing exe, which is then remembered for the click. The lookup sits in `try/catch`: the capabilities always answer. They are asked once per window, so a Photoshop installed later appears after a window reload.
- Every other branch that touches a path first requires `DRIVE = /^[A-Za-z]:[\\/][^:]*$/`: `\\server\share`, `\foo` and a path naming an NTFS alternate data stream (`C:\a.txt:s.png`, any colon after the drive) are refused before any `stat`. Windows file names cannot hold `:`, so no real path is lost. The webview still draws a card for such a path; its preview says "preview unavailable". `CC-OPEN` (the stock `open_file` route) does not check it: it may show a planted stream of an image-named file in VS Code's image tab, where stock VS Code would open the same stream as text, so that adds no capability.
- `cc_reveal_in_os`: `mode:"open"` on a folder spawns `explorer.exe "<folder>"` (a drive root becomes `"C:\."`); anything else runs `revealFileInOS` (select in the parent).
- `cc_read_image`: MIME by extension (`png jpg jpeg jfif gif webp svg bmp ico avif`), must be a file; over 104857600 bytes (100 MB, see [Preview ceiling](#preview-ceiling)) answers `too large` with the size and is not read; an equal `knownMtimeMs` answers `notModified`; else the file as a base64 data URL. Only `fs.promises` in this branch.
- `cc_open_in_photos`: Windows only; `png jpg jpeg jfif gif webp bmp tif tiff heic heif avif ico jxl`; spawns `explorer.exe` with the one quoted path argument - the default app for the type. Explorer's own parser treats commas specially, so a planted file whose name holds commas might make Explorer open another item than the one clicked (not verified); a fix would drop the tested support for names like `a,b.png`. Open folder (`cc_reveal_in_os`, mode `open`) passes its folder the same way.
- `cc_open_in_photoshop`: Windows only; `psd psb png jpg jpeg tif tiff webp gif bmp`. The exe (shared lookup text `psLookup`): remembered `globalThis.__ccPsExe`, else `CC_PHOTOSHOP_EXE`, else `reg query` of `HKLM\...\App Paths\Photoshop.exe` (5 s timeout, hidden; `REG_SZ` or `REG_EXPAND_SZ` with `%VAR%` expanded; HKCU is not read); a missing or vanished exe falls back to `%ProgramW6432%` (else `%ProgramFiles%`)`\Adobe\Adobe Photoshop*\Photoshop.exe`, release before beta, newest name first. The file is the only argument, as a double-click in Explorer would pass it.

**Error containment.** Every `cc_*` branch sits in `try/catch` and answers a typed
`{type:"cc_*_response",ok:false,error}` - never throws, never `{type:"error"}`
(the webview would reject and send a stray interrupt). Every `spawn` is
`detached`, `stdio:"ignore"`, has an `error` listener and is `unref()`ed: an
unhandled child `error` event takes down the whole extension host, and an
undetached Photoshop would die with the window. I/O is asynchronous except the
Photoshop exe lookup (`existsSync`, `readdirSync` on the local disk). Nothing is
inserted outside H1 and H2.

**Host harness** (`tests/host-harness.test.mjs`): runs the six inserts exactly as
`plan()` returned them for the fixture, and again built with the request named
`p`, `e`, `v`, `n`, against stubbed `vscode`, `spawn` and `execFile` and real
files in a temp folder: caps (the Photoshop and platform variants are in
`media.test.mjs`),
fall-through of unknown requests, read_image (data, `notModified`, the 100 MB
edge, refusals, no sync `fs`), drive-letter and stream refusals without `stat`,
reveal, Default app, Photoshop (`reg` timeout, cache, error event, fallback
search), `CC-OPEN` routing. Without a fixture the `plan()` variant is
skipped, so that run does not count as a pass.

## `chat-icons`

Webview only. The buttons come from `ctx.options.buttons` (the config's `buttons`),
checked by `validateButtons` on every plan: a bad list makes only this part
UNSAFE, with the first bad field named (`buttons[1].tooltip: required, 1-80
characters, ...`). No buttons: no edits, no `requires`, the note `no buttons
configured; --buttons <file> adds them`, and not even the panel is needed. With
buttons, every point comes from the panel's `Layout`; `toolbar === null` is a
`LayoutError` with its reason. Each kind of button asks only for what it uses:

| # | insert | where | when | derivation |
| --- | --- | --- | --- | --- |
| I1 | `,onSendText:__ccSendText/*CC-SEND*/` | `signatureEnd` (@5151926) | a send button exists | - |
| I2 | `onSendText:(__ccT)=>Z(__ccT,[]),/*CC-SEND*/` | `callPropsAt` (@5198124) | a send button exists | anchor `("/compact",[])` exactly once; `let (ID)=\(\)=>\{(ID)\("\/compact",\[\]\)\}` within 200 before it; `Z` = group 2; guard: `onCompact:<group 1>` within 1500 after the call site |
| I3.. | `/*CC-ICON:<id>*/` + one button per configured button, in list order | `afterSlashAt` (@5155012), after the ring | always, with buttons | busy guard below |

- Busy guard, when a command or send button exists: `session:(ID)` from the panel signature, and `<session>.busy.value` inside the panel's body. Without the busy signal there are no buttons at all: a button that sends mid-turn and cannot be greyed out while Claude works is worse than none. Insert buttons only edit the draft, so they need neither the signal nor `CC-SEND`.
- `requires: ["run-plumbing"]` only when a command button exists.
- A command button: `disabled` while `<session>.busy.value` or while `__ccCan("<command>")` is false (the registry does not list it); tooltip then `Unavailable: Claude is still working` or `<command> is not loaded yet or not installed`; the click runs it through `__ccRun`. `__ccCan` is guarded at render: a missing prop would throw and take the composer down, not only the button.
- A send button: `disabled` while busy; the click calls `__ccSendText(text)`, which I2 wires to the panel's own send function `Z(text, [])` - what Enter does. The draft in the input is untouched; pending attachments go with the message (they go with a command button's `/<name>` too).
- An insert button: the click calls the panel's `onInsertAtMention` (`Layout.insertFn`, the callback its "Add context" menu uses), which appends the text at the end of the draft with a separating space. Never disabled while Claude works.
- Every config string reaches the bundle only through `lit()`: a JS string literal with `\`, `"` and `/` escaped and every character outside printable ASCII as a `\u` escape, so config text can never become code, close a comment or spell a marker. The one raw splice is the id in `CC-ICON:<id>`, safe by its pattern `^[a-z0-9-]{1,24}$`.
- The part's own tooltips (busy, not listed) come from its `TEXTS` table per language.
- Errors, prefixed with the step: `let ...("/compact",[]) handler: ...`, `onCompact guard: ...`, `session: no session:(ID) in the composer panel signature`, `panel body: ...`, `no busy signal`, `pristine webview already contains __cc names`, and `buttons[<i>].<field>: <why>` from `validateButtons`.
- Icons are inline SVG: the codicon font in `index.css` is a `data:` URL, and the webview's policy (`font-src ${cspSource}` in `extension.js`) does not allow `data:` fonts. `menuButton` buttons, `svg` 26 x 26 with `viewBox "-5 -5 26 26"`: the 16-unit glyph box padded by 5 on every side, so the glyph is drawn smaller and centred, meant to match the `/` icon's size. Path `fill:"currentColor"` - colour, disabled grey and theme are the stock ones. The outlines are `ICONS` at the top of `parts/chat-icons.mjs`. A `label` button is a text pill: the stock round `menuButton` gets `width:auto`, padding and a 5 px radius.

Icon attribution: the outlines of `arrow-right`, `export`, `check`, `pass`, `sync`,
`pulse`, `graph`, `comment`, `rocket`, `debug`, `trash`, `book` and `star` (the
glyph `star-full`) are glyphs of Codicons by Microsoft
(https://github.com/microsoft/vscode-codicons), licensed under CC BY 4.0
(https://creativecommons.org/licenses/by/4.0/). Changed: converted from the
codicon font the Claude Code extension ships in its `index.css` to 16 x 16 SVG
paths rounded to 0.1.

## `chat-mark` and `chat-files`

Both are webview-only and never touch `extension.js`; they call chat-media's helpers at run
time (`__ccB`, `__ccState`, `__ccCtx`, `__ccViewer`, `__ccLoadImage`, `__ccCaps`,
`__ccButtons`, `__ccAct`, `__ccPathOf`, `__ccKind`, `__ccDecodeHref`), so with
`chat-media` UNSAFE or disabled nothing of theirs shows. Each appends its helper
block at the end of the bundle (`at = src.length`): the bundle ends with
`try{sY5()}catch($){...}`, and function declarations appended after it are
hoisted, defined before `sY5` runs. With both enabled the two blocks follow part
order, `CC-MARK` first.

**`chat-mark`** - `/*CC-MARK*/` + `assets/mark-helpers.js`. No anchor; guards,
each a `LayoutError` named by its label:

| guard | what | why |
| --- | --- | --- |
| M1 | `/function ([\w$]+)\(([\w$]+)\)\{if\(!\2\.startsWith\("@"\)\|\|\2==="@"\)return \2;/` once | the function the insert goes through returns text without `@` unchanged (2.1.283: `Ev1`; 280 `ZC1`, 281 `KC1`, 282 `_v1`) |
| M2 | `.atMentionEvents.add(` once | the prompt box is the one subscriber of the emitter |
| M3 | `insertAtMention:(a,b)=>{let x=<M1 name>(a)` once | the insert really goes through M1 |
| M4 | no `__cc` in the pristine copy | - |

Runtime: the card hook in `__ccCard` calls `__ccMarkButtons(path, kind,
tooLarge, caps)` (Insert path, key `select`, always for an image while
`__ccCtx.atMentionEvents.emit` exists; Mark only with `read_image` and not `large`). Insert path and Done call
`__ccMarkInsert(text)` = `__ccCtx.atMentionEvents.emit(text)`: the prompt box
inserts at the caret with `execCommand("insertText")`, no `@` means no mention
and no attachment; a path with a space is put in double quotes. While a permission request is on screen the window drops the
text silently; nothing reports it. `__ccViewer`'s `load` handler calls
`__ccMarkViewer({path, overlay, bar, img, close, draw})`: two layers before the
bar (boxes, `pointer-events:none`; input, `auto` only in draw mode), the bar wraps
(`flexWrap`), boxes are kept per lower-cased path in `__ccState().marks` until
Clear or a reload. Coordinates are pure functions of the image's
`getBoundingClientRect()`: `__ccMarkBox` (screen points to source pixels,
clamped, under 4 screen px is no box), `__ccMarkScreen` (back). Done closes the
viewer first, then inserts `__ccMarkText`: the head `<path> (WxH), regions [x1,y1,x2,y2] in source image pixels:`
(its last part from the label table, `regions`), then one line `<n> [x1,y1,x2,y2]: ` per box; the joiner is one
constant, and `__ccMarkInsertLines` makes each break with `execCommand("insertLineBreak")`, as Shift+Enter does
(a line break inside inserted text is dropped by the prompt box). Middle-button pan is chat-media's `__ccPanBtn`.
The labels come from `__ccMarkLabels` (Insert path, Mark, Undo, Clear, Done and their tooltips).

**`chat-files`** - two inserts. F1 `/*CC-SESS*/globalThis.__ccSessions=<q>;globalThis.__ccFilesCtx=<U>;try{__ccFilesBoot()}catch(__ccE){}`
right after the statement that follows the anchor `{hostReportsDocumentCloses:!0});`
(`q=new n61(G,U);` in 2.1.283: the session manager and the window context; the
class is `y61`/`C61`/`r61`/`n61` in 280-283, the start function `uX5`/`BY5`/`mY5`/`sY5`).
F2 `/*CC-FILES*/` + `assets/files-helpers.js` at the end. Guards: the anchor once;
the statement `^([\w$]+)=new ([\w$]+)\(([\w$]+),([\w$]+)\);` right after it;
`,<q>=void 0,` and `,<U>=new ` within 300 chars before the anchor; `activeSession=`
within the first 3000 chars of the manager class; the window row class
`class X{type;content;parentToolUseId;sdkParentToolUseId;` once; `"ReadCoalesced"`
present and `input:{fileReads:` once; no `__cc`.

Runtime: `__ccFilesBoot` adds one fixed button (top right, `z-index:9999`) unless
`window.IS_SESSION_LIST_ONLY` or chat-media's helpers are missing. Its texts come from `__ccFilesLabels`. The panel reads
`__ccSessions.activeSession.value.messages.value` at every open - the window's
own rows, not the transcript: `row.content[i].content` is the block, subagent
rows carry `sdkParentToolUseId` (assistant) or `parentToolUseId` (user). The
window keeps at most 600 rows and trims to 500, oldest tool rows first
(`lf1=600,df1=500`), so a long chat shows only its last part. `__ccFilesCollect`
takes main-agent assistant rows: one-path fenced blocks and drive-path link
targets from text, image paths from `Read` and `ReadCoalesced`. Consecutive
successful Reads are merged by the bundle's `_b1` into one row that carries no
subagent marker, so a `ReadCoalesced` row is taken only when neither neighbour row
is a subagent's (the neighbour rule). A non-empty list with no window-shaped row
is "could not read the chat", not "empty": a changed row shape shows. While open
the panel sets `__ccState().panel` to its close function; an insert closes it.

## State, ledger, cache, lock, hook

All paths are derived from the environment at call time (`USERPROFILE`, else
`HOME`; `CCP_STATE_DIR` for the state folder); importing the engine runs
nothing.

- **Config** `vscode-claude-code-patch.config.json`: `{"schema":"ccp-config/1","paused":false,"enabled":[...],"language":"en","buttons":[...]}`, `language` and `buttons` optional. Absent: the base parts (`DEFAULT_ENABLED` = `chat-media`, `chat-mark`, `chat-files`), English, no buttons, not paused; a build by these defaults writes no file. Every write (`--enable`, `--disable`, `--language`, `--buttons`, `--revert`) keeps `language` and `buttons`. `buttons` is not checked on read: `chat-icons` checks it, so a bad list takes out only that part. Unreadable, a foreign `schema`, no boolean `paused` or no `enabled` list, an unknown part id, or a `language` other than `en` and `ru`: builds exit 1 with `fix or delete it (--revert rewrites it with the defaults)`, `--ensure` does nothing and says so in its message, `--verify` checks every part and exits 1, `--status` prints `config: UNREADABLE - ...`, and `--revert` rewrites it with the base parts and `paused: true`, keeping a `buttons` list if the file still parses (`..., its buttons kept`).
- **Ledger** `{"<version>": {"date", "targets": {"<target>": {"sha1_pristine": "<12 hex>"}}}}`; for webview a root `sha1_pristine` (v1's key) is the fallback. A known version whose pristine copy has another sha1 is refused. Unknown versions, and targets a known version has no sha1 for, are recorded after their first good build.
  - **One read per run** (`readLedger`): the writing commands read it right after taking the lock, `--verify` and `--status` without a lock. The write merges the new sha1s into that same object: an existing entry keeps every key (`date`, v1's `symbols`, `buttons`, `side`, the root `sha1_pristine`, other `targets.*`) and gets only `targets.<target>.sha1_pristine`; a new version gets `{date, targets}`. No second read, so a read that fails in the middle of a run cannot shrink the file.
  - **Unreadable** = the file exists and reading it throws, `JSON.parse` throws, or the value is not a plain object (an array included); an absent file is an empty, readable ledger. The line: `ledger <path> is unreadable (<first line of the reason>) - fix it or delete it (deleting drops the sha1 history of every version)`. A build (no flag, `--enable`, `--disable`, `--language`, `--buttons`, `--reapply`, `--dry-run`): the line, exit 1, nothing written - checked first under the lock, before the config write. `--ensure`: the fast path never reads the ledger; the slow path puts the line into the Details of its message, exit 0, nothing written. `--verify`: the line, exit 1, no trial build. `--status`: `ledger: unreadable (<reason>)` before the installations and no ledger comparison on the `.orig` lines, exit 0. `--revert`: restores without the sha1 check (above). `--forget`, `--where`, `--install-hook`, `--uninstall-hook`: unaffected. The ledger is never written while unreadable.
- **Cache** `{"schema":"ccp-cache/1","targets":{"<file>":{size,mtimeMs,featureSet}}}`. `featureSet` = the first 12 hex of the sha1 of `{enabled, language, buttons, code}`, where `code` is the sha1 of the engine, `lib/layout.mjs`, every file of the parts folder in use and every file of `assets/`, read once per run. `--ensure` stats each target; if every fingerprint matches it exits without taking the lock or reading a bundle. A new version folder, a changed file, a changed config or changed skill code sends it under the lock into a full build, after reading config and cache again. So a skill update or a repair is applied at the next session start, and a part a build left UNSAFE is tried again as soon as its code changes; until something changes, later sessions stay silent about it.
- **Lock** `vscode-claude-code-patch.lock`, opened exclusively by every writing command, which writes `<pid> <ISO time>` into it. A held lock whose text starts with a pid that is not this process and no longer runs (`process.kill(pid, 0)` throws `ESRCH`) is removed at once and taken, with `  [-] removed a lock left by a run that is no longer running (pid <n>)` (not printed under `--ensure`). Anything else - empty or other text, a live pid, `EPERM`, a lock that cannot be removed - keeps the age rule: polled every 250 ms for up to 30 s; one older than 120 s is taken as abandoned and removed. A reused pid can only make a finished run look alive, which falls back to the age rule. Not getting it: exit 1, `the lock is held by another run since <time>` (`--ensure`: in its message, exit 0).
- **Hook** in `settings.json` under `hooks.SessionStart`, one entry: `{"type":"command","command":"<node.exe>","args":["<path of the claude_code_patch.mjs that installed it>","--ensure"],"async":true,"timeout":120}`, where `command` is the absolute path of the Node that ran `--install-hook`. Ours is recognised by `claude_code_patch.mjs` in the entry's JSON; several collapse into one, and an existing one is refreshed in place. `settings.json` is copied once to `settings.json.ccp.bak` before the first hook write. `--install-hook` refuses (exit 1) under Electron and while v1's entry exists in any form (`patch_claude_code_ui.mjs`, or `run.ps1` / `run.sh` inside a `vscode-claude-chat-context-meter` folder) - so do every build and `--ensure`; the engine never edits v1's entry. From an engine outside `~/.agents/skills` and `~/.claude/skills` it installs with a warning that the hook now points into that folder. `settings.json` that does not parse is refused, untouched (`... is not valid JSON (...) - fix it first; nothing written`); for builds an unreadable `settings.json` only means no v1 hook can be seen.

## `--ensure` and its message

The hook is `async`: plain output of an async hook reaches no one. So `--ensure`
prints at most one JSON line on stdout, `{"systemMessage": "..."}`, and always
exits 0. The message starts with `Claude Code chat patch (vscode-claude-code-patch):`,
then:

- after a build that wrote: `rebuilt for <versions>; reload the VS Code window to see it (Ctrl+Shift+P -> Developer: Reload Window).`
- with parts left UNSAFE: `Not applied (UNSAFE): <parts>; ask Claude to fix the Claude Code chat patch.`
- with any other problem: `A problem at session start; ask Claude to check the Claude Code chat patch.`
- after either of the last two: `Details: <every problem line, joined by " | ">` (the UNSAFE lines, the ledger, the lock, the config, v1's refusal, `[!]` lines).

The first sentence and one of the others can stand together. Nothing is printed
when every fingerprint matches, and nothing while the config is `paused`. On
another platform the message is the `Windows only for now: ...` line.

## Reading the output in full

- `  <part>: SAFE TO PATCH` - the trial build of that part passed every check (`(dry run)` after it under `--dry-run`). `    chat-icons: nothing to insert (no buttons configured; --buttons <file> adds them)` under it: enabled without buttons, not an error.
- `  UNSAFE: <part>/<target>: <ErrorName>: <message>` - the part is left out of the build on every target; the others are built. `LayoutError` means an anchor or a derivation did not match the new build (`anchor '("/compact",[])' found 0 times (expected exactly 1)`, `H2 processRequest: /.../ matched 0 times`): self-repair. Any other error name (`TypeError`, `RangeError`) is the part's code meeting a build it does not understand: the same. A plain `Error` prints no name: `UNSAFE: <part>/<target>: <message>`, as in the engine's own checks (`marker count after assembly differs from its edits`, `the host write failed`) and in `chat-icons/webview: buttons[<i>].<field>: <why>` (the config's buttons).
- `  UNSAFE: <part>/<target>: target refused: <reason>`, after a `  REFUSED <target>: <reason>` line - the file itself is refused, not an anchor. `foreign CC markers <list>`: another tool wrote `/*CC-...*/` markers; with the `.orig` present, `--revert` throws them away and names them, then build. Without an `.orig`, `--revert` refuses that target (`[!] <target> carries CC markers (<list>) but <file>.orig is missing - reinstall the extension`, exit 1) and still sets `paused`: reinstall the extension, then build (the build also clears `paused`). `... carries CC markers but ... .orig is missing`, `the pristine copy carries CC markers ...` or `the pristine copy has sha1 ..., the ledger says ...`: the pristine copy is not the extension's original; stop, tell the user, reinstalling the extension gives a clean one.
- `  UNSAFE: <part>: <reason>` - the part's module or `lib/layout.mjs` does not load, so the part is out on every target: `  UNSAFE: <part>: module did not load: <error>` or `  UNSAFE: <part>: lib/layout.mjs failed to load: <error>`. A file of the skill itself is broken.
- `  UNSAFE: parse <target>: <error>` followed by `  Fatal: <target> does not parse after the build - nothing written to any target` - no per-part verdict; nothing is written anywhere. To find the part whose inserts break the parse, run `--disable <id> --dry-run` once per enabled part: those runs write nothing, and the one whose `Fatal` goes away names the part. Then self-repair for that part, on the user's word (`SKILL.md`, When something breaks).
- `  layout: not found: <reason>` - the composer panel was not recognised; `context-meter` and `chat-icons` (with buttons) are UNSAFE with the same reason; `chat-media`, `chat-mark` and `chat-files` do not depend on it.
- `ledger <path> is unreadable ...` - see the ledger above. Run the command once more (a sync client can hold the file for a moment); if it stays, tell the user and do not delete the ledger yourself: it holds the sha1 guard of every version. `--revert` still works and prints `ledger unreadable: .orig restored without the sha1 check (<path>)` once.
- `  [!] <installation folder>: <reason>` (a build, `--verify`, `--ensure`) or `  [!] <installation folder> <target>: <reason>` (`--revert`) - a file of that installation could not be read or written, usually one held by another process or an old version folder VS Code is deleting. Only that installation (or that target) is skipped; the others are built or restored; exit 1. Run the command again later. `  [!] <target>: <reason>` inside a build is a failed write of that target: the file is as it was.
- `  [-] removed a lock left by a run that is no longer running (pid <n>)` - an earlier run was killed while holding the lock; nothing to do.
- A build prints per target `[w] <target> written: <parts>`, `[=] <target> unchanged: <parts>`, `[-] <target> restored from <file>.orig, which is removed` or `[=] <target> left as it is: it still carries the build of a previous run`, then `[+] <part> applied` per part (or `[=] chat-icons: nothing to insert (...)`). A build without `--dry-run` that got past the ledger and the config ends with `Reload VS Code to see the change`, also after a parse `Fatal` (nothing was written) or an UNSAFE part; without a `[w]` or `[-]` line a reload changes nothing.
- `--verify` prints per installation `version <v>: in the ledger (<date>)` or `not in the ledger`, per target `clean` or `patched (<markers>)`, `.orig present|absent` and `pristine sha1 <12 hex> = ledger` (or `!= ledger <12 hex>`), and the `layout:` line with the panel's derived names. `[dry-run] would write <target>` means the build differs from the file on disk - after a skill update, a config change or a new extension build; it is not an error. `config: paused (--revert); below is what an explicit build would do` heads it while paused.

`--status` shows what is on disk: the `config:` line (`<path>` or `none, defaults`,
`paused`, `language`), `buttons: <ids>` when the config has a list, each part
enabled or disabled and whether its module loads, per target each marker with its
owner (`FOREIGN` for markers of no part), the parts the config expects (`chat-icons`
without buttons expects none), whether `.orig` exists and matches the ledger, the
`hook:` line (`installed`; `points at <engine> (missing file)` or `runs <node.exe> (missing
file)`, both ending `- run --install-hook`; `points at another copy <engine>`), and `v1 trace:` lines while anything of v1 is left (its hook entry,
or its folder under `~/.claude/skills` or `~/.agents/skills`). `note: the parts in
the file differ from the config (found: ...) - an UNSAFE part, or the build of a
previous run` follows an UNSAFE part or a build left from a previous run (also
after a skill update or a config change, until the next build). After `--revert`
it shows on every target (`found: none`) and means only that the config is paused.
With no installation found `--status` prints no installation line and still exits
0: use `--where`, which says `no Claude Code installation under <path>` and exits
1. The ring is drawn when `CC-PIE (context-meter)` is listed; without it the
button shows the count as text or, on a build without the usage signal, is a plain
`context` button that runs `/context`.

## Preview ceiling

The chat webview may load files only from the extension folder, so the host reads
the whole image and posts it to the webview as one base64 string. A 19 MB,
14377 x 4819 JPEG took 1-2 s to preview and zoomed well. Past a few hundred MB
this method breaks by construction: base64 of a 384 MB file is about 512 MB of
text, the JavaScript engine's limit for one string, and decoding 350 megapixels
needs about 1.4 GB in one webview. Hence the 100 MB ceiling. Above it the card
keeps the caption and its buttons (the VS Code tab loads the file by URL, not as a
string). A rework could let the webview read files from disk directly (add the
drives to its `localResourceRoots`): no string limit and faster, but the window
that renders model output would then reach the whole disk, a security trade-off to
weigh first. The other route is a downscaled copy before posting. Neither is
planned.

## Tests

| file | covers |
| --- | --- |
| `tests/run.mjs` | the only runner |
| `layout.test.mjs` | T-E20: `Layout` on the fixture, the panel anchor renamed or doubled, `applyEdits` order, `ctx` helpers and options, the fixture loader |
| `engine.test.mjs` | T-E2..T-E25: the engine with fake parts from `tests/fixtures/fake-parts/<set>/`; the `--ensure` message, the unreadable ledger and the one-read merge, one installation's failure, the lock of a finished run |
| `config.test.mjs` | T-C1..T-C10: the base install without a config, `language` and `buttons` kept through every write and handed to the parts, the fingerprint of the code, the `hook:` line, v1 refused in every form, Windows only, the project-copy warning, chat-icons without buttons |
| `cm-regression.test.mjs` | T-E1: the ring alone writes v1's webview byte for byte (2.1.280 reference with `index.v1.js` only), and the Russian tooltips |
| `foreign.test.mjs` | T-N1..T-N4, T-N8, T-N9, T-N11: foreign patchers (`tests/lib/xpatch.mjs`), a file v1 patched, the `CC-ICON:*` family against v1's `CC-BTN:<id>` |
| `media.test.mjs` | T-M1..T-M5 and chat-media's T-N5, T-N6, T-N10: anchors, label tables in both languages, host capabilities (Photoshop found or not, not Windows), NTFS-stream refusals; T-M5 runs the card's effects in a small hook runtime with a fake `IntersectionObserver` (capabilities that come late, the 5/15/60 s re-ask) |
| `host-harness.test.mjs` | T-M4, the host harness |
| `icons.test.mjs` | T-I1..T-I6 and chat-icons' T-N5, T-N6, T-N10: points and texts, no buttons, what each kind of button asks for, Russian, the escape fuzz (quotes, `*/`, a fake marker, `</script>`, U+2028, backtick, `${`), `validateButtons` |
| `mark.test.mjs` | T-K1..T-K8: chat-mark on every fixture version found beside `CCP_FIXTURES`, its pure functions, the card hooks and the viewer in a small fake DOM, both languages |
| `files.test.mjs` | T-F1..T-F7: chat-files on every fixture version found, `__ccFilesCollect` on hand-made rows and, when present, on recorded window rows (`messages` beside the fixture folders), the button and the panel |
| `integration.test.mjs` | T-J1..T-J10: the real parts through the real engine in a sandbox; T-J7 builds all five on every version found beside `CCP_FIXTURES` |
| `mirror.test.mjs` | `tools/mirror.mjs`: the mirror, the tree comparison, its guards, links and junctions, the CLI exit codes |
| `prose.test.mjs` | the sentences of `SKILL.md` that carry a rule an agent must not lose |
| `run.test.mjs` | self-test of the runner: the live-copy refusals, the skip count, "a test file started without run.mjs refuses" |

Helpers in `tests/lib/`: `fixtures.mjs` (loading and checking fixtures, the skip
reasons), `sandbox.mjs` (a temp home with a copy of the fixture as an installed
extension; refuses to load outside `run.mjs`, see below), `b-harness.mjs`
(`plan()` of the real parts through `lib/layout.mjs`, no engine), `xpatch.mjs`
(the foreign patcher), `ensure.mjs` (reads the `--ensure` JSON line),
`skip-reporter.mjs` (writes each skipped test and its reason for the runner).

Run from any folder; the runner finds its skill folder by its own location. Pass
test files by absolute path: a relative one is looked up in the current folder
first, which may hold another copy of the skill.

```
CCP_FIXTURES="<fixture folder>" node "<skill folder>/tests/run.mjs"                                   # every tests/*.test.mjs
CCP_FIXTURES="<fixture folder>" node "<skill folder>/tests/run.mjs" "<skill folder>/tests/host-harness.test.mjs"
```

- `CCP_FIXTURES` names the fixture folder of one version and is required (without it the runner prints its usage and exits 2). A fixture is `index.js.orig` (pristine webview), `extension.js` (pristine host) and `manifest.json` `{"version","files":{"<name>":{"size","sha1"}}}`; [layout-recovery.md](layout-recovery.md#2-set-up-and-take-the-fixture) takes one from the installed extension. Missing files or a sha1 off the manifest fail loudly.
- **Material only the maintainer has** is optional, and the tests that need it skip with a reason: the pinned 2.1.280 reference (sizes and sha1 in `tests/lib/fixtures.mjs`) with `index.v1.js` (v1's build of it), sibling version folders next to `CCP_FIXTURES`, and recorded chat rows (`messages`). The reasons read `fixture is <version>, not 2.1.280: reference comparison skipped`, `no index.v1.js in the fixture (... author-only material): v1 comparison skipped`, `no fixture of <version> next to CCP_FIXTURES (...): author-only material`, `no fixture <version> beside ...: author-only material`, `no messages fixture in ... (real chat rows, not shipped): author-only material`: each one names `author-only material` or ends in `reference comparison skipped`. After the run the runner prints `[run.mjs] skipped: <n>, by reason:` with a count per reason. A run on a user's own fixture is green with these skips; everything else runs on the new bundles: every anchor once, every name derived, renamed or doubled anchors refused (T-N5, T-N6), the build parses, the engine and the real parts in the sandbox. Green with skips does not prove that a re-learned derivation still refuses a broken bundle: the byte-for-byte comparisons only run on the reference.
- `CCP_ALLOW_NO_FIXTURES=1` - the only bypass: fixture tests skip with a `SUITE INCOMPLETE` banner. Such a run is no verdict.
- **The runner** snapshots the real guarded paths (every installation's targets, `.orig` and tmp files, `settings.json` and its backups, the state files of this skill and of v1, absent ones included). It refuses to start (exit 2) from a live copy: an engine whose real path lies under `~/.claude` or `~/.agents/skills` (`the engine <p> lies under <dir>: run the suite in a copy outside the live folders (tools/mirror.mjs makes one)`) or the one the SessionStart hook runs; and unless `--where` in a sandbox sees only the sandbox installation. It also refuses (exit 2) a Node older than 20.10 and a `CCP_FIXTURES` inside the skill folder. It then runs `node --test --test-concurrency=1` with `USERPROFILE`, `HOME`, `APPDATA`, `LOCALAPPDATA` and `CCP_STATE_DIR` pointing at an empty bait folder and `CCP_RUN_BAIT` naming it, and snapshots again. Exit 0 green, 1 a test failed, 2 usage error, refused start, a real file changed or the bait written to. A real file changed during the run (another window's hook, an extension update) is to be investigated, not re-run away.
- **Isolation sentinel.** The test files that import `tests/lib/sandbox.mjs` (`engine`, `config`, `foreign`, `cm-regression`, `integration`; `run.test.mjs` checks the sentinel through probe files) refuse to load unless `CCP_RUN_BAIT` is set, lies under the OS temp dir, and is equal (resolved, case-insensitive) to each of `USERPROFILE`, `HOME`, `APPDATA` and `CCP_STATE_DIR`, which only `run.mjs` arranges. Started any other way (`node --test tests/engine.test.mjs`), the file fails at import with `Error: tests/lib/sandbox.mjs: not isolated - run the suite through node tests/run.mjs`: one failed test, exit 1, no test of the file run. The other test files do not check; start them through `run.mjs` too.
- Tests that spell an anchor literally instead of importing it; when that anchor is re-taught, move the literal with it:
  - panel anchor `title:"Show command menu (/)"`: `engine.test.mjs` (T-E21, which renames it and expects its error text), `layout.test.mjs` ("readToolbar never throws", the expected error text), and `tests/lib/xpatch.mjs` (`ANCHOR`, the foreign patcher). With that anchor missing, xpatch's `patch-toolbar`/`toolbar-nomark` insert at offset 9 of the file and T-N3 passes vacuously.
  - `("/compact",[])`: `icons.test.mjs` (`COMPACT`; T-N10 chat-icons and the T-I1 guards also hard-code the 2.1.280 handler `let l6=()=>{Z("/compact",[])}`) and `integration.test.mjs` (`COMPACT`, T-J6).
  - `` title:`Image blocked: ${ ``: `integration.test.mjs` (`W2`, T-J6).
  - `"revealInExplorer"` and `"get_current_selection"`: `integration.test.mjs` (T-J2) and `media.test.mjs` (T-N5/T-N6 host); `media.test.mjs` also expects `async processRequest(` exactly twice in the host, on any fixture.
  All but xpatch's fail until their literal follows the anchor; xpatch's stays green and proves nothing.
- Read the summary lines at the end (`tests N`, `pass N`, `fail N`, `skipped N`): a run with `tests 0` ran nothing. Always go through `run.mjs`; it strips `NODE_TEST_CONTEXT`, which makes a nested `node --test` report to a parent that is not listening and silently run nothing.
- The whole suite takes several minutes (about 240 tests; a slow machine or a busy disk can double it): run it in the background rather than inside a two-minute tool timeout. It needs Node 20.10 or newer (`--test-concurrency`).
- `CCP_PARTS_DIR` (a different parts folder) is a test seam; `--status` and `--where` say when it is set. The engine's `run(argv, env, io)` takes a test seam `io` (`writeFile`, `lockWaitMs`, `platform`, `node`) that the CLI never sets.
