# Remote-SSH (Linux server)

Read this when the user works in a VS Code Remote-SSH window, i.e. you run on a Linux server
(`uname -s` says `Linux`). Everything in SKILL.md holds there; this file adds what differs.

In a VS Code Remote-SSH window both bundles of the Claude Code extension load from the server's
copy, so a patch on the local machine does not reach that chat: the server needs its own copy of
this skill, its own build and its own hook. The Claude Code chat of that window, and the terminal
it opens, run on the server.

- **Installing there.** In a terminal of the Remote-SSH window (it runs on the server) the user
  runs the same `npx skills@latest add warodan/vscode-claude-code-patch -g` and restarts the
  agent; then [First install](../SKILL.md#first-install) runs there as anywhere else, nothing
  written before the user's yes at step 4. Node.js must be installed on the server. Updating and
  removing are the same `npx skills@latest update|remove -g vscode-claude-code-patch`, run on the
  server.
- **Where it looks.** On Linux the engine searches only `~/.vscode-server/extensions` and only
  folders whose name holds `-linux-` (`anthropic.claude-code-<version>-linux-x64`, every version
  folder there, like on Windows). Tried on linux-x64 only: a `-linux-arm64` folder is matched and
  built but untried; an Alpine server's `-alpine-x64` / `-alpine-arm64` folders are not matched at
  all, so there the engine says `no Claude Code installation`. State files and the hook live in
  `~/.claude/` on the server (`CCP_STATE_DIR` moves them), as `%USERPROFILE%\.claude\` on Windows.
  The anchors are the same: on 2.1.301 the linux-x64 bundles were byte for byte the win32-x64
  ones. `--verify` on the server is the check for any other version.
- **What the Linux build changes.** Only chat-media, and only on Linux: a card also appears under
  an absolute POSIX path alone in a fenced code block (`/srv/...`, `/data/...`, any `/a/b...`)
  and under a markdown link or image to `/abs/path` or `file:///abs/path`. A lone `/word` gets no
  card (that is how a slash command looks), nor does a first segment with a blank. Anything else
  of that shape gets one too, a URL path such as `/api/v1/users` or a link `[docs](/docs/page)`
  included: a card whose buttons find no file. Drive paths still get cards, but the server cannot
  open them.
- **Host buttons there.** Open - `vscode.open` in the remote window (images in VS Code's image
  viewer, other files in the editor; `.html` goes to the Integrated Browser as on Windows, not yet
  tried in a live Remote-SSH window: the browser may get a `vscode-remote:` address instead of
  `file://`). Show in folder and Open folder - the path is selected in VS Code's Explorer when it
  lies inside the window's workspace folders; outside them a notification offers Copy path or Open
  folder in new window, and nothing happens without a click (tested with stubs, not yet tried in a
  live Remote-SSH window). Default app and Photoshop are not offered: the host's capabilities name
  neither off Windows. Previews are read on the server, where the host runs; the 100 MB ceiling
  holds. chat-mark, chat-files, context-meter, chat-icons and chat-attention are the same text as
  on Windows.
- **The hook on the server.** `--install-hook` run there writes the SessionStart entry into the
  server's `~/.claude/settings.json` with the server's `node` and the server copy of the engine;
  every Claude Code session started on the server, the Remote-SSH chat included, re-applies the
  patch after an extension update. Run it with a Node.js installed on the server (for example
  `/usr/bin/node`), not one under `~/.vscode-server`: that path changes with VS Code updates, and
  the engine prints a warning when it records one.
- **Repairs and the rescue there.** A part UNSAFE on the server is repaired on the server, by the
  same [self-repair](self-repair.md) (its Linux lines). `--revert` for a window where no chat opens
  runs in a terminal of the Remote-SSH window.
