# Composer add-ons: the context ring and the user's own buttons

Both add-ons live in the chat composer, in the slot right after its `/` button: the ring first,
then the buttons in list order. Both are optional and independent: either can be enabled without
the other. Commands below write `<skill>` for the skill folder: the folder of the `engine:` line
that the lookup in `SKILL.md` (Finding the script) prints. Claude Code substitutes
`${CLAUDE_SKILL_DIR}` in `SKILL.md` only, not in this file.

## The ring (`context-meter`)

- **What it shows:** a ring and the tokens in this chat's context, in whole thousands (`184k`;
  from a million with one decimal, `1.2M`). The tooltip adds the share of the context window and
  the window size. Before the first completed turn of a chat the window is guessed from the model
  id (`[1m]` at its end: 1,000,000 tokens, else 200,000) and the tooltip marks it with `~`.
- **Colour:** green below 256k tokens and below 60 % of the window, the extension's clay orange
  above either. The thresholds are fixed.
- **Click:** runs `/context` (the local context panel). The button stays disabled until the CLI has
  listed `/context`, a second or two after a window opens.
- **Side effect:** the composer's stock context counter is switched off, and its click action
  (compacting) goes with it; `/compact` still works when typed.
- **Degrades instead of failing:** without the usage signal the button is a plain `context`
  button that runs `/context`; without a place to draw the ring it shows the count as text.
  `--status` lists `CC-PIE (context-meter)` only when the ring is drawn.
- **On / off:** `node "<skill>/claude_code_patch.mjs" --enable context-meter` (or `--disable`),
  then Developer: Reload Window. The tooltips follow `--language`.

## Buttons (`chat-icons`)

A button does one of three things:

| `action.type` | what a click does | while Claude works |
| --- | --- | --- |
| `command` | runs a slash command through the chat's command registry, as if picked from the `/` menu: `{"type": "command", "command": "/usage"}`. Anything that menu lists works: built-ins, the user's commands (`~/.claude/commands`, the project's `.claude/commands`), skills (`/skill-name`), plugin commands and skills (`/plugin:skill`). The exact name the menu shows, no arguments. A command the registry does not list shows the button grey with the tooltip `<command> is not loaded yet or not installed` | grey |
| `send` | sends the text as if typed and sent with Enter: `{"type": "send", "text": "..."}`, 1-2000 characters, line breaks allowed. A slash command with arguments goes here (`/review 42`) | grey |
| `insert` | appends one line to the end of the draft in the prompt box, with a space before it where needed, without sending: `{"type": "insert", "text": "..."}`, 1-500 characters, one line. A text starting with `@` opens the mention menu | usable |

The rest of a button:

- `id`: 1-24 characters from `a-z`, `0-9` and `-`, unique in the list. The patch marks the button
  in the bundle as `CC-ICON:<id>`.
- The face: exactly one of `icon` (a name below) or `label` (1-3 characters of text, drawn as a
  small pill).
- `tooltip`: required, 1-80 characters.
- At most five buttons: the composer is narrow and does not wrap. List order is screen order.
  There is no placement option.

Icons (Codicons, drawn 16 x 16 in the stock button size): `arrow-right` (arrow), `export` (arrow
out of a bar: hand off), `check` (tick), `pass` (tick in a circle: done), `sync` (two circling
arrows), `pulse` (heartbeat line), `graph` (bar chart), `comment` (speech bubble), `rocket`,
`debug` (bug), `trash`, `book`, `star`.

Anything pending in the composer (attached files) goes out with a send button's text and with a
command button's command. The draft text itself is left alone.

**Storage and commands.** The list lives in the config file's `buttons`
(`%USERPROFILE%\.claude\vscode-claude-code-patch.config.json`), so the hook rebuilds the buttons
after every extension update.

- `node "<skill>/claude_code_patch.mjs" --buttons "<file>"`: reads a JSON list (or an object
  `{"buttons": [...]}`), checks every field, stores the list, enables `chat-icons` and builds. It
  replaces the whole list. An error names the field and the allowed values and ends in
  `- nothing written`, for example `buttons[1].icon: unknown icon "gear" (icons: arrow-right, ...)`.
  An empty list is refused: `--buttons none` removes the buttons.
- `--buttons none`: removes the list, disables `chat-icons` and builds.
- `--status` prints `buttons: <ids>`. `chat-icons` enabled with no buttons inserts nothing:
  `--verify` says `chat-icons: nothing to insert (...)`, which is not an error.
- The part's own tooltips (`Unavailable: Claude is still working`, the not-listed tooltip) follow
  `--language`; the user's tooltips are shown as written.

Example file:

```json
[
  { "id": "usage", "icon": "graph", "tooltip": "Show usage", "action": { "type": "command", "command": "/usage" } },
  { "id": "wrap-up", "icon": "pass", "tooltip": "Wrap up and summarise", "action": { "type": "send", "text": "Done. Wrap up and summarise what changed." } },
  { "id": "steps", "label": "1-2", "tooltip": "Ask for steps", "action": { "type": "insert", "text": "Explain it step by step." } }
]
```

## Proposing buttons: one subagent, this brief

When the user wants buttons fitted to their setup, start one read-only subagent (an explore-type
agent is enough) and give it this brief verbatim. It keeps the user's transcripts and secrets out of
the search and returns a short table. No subagent tool: do the same reads yourself, under the same
Never-read list, and keep only the table.

```
Goal: propose 3-5 buttons for the Claude Code chat composer in VS Code, fitted to how this user
works. Read only: run nothing that changes a file, use no network.

Read ONLY the frontmatter (name, description, user-invocable, disable-model-invocation) of:
  ~/.claude/commands/**/*.md and ./.claude/commands/**/*.md     -> /name (in a subfolder dir: /dir:name)
  ~/.claude/skills/*/SKILL.md, ./.claude/skills/*/SKILL.md -> /skill-name (Claude Code loads skills
    only from these; an `npx skills` install in .agents/skills is linked into them)
  plugins: ~/.claude/plugins/installed_plugins.json (plugin names and installPath only), and which of
    them are enabled with this command, which prints only that key of settings.json:
      node -e "console.log(JSON.stringify(require(require('path').join(require('os').homedir(),'.claude','settings.json')).enabledPlugins||{}))"
    then <installPath>/skills/*/SKILL.md and <installPath>/commands/**/*.md -> /plugin:name
    (plugin = the part of the plugin key before '@')
  ~/.claude/CLAUDE.md and ./CLAUDE.md: headings only, to spot recurring workflows (handoff,
    review, commit, release, report).
Never read: ~/.claude/projects/** (session transcripts), ~/.claude/history.jsonl, ~/.claude.json,
  .env and .env.*, credentials and key files, settings files beyond the one key above, memory files.

Built-ins worth offering: /usage (a local usage panel), /compact, /review, /export, /rewind, /mcp,
  /memory. Skip /context (the context ring shows it) and /model (the composer has a picker);
  offer /clear only if asked (it wipes the conversation).
Prefer skills and commands the user clearly runs by hand (user-invocable, a verb in the name, a
  workflow in CLAUDE.md). Propose a "send" button only for a fixed phrase the user has named;
  otherwise list it as a question for the user ("which phrase do you send to finish a task?").

Output:
1. A table: id | icon or label | action (command /name, send "text" or insert "text") | tooltip |
   why (one line + the source file). Mark built-ins "greys out if this CLI does not list it".
2. The ready JSON list, at most 5 buttons:
   [{"id":"usage","icon":"graph","tooltip":"Show usage","action":{"type":"command","command":"/usage"}}]
   Rules: id 1-24 of a-z 0-9 -, unique; exactly one of "icon" (arrow-right, export, check, pass,
   sync, pulse, graph, comment, rocket, debug, trash, book, star) or "label" (1-3 characters);
   tooltip 1-80 characters; a "command" takes no arguments (a "send" text can); "insert" is one line.
```

## Presenting and applying

1. Show the user the table, not the JSON. Let them pick up to five, change icons, labels and
   tooltips, and add their own; answer the subagent's open questions with them.
2. Write the chosen list as JSON into a temporary file (for example `%TEMP%\ccp-buttons.json`),
   never into the skill folder.
3. `node "<skill>/claude_code_patch.mjs" --buttons "<that file>"`. An error names the field:
   fix it and run again (nothing was written). Then delete the temporary file.
4. Tell the user: Developer: Reload Window; the buttons stand right of the ring (right of the `/`
   button without it), and hovering shows each tooltip. Command buttons stay grey for a second or
   two after a reload. Ask them to confirm: you cannot see the window.

## Variations

- A built-in or custom command: `{"type": "command", "command": "/usage"}`.
- A skill: `{"type": "command", "command": "/skill-name"}`; a plugin skill: `"/plugin:skill"`.
- A fixed message: `{"type": "send", "text": "Done. Wrap up and summarise what changed."}`.
- A command with arguments: a send button, `{"type": "send", "text": "/review 42"}`; a
  `command` button takes the bare name only.
- A phrase to extend by hand before sending: `{"type": "insert", "text": "Check this against the spec: "}`.
  One line only.
- Change or remove one button: copy the current list from the config file's `buttons` into a
  temporary file, edit it, run `--buttons "<file>"` again (the new list replaces the old one).
  Remove all: `--buttons none`.
- Not possible as a button: two actions in one click, a keyboard shortcut, more than five buttons,
  a place other than the slot after the `/` button.
