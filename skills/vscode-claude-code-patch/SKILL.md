---
name: vscode-claude-code-patch
description: >-
  Patches the Claude Code chat in VS Code (Windows): image previews and open
  buttons under file paths in answers, clickable links to local files, an image
  viewer, marking image areas, a chat files panel, a context ring in the
  composer; add-on: the user's own composer buttons. A SessionStart hook
  re-applies it after extension updates. Use for: "can the Claude Code chat show image previews",
  "buttons under file paths", "file links in answers do not open", "mark areas
  on a screenshot for Claude", "install the chat patch", "add a context ring",
  "add a button to the composer", "add a button that runs /usage", "previews are
  gone after the extension update", "the patch says UNSAFE or LayoutError", "fix
  the Claude Code chat patch", "no Claude Code chat opens", "undo the patch".
  Russian: «превью картинок в чате», «кнопки под путями», «поставь патч чата»,
  «кольцо контекста», «добавь кнопку в чат», «кнопку для /usage», «превью
  пропали после обновления», «почини патч чата», «чат Claude Code не
  открывается», «откати патч».
---

# Claude Code chat patch (VS Code, Windows)

The Claude Code extension has no extension point for its chat UI, so this skill inserts code into
the installed extension's two bundles: `webview/index.js` (the chat window) and `extension.js`
(the extension host). Each patched file keeps its pristine copy beside it (`<file>.orig`), and a
SessionStart hook re-applies the patch after every extension update, which wipes it. Windows only.

| part | what the user sees | patches |
| --- | --- | --- |
| `chat-media` (base) | a card under an absolute path in an answer, by kind: image - preview, Open, Default app, Show in folder; `.psd`/`.psb` - Photoshop (only where Photoshop is installed), Show in folder; folder - Open folder; pdf, Office, archives and similar - Show in folder; any other file - Open, Show in folder. A click on the preview opens a viewer (wheel zooms at the cursor, drag pans, double-click fits, Esc or a click beside the image closes). Markdown links and images to drive paths open or show the same card | webview, extension.js |
| `chat-mark` (base) | two more buttons under an image preview and in the viewer: Insert path puts the image path at the cursor of the prompt box; Mark switches the viewer to drawing numbered rectangles (the middle button still pans, the wheel zooms), and Done closes it and puts the path, the image size and one numbered line per rectangle into the prompt box for the user to comment. Rectangles stay per path until Clear or a window reload. Needs `chat-media` | webview |
| `chat-files` (base) | a small folder button at the top right of the chat: a panel of this chat's files - images as thumbnails, then folders, then other files, newest first; a click acts like the path buttons. Needs `chat-media` | webview |
| `context-meter` (base) | a ring and the token count (`184k`) right after the composer's `/` button; a click runs `/context`. The stock counter is switched off | webview |
| `chat-icons` (add-on) | up to five buttons of the user's own, right of the ring: each runs a slash command, sends a fixed message, or inserts a line into the prompt box | webview |

Asked how much context is left in the chat the user is looking at: with the ring installed it
shows the count, and its tooltip the share of the window; you cannot see the window, and
`/context` prints the same in the chat. Without the ring (taken out with `--disable context-meter`,
or UNSAFE after an extension update), offer it back: `--enable context-meter`, or the repair.

Rules that hold for every command:

- Every write rebuilds the patched files from the pristine copy; nothing is ever patched on top of a patched file.
- UNSAFE means nothing was written for that part. Never hand-edit either bundle.
- --revert restores every patched file byte for byte and keeps it that way: the SessionStart hook re-applies nothing until you apply again.
- extension.js is patched only by the chat-media part; the ring and the composer buttons never touch it.
- chat-mark and chat-files never touch extension.js; each can be disabled without losing the image cards.
- If extension.js does not parse, no Claude Code chat opens in that window: the engine writes it only when the trial build parses, and replaces it only by renaming a complete, verified copy over it.
- Every change becomes visible only after Developer: Reload Window.
- Insert path inserts the plain image path into the prompt box, never an @-mention: the image is not loaded into context.
- Rectangle regions are written as [x1,y1,x2,y2] in pixels of the original file, origin top-left.
- The files panel lists only what the main agent showed in this chat; files touched only by subagents are not in it.
- Images over 100 MB get no preview; their buttons still work.

How each part works, its anchors and the engine's guards:
[references/internals.md](references/internals.md).

## Finding the script

Every command here is `node "${CLAUDE_SKILL_DIR}/claude_code_patch.mjs" <flag>`.
`${CLAUDE_SKILL_DIR}` is not an environment variable: Claude Code writes the skill's real folder
into this file as it loads it. This line finds the script either way and prints where everything is:

```bash
for p in "${CLAUDE_SKILL_DIR}" ~/.claude/skills/vscode-claude-code-patch ~/.agents/skills/vscode-claude-code-patch \
         ./.claude/skills/vscode-claude-code-patch ./.agents/skills/vscode-claude-code-patch; do
  [ -n "$p" ] && [ -f "$p/claude_code_patch.mjs" ] && { node "$p/claude_code_patch.mjs" --where; break; }
done
```

Its `engine:` line is the script's absolute path. Where `${CLAUDE_SKILL_DIR}` came through empty,
use that path in the commands below; give it to the user whenever they run a command themselves.
No output at all: the skill is in none of these folders, ask the user where it is. The
`node "<path>" --flag` form works in Git Bash and PowerShell alike.

## First install

Run these steps in order when the user asks to install or set up the patch, or asks for one of
its features while `--status` shows no `CC-` markers. Steps 1-3 only read; nothing is written
before the user's yes at step 4. A question ("can the chat show image previews?") gets a short
answer and that offer, not an install.

1. **Preconditions.** Windows; VS Code with the Claude Code extension (only
   `%USERPROFILE%\.vscode\extensions` is searched); `node` on PATH, version 16.9 or newer (none:
   `winget install OpenJS.NodeJS.LTS`, then restart VS Code); the Bash tool (Git Bash) for the
   script lookup and a self-repair, whose test suite needs Node 20.10. The skill should be installed
   globally: if its folder lies inside a project rather than under `~/.claude/skills` or
   `~/.agents/skills`, the hook would point into that project and break when the project moves.
   Say so, recommend `npx skills@latest add warodan/vscode-claude-code-patch -g`, and stop until
   the user has reinstalled globally or says to go on.
2. **Status:** `node "${CLAUDE_SKILL_DIR}/claude_code_patch.mjs" --status`. Any `v1 trace:` line
   means the older skill vscode-claude-chat-context-meter is still there: follow
   [references/migrate-from-v1.md](references/migrate-from-v1.md), and run v1's commands only
   after the user says yes. `hook: installed, points at another copy <path>`: another copy of this
   skill runs the hook; ask which copy stays before going on.
3. **Check:** `--verify`. It writes nothing; every enabled part must say `SAFE TO PATCH`. Anything
   else: [Reading the output](#reading-the-output), then [When something breaks](#when-something-breaks).
4. **Ask before writing.** Tell the user in two or three lines what changes, then wait for a yes:
   the build edits two files of the installed Claude Code extension (`webview/index.js`,
   `extension.js`), keeps the pristine copy of each beside it (`<file>.orig`), and `--revert` puts
   both back byte for byte; a SessionStart hook entry in `~/.claude/settings.json` (copied first to
   `settings.json.ccp.bak`) re-applies the patch after extension updates, and `--uninstall-hook`
   removes it. In the composer the context ring takes the place of the stock context counter,
   whose click compacted the chat. The labels are English: if the user asked for Russian ones or
   writes to you in Russian, say in the same message that they will be Russian. One yes covers
   the build, the hook and the language. Yes without the hook: skip step 6. No: stop, nothing was
   written.
5. **Build:** the same command without a flag, or with `--language ru` for Russian labels (a build
   that also stores the language; `--language en` switches back later). With no config file it
   builds the four base parts. Done: exit 0 and a `[+] <part> applied` line for each part.
6. **Hook:** `--install-hook`. Done: `[+] SessionStart hook added in <path>`; tell the user in one
   line that it is in place.
7. **Paths in answers.** Cards appear only under paths written a certain way, and by default the
   VS Code extension tells the agent to write workspace-relative markdown links, which get no card.
   A card appears only under an absolute Windows path alone in a fenced code block, or under a markdown image or link whose target is an absolute drive path; a workspace-relative link gets no card.
   Read `~/.claude/CLAUDE.md` and the current project's `CLAUDE.md` for a rule about how paths are
   written. If there is none, explain this in two lines and offer to add the rule below to
   `~/.claude/CLAUDE.md` (all projects; recommended) or to the project's `CLAUDE.md` (this project
   only). Write the rule into a CLAUDE.md only after the user says yes; append it, never rewrite the file.
   Then show what was added. If the user already has a convention of their own, adapt to it
   instead (for example, they prefer markdown images) and say which of their forms shows a card.

   ```markdown
   ## Local file paths in answers
   When you point me to a local file or folder I may want to open (images, generated files,
   output folders), write its absolute Windows path alone in a fenced code block, one path
   per block. The chat shows a preview and open buttons under it. Code references inside the
   workspace can stay markdown links.
   ```

8. **Reload and confirm.** Tell the user: Ctrl+Shift+P -> Developer: Reload Window. To check: ask
   you to show an image path - a preview card with buttons appears under it; the folder button at
   the top right of the chat opens the files panel; the ring with the token count stands right
   after the composer's `/` button. You cannot see the window: ask them to confirm.
9. **Offer composer buttons** in two or three lines: up to five buttons right of the ring, each
   doing in one click what the user now types. Give one example: `/usage` shows the plan limits in
   one click, or a command or skill of their own they run by hand. Offer a short look at their
   commands and skills that proposes a set (read only, by a subagent, a minute or two). On a yes:
   [references/composer-addons.md](references/composer-addons.md).

## Everyday commands

`node "${CLAUDE_SKILL_DIR}/claude_code_patch.mjs" <flag>`; `--help` prints:

```
Patch the Claude Code chat in VS Code (Windows). Base parts: context-meter (the context
ring), chat-media (previews and buttons under image paths, the image viewer, clickable file links),
chat-mark (Insert path and rectangle marks on images), chat-files (the chat files panel). Add-on:
chat-icons (your own composer buttons, from --buttons).

  (no flag)              build every enabled part from the pristine copy and write what changed
  --verify               per installation, target and part: SAFE TO PATCH or UNSAFE; writes nothing
  --enable <id>          enable a part and build          (parts: context-meter, chat-media, chat-icons, chat-mark, chat-files)
  --disable <id>         disable a part and build without it
  --language <en|ru>     language of the labels, tooltips and texts the patch adds; builds
  --buttons <file>       composer buttons from a JSON file (a list); enables chat-icons and builds
  --buttons none         remove the buttons, disable chat-icons and build
  --reapply              same as no flag
  --revert               restore every patched file from .orig byte for byte and pause;
                         the SessionStart hook re-applies nothing until an explicit build
  --ensure               self-heal for the SessionStart hook: builds when something changed and
                         says so as one JSON line {"systemMessage": ...}; always exits 0
  --status               config, markers found and whose, .orig, parts loaded, hook, traces of v1
  --where                installations and targets found, state folder
  --install-hook         add the SessionStart hook (refused while v1's hook is present)
  --uninstall-hook       remove it again
  --forget               delete the fingerprint cache (vscode-claude-code-patch.local.json)
  --dry-run              with a build: every check, no write at all
  -h, --help             this text

A button: {"id": "a-z0-9-", "icon": "<name>" or "label": "<= 3 chars", "tooltip": "<= 80 chars", "action":
  {"type": "command", "command": "/name"} | {"type": "send", "text": "..."} | {"type": "insert", "text": "one line"}};
  at most 5. A wrong field is named with the allowed values (icon names included).
No config file = the base parts in English. Config: %USERPROFILE%\.claude\vscode-claude-code-patch.config.json
Installations are looked up only in %USERPROFILE%\.vscode\extensions.
State: %USERPROFILE%\.claude\vscode-claude-code-patch.* (CCP_STATE_DIR moves it, settings.json too).
Every change becomes visible after Developer: Reload Window.
```

- One command per run; --dry-run goes only with a build (no flag, `--enable`, `--disable`, `--language`, `--buttons`, `--reapply`). With anything else it is a usage error.
- An unknown flag (v1's `--button`, `--side`, `--ext-dir` included) is a usage error: exit 1, nothing written.
- Exit 0: everything enabled is built or already in place. Exit 1: an UNSAFE part, a refusal, a `Fatal`, an unreadable ledger or config, an installation or target that could not be read or written, a held lock, no installation found, v1's hook present, not Windows, or a usage error. `--status` exits 0 whatever it finds.
- An explicit build clears `paused` (set by `--revert`) and writes the config; every write keeps `language` and `buttons`.
- --ensure never fails a session start: it prints one JSON line {"systemMessage": ...} when it has something to say, nothing otherwise, and always exits 0. It rebuilds when the extension changed, when the config changed, or when the skill's own files changed (an update or a repair).
- `--install-hook` records the absolute paths of the running `node.exe` and of the `claude_code_patch.mjs` it was run from: run it from the installed skill folder, never from a copy.
- Every installation under `%USERPROFILE%\.vscode\extensions` (`anthropic.claude-code-<version>-*`) is built, old version folders VS Code has not deleted yet included.

State lives in `%USERPROFILE%\.claude\`: `vscode-claude-code-patch.config.json` (enabled parts,
`paused`, `language`, `buttons`), `.ledger.json` (the sha1 of each pristine bundle per extension
version: a pristine copy that disagrees is refused), `.local.json` (the fingerprint cache
`--ensure` skips unchanged installations by), `.lock` (every writing command holds it; a second
run waits up to 30 s), and the hook entry in `settings.json`. Details:
[references/internals.md](references/internals.md).

## Reading the output

The next action for each kind of line; the full catalogue with `--status` notes is in
[references/internals.md](references/internals.md#reading-the-output-in-full).

- `<part>: SAFE TO PATCH` - the trial build of that part passed every check. `chat-icons: nothing to insert (no buttons configured; ...)` under it is not an error: the add-on is on without buttons.
- `UNSAFE: <part>/<target>: <ErrorName>: <message>` - that part is left out on every target; the others are built. `LayoutError` (an anchor or a derivation did not match the new extension build) or any other error name (`TypeError`: the part's code met a build it does not understand): [When something breaks](#when-something-breaks). `UNSAFE: chat-icons/webview: buttons[<i>].<field>: ...`: the button list in the config is wrong; fix it with `--buttons <file>`.
- `REFUSED <target>: <reason>`, followed by `UNSAFE: <part>/<target>: target refused: ...` - the file itself is refused. `foreign CC markers <list>`: another tool wrote `/*CC-...*/` markers (v1's custom buttons `CC-BTN:<id>` among them); with the `.orig` present, `--revert` throws them away and names them, then build. Without an `.orig`, or when the pristine copy carries markers or disagrees with the ledger: stop and tell the user; reinstalling the extension gives a clean copy.
- `Fatal: <target> does not parse after the build - nothing written to any target` - nothing was written anywhere. To find the part, run `--disable <id> --dry-run` once per enabled part: those runs write nothing, and the one whose `Fatal` goes away names the part. Then [When something breaks](#when-something-breaks) for that part.
- `layout: not found: <reason>` - the composer panel was not recognised: the ring and the buttons are UNSAFE with the same reason; chat-media, chat-mark and chat-files do not depend on it.
- `ledger <path> is unreadable (...)` - builds and `--verify` stop, nothing written. Run the command once more (a sync client can hold the file for a moment); if it stays, tell the user and do not delete the ledger yourself: it holds the sha1 guard of every version. `--revert` still works.
- `config <path>: ...` or `config <path> is unreadable` - builds refuse (`fix or delete it (--revert rewrites it with the defaults)`), the hook does nothing. Show the user the line; `--revert` rewrites the config with the base parts and keeps a button list that still parses.
- `[!] <installation folder>: <reason>` - a file of that installation could not be read or written (held by another process, or an old version folder VS Code is deleting). Only that installation is skipped. Run the command again later.
- `the lock is held by another run since <time>` - another run holds the lock (often the hook at a session start). Wait a little and run again.
- `The v1 skill vscode-claude-chat-context-meter still patches this chat ...` - [references/migrate-from-v1.md](references/migrate-from-v1.md).
- `Windows only for now: ...` - this platform is not supported; say so.
- `vscode-claude-code-patch needs Node.js 16.9 or newer; this is <version> (<node.exe>)` - nothing was run; the user updates Node (`winget install OpenJS.NodeJS.LTS`), restarts VS Code, and you run `--install-hook` again (the hook records the path of `node.exe`).
- A build ends with `Reload VS Code to see the change`. What was written are the `[w] <target> written: <parts>` and `[-] <target> restored` lines above it; with only `[=]` lines a reload changes nothing.

**A message from the hook** starts with `Claude Code chat patch (vscode-claude-code-patch):` and
reaches you or the user as a system message at a session start:

- `rebuilt for <versions>; reload the VS Code window to see it ...` - tell the user to reload.
- `Not applied (UNSAFE): <parts>; ask Claude to fix the Claude Code chat patch.` - self-repair (next section). The user may be busy with something else: tell them in one line and offer it, then start on a yes or when they ask.
- `A problem at session start; ask Claude to check the Claude Code chat patch. Details: ...` - the details are lines from the list above (ledger, lock, config, v1, `[!]`); act on them.

## When something breaks

**UNSAFE after an extension update:** the new extension build moved code an anchor points at; the
parts that passed keep working meanwhile. When the user asked you to fix or restore the patch,
start at once: say in one line that you are working it out, and report back with a result. When
they only asked to check ("is the patch still safe on this version?"), run `--verify`, report what
it printed and offer the repair; after the hook's message, offer it too (see above). Start on a
yes. On an extension older than 2.1.280, the oldest build this skill was tested on, suggest
updating the extension before any repair. The repair itself:
[references/self-repair.md](references/self-repair.md); finding a moved anchor (its steps 3-5):
[references/layout-recovery.md](references/layout-recovery.md); the live folder it repairs is
`${CLAUDE_SKILL_DIR}`. A changed host anchor is applied only after the host harness passes. A self-repair lands in the installed copy, and the next npx skills update replaces it: offer to send the fix upstream.

**No Claude Code chat opens.** A broken `extension.js` takes every chat of the window with it, and
then Claude is not there to fix it. This command loads no part and no `lib/layout.mjs`, so it works
with a broken skill file, and an unreadable ledger does not stop it. The user can run it in any
terminal (give them the `engine:` path from Finding the script), then Developer: Reload Window:

```
node "${CLAUDE_SKILL_DIR}/claude_code_patch.mjs" --revert
```

If that fails too: Extensions -> Claude Code -> Uninstall -> Install (settings and sessions survive).

**Two patchers.** Two patchers rebuilding the same files erase each other's work: while the SessionStart hook of vscode-claude-chat-context-meter (v1) is present, every build and --install-hook refuse.
Patches of other tools are not supported either (Known limits).

## Uninstall

1. `node "${CLAUDE_SKILL_DIR}/claude_code_patch.mjs" --revert` (every patched file back to the
   original, `.orig` removed), then `--uninstall-hook`, then Developer: Reload Window.
2. `npx skills@latest remove -g vscode-claude-code-patch` (a project install: the same without
   `-g`, from the project folder).
3. The state files `%USERPROFILE%\.claude\vscode-claude-code-patch.*`,
   `settings.json.ccp.bak` and, after a self-repair, `%LOCALAPPDATA%\vscode-claude-code-patch` stay;
   delete them if the user wants. Offer to remove the paths rule from
   CLAUDE.md if you added it.

## Known limits

- Windows only. Only `%USERPROFILE%\.vscode\extensions` is searched: VS Code Insiders, Cursor and other editors are not patched.
- A workspace-relative markdown link gets no card (see First install, step 7).
- The hook stores the absolute path of `node.exe`: after Node is reinstalled into another folder, run `--install-hook` again. `--status` says `runs <node.exe> (missing file)` then, and `points at ... (missing file)` when the skill folder moved.
- `CLAUDE_CONFIG_DIR` is not read: where Claude Code's config lives elsewhere, set the user environment variable `CCP_STATE_DIR` to that folder (the state files and `settings.json` follow it), then restart VS Code.
- In markdown link and image targets a `\` before punctuation is an escape: `C:\a\.cache\b.png` arrives as `C:\a.cache\b.png`, and a path with spaces works only as `[x](<C:\a b\c.png>)`. A `%` in a file name breaks there too: a valid escape (`%41`) decodes into another name (the card says file not found), anything else (`50%off.png`) gives a dead link. Paths in fenced code blocks are not affected: prefer them.
- Cards wait for the extension host to name its capabilities. At a slow window start that can time out; while cards are on screen it is asked again after 5 s, 15 s and 60 s. After the third failure the cards stay without buttons until a new card, a link click or Developer: Reload Window.
- The capabilities are asked once per window, so a Photoshop installed later appears after a reload. Photoshop is found through `CC_PHOTOSHOP_EXE`, the `App Paths` registry key (HKLM) or `Program Files\Adobe\Adobe Photoshop*`; one installed elsewhere needs `CC_PHOTOSHOP_EXE`, and VS Code sees a new variable only after a full restart.
- Default app opens the file with the Windows default for its type and follows a changed default. Default app and Open folder hand the path to `explorer.exe` as one quoted argument; Explorer treats commas specially, so a planted file whose name holds commas might open another item (not verified).
- Any image path the model mentions is previewed without a click (read only, image extensions, up to 100 MB); nothing is launched without a click. A path naming an NTFS stream (`C:\a.txt:s.png`) gets a card but no preview and no action.
- Past 100 MB there is no preview: the host posts the image to the webview as one base64 string (why: [internals](references/internals.md#preview-ceiling)).
- A markdown file opened from the chat goes through `vscode.open`, so it opens in the editor `workbench.editorAssociations` names for `*.md`, and a line or heading in the link (`#L10`) is not jumped to.
- Anything pending in the composer (attachments) is sent together with a send button's text and with a command button's command.
- Insert path and Done hand the text to the window; while a permission request is on screen the window drops it silently. Rectangles are kept: press Done again once the request is gone. Inserted lines break the way Shift+Enter breaks them, so a line may start with a space.
- The files panel sees only what the chat window keeps in memory: about the last 500 records. In a long chat the earliest paths are not in it. The window merges consecutive Reads into one record that no longer says who made them, so an image a subagent read can show, and a main-agent group next to a subagent's records can be missing.
- A JPEG rotated by its EXIF tag is shown rotated; rectangle numbers are in the rotated picture, while an agent may read the file unrotated.
- Command buttons stay grey until the CLI has listed its commands (a second or two after a window opens) and stay grey for a command it does not list. A command button takes no arguments: use a send button.
- The ring's colours are fixed: green below 256k tokens and below 60 % of the window, clay orange above either.
- Host error texts (`unsupported path`, `Photoshop.exe not found`) stay English in both languages.
- Patches of other tools without `CC-` markers: while our `.orig` exists, the next build drops them; one that lands before our first build becomes part of the `.orig` and stays until the extension is reinstalled. Coexistence is not supported.
