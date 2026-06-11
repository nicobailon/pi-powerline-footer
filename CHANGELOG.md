# Changelog

## [Unreleased]

## [0.6.1] - 2026-06-08

### Fixed
- **Prompt history draft preservation** — Returning from prompt-history browsing with Down now restores the unsent editor draft instead of clearing it.

## [0.6.0] - 2026-06-05

### Changed
- **Prompt history recall** — Pressing Up at the end of non-bash editor text now recalls the previous submitted prompt, while Up inside the text keeps normal cursor movement.
- **Pi 0.76 compatibility** — Verified compatibility against `@earendil-works/pi-ai`, `@earendil-works/pi-coding-agent`, and `@earendil-works/pi-tui` `0.76.0`, then widened peer/dev ranges to `>=0.74.0 <0.77.0`.
- **Git polling control** — Added `powerline.git.polling` with `full`, `branch`, and `off` modes so users can avoid background dirty-state polling in worktrees or Windows environments.

### Fixed
- **Session-switch keyboard modes** — Preserved Kitty keyboard protocol and `modifyOtherKeys` across session switches so Shift+Enter keeps inserting newlines after resume/new/fork.
- **Fixed-editor IME positioning** — Kept the terminal cursor anchored to the logical editor cursor even when the visible hardware cursor is hidden, improving IME candidate placement.
- **Fixed-editor image scrolling** — Cleared stale Kitty image placements when the app-owned chat viewport moves so images scroll with text.
- **Stale extension contexts** — Ignored only Pi's stale-context render race during session replacement while preserving other render errors.
- **Stash text lookup** — Fell back to Pi's editor text when the custom editor temporarily reports an empty string, so stash/copy/history actions can still see current input.
- **Segment option config** — Parsed and merged documented segment options like `powerline.path.mode` over preset defaults.
- **Fixed-editor selection hit-testing** — Refreshed root viewport state before mouse selection hit-testing so copied text stays aligned after output changes.

## [0.5.6] - 2026-05-26

### Fixed
- **Fixed-editor mouse scrolling** — Reasserted terminal mouse reporting after fixed-editor writes so mouse-wheel scrolling keeps working when the fixed editor is enabled.
- **Fixed-editor chat clipping** — Guarded fixed-editor viewport writes against terminal autowrap drift so full-width user message boxes no longer lose characters at the right edge.

## [0.5.5] - 2026-05-26

### Fixed
- **Pi 0.75 extension installs** — Widened Pi package peer dependency ranges so `pi-powerline-footer` can install alongside extensions that require Pi 0.75.x packages.

## [0.5.4] - 2026-05-10

### Fixed
- **Editor undo shortcut** — Command-Z now restores deleted prompt text through the custom editor undo stack.

## [0.5.3] - 2026-05-10

### Fixed
- **Fixed-editor status scrolling** — Mouse wheel scrolling now repaints the app-owned chat viewport immediately when fixed status rows are present, instead of waiting for a later TUI diff render.

## [0.5.2] - 2026-05-09

### Fixed
- **Editor file drops** — Finder file, folder, image, and screenshot drops now insert path strings into the custom editor, including terminals that send `file://` URI drops.
- **Fixed-editor status scrolling** — Mouse wheel and keyboard scrolling now refresh viewport bounds when fixed Pi/status rows appear, so fixed status messages no longer stop chat scrolling.

## [0.5.1] - 2026-05-02

### Fixed
- **Fixed-editor context-menu copy** — Right-clicking inside an app-owned text selection now restores the full highlighted range after terminal context-menu Copy, instead of leaving only the clicked word on the clipboard.

## [0.5.0] - 2026-05-02

### Changed
- **Fixed editor hard cutover** — Chat/feed content now scrolls in a TUI-owned viewport above the fixed powerline/editor cluster. Mouse wheel and PageUp/PageDown scroll chat without moving the editor. Dragging chat or fixed-editor text highlights it and copies on release. Use `/powerline fixed-editor on|off|toggle` to switch back to Pi’s regular scrolling layout, or `/powerline mouse-scroll off` for native terminal selection.
- **Chat shortcuts** — Added configurable previous/next shortcuts for jumping the fixed-editor chat viewport through user messages (`ctrl+shift+u` / `ctrl+shift+i`), LLM messages (`ctrl+alt+,` / `ctrl+alt+.`), plus `ctrl+shift+g` to jump straight to the bottom. Fixed-editor feed scrolling now also has configurable `scrollChatUp` / `scrollChatDown` shortcuts, defaulting to `cmd+up` / `cmd+down`.
- **Editor navigation shortcuts** — Added configurable `editorStart` / `editorEnd` shortcuts, defaulting to `cmd+shift+up` / `cmd+shift+down`, to move the editor cursor to the start of the first line or end of the last line. Shortcut settings are refreshed per session, and `cmd+shift` aliases canonicalize to the same `super+shift` form as the defaults. Unsupported Command-letter bindings are ignored instead of matching plain text input.

### Fixed
- **Bash ghost shell safety** — Bash-mode and one-off `!command` ghost suggestions no longer spawn shell-native completion probes, avoiding interactive zsh/fish/bash subprocesses that can interfere with terminal job control and stop the parent Pi process.
- **Thinking status repainting** — Thinking level changes now invalidate the powerline layout immediately and use live thinking state, so rapid Shift+Tab cycling updates the footer without waiting for the next agent turn, typing throttle, or session-history refresh. Tree navigation clears the live override so branch history can show the selected branch's thinking level.
- **Context usage repainting** — The context-window usage segment now refreshes from live streaming assistant usage on message updates and forces a final repaint at message/turn completion, so values like `17.1%/272k` update sooner than session-history-only refreshes. `/tree` navigation with a branch summary now uses Pi's current context estimate immediately instead of waiting for the next assistant turn. Live usage is cleared across sessions and agent turns, `totalTokens` is preferred when providers report it, and zero-token, aborted, or error messages fall back to the last valid persisted usage instead of flashing `0%`.
- **Extension status repainting** — `ctx.ui.setStatus()` updates now invalidate the powerline layout immediately while idle, so custom status items such as `🪃 auto` appear without waiting for the next prompt or agent event.
- **Fixed-editor working status** — Pi's working/status line, like `⠏ Shaolin Switchblade Sync...`, now stays fixed with the editor instead of scrolling with chat.
- **Fixed-editor follow-up queue** — The fixed editor now re-enables Pi's extended keyboard mode after entering alternate screen, so `Alt+Enter` still reaches Pi's follow-up queue while the agent is streaming.
- **Fixed-editor terminal cleanup** — Session shutdown and emergency exit cleanup now leave alternate screen before clearing the full Kitty CSI-u stack and xterm modifyOtherKeys mode, preventing keypresses from leaking as sequences like `97;1:3u` after quitting Pi.
- **Fixed-editor overlay width** — Overlay compositing now normalizes tabbed overlay lines and strips OSC shell-integration markers from overlay-visible base lines, preventing side-chat overlays from producing rendered lines wider than the terminal.
- **Fixed-editor selection context menu** — App-owned text selection now briefly releases mouse reporting after copy so a follow-up right-click can open the terminal context menu.
- **Fixed-editor selection overflow** — Chat selection highlighting now strips OSC shell-integration control sequences before slicing text, preventing exposed `]133` markers from making rendered lines exceed terminal width.
- **Fixed-editor text selection** — Dragging inside the fixed editor cluster now highlights and copies selected text instead of being swallowed by mouse-scroll handling. Dragging a chat selection to the viewport edge now scrolls while keeping the selection active.
- **Fixed-editor right-click menu** — Right-click temporarily releases mouse reporting so the terminal context menu remains available while fixed-editor mouse scrolling is enabled.
- **Fixed-editor double-click selection** — Double-clicking chat or fixed-editor text now selects the whole line while mouse reporting is active.
- **Fixed-editor keyboard scrolling** — Command+PageUp/PageDown and Ctrl+Shift+Up/Down now scroll the fixed-editor chat viewport, giving compact keyboards a default page-scroll shortcut.
- **Fixed-editor submit follow** — Submitting editor text now returns the fixed-editor chat viewport to the bottom so the new prompt/output stays in view.

## [0.4.20] - 2026-04-26

### Changed
- **Welcome overlay logo** — Replaced the old π splash art with a block-rendered version of the current Pi logo.
- **Status line branding** — Removed the standalone `π` segment from the powerline surface so the editor row starts with model/status information.
- **Stash shortcut** — Accept macOS `Option+S` even when the terminal emits the literal `ß` character instead of an `alt+s` escape sequence.
- **Model segment** — Removed the extra ASCII model glyph before the model name.

## [0.4.19] - 2026-04-25

### Fixed
- **Editor responsiveness during live status updates** — Coalesced status repaints and moved the top powerline row out of the editor render path so shifting status items do less work while typing.

## [0.4.18] - 2026-04-23

### Fixed
- **Editor responsiveness while streaming** — Reduced powerline layout work during assistant streaming and coalesced welcome-dismiss work so typing in the editor stays more responsive while output is arriving.

## [0.4.17] - 2026-04-23

### Fixed
- **Session shutdown crash** — Footer/editor render paths no longer read stale session-bound `ctx` objects during Ctrl+C, reload, or session replacement, preventing Pi 0.69.x stale-extension errors.
- **Bash transcript theme regression** — The bash transcript widget now uses the full Pi theme provided by the widget factory, avoiding `theme.fg is not a function` crashes from editor theme objects.
- **Welcome overlay shutdown cleanup** — Delayed welcome overlays now ignore replaced sessions and clean up their countdown timer safely during early dismissal.

## [0.4.16] - 2026-04-21

### Fixed
- **Project-local powerline settings now apply** — The extension now merges global and project settings for `powerline`, so project `.pi/settings.json` custom items and preset overrides render correctly without requiring a matching global config.
- **Preset changes preserve project-local custom items** — `/powerline <preset>` now writes back to the project settings file when that file owns the `powerline` key, preserving existing `customItems` instead of silently bypassing project configuration.
- **Promoted status rendering cleanup** — Custom powerline items now normalize status text consistently, keep notification-style statuses renderable when promoted, and avoid duplicate notification display above the editor.
- **Custom-item review cleanup** — Removed the remaining `any` escape from the custom-items test and deleted redundant narration comments in the touched segment code.
- **Per-level thinking colors restored** — `minimal`, `low`, and `medium` thinking levels now render with their documented distinct colors again, and the theme surface now exposes only the thinking color keys that actually affect runtime rendering.
- **Thinking-color cleanup** — Narrowed the segment theme contract to the `fg()` API it actually uses, removed the regression test cast, and cleaned the nearby thinking docs/comments to match the project’s plain-text style.

## [0.4.15] - 2026-04-21

### Added
- **`theme.json` icon overrides** — `theme.json` can now override footer icons alongside colors, so you can tone down or remove glyphs like the auto-compact marker without editing `icons.ts`.

### Fixed
- **Older pi autocomplete compatibility** — Bash-mode autocomplete providers now stay sync-compatible when they have no dropdown items, so wrapping the default provider no longer risks handing older hosts a `Promise` from `getSuggestions()`.
- **Enter no longer forces ghost text** — Bash-mode Enter now submits exactly what is in the editor instead of silently accepting the current ghost suggestion first. `Tab` and Right Arrow remain the explicit ghost-accept actions.

## [0.4.14] - 2026-04-21

### Fixed
- **Ghost-first bash predictions** — Bash mode no longer opens or relies on a shell autocomplete dropdown. Typing now updates only the inline ghost suggestion, and `Tab` accepts that ghost instead of surfacing a menu.
- **Irrelevant command-position suggestions** — Command stems now resolve from successful project history first, can use guarded global Git history as a backup, and fall back to a tiny curated default set when history is absent. Today that means `g` → `git status` and `c` → `cd ..`, while generic command noise like `g++` stays out of the shell UI.
- **Empty-prompt global-history ghosts** — When bash mode starts on an empty prompt without a successful project-history match, it now stays empty instead of promoting an unvalidated global-history command.

## [0.4.13] - 2026-04-20

### Fixed
- **Stale footer repaint after model changes and agent completion** — The shared footer/editor render path now invalidates its cached layout and repaints immediately on `model_select` and `agent_end`, fixing the stale model/status behavior reported in issue #11 and avoiding the incomplete direct-render approach proposed in PR #19.
- **Bracketed paste shell UI refresh** — After multiline bracketed paste completes, bash-mode ghost suggestions and shell autocomplete now refresh normally instead of staying stale.

## [0.4.12] - 2026-04-20

### Added
- **Sticky bash mode** — Added `/bash-mode`, `/bash-reset`, a configurable `ctrl+shift+b` toggle, a persistent per-session shell runtime, and an embedded shell transcript below the editor.
- **Shell-aware completion pipeline** — Added project/global shell history ranking, git-aware completions, PATH/path completions, active-shell native completion adapters, and ghost suggestions for bash mode.
- **Shell mode status segment** — Added a dedicated `shell_mode` segment that shows when bash mode is active and whether the managed shell is idle or running.
- **Test coverage for bash mode primitives** — Added tests for transcript truncation, history parsing, completion ranking, ghost suggestions, and managed shell cwd persistence.
- **Empty-prompt bash ghost suggestions** — Entering bash mode on an empty prompt now shows a history-based inline ghost suggestion immediately, and clearing the prompt restores it without auto-opening the dropdown.

### Changed
- **Auto-hide native context under custom compaction** — When `pi-custom-compaction` is installed and enabled, the powerline now hides `context_pct` and `context_total` so the footer does not show stale native context usage after virtual background summaries apply.

### Fixed
- **Newest-first shell history ranking** — Bash mode now treats project and global shell history consistently so the newest matching command wins instead of older matches surfacing first.
- **Interrupted shell recovery** — If an interrupted shell command tears down the managed shell process, the session now marks the command as failed, clears stale process state, and starts cleanly on the next command instead of getting stuck.
- **Escaped fallback path completions** — Deterministic path completions now escape shell-special characters like spaces before insertion while keeping the dropdown labels readable.
- **Native completion cwd drift** — Shell-native completion probes now run from the managed shell cwd instead of the extension directory, so repo-aware and path-aware suggestions match the actual bash-mode location.
- **Broken bash argument completions** — Bash native completion no longer suggests unrelated executables like `declare` for argument positions such as `cd d`, and directory candidates keep their trailing slash.
- **Enter while shell is busy** — Pressing Enter with ghost text visible no longer mutates the editor when a shell command is already running.
- **Package release contents** — The published package now includes the new `bash-mode/*.ts` runtime files instead of only the root-level extension files.
- **Transcript eviction** — The bash transcript now keeps the active command visible even when that single command exceeds the retention cap, instead of evicting the running command entirely.
- **Escaped native zsh directory completions** — Native zsh completions now preserve trailing directory slashes for escaped path suggestions like `My\ Folder/`.
- **Prompt history navigation regression** — Bash mode no longer reuses pi-tui’s internal `historyIndex` slot for shell history state, so normal Up/Down prompt navigation works reliably again and Down clears the editor when returning to the live draft.
- **Empty-prompt shell history browsing** — Bash mode history navigation now works from an empty prompt too, returning the newest commands instead of reporting no matches.
- **One-off `!` / `!!` shell predictions** — Default one-off bash commands now reuse the shell completion pipeline too, so typing `!` or `!!` shows ghost suggestions immediately and Right Arrow accepts them just like sticky bash mode.
- **Bang-command completion alignment** — One-off shell predictions now only activate for real `!` / `!!` commands at the start of the prompt, matching pi’s actual submission behavior instead of also triggering after leading whitespace.
- **Hidden ghost acceptance** — Right Arrow no longer accepts a ghost suggestion when the cursor is not at the end of the line, so moving around inside a command behaves normally.
- **Working vibe generation on `openai-codex/*` and similar providers** — Vibe generation now sends a minimal system prompt to providers that require instructions, batch generation preserves provider error messages instead of collapsing them into `Empty response from model`, and the default vibe model now uses `openai-codex/gpt-5.4-mini` instead of an Anthropic default.
- **Multiline paste submission regression** — The custom editor no longer misreads bracketed multiline paste chunks as submit keys, so pasted text stays in the editor instead of getting split into separate submitted prompts.

## [0.4.11] - 2026-04-14

### Fixed
- **Prompt-width crash on pasted unicode text** — Replaced manual truncation in the last-prompt widget and welcome helpers with pi-tui truncation so pasted text containing grapheme clusters no longer overflows terminal width and crashes the UI.
- **Session usage typing cleanup** — Replaced broad session assistant-message casts with local type narrowing in footer context building.

### Changed
- **Status copy simplified** — Removed emoji-based stash and fallback status markers from the current UI and docs.

## [0.4.10] - 2026-04-12

### Changed
- **Model segment simplified** — Footer model segment now shows model info only (plus thinking), without profile labels.

### Removed
- **Profile switching surface** — Removed `/model-switcher`, profile cycle/select shortcuts, and profile persistence wiring from this extension.

## [0.4.9] - 2026-04-03

### Added
- **Recent project prompts in prompt history** — `/stash-history` and `ctrl+alt+h` now let you choose between saved stashed prompts and recent user-submitted prompts from pi sessions in the current project folder.

### Fixed
- **Session transition cleanup in prompt history UI** — Unified stash and welcome cleanup under `session_start` reason handling so replacement starts reset session-local state without relying on removed post-transition extension events.

## [0.4.8] - 2026-03-27

### Fixed
- **Broken vibe generation after pi update** — Migrated from removed `modelRegistry.getApiKey()` to `getApiKeyAndHeaders()`, passing both `apiKey` and `headers` through to `complete()` so OAuth and custom proxy providers work correctly.

## [0.4.7] - 2026-03-22

### Fixed
- **Stale footer after profile switch** — Invalidated layout cache after switching profiles so the powerline updates immediately instead of lagging behind the notification.

## [0.4.6] - 2026-03-22

### Added
- **Model profiles** — Added saved model + thinking combos via `modelProfiles` in settings. When active, profiles with a label show the label in the model segment; profiles without a label append a `(P#)` indicator to the model name.
- **Profile shortcuts** — Added `alt+shift+tab` profile cycling and `ctrl+alt+m` profile selector overlay, both configurable through `powerlineShortcuts`.
- **`/model-switcher` command** — Added profile management commands for listing, adding (interactive picker or direct text), removing, and switching by profile number, with immediate persistence to `settings.json`.

## [0.4.5] - 2026-03-19

### Added
- **Stash history overlay** — Added `ctrl+alt+h` stash history picker showing up to 12 recent stashed prompts (newest first).
- **Stash history slash command** — Added `/stash-history` to open the same stash history picker from the command prompt.
- **Persistent stash history storage** — Stash history now saves to `~/.pi/agent/powerline-footer/stash-history.json`.
- **Insert mode prompt for stash history** — Selecting a stash history entry now supports `Replace`, `Append`, or `Cancel` when the editor already has text.
- **Editor-wide clipboard shortcuts** — Added `ctrl+alt+c` to copy all editor text and `ctrl+alt+x` to cut all editor text.
- **Configurable powerline shortcuts** — Added `powerlineShortcuts` settings support for `stashHistory`, `copyEditor`, and `cutEditor` bindings.

### Changed
- **Stash lifecycle consistency** — Active stash resets on session switch and when `powerline` is disabled, while stash history persists to disk for reuse across restarts.
- **Stash update behavior** — Pressing `Alt+S` while both editor text and an active stash exist now updates the stash with the current editor text and clears the editor (no swap-back into the editor).
- **Shortcut override hardening** — Invalid shortcut override values are rejected, and conflicting shortcuts auto-fallback so `Alt+S` stash behavior and all three powerline shortcuts remain usable.

## [0.4.4] - 2026-03-19

### Removed
- Dropped npm `bin` installer shim and removed `cli.js`; package now targets `pi install npm:pi-powerline-footer` as the only install path.

## [0.4.3] - 2026-03-19

### Fixed
- **`nerd` preset crash on `primary` theme color** — Replaced invalid `tokens: "primary"` with `tokens: "muted"` so `/powerline nerd` no longer trips `Unknown theme color: primary` on current pi themes.
- **Stale theme docs** — Updated README and `theme.example.json` to remove `primary` as a supported theme color name and align documented defaults with runtime values.
- **Thinking level fallback from footer context** — `buildSegmentContext()` now correctly falls back to `ctx.getThinkingLevel()` when no session `thinking_level_change` event exists.
- **Vibe config persistence signaling** — `/vibe` commands now warn when runtime changes could not be written to `settings.json` instead of silently claiming persistence.
- **Welcome text width truncation** — Truncation now respects `visibleWidth()` per codepoint, preventing wide-character overflow in welcome rendering.
- **JS extension discovery parity** — `discoverLoadedCounts()` now recognizes directory `index.js` and standalone `.js` extension entries, not just TypeScript files.
- **Package count scope parity** — Welcome extension counts now include npm packages from both global (`~/.pi/agent/settings.json`) and project (`.pi/settings.json`) settings.
- **Dead `git` semantic color path** — Removed unused `git` semantic color wiring that was never read by segment rendering.
- **Vibe batch count hardening** — `/vibe generate` and `generateVibesBatch()` now clamp invalid/negative/huge counts to safe bounds.
- **Custom editor async race guard** — Late `setupCustomEditor()` async completion no longer re-attaches editor/footer/widgets after the extension has been disabled.
- **Vibe file path sanitization** — Theme names are now slugged to safe filenames before file reads/writes, preventing path-like theme strings from producing unsafe paths.
- **Home directory resolution hardening** — Settings/vibe path resolution now falls back to OS homedir APIs when `HOME`/`USERPROFILE` are unset.
- **Dead `thinkingHigh` semantic path** — Removed unused `thinkingHigh` semantic color plumbing from runtime theme config/types and example theme JSON.
- **Dead color table entries** — Removed unused ANSI color constants from `colors.ts` to match only colors actually used by welcome/editor chrome rendering.

## [0.4.2] - 2026-03-15

### Fixed
- **Ghost entries in extension statuses** — Status values that are purely ANSI escape codes with no visible text (zero `visibleWidth`) are now filtered out instead of rendering as blank ` · ` gaps in the powerline bar.
- **Double separator artifacts** — Extensions that bake in their own trailing separators (e.g., Glimpse's `G ·`) no longer clash with the segment's own ` · ` joiner. Trailing ANSI codes, whitespace, `·`, and `|` are stripped from each status value before joining.

## [0.4.1] - 2026-03-12

### Fixed
- **Prompt history now survives custom editor reinstalls** — Up-arrow recall is preserved across `/reload`, preset changes, and the editor's autocomplete self-rebind path by snapshotting prompt history before replacement and restoring it into the new custom editor instance. Explicitly disabling `powerline-footer` via `/powerline` still clears the extension-managed history on purpose.

## [0.4.0] - 2026-03-11

### Added
- **Editor stash** — Press `Alt+S` to save editor content and clear the editor, type a quick prompt, and have the stashed text auto-restored when the agent finishes. Toggles: stash, pop, swap, or "nothing to stash" depending on editor/stash state. Status indicator (`stash`) shown in the powerline bar on presets that include `extension_statuses`. Auto-restore only happens when the editor is empty (won't overwrite text you started typing).

### Fixed
- **Stale state on session switch** — `/new` and `/resume` now properly reset session timer, context, last prompt, streaming flag, and dismiss any active welcome overlay/header. Previously these carried over from the old session because `session_start` only fires on initial load and `/reload`, not on session changes.

### Removed
- Dead `clearThemeCache()` export from `theme.ts`
- Dead `user_message` event handler (welcome dismissal already handled by `agent_start`, `tool_call`, and editor keypress)
- Unused parameters across handlers and segments
- Redundant double settings file read (consolidated into single `readSettings()` helper)

## [0.3.1] - 2026-02-28

### Changed
- **Last prompt reminder now always visible** — Shows your last message at all times (not just during streaming) so you always have context. Disable via `"showLastPrompt": false` in settings.json.

## [0.3.0] - 2026-02-28

### Added
- **Last prompt reminder** — Shows your last message below the powerline bar while the agent is streaming, so you don't forget what you asked during long operations. Displays as a subtle gray `↳ your message here...` that disappears when the agent finishes.

## [0.2.24] - 2026-02-15

### Fixed
- **Secondary row disappearing** — When overflow segments exceeded terminal width, the entire secondary row vanished instead of showing what fits. The secondary row now applies the same width-fitting logic as the top bar, adding segments until full and stopping there.

### Removed
- Dead `width` field from `SegmentContext` (set but never read by any segment)
- Dead `rainbow` function and `RAINBOW_COLORS` from `colors.ts` (duplicated in `theme.ts`, which is the version actually used)

## [0.2.23] - 2026-02-06

### Fixed
- **Slash command autocomplete not appearing** — Custom editor created during `session_start` never received the autocomplete provider because pi v0.52.7 moved `setupAutocomplete()` to run after extensions load. The `handleInput` override now detects the missing provider on first keystroke, re-triggers `setEditorComponent` (which succeeds because the provider exists by then), and forwards the keystroke to the new editor. Users without editor-replacing extensions were unaffected.

## [0.2.22] - 2026-01-31

### Fixed
- **Detached HEAD flickering** — Git branch segment no longer oscillates between showing "detached" and hiding every 500ms when HEAD is detached
  - Root cause: two competing branch detection methods (provider reads `.git/HEAD` → `"detached"`, extension runs `git branch --show-current` → empty/null) fought via a `??` fallback that leaked the provider value on every cache expiry
  - Branch cache now returns stale value while refreshing instead of falling through to provider
  - Detached HEAD now shows the short commit SHA (e.g., `abc1234 (detached)`) instead of bare "detached"

### Changed
- **Extracted `runGit` helper** — Consolidated duplicated process-spawning logic from `fetchGitBranch` and `fetchGitStatus` into a shared helper
- `fetchGitBranch` now distinguishes "not a git repo" (null, early exit) from "detached HEAD" (empty string, SHA lookup) — avoids spawning a wasteful second process for non-git directories

## [0.2.21] - 2026-01-31

### Changed
- **Status bar moved above editor** — Powerline segments now render above the top border instead of below the bottom border, keeping the input prompt closer to the conversation
- **Removed blank line below editor** — Eliminated extra spacing after the status bar
- **Default segment order** — Model and thinking level now appear before path for better at-a-glance info (π → model → think → path → ...)

## [0.2.20] - 2026-01-30

### Changed
- **Editor layout redesign** — Replaced rounded box (`╭╮│╰╯`) with clean open layout:
  - Subtle grey `─` top/bottom borders with 1-char margins
  - `>` input prompt on first content line (light gray), continuation lines indented to match
  - Status bar moved below the bottom border as a standalone line
  - Status bar no longer has trailing `─` fill
- **Softer border colors** — Borders use muted grey (`sep`) instead of bright blue (`border`)

### Fixed
- **Scroll indicator detection** — Bottom border regex now matches editor scroll indicators (`─── ↓ N more`) in addition to plain borders, preventing broken rendering when editor content is scrollable
- **Segment overflow** — `topBarAvailable` no longer wastes 4 chars on removed box corners, giving segments the full terminal width for layout calculation

## [0.2.19] - 2026-01-28

### Added
- **File-based vibe mode** — Pre-generate vibes once, pull from file at runtime (zero cost, instant)
  - `/vibe generate <theme> [count]` — Generate and save vibes to `~/.pi/agent/vibes/{theme}.txt`
  - `/vibe mode file` — Switch to file-based mode
  - `/vibe mode generate` — Switch back to on-demand generation
  - Uses seed-based deterministic shuffle for no-repeat selection
  - Works offline, no API key needed at runtime

### Improved
- **Better vibe variety in generate mode** — Tracks last 5 vibes and excludes them from generation
- **Updated prompt** — Now emphasizes creativity and avoiding clichéd phrases
- **Richer tool call context** — Uses agent's response text instead of just "reading file: X" for more contextual vibes
- **Configurable max message length** — `workingVibeMaxLength` setting (default: 65 chars, up from 50)

## [0.2.18] - 2026-01-28

### Fixed
- **Race condition in vibe generation** — Fixed bug where stale vibe generations could overwrite newer ones by capturing AbortController in local variable

## [0.2.17] - 2026-01-28

### Added
- **Working Vibes** — AI-generated themed loading messages that match your preferred style
  - Set a theme with `/vibe star trek` and loading messages become "Running diagnostics..." instead of "Working..."
  - Configure via `settings.json`: `"workingVibe": "pirate"` for nautical-themed messages
  - Supports any theme: star trek, pirate, zen, noir, cowboy, etc.
  - Shows "Channeling {theme}..." placeholder, then updates when AI responds (within 3s timeout)
  - **Auto-refresh on tool calls** — Generates new vibes during long tasks (rate-limited, default 30s)
  - Configurable refresh interval via `workingVibeRefreshInterval` (in seconds)
  - Custom prompt templates via `workingVibePrompt` with `{theme}` and `{task}` variables
  - Uses claude-haiku-4-5 by default (~$0.000015/generation), configurable via `/vibe model` or `workingVibeModel` setting

### Fixed
- **Event handlers now use correct events** — Replaced non-existent `stream_start`/`stream_end` with `agent_start`/`agent_end`
- **Removed duplicate powerline bar** — Footer no longer renders redundant status during streaming

## [0.2.16] - 2026-01-28

### Fixed
- **Model and path colors restored** — Fixed color regression from v0.2.13 theme refactor:
  - Model segment now uses original pink (`#d787af`) instead of white/gray (`text`)
  - Path segment now uses original cyan (`#00afaf`) instead of muted gray

## [0.2.15] - 2026-01-27

### Added
- **Status notifications above editor** — Extension status messages that look like notifications (e.g., `[pi-annotate] Received: CANCEL`) now appear on a separate line above the editor input
- Notification-style statuses (starting with `[`) appear above editor
- Compact statuses (e.g., `MCP: 6 servers`) remain in the powerline bar

## [0.2.14] - 2026-01-26

### Fixed
- **Theme type mismatch crash** — Fixed `TypeError: theme.fg is not a function` caused by passing `EditorTheme` (from pi-tui) instead of `Theme` (from pi-coding-agent) to segment rendering
- **Invalid theme color** — Changed `"primary"` to `"text"` in default colors since `"primary"` is not a valid `ThemeColor`

## [0.2.13] - 2026-01-27

### Added
- **Theme system** — Colors now integrate with pi's theme system instead of hardcoded values
- Each preset defines its own color scheme with semantic color names
- Optional `theme.json` file for user customization (power user feature)
- Colors can be theme names (`accent`, `primary`, `muted`) or hex values (`#ff5500`)
- Added `theme.example.json` documenting all available color options

### Changed
- Segments now use pi's `Theme` object for color rendering
- Removed hardcoded ANSI color codes in favor of theme-based colors
- Presets include both layout AND color scheme for cohesive looks
- Simplified thinking level colors to use semantic `thinking` color (rainbow preserved for high/xhigh)

## [0.2.12] - 2026-01-27

### Added
- **Responsive segment layout** — Segments dynamically flow between top bar and secondary row based on terminal width
- When terminal is wide: all segments fit in top bar, secondary row hidden
- When terminal is narrow: overflow segments move to secondary row automatically

### Changed
- **Default preset reordered** — New order: π → folder → model → think → git → context% → cache → cost
- Path now appears before model name for better visual hierarchy
- Thinking level now appears right after model name
- Added git, cache_read, and cost to primary row in default preset
- **Thinking label shortened** — `thinking:level` → `think:level` to save 3 characters

### Fixed
- **Narrow terminal crash** — Welcome screen now gracefully skips rendering on terminals < 44 columns wide
- **Editor crash on very narrow terminals** — Falls back to original render when width < 10
- **Streaming footer crash** — Truncation now properly handles edge cases and won't render content that exceeds terminal width
- **Secondary widget crash** — Content width is now validated before rendering
- **Layout cache invalidation** — Cache now properly clears when preset changes or powerline is toggled off

## [0.2.11] - 2026-01-26

### Changed
- Added `pi` manifest to package.json for pi v0.50.0 package system compliance
- Added `pi-package` keyword for npm discoverability

## [0.2.10] - 2026-01-17

### Fixed
- Welcome overlay now properly dismisses for `p "command"` case by:
  - Adding `tool_call` event listener (fires before stream_start)
  - Checking `isStreaming` flag when overlay is about to show
  - Checking session for existing activity (assistant messages, tool calls)
- Refactored dismissal logic into `dismissWelcome()` helper

## [0.2.9] - 2026-01-17

### Fixed
- Welcome overlay/header now dismisses when agent starts streaming (fixes `p "command"` case where welcome would briefly flash)
- Race condition where dismissal request could be lost due to 100ms setup delay in overlay

## [0.2.8] - 2026-01-16

### Changed
- `quietStartup: true` → shows welcome as header (dismisses on first input)
- `quietStartup: false` or not set → shows welcome as centered overlay (dismisses on key/timeout)
- Both modes use same two-column layout: logo, model info, tips, loaded counts, recent sessions
- Refactored welcome.ts to share rendering logic between header and overlay

### Fixed
- `/powerline` toggle off now clears all custom UI (editor, footer, header)

## [0.2.6] - 2026-01-16

### Fixed
- Removed invalid `?` keyboard shortcut tip, replaced with `Shift+Tab` for cycling thinking level

## [0.2.5] - 2026-01-16

### Added
- **Welcome overlay** — Branded "pi agent" splash screen shown as centered overlay on startup
- Two-column boxed layout with gradient PI logo (magenta → cyan)
- Shows current model name and provider
- Keyboard tips section (?, /, !)
- Loaded counts: context files (AGENTS.md), extensions, skills, and prompt templates
- Recent sessions list (up to 3, with time ago)
- Auto-dismisses after 30 seconds or on any key press
- Version now reads from package.json instead of being hardcoded
- Context file discovery now checks `.claude/AGENTS.md` paths (matching pi-mono)

## [0.2.4] - 2026-01-15

### Fixed
- Compatible with pi-tui 0.47.0 breaking change: CustomEditor constructor now requires `tui` as first argument

## [0.2.3] - 2026-01-15

### Fixed
- npm bin entry now works correctly with `npx pi-powerline-footer`

## [0.2.2] - 2026-01-15

### Changed
- **Path segment defaults to basename** — Shows just the directory name (e.g., `powerline-footer`) instead of full path to save space
- **New path modes** — `basename` (default), `abbreviated` (truncated full path), `full` (complete path)
- Simplified path options: replaced `abbreviate`, `stripWorkPrefix` with cleaner `mode` option
- Full/nerd presets use `abbreviated` mode, default/minimal/compact use `basename`
- Thinking segment now uses dedicated gradient colors (thinkingOff → thinkingMedium)

### Fixed
- Path basename extraction now uses `path.basename()` for Windows compatibility
- Git branch cache now stores `null` results, preventing repeated git calls in non-git directories
- Git status cache now stores empty results for non-git directories (was also spawning repeatedly)
- Removed dead `footerDispose` variable (cleanup handled by pi internally)

## [0.2.1] - 2026-01-10

### Added
- **Live git branch updates** — Branch now updates in real-time when switching via `git checkout`, `git switch`, etc.
- **Own branch fetching** — Extension fetches branch directly via `git branch --show-current` instead of relying solely on FooterDataProvider
- **Branch cache with 500ms TTL** — Faster refresh cycle for branch changes
- **Staggered re-renders for escape commands** — Multiple re-renders at 100/300/500ms to catch updates from `!` commands

### Fixed
- Git branch not updating after `git checkout` to existing branches
- Race condition where FooterDataProvider's branch cache wasn't updating in time

## [0.2.0] - 2026-01-10

### Added
- **Extension statuses segment** — Displays status text from other extensions (e.g., rewind checkpoint count)
- **Thinking level segment** — Live-updating display of current thinking level (`thinking:off`, `thinking:med`, etc.)
- **Rainbow effect** — High and xhigh thinking levels display with rainbow gradient inspired by Claude Code's ultrathink
- **Color gradient** — Thinking levels use progressive colors: gray → purple-gray → blue → teal → rainbow
- **Streaming visibility** — Status bar now renders in footer during streaming so it's always visible

### Changed
- Extension statuses appear at end of status bar (last item in default/full/nerd presets)
- Default preset now includes `thinking` segment after model
- Thinking level reads from session branch entries for live updates
- Footer invalidate() now triggers re-render for settings changes
- Responsive truncation — progressively removes segments on narrow windows instead of hiding status

### Fixed
- ANSI color reset after status content to prevent color bleeding
- ANSI color reset after rainbow text

### Removed
- Unused brain icon definitions

## [0.1.0] - 2026-01-10

### Added
- Initial release
- Rounded box design rendering in editor top border
- 18 segment types: pi, model, thinking, path, git, subagents, token_in, token_out, token_total, cost, context_pct, context_total, time_spent, time, session, hostname, cache_read, cache_write
- 6 presets: default, minimal, compact, full, nerd, ascii
- 10 separator styles: powerline, powerline-thin, slash, pipe, dot, chevron, star, block, none, ascii
- Git integration with async status fetching and 1s cache TTL
- Nerd Font auto-detection for common terminals
- oh-my-pi dark theme color matching
- Context percentage warnings at 70%/90%
- Auto-compact indicator
- Subscription detection
