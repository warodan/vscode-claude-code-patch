# Moving from vscode-claude-chat-context-meter (v1)

v1 is the older skill `vscode-claude-chat-context-meter`: the context ring alone, patched by
`patch_claude_code_ui.mjs`. This skill grew out of it; its `context-meter` part draws the same
ring.

## Why both cannot run

Both patch the same `webview/index.js` and keep the pristine copy under the same name
(`webview/index.js.orig`), each from its own SessionStart hook with its own lock. At every
extension update both rebuild, and each erases the other's work. v1's custom buttons
(`CC-BTN:<id>` markers) are foreign to this skill, so while v1 keeps writing them this skill's
builds refuse the webview. That is why, while v1's SessionStart hook is in `settings.json`, every
build of this skill (`--dry-run` and the hook's `--ensure` included) and `--install-hook` refuse:
exit 1, nothing written, and the message names v1's exact commands. `--status`, `--verify`,
`--revert`, `--where`, `--uninstall-hook` and `--forget` still work.

## Finding v1

`node "<skill>/claude_code_patch.mjs" --status` prints a `v1 trace:` line per trace:

- `v1 trace: SessionStart hook of vscode-claude-chat-context-meter (patch_claude_code_ui.mjs) in <settings.json> - ...`:
  v1's hook, in any of its forms (`node ... patch_claude_code_ui.mjs --ensure`, or `run.ps1` /
  `run.sh` inside a `vscode-claude-chat-context-meter` folder).
- `v1 trace: skill folder <path>`: v1's folder under `~/.claude/skills` or `~/.agents/skills`.

The refusal message of a build names v1's script from the hook entry, or from those two folders.
A project install of v1 sits in `.claude/skills/` or `.agents/skills/` of that project; its hook
entry names the folder. Before step 2 below, `--status` also lists v1's custom buttons, if any, as
`CC-BTN:<id> (FOREIGN)` markers: note them if the user wants them back.

## The move, in this order

Show the user the four steps first and run v1's commands only after their yes. `<v1>` is v1's
folder.

1. **Remove v1's hook:** `node "<v1>/patch_claude_code_ui.mjs" --uninstall-hook`. When v1's hook
   runs through its runner scripts (installs where `node` was not on PATH), use the same flag
   through them: `powershell -NoProfile -ExecutionPolicy Bypass -File "<v1>\run.ps1" --uninstall-hook`
   or `sh "<v1>/run.sh" --uninstall-hook`.
2. **Undo v1's patch:** `node "<v1>/patch_claude_code_ui.mjs" --revert`. It restores
   `webview/index.js` from its `.orig` and deletes the `.orig`.
3. **Remove v1's folder:** `npx skills@latest remove -g vscode-claude-chat-context-meter` for a
   global install; for a project install the same without `-g`, run from that project.
4. **Install this skill:** `--status` (no `v1 trace:` line left), then `SKILL.md`, First install,
   from step 3. The ring comes with the base install.

v1's state files (`%USERPROFILE%\.claude\vscode-claude-chat-context-meter.*`,
`settings.json.ccm.bak`) may stay: this skill never reads them. Delete them if the user wants.

**v1's folder is already gone but its hook is not.** Then v1's own commands are unavailable, and the
refusal message shows the placeholder `"<v1 skill folder>\patch_claude_code_ui.mjs"`. With the
user's yes, copy `settings.json` to a backup, remove from `hooks.SessionStart` the one entry whose
command or arguments name `patch_claude_code_ui.mjs` or v1's `run.ps1` / `run.sh`, and check that
the file still parses. This skill's `--revert` then restores the webview: v1's ring markers
(`CC-BTN:context`, `CC-PIE`, `CC-RUN`) are ones this skill owns, and v1's custom-button markers are
thrown away and named.

## v1's buttons as buttons of this skill

v1's `--button ID:/text[:mode]` buttons can be recreated in the config
([composer-addons.md](composer-addons.md)), where, unlike in v1, they survive extension updates:

| v1 | this skill |
| --- | --- |
| `--button review:/review` (mode `run`, the default) | `{"id": "review", "label": "R", "tooltip": "Run /review", "action": {"type": "command", "command": "/review"}}` |
| `--button note:/text:insert` | `{"id": "note", ..., "action": {"type": "insert", "text": "text"}}` |
| the id shown as the button's text | an `icon` or a `label` of up to 3 characters, plus a required `tooltip` |
| `--side` (`slash`, `left`, `right`) | no equivalent: the buttons stand right after the ring, in list order |
| mode `usage` (a ring on another command) | no equivalent: the ring is `context-meter` and runs `/context` |
| v1's flags `--button`, `--side`, `--ext-dir` passed to this skill | usage errors: exit 1, nothing written |
