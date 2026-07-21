<p>
  <img src="banner.png" alt="pi-powerline-footer" width="1100">
</p>

# pi-powerline-footer

Customizes the default [pi](https://github.com/badlogic/pi-mono) editor with a powerline-style status bar, welcome overlay, and AI-generated "vibes" for loading messages. Inspired by [Powerlevel10k](https://github.com/romkatv/powerlevel10k) and [oh-my-pi](https://github.com/can1357/oh-my-pi).

<img width="1261" height="817" alt="Example powerline UI" src="https://github.com/user-attachments/assets/4cc43320-3fb8-4503-b857-69dffa7028f2" />

The screenshot is illustrative and may differ from current Pi versions. The supported surface is the fixed-editor powerline cluster; the older oh-my-pi-style editor chrome is not configurable today.

## Features

**Editor stash** — Press `Alt+S` to save your editor content and clear the editor, type a quick prompt, and your stashed text auto-restores when the agent finishes. Toggles between stash, pop, and update-existing-stash. A `stash` indicator appears in the powerline bar while text is stashed.

**Working Vibes** — AI-generated themed loading messages. Set `/vibe star trek` and your "Working..." becomes "Running diagnostics..." or "Engaging warp drive...". Supports any theme: pirate, zen, noir, cowboy, etc.

**Welcome overlay** — Branded splash screen shown as centered overlay on startup. Shows gradient logo, model info, keyboard tips, loaded AGENTS.md/extensions/skills/templates counts, an approximate initial system-prompt token count, and recent sessions. Auto-dismisses after 30 seconds or on any key press. Set `powerline.welcome` to `false` to disable it while keeping the footer enabled.

**Rounded box design** — Status renders directly in the editor's top border, not as a separate footer.

**Fixed editor cluster** — In interactive TUI sessions, chat/feed content scrolls above the fixed Pi working/status line, powerline rows, editor, ghost suggestions, bash transcript, and last-prompt/status rows. Scroll chat with the mouse wheel, PageUp/PageDown, Command+PageUp/PageDown, Ctrl+Shift+Up/Down, or message-jump shortcuts; the editor stays put. When you are scrolled away from the bottom, a stacked shortcut hint card appears over the bottom of the chat viewport with the configured bottom, user-message, and assistant-response jump shortcuts. When mouse scrolling is enabled, click anywhere in that card to jump back to the bottom. Drag text to copy it, drag selection to the viewport edge to scroll, double-click a line to select it, and right-click to open the terminal menu. Mouse capture blocks native modifier-click link handling; hold Shift while using your terminal’s normal modifier-click to open OSC 8 links. Use `/powerline fixed-editor off` for Pi’s regular scrolling layout, or `/powerline mouse-scroll off` for native link handling and selection.

**Live thinking level indicator** — Shows current thinking level (`think:off`, `think:med`, etc.) with per-level colors. High, xhigh, and max levels use a rainbow effect inspired by Claude Code's ultrathink.

**Smart defaults** — Nerd Font auto-detection for iTerm, WezTerm, Kitty, Ghostty, and Alacritty with ASCII fallbacks. Colors matched to oh-my-pi's dark theme.

**Git integration** — Async status fetching with 1s cache TTL. Automatically invalidates on file writes/edits. Shows branch, staged (+), unstaged (*), and untracked (?) counts.

**Context awareness** — Color-coded warnings above 70% (yellow) and above 90% (red) context usage. During streaming, the context segment refreshes from live assistant usage instead of waiting for the next turn. Auto-compact indicator when enabled. If `pi-custom-compaction` is installed and enabled, the powerline automatically hides native context segments so the footer does not show stale post-summary usage.

**Token intelligence** — Smart formatting (1.2k, 45M), used/max/percentage context display, subscription detection, and configurable subscription cost display.

**Sticky bash mode** — Toggle bash mode with `ctrl+shift+b` or `/bash-mode`. It keeps a managed shell session alive for the current pi session, shows a dedicated `shell_mode` segment, streams command output into an embedded transcript below the editor, and lets `cd` or exported state persist across commands.

**Shell ghost suggestions** — Bash mode is now ghost-first. Successful per-project shell history is the primary source, while deterministic path and git continuations can still extend an existing command. Shell-native completion probes are disabled so `!command` predictions never spawn interactive shell completion subprocesses. At command position, short stems first resolve from the newest successful local command, can use guarded global shell history for high-confidence heads like `git`, and finally fall back to a tiny curated default set when history is absent. Right now that curated set is `g` → `git status` and `c` → `cd ..`. If the bash prompt is empty, bash mode shows the newest successful project-history ghost suggestion when one exists, otherwise it stays empty. The same inline predictions now also kick in for one-off `!command` and `!!command` prompts. Right Arrow or Tab accepts ghost text into the editor, and Enter runs the current shell command.

## Installation

```bash
pi install npm:pi-powerline-footer
```

Restart pi to activate.

## Usage

Activates automatically. Toggle with `/powerline`, switch presets with `/powerline <name>`, fixed-editor mode with `/powerline fixed-editor on|off|toggle`, the scroll-away card with `/powerline scroll-away-card on|off|toggle`, primary-row placement with `/powerline placement above|below|toggle`, and wheel mode with `/powerline mouse-scroll on|off|toggle`.

Fixed editor is on by default.

- `/powerline fixed-editor off` — return to Pi’s regular scrolling layout
- `/powerline fixed-editor on` — re-enable the fixed editor
- `/powerline fixed-editor toggle` — switch between the two
- `/powerline scroll-away-card off` — hide the navigation hint card while keeping the fixed editor and its shortcuts
- `/powerline scroll-away-card on` — show the navigation hint card when scrolled away from the bottom
- `/powerline scroll-away-card toggle` — switch the hint card between shown and hidden
- `/powerline placement below` — move the primary powerline row below the editor
- `/powerline placement above` — restore the default placement
- `/powerline placement toggle` — switch between above and below

You can also set it in the agent settings file (`~/.pi/agent/settings.json` by default, or under `PI_CODING_AGENT_DIR`) or project-local `.pi/settings.json`:

```json
{
  "powerline": {
    "preset": "default",
    "fixedEditor": false,
    "scrollAwayCard": true,
    "placement": "below",
    "welcome": true,
    "mouseScroll": true
  }
}
```

Use `"fixedEditor": true` to enable it again. Set `"scrollAwayCard": false` to keep the fixed editor and navigation shortcuts while hiding the scroll-away hint card. `"placement"` accepts `"above"` (default) or `"below"` in both fixed and regular editor modes. It moves only the primary powerline row; notifications and Pi working status stay above, while responsive overflow, bash transcript, and the last-prompt reminder stay below. Set `"welcome": false` to skip the startup welcome overlay/header while leaving powerline itself enabled. Add `"mouseScroll": false` if you want native terminal selection instead of fixed-editor mouse handling. Set `"copyOnSelect": false` to prevent selected text from being automatically copied to the system clipboard; the selection stays highlighted with a character-count hint, and you copy explicitly with `ctrl+c` or right-click instead. In Herdr, tmux, and other terminal multiplexers, fixed-editor scrolling is Pi-owned while fixed-editor mode is on; keep mouse scrolling enabled for the fixed-editor viewport, or use `/powerline fixed-editor off` when you want the host multiplexer scrollback to own the experience. While fixed-editor mouse reporting is enabled, hold Shift during your terminal's normal modifier-click to bypass capture for OSC 8 links; otherwise use `/powerline mouse-scroll off` or `/powerline fixed-editor off` for native link handling.

| Preset | Description |
|--------|-------------|
| `default` | Model, thinking, path (basename), git, context, tokens, cost |
| `minimal` | Just path (basename), git, context |
| `compact` | Model, git, cost, context |
| `full` | Everything including hostname, time, abbreviated path |
| `nerd` | Maximum detail for Nerd Font users |
| `ascii` | Safe for any terminal |

**Environment:** `POWERLINE_NERD_FONTS=1` to force Nerd Fonts, `=0` for ASCII.

Preset selection is saved under `powerline` in the agent settings file and restored on startup.
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

If you still prefer the older string preset config shape, `"powerline": "default"` continues to work. String preset shorthand keeps `welcome` enabled and uses the default shortcut/cost/model display settings.

### Disabling segments

Set `powerline.disabledSegments` to hide built-in or configured custom segments from the active preset:

```json
{
  "powerline": {
    "preset": "default",
    "disabledSegments": ["cost", "extension_statuses", "custom:ci"]
  }
}
```

Built-in names are listed under Segments below. Custom items use `custom:<id>`. Unknown names are ignored with a startup warning.

### Custom layout

Use `powerline.layout` to override segment order and grouping while keeping the selected preset’s separator, colors, and segment options:

```json
{
  "powerline": {
    "preset": "default",
    "layout": {
      "left": ["model", "thinking", "path", "git"],
      "right": ["context_pct", "cost"],
      "secondary": ["custom:ci"]
    },
    "customItems": [
      { "id": "ci", "statusKey": "ci-status" }
    ]
  }
}
```

A present `left`, `right`, or `secondary` array replaces that preset group exactly; an empty array clears it. Omitted groups keep the preset entries and automatically append custom items by their configured `position`. Explicitly listing a segment moves it out of omitted preset groups, and explicitly placed custom items are not auto-appended elsewhere. `disabledSegments` is applied after layout.

Responsive behavior is unchanged: these groups control ordering and overflow priority, not permanently pinned terminal rows. On wide terminals secondary entries can fit in the top bar; on narrow terminals primary overflow moves into the secondary line. Unknown entries are ignored with a startup warning. The old fixed `custom` preset has been removed; combine any preset with `layout` instead.

### Demo settings

For a compact current footer setup:

```json
{
  "powerline": {
    "preset": "default",
    "fixedEditor": true,
    "mouseScroll": true,
    "path": { "mode": "basename" },
    "model": { "display": "name" },
    "cost": { "subscriptionDisplay": "subscription" }
  }
}
```

Use `"model": { "display": "qualified" }` when two providers expose models with the same display name.

Subscription cost display accepts:

| Mode | Subscription + reported cost | Subscription + no reported cost |
|------|------------------------------|----------------------------------|
| `subscription` | `(sub)` | `(sub)` |
| `reported-cost` | `$0.12` | `(sub)` |
| `both` | `$0.12 (sub)` | `(sub)` |

Segment display formats (opt-in; defaults match the historical rendering):

| Segment option | Values | Default | Effect |
|---|---|---|---|
| `"context": { "format" }` | `"full"` / `"percent"` | `"full"` | `"percent"` shows a bare rounded `83%` (threshold-colored, no icon) instead of `12k/200k (6.2%)` |
| `"cache_read": { "format" }` | `"tokens"` / `"percent"` | `"tokens"` | `"percent"` shows the cache hit rate `cacheRead / (input + cacheRead)` instead of the raw token count |

```json
{
  "powerline": {
    "context": { "format": "percent" },
    "cache_read": { "format": "percent" }
  }
}
```

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

In `~/.pi/agent/settings.json` (or under `PI_CODING_AGENT_DIR` when that environment variable is set):

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

Use `Alt+S` / `Option+S` as a quick stash toggle while drafting. It keeps one active stash and clears the editor when stashing. Powerline listens for unambiguous Alt/Meta-S escape encodings by default. If your old terminal setup only emits the printable German sharp-S character for Option+S and you still want that to trigger stash, set `"stashSharpSShortcut": true` under `powerline`.

| Editor | Stash | `Alt+S` result |
|--------|-------|----------------|
| Has text | Empty | Stash current text, clear editor |
| Empty | Has stash | Restore stash into editor |
| Has text | Has stash | Update stash with current text, clear editor |
| Empty | Empty | Show "Nothing to stash" |

Auto-restore after an agent run only happens when the editor is still empty. If you typed meanwhile, the stash is preserved.

The `stash` indicator appears in the powerline bar (on presets with `extension_statuses`). Active stash is still session-local and resets on session switch / disable, but stash history is persisted to the agent dir at `powerline-footer/stash-history.json` so it survives restarts. By default the agent dir is `~/.pi/agent`; set `PI_CODING_AGENT_DIR` to move global powerline settings, stash history, sessions, vibes, skills, commands, and extension discovery with Pi.

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
- `ctrl+alt+g` — jump the fixed-editor chat viewport to the bottom

Copy/cut actions do not modify stash state or stash history. Dragging files, folders, images, or screenshots from Finder into the custom editor inserts their path strings. Chat jumps require fixed-editor mode because they use its app-owned scroll viewport. When fixed-editor chat is scrolled away from the bottom, the viewport shows a shortcut hint card with these configured shortcut labels unless `powerline.scrollAwayCard` is `false`; with mouse scrolling enabled, clicking anywhere in the card jumps to the bottom. Submitting editor text also returns that viewport to the bottom so new output stays in view.

### Shortcut configuration

You can override shortcut keys in the agent settings file:

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
    "jumpChatBottom": "ctrl+alt+g",
    "scrollChatUp": "cmd+up",
    "scrollChatDown": "cmd+down",
    "editorStart": "cmd+shift+up",
    "editorEnd": "cmd+shift+down"
  }
}
```

After changing bindings, run `/reload`. Invalid bindings, reserved key conflicts (like `Alt+S`), or duplicate conflicts automatically fall back to safe defaults. Set a binding to `null` or `""` to disable that action; disabled actions are not registered, do not match raw terminal fallbacks, and are omitted from the fixed-editor scroll-away hint card. `bashMode.toggleShortcut` also accepts `null` or `""` to disable the keyboard toggle while keeping `/bash-mode` available. `cmd` and `command` are accepted aliases for Pi's `super` modifier for the documented Command navigation keys; unsupported Command-letter bindings such as `cmd+c` are ignored instead of matching plain text input. Some terminals, including Ghostty, bind Command+Arrow themselves; remap those terminal keys to send `\x1b[1;9A` / `\x1b[1;9B` for chat scrolling and `\x1b[1;10A` / `\x1b[1;10B` for editor-boundary navigation if you want Pi to receive them.

### Editor autocomplete composition

Powerline wraps Pi's autocomplete provider so bash mode can add shell-aware suggestions. When another editor extension was already installed, powerline now passes Pi's provider through that previous editor's `setAutocompleteProvider()` first and then wraps the resulting provider. This preserves prior autocomplete-provider wrappers where possible, but it is not full render/input composition between custom editors.

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

In the agent settings file:

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
/vibe generate mafia 200    # Generate 200 vibes, save to the agent dir
/vibe mode file             # Switch to file mode
/vibe mafia                 # Now uses the file
```

**How file mode works:**
1. Vibes are loaded from `vibes/{theme}.txt` in the agent dir into memory
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
| max | `think:max` | rainbow |

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

`model` · `thinking` · `shell_mode` · `path` · `git` · `subagents` · `token_in` · `token_out` · `token_total` · `cost` · `context_pct` · `context_total` · `time_spent` · `time` · `session` · `hostname` · `cache_read` · `cache_write` · `extension_statuses`

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

Create `extensions/powerline-footer/theme.json` in the agent dir:

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
