# Self-repair: a part is UNSAFE on a new extension build

`--verify`, a build or the hook's message says `UNSAFE: <part>/<target>: ...` after the Claude Code
extension updated: the new build rewrote code an anchor points at. The repair goes into a staging
copy of the skill, is tested there against a fixture of the new version, and only then replaces
the installed skill folder. The parts that passed keep working the whole time.

**Start only on the user's word:** they asked you to fix or restore the patch (or a part of it), or
said yes when you offered the repair. A request to check ("is the patch still safe on this
version?") gets `--verify`, a report and the offer, nothing more; the hook's message gets one line
and the offer.
That request or that yes covers every step below, the live apply in step 10 included; sending
anything upstream (step 12) needs its own yes.

## Folders

| name | where | what |
| --- | --- | --- |
| `SKILL` | the installed skill folder: the folder of the `engine:` line that the lookup in `SKILL.md` (Finding the script) prints. An `npx skills add -g` install lives in `%USERPROFILE%\.agents\skills\vscode-claude-code-patch`, linked from `%USERPROFILE%\.claude\skills\vscode-claude-code-patch` | the live copy: the hook runs it; never edited in place |
| `STAGE` | `%LOCALAPPDATA%\vscode-claude-code-patch\staging\vscode-claude-code-patch` | the only place the skill is edited; no Claude Code session loads it |
| `FX` | `%LOCALAPPDATA%\vscode-claude-code-patch\fixtures\<version>` | the pristine bundles of the new version |

The fixtures are Anthropic's code: they stay under `%LOCALAPPDATA%`, never in git, the skill folder
or a synced folder (OneDrive, Google Drive, Dropbox). The suite needs Node 20.10 or newer.

The blocks below are for Git Bash (the Bash tool). Each Bash tool call starts fresh, so repeat these
lines at the start of every call:

```bash
SKILL=$(cygpath -m '<the installed skill folder>')
VER=2.1.290                                   # the new version, from the UNSAFE line or --verify
BASE="$(cygpath -m "$LOCALAPPDATA")/vscode-claude-code-patch"
STAGE="$BASE/staging/vscode-claude-code-patch"; FX="$BASE/fixtures/$VER"
```

## Steps

1. **Tell the user in one line** that the new extension build moved something and you are working
   it out (when to start: above, and `SKILL.md`, When something breaks).
2. **Mirror the live folder into staging** and check that the copy is exact:
   `node "$SKILL/tools/mirror.mjs" "$SKILL" "$STAGE"`. Exit 0 with
   `mirror: sha1 comparison: the trees are equal` is the only good result; anything else, read the
   lines and mirror again. The tool deletes what the source does not have, so it refuses a target
   that is neither empty nor a copy of this skill, and folders that overlap. Why staging: the hook
   rebuilds as soon as the skill's own files change, so a session start while the live folder is
   half edited would build from half-edited files.
3. **Take a fixture of the new version** into `FX`: the command in
   [layout-recovery.md](layout-recovery.md#2-set-up-and-take-the-fixture).
4. **Find the new anchors** with [layout-recovery.md](layout-recovery.md), one recon block per
   anchor family.
5. **Edit only the file of the part that failed, in `STAGE`:** the composer panel - `Layout` in
   `lib/layout.mjs`; `chat-media` - `parts/chat-media.mjs` (host snippets in
   `assets/host-snippets.mjs`, webview helpers in `assets/webview-helpers.js`); `chat-icons` -
   `parts/chat-icons.mjs`; the ring - `parts/context-meter.mjs`; `chat-mark` - `parts/chat-mark.mjs`
   (helpers in `assets/mark-helpers.js`); `chat-files` - `parts/chat-files.mjs` (helpers in
   `assets/files-helpers.js`). Tests that spell a re-taught anchor literally move with it
   ([internals.md](internals.md#tests)).
6. **Run the staging suite on the new fixture**, in the background (it takes minutes):
   `CCP_FIXTURES="$FX" node "$STAGE/tests/run.mjs"`. Green is exit 0 with `fail 0` and a non-zero
   `tests` count in the summary. The runner then lists the skipped tests by reason. On a fixture
   other than the reference version skips are expected where they compare with material only the
   maintainer has (the 2.1.280 reference, v1's build of it, other versions' fixtures beside yours,
   recorded chat rows): every reason that names `author-only material` or ends in
   `reference comparison skipped`. Any other skip reason is a gap to look at. For any change to a host
   anchor or to `assets/host-snippets.mjs`, `tests/host-harness.test.mjs` must also pass alone on
   that fixture with `skipped 0` before anything is written (command in
   [layout-recovery.md](layout-recovery.md#3c-the-extension-host-extensionjs)).
   Run the suite only in `STAGE` and only through `tests/run.mjs`: it refuses an engine under
   `~/.claude` or `~/.agents/skills` or the one the hook runs, and a test file started with
   `node --test` directly fails at import (`tests/lib/sandbox.mjs: not isolated - ...`).
7. **`--verify` from staging:** `node "$STAGE/claude_code_patch.mjs" --verify` - every enabled part
   `SAFE TO PATCH`. It reads the real installation and writes nothing.
8. **Save the diff for upstream** while the live folder still holds the old code (diff exits 1
   when there are differences; that is expected):
   `diff -ru "$SKILL" "$STAGE" | sed -e "s#$SKILL#a#g" -e "s#$STAGE#b#g" > "$BASE/fix-$VER.diff"`.
   The `sed` replaces the two folders with `a` and `b`, so the file names no personal path.
9. **Staging replaces the live folder whole:** `node "$STAGE/tools/mirror.mjs" "$STAGE" "$SKILL"`,
   exit 0 with the trees equal: the live folder is then byte for byte the tree the suite passed in.
   Anything else: mirror again, do not apply. A linked live folder (`~/.claude/skills/...`) stays a
   link.
10. **Apply** (the user's request to fix, or their yes, covers it): `node "$SKILL/claude_code_patch.mjs" --verify`
    (every part `SAFE TO PATCH`), then the same command without a flag, then tell the user:
    Developer: Reload Window.
11. **Report** what changed in the extension and what you changed in the skill, file by file.
12. **Offer to send the fix upstream.** The repair lives only in this installed copy: the next
    `npx skills update` replaces the folder with the published version, and if that version does
    not carry the fix yet, the next session start rebuilds (the skill's files changed) and the part
    is UNSAFE again; the hook says so. Show the user the issue text and the diff first (the diff
    holds short pieces of the extension's minified code around the anchors), then ask. On their
    yes, open an issue at
    https://github.com/warodan/vscode-claude-code-patch/issues with the extension version, the
    UNSAFE lines and `fix-<version>.diff`: with the GitHub CLI,
    `gh issue create --repo warodan/vscode-claude-code-patch --title "UNSAFE on <version>: <part>" --body-file <a file with the text and the diff>`;
    without it, give the user the text to paste. Nothing is sent without their yes.

Escalate to the user only when the new build rules the behaviour out (the command registry is
gone, there is no composer slot, the host no longer routes requests): explain what is still possible
instead. The fixture and the staging copy may stay under `%LOCALAPPDATA%`; the next repair mirrors
over the staging copy.
