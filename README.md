<p>
  <img src="banner.png" alt="pi-powerline-footer" width="1100">
</p>

# pi-powerline-footer

Customizes the default [pi](https://github.com/badlogic/pi-mono) editor with a powerline-style status bar, welcome overlay, and AI-generated "vibes" for loading messages. Inspired by [Powerlevel10k](https://github.com/romkatv/powerlevel10k) and [oh-my-pi](https://github.com/can1357/oh-my-pi).

<img width="1261" height="817" alt="Image" src="https://github.com/user-attachments/assets/4cc43320-3fb8-4503-b857-69dffa7028f2" />

## Features

**Editor stash** — Press `Alt+S` to save your editor content and clear the editor, type a quick prompt, and your stashed text auto-restores when the agent finishes. Toggles between stash, pop, and update-existing-stash. A `stash` indicator appears in the powerline bar while text is stashed.

**Working Vibes** — AI-generated themed loading messages. Set `/vibe star trek` and your "Working..." becomes "Running diagnostics..." or "Engaging warp drive...". Supports any theme: pirate, zen, noir, cowboy, etc.

**Welcome overlay** — Branded splash screen shown as centered overlay on startup. Shows gradient logo, model info, keyboard tips, loaded AGENTS.md/extensions/skills/templates counts, and recent sessions. Auto-dismisses after 30 seconds or on any key press.

**Rounded box design** — Status renders directly in the editor's top border, not as a separate footer.

**Fixed editor cluster** — In interactive TUI sessions, chat/feed content scrolls above the fixed Pi working/status line, powerline rows, editor, ghost suggestions, bash transcript, and last-prompt/status rows. Scroll chat with the mouse wheel, PageUp/PageDown, Command+PageUp/PageDown, Ctrl+Shift+Up/Down, or message-jump shortcuts; the editor stays put. Drag text to copy it, drag selection to the viewport edge to scroll, double-click a line to select it, and right-click to open the terminal menu. Use `/powerline fixed-editor off` for Pi’s regular scrolling layout, or `/powerline mouse-scroll off` for native terminal selection.

**Live thinking level indicator** — Shows current thinking level (`think:off`, `think:med`, etc.) with per-level colors. High and xhigh levels use a rainbow effect inspired by Claude Code's ultrathink.

**Smart defaults** — Nerd Font auto-detection for iTerm, WezTerm, Kitty, Ghostty, and Alacritty with ASCII fallbacks. Colors matched to oh-my-pi's dark theme.

**Git integration** — Async status fetching with 1s cache TTL. Automatically invalidates on file writes/edits. Shows branch, staged (+), unstaged (*), and untracked (?) counts.

**Context awareness** — Color-coded warnings at 70% (yellow) and 90% (red) context usage. During streaming, the context segment refreshes from live assistant usage instead of waiting for the next turn. Auto-compact indicator when enabled. If `pi-custom-compaction` is installed and enabled, the powerline automatically hides native context segments so the footer does not show stale post-summary usage.

**Token intelligence** — Smart formatting (1.2k, 45M), subscription detection (shows "(sub)" vs dollar cost).

**Sticky bash mode** — Toggle bash mode with `ctrl+shift+b` or `/bash-mode`. It keeps a managed shell session alive for the current pi session, shows a dedicated `shell_mode` segment, streams command output into an embedded transcript below the editor, and lets `cd` or exported state persist across commands.

**Shell ghost suggestions** — Bash mode is now ghost-first. Successful per-project shell history is the primary source, while deterministic path and git continuations can still extend an existing command. Shell-native completion probes are disabled so `!command` predictions never spawn interactive shell completion subprocesses. At command position, short stems first resolve from the newest successful local command, can use guarded global shell history for high-confidence heads like `git`, and finally fall back to a tiny curated default set when history is absent. Right now that curated set is `g` → `git status` and `c` → `cd ..`. If the bash prompt is empty, bash mode shows the newest successful project-history ghost suggestion when one exists, otherwise it stays empty. The same inline predictions now also kick in for one-off `!command` and `!!command` prompts. Right Arrow or Tab accepts ghost text into the editor, and Enter runs the current shell command.

## Installation

```bash
pi install npm:pi-powerline-footer
```

Restart pi to activate.

## Usage

Activates automatically. Toggle with `/powerline`, switch presets with `/powerline <name>`, fixed-editor mode with `/powerline fixed-editor on|off|toggle`, and wheel mode with `/powerline mouse-scroll on|off|toggle`.

Fixed editor is on by default.

- `/powerline fixed-editor off` — return to Pi’s regular scrolling layout
- `/powerline fixed-editor on` — re-enable the fixed editor
- `/powerline fixed-editor toggle` — switch between the two

You can also set it in `~/.pi/agent/settings.json` or project-local `.pi/settings.json`:

```json
{
  "powerline": {
    "preset": "default",
    "fixedEditor": false
  }
}
```

Use `"fixedEditor": true` to enable it again. Add `"mouseScroll": false` if you want native terminal selection instead of fixed-editor mouse handling.

| Preset | Description |
|--------|-------------|
| `default` | Model, thinking, path (basename), git, context, tokens, cost |
| `minimal` | Just path (basename), git, context |
| `compact` | Model, git, cost, context |
| `full` | Everything including hostname, time, abbreviated path |
| `nerd` | Maximum detail for Nerd Font users |
| `ascii` | Safe for any terminal |

**Environment:** `POWERLINE_NERD_FONTS=1` to force Nerd Fonts, `=0` for ASCII.

Preset selection is saved to `~/.pi/agent/settings.json` under `powerline` and restored on startup.
Run `/powerline default` to switch back to the default preset.

### Custom items from extension statuses

You can promote any extension status key into its own dedicated powerline item. This gives you a general way to register your own status items without changing this extension.

1. Any extension can publish status text through `ctx.ui.setStatus("my-key", "...value...")`.
2. Configure `powerline.customItems` to place those keys on the left, right, or secondary row.

```json
{
  "powerline": {
    "preset": "default",
    "customItems": [
      {
        "id": "ci",
        "statusKey": "ci-status",
        "position": "right",
        "prefix": "CI",
        "color": "warning"
      },
      {
        "id": "review",
        "position": "secondary",
        "hideWhenMissing": false,
        "prefix": "review"
      }
    ]
  }
}
```

`customItems` fields:

- `id` (required): unique item id (`a-z`, `A-Z`, `0-9`, `_`, `-`)
- `statusKey` (optional): extension status key to read, defaults to `id`
- `position` (optional): `left`, `right`, or `secondary` (default `right`)
- `prefix` (optional): text shown before the live status value
- `color` (optional): any Pi theme color (`warning`, `accent`, etc.) or hex (`#RRGGBB`)
- `hideWhenMissing` (optional): hide item when no status is present (default `true`)
- `excludeFromExtensionStatuses` (optional): omit this key from the aggregate `extension_statuses` segment (default `true`)

If you still prefer the old style, `"powerline": "default"` continues to work.

## Bash mode

Toggle bash mode with either:

- `ctrl+shift+b`
- `/bash-mode on`
- `/bash-mode off`
- `/bash-mode toggle`

Reset the managed shell with `/bash-reset`.

While bash mode is active:

- Enter runs the current shell command
- Right Arrow accepts ghost text into the editor without running it
- Tab accepts the current ghost suggestion when one exists; otherwise it does nothing
- Up and Down browse matching shell history
- `escape` exits bash mode and returns to normal prompt mode
- `ctrl+c` interrupts the active shell job before falling back to normal pi behavior

The managed shell is persistent for the current pi session. Command output appears in a transcript below the editor, and shell cwd changes are reflected in the footer path and `shell_mode` segment. If the bash prompt is empty, bash mode shows the newest successful project-history ghost suggestion immediately when one exists, including right after mode entry or after the prompt is cleared again. One-off `!command` and `!!command` prompts reuse the same shell prediction pipeline, including ghost text. Mode entry stays quiet: there is no automatic or manual dropdown completion surface, and ghost suggestions do not run shell-native completion probes.

### Bash mode configuration

In `~/.pi/agent/settings.json`:

```json
{
  "bashMode": {
    "toggleShortcut": "ctrl+shift+b",
    "transcriptMaxLines": 2000,
    "transcriptMaxBytes": 524288
  }
}
```

## Editor Stash

Use `Alt+S` / `Option+S` as a quick stash toggle while drafting. It keeps one active stash and clears the editor when stashing.

| Editor | Stash | `Alt+S` result |
|--------|-------|----------------|
| Has text | Empty | Stash current text, clear editor |
| Empty | Has stash | Restore stash into editor |
| Has text | Has stash | Update stash with current text, clear editor |
| Empty | Empty | Show "Nothing to stash" |

Auto-restore after an agent run only happens when the editor is still empty. If you typed meanwhile, the stash is preserved.

The `stash` indicator appears in the powerline bar (on presets with `extension_statuses`). Active stash is still session-local and resets on session switch / disable, but stash history is persisted to `~/.pi/agent/powerline-footer/stash-history.json` so it survives restarts.

### Stash history

Open prompt history with either:

- `ctrl+alt+h`
- `/stash-history`

Prompt history now has two sources:

- stashed prompts — up to 12 recent stashed prompts (newest first)
- recent project prompts — up to 50 recent user-submitted prompts pulled from pi sessions in the current project folder

Selecting an entry inserts it into the editor. If the editor already has text, you can choose `Replace`, `Append`, or `Cancel`.

### Editor clipboard and chat shortcuts

- `ctrl+alt+c` — copy full editor content
- `ctrl+alt+x` — cut full editor content (copy, then clear)
- `cmd+up` — scroll the fixed-editor chat viewport up
- `cmd+down` — scroll the fixed-editor chat viewport down
- `cmd+shift+up` — move the editor cursor to the start of the first line
- `cmd+shift+down` — move the editor cursor to the end of the last line
- `ctrl+shift+u` — jump the fixed-editor chat viewport to the previous user message
- `ctrl+shift+i` — jump the fixed-editor chat viewport to the next user message
- `ctrl+alt+,` — jump the fixed-editor chat viewport to the previous LLM message
- `ctrl+alt+.` — jump the fixed-editor chat viewport to the next LLM message
- `ctrl+shift+g` — jump the fixed-editor chat viewport to the bottom
Copy/cut actions do not modify stash state or stash history. Dragging files, folders, images, or screenshots from Finder into the custom editor inserts their path strings. Chat jumps require fixed-editor mode because they use its app-owned scroll viewport. Submitting editor text also returns that viewport to the bottom so new output stays in view.

### Shortcut configuration

You can override shortcut keys in `~/.pi/agent/settings.json`:

```json
{
  "powerlineShortcuts": {
    "stashHistory": "ctrl+alt+h",
    "copyEditor": "ctrl+alt+c",
    "cutEditor": "ctrl+alt+x",
    "jumpPreviousUserMessage": "ctrl+shift+u",
    "jumpNextUserMessage": "ctrl+shift+i",
    "jumpPreviousLlmMessage": "ctrl+alt+,",
    "jumpNextLlmMessage": "ctrl+alt+.",
    "jumpChatBottom": "ctrl+shift+g",
    "scrollChatUp": "cmd+up",
    "scrollChatDown": "cmd+down",
    "editorStart": "cmd+shift+up",
    "editorEnd": "cmd+shift+down"
  }
}
```

After changing bindings, run `/reload`. Invalid bindings, reserved key conflicts (like `Alt+S`), or duplicate conflicts automatically fall back to safe defaults. `cmd` and `command` are accepted aliases for Pi's `super` modifier for the documented Command navigation keys; unsupported Command-letter bindings such as `cmd+c` are ignored instead of matching plain text input. Some terminals, including Ghostty, bind Command+Arrow themselves; remap those terminal keys to send `\x1b[1;9A` / `\x1b[1;9B` for chat scrolling and `\x1b[1;10A` / `\x1b[1;10B` for editor-boundary navigation if you want Pi to receive them.

## Working Vibes

Transform boring "Working..." messages into themed phrases that match your style:

```
/vibe star trek    → "Running diagnostics...", "Engaging warp drive..."
/vibe pirate       → "Hoisting the sails...", "Charting course..."
/vibe zen          → "Breathing deeply...", "Finding balance..."
/vibe noir         → "Following the trail...", "Checking the angles..."
/vibe              → Shows current theme, mode, and model
/vibe off          → Disables (back to "Working...")
/vibe model        → Shows current model
/vibe model openai/gpt-4o-mini → Use a different model
/vibe mode         → Shows current mode (generate or file)
/vibe mode file    → Switch to file-based mode (instant, no API calls)
/vibe mode generate → Switch to on-demand generation (contextual)
/vibe generate mafia 200 → Pre-generate 200 vibes and save to file
```

### Configuration

In `~/.pi/agent/settings.json`:

```json
{
  "workingVibe": "star trek",                              // Theme phrase
  "workingVibeMode": "generate",                           // "generate" (on-demand) or "file" (pre-generated)
  "workingVibeModel": "openai-codex/gpt-5.4-mini",         // Optional: model to use (default)
  "workingVibeFallback": "Working",                        // Optional: fallback message
  "workingVibeRefreshInterval": 30,                        // Optional: seconds between refreshes (default 30)
  "workingVibePrompt": "Generate a {theme} loading message for: {task}",  // Optional: custom prompt template
  "workingVibeMaxLength": 65                         // Optional: max message length (default 65)
}
```

### Modes

| Mode | Description | Pros | Cons |
|------|-------------|------|------|
| `generate` | On-demand AI generation (default) | Contextual, hints at actual task | Model-dependent cost and latency |
| `file` | Pull from pre-generated file | Instant, zero cost, works offline | Not contextual |

**File mode setup:**
```bash
/vibe generate mafia 200    # Generate 200 vibes, save to ~/.pi/agent/vibes/mafia.txt
/vibe mode file             # Switch to file mode
/vibe mafia                 # Now uses the file
```

**How file mode works:**
1. Vibes are loaded from `~/.pi/agent/vibes/{theme}.txt` into memory
2. Uses seeded shuffle (Mulberry32 PRNG) — cycles through all vibes before repeating
3. New seed each session — different order every time you restart pi
4. Zero latency, zero cost, works offline

**Prompt template variables (generate mode only):**
- `{theme}` — the current vibe theme (e.g., "star trek", "mafia")
- `{task}` — context hint (user prompt initially, then agent's response text or tool info on refresh)
- `{exclude}` — recent vibes to avoid (auto-populated, e.g., "Don't use: vibe1, vibe2...")

**How it works:**
1. When you send a message, shows "Channeling {theme}..." placeholder
2. AI generates a themed message in the background (3s timeout)
3. Message updates to the themed version (e.g., "Engaging warp drive...")
4. During long tasks, refreshes on tool calls (rate-limited, default 30s)
5. Cost and latency depend on your configured `workingVibeModel`

## Thinking Level Display

The thinking segment shows live updates when you change thinking level:

| Level | Display | Color |
|-------|---------|-------|
| off | `think:off` | gray |
| minimal | `think:min` | purple-gray |
| low | `think:low` | blue |
| medium | `think:med` | teal |
| high | `think:high` | rainbow |
| xhigh | `think:xhigh` | rainbow |

## Path Display

The path segment supports three modes:

| Mode | Example | Description |
|------|---------|-------------|
| `basename` | `powerline-footer` | Just the directory name (default) |
| `abbreviated` | `…/extensions/powerline-footer` | Full path with home abbreviated and length limit |
| `full` | `~/.pi/agent/extensions/powerline-footer` | Complete path with home abbreviated |

Configure via preset options: `path: { mode: "full" }`

## Git polling

By default the git segment polls both branch and dirty state. If background `git status --porcelain` calls interfere with your workflow, use branch-only polling:

```json
{
  "powerline": {
    "git": { "polling": "branch" }
  }
}
```

Use `"off"` to disable extension-owned git polling entirely and only show the branch reported by Pi when available.

## Segments

`model` · `thinking` · `shell_mode` · `path` · `git` · `subagents` · `token_in` · `token_out` · `token_total` · `cost` · `context_pct` · `context_total` · `time_spent` · `time` · `session` · `hostname` · `cache_read` · `cache_write`

## Separators

`powerline` · `powerline-thin` · `slash` · `pipe` · `dot` · `chevron` · `star` · `block` · `none` · `ascii`

## Theming

Colors are configurable via pi's theme system. Each preset defines its own color scheme, and you can override individual colors and icons with a `theme.json` file in the extension directory.

### Default Colors

| Semantic | Theme Color | Description |
|----------|-------------|-------------|
| `model` | `#d787af` | Model name |
| `shellMode` | `accent` | Bash mode segment |
| `path` | `#00afaf` | Directory path |
| `gitClean` | `success` | Git branch (clean) |
| `gitDirty` | `warning` | Git branch (dirty) |
| `thinking` | `thinkingOff` | Thinking level (`off`) |
| `thinkingMinimal` | `thinkingMinimal` | Thinking level (`minimal`) |
| `thinkingLow` | `thinkingLow` | Thinking level (`low`) |
| `thinkingMedium` | `thinkingMedium` | Thinking level (`medium`) |
| `context` | `dim` | Context usage |
| `contextWarn` | `warning` | Context usage >70% |
| `contextError` | `error` | Context usage >90% |
| `cost` | `text` | Cost display |
| `tokens` | `muted` | Token counts |

### Custom Theme Override

Create `~/.pi/agent/extensions/powerline-footer/theme.json`:

```json
{
  "colors": {
    "pi": "#ff5500",
    "model": "accent",
    "shellMode": "accent",
    "path": "#00afaf",
    "gitClean": "success",
    "thinking": "thinkingOff",
    "thinkingMinimal": "thinkingMinimal",
    "thinkingLow": "thinkingLow",
    "thinkingMedium": "thinkingMedium"
  },
  "icons": {
    "auto": "↯",
    "warning": ""
  }
}
```

Colors can be:
- **Theme color names**: `accent`, `muted`, `dim`, `text`, `success`, `warning`, `error`, `border`, `borderAccent`, `borderMuted`
- **Hex colors**: `#ff5500`, `#d787af`

Icons can be any string, including `""` when you want to suppress a specific glyph entirely.

See `theme.example.json` for all available options.
