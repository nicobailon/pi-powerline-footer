# pi-powerline-footer

本仓库是 [Thurston Sandberg](https://github.com/thurstonsand) 发布的 fork 版本。发布包：`@thurstonsand/pi-powerline-footer`。Fork 自 [nicobailon/pi-powerline-footer](https://github.com/nicobailon/pi-powerline-footer)。

为 [Pi](https://github.com/badlogic/pi-mono) 默认编辑器提供 Powerline 风格的状态栏、欢迎覆盖层以及 AI 生成的"氛围"加载消息。灵感来源于 [Powerlevel10k](https://github.com/romkatv/powerlevel10k) 和 [oh-my-pi](https://github.com/can1357/oh-my-pi)。

## 功能特性

**编辑器暂存 (Editor stash)** — 按 `Alt+S` 保存编辑器内容并清空编辑器，输入快速提示后，暂存的文本会在代理完成后自动恢复。可在暂存、恢复和更新已有暂存之间切换。有文本暂存时，状态栏会显示 `stash` 指示器。

**工作氛围 (Working Vibes)** — AI 生成的主题加载消息。设置 `/vibe star trek`，你的"Working..."就会变成"Running diagnostics..."或"Engaging warp drive..."。支持任意主题：海盗、禅意、黑色电影、牛仔等。

**欢迎覆盖层** — 启动时以居中覆盖层形式显示品牌启动画面。展示渐变 Logo、模型信息、键盘提示、已加载的 AGENTS.md/扩展/技能/模板数量以及最近的会话记录。30 秒后或按任意键自动消失。

**圆角框设计** — 状态信息直接渲染在编辑器顶部边框内，而非作为独立的页脚栏。

**固定编辑器布局** — 在交互式 TUI 会话中，聊天/信息流内容在 Pi 工作/状态行、powerline 行、编辑器、幽灵建议、bash 转录区和最后提示/状态行上方滚动。可用鼠标滚轮、PageUp/PageDown、Command+PageUp/PageDown、Ctrl+Shift+Up/Down 或消息跳转快捷键滚动聊天内容；编辑器保持不动。拖拽文本可复制，拖拽选区到视口边缘可滚动，双击行可选中，右键可打开终端菜单。使用 `/powerline fixed-editor off` 切换回 Pi 的常规滚动布局，或 `/powerline mouse-scroll off` 使用原生终端选择。

**实时思考级别指示器** — 显示当前思考级别（`think:off`、`think:med` 等），每个级别有对应颜色。high 和 xhigh 级别采用灵感来自 Claude Code ultrathink 的彩虹效果。

**智能默认值** — 自动检测 iTerm、WezTerm、Kitty、Ghostty 和 Alacritty 中的 Nerd Font，不支持时回退为 ASCII。颜色匹配 oh-my-pi 的暗色主题。

**Git 集成** — 异步状态获取，1 秒缓存 TTL。文件写入/编辑时自动失效。显示分支、已暂存 (+)、未暂存 (\*) 和未跟踪 (?) 数量。

**上下文感知** — 上下文使用率达到 70%（黄色）和 90%（红色）时显示颜色编码警告。流式传输期间，上下文段从实时助手使用量刷新，而不是等待下一轮。启用自动压缩时有指示器。如果安装了 `pi-custom-compaction` 并启用，powerline 会自动隐藏原生上下文段，避免页脚显示过时的摘要后使用量。

**Token 智能显示** — 智能格式化（1.2k、45M），订阅检测（显示 "(sub)" 而非美元费用）。

**固定 Bash 模式** — 使用 `ctrl+shift+b` 或 `/bash-mode` 切换 bash 模式。为当前 pi 会话保持一个托管 shell 会话，显示专用的 `shell_mode` 段，将命令输出流式显示在编辑器下方的嵌入式转录区，并让 `cd` 或导出的状态在命令间持久化。

**Shell 幽灵建议** — Bash 模式现在优先使用幽灵建议。成功的项目级 shell 历史记录是主要来源，而确定性的路径和 git 补全仍可扩展现有命令。Shell 原生补全探测已禁用，因此 `!command` 预测永远不会触发交互式 shell 补全子进程。在命令位置，短前缀首先从最新的成功本地命令中匹配，可使用受保护的历史记录来匹配高置信度的命令头如 `git`，最后在历史记录为空时回退到少量精选默认值。目前精选集合为 `g` → `git status` 和 `c` → `cd ..`。如果 bash 提示符为空，bash 模式会在存在最近的項目历史幽灵建议时立即显示，否则保持空白。同样的内联预测现在也会在一次性 `!command` 和 `!!command` 提示中生效。右箭头或 Tab 接受幽灵文本到编辑器，Enter 运行当前 shell 命令。

## 安装

```
pi install npm:@thurstonsand/pi-powerline-footer
```

重启 pi 即可激活。

## 使用方式

自动激活。使用 `/powerline` 切换，`/powerline <name>` 切换预设，`/powerline fixed-editor on|off|toggle` 控制固定编辑器模式，`/powerline mouse-scroll on|off|toggle` 控制滚轮模式。

固定编辑器默认开启。

*   `/powerline fixed-editor off` — 返回 Pi 常规滚动布局
*   `/powerline fixed-editor on` — 重新启用固定编辑器
*   `/powerline fixed-editor toggle` — 在两者之间切换

也可以在 `~/.pi/agent/settings.json` 或项目本地的 `.pi/settings.json` 中设置：

```json
{
  "powerline": {
    "preset": "default",
    "fixedEditor": false
  }
}
```

使用 `"fixedEditor": true` 重新启用。如果希望原生终端选择而非固定编辑器鼠标处理，添加 `"mouseScroll": false`。

| 预设名称 | 描述 |
| --- | --- |
| `default` | 模型、思考、路径（基名）、Git、上下文、Token、费用 |
| `minimal` | 仅路径（基名）、Git、上下文 |
| `compact` | 模型、Git、费用、上下文 |
| `full` | 全部信息，包括主机名、时间、缩写路径 |
| `nerd` | 为 Nerd Font 用户提供最大细节 |
| `ascii` | 适用于任何终端的安全模式 |

**环境变量：** `POWERLINE_NERD_FONTS=1` 强制使用 Nerd Font，`=0` 使用 ASCII。

预设选择保存到 `~/.pi/agent/settings.json` 的 `powerline` 下，启动时恢复。运行 `/powerline default` 切换回默认预设。

### 从扩展状态添加自定义项

你可以将任何扩展状态键提升为其专属的 powerline 项。这为注册自己的状态项提供了通用方式，无需修改此扩展。

1.  任何扩展都可以通过 `ctx.ui.setStatus("my-key", "...value...")` 发布状态文本。
2.  配置 `powerline.customItems` 将这些键放置到左侧、右侧或副行。

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

`customItems` 字段说明：

*   `id`（必填）：唯一项 ID（`a-z`、`A-Z`、`0-9`、`_`、`-`）
*   `statusKey`（可选）：要读取的扩展状态键，默认为 `id`
*   `position`（可选）：`left`、`right` 或 `secondary`（默认 `right`）
*   `prefix`（可选）：在实时状态值前显示的文本
*   `color`（可选）：任意 Pi 主题颜色（`warning`、`accent` 等）或十六进制颜色（`#RRGGBB`）
*   `hideWhenMissing`（可选）：无状态存在时隐藏该项（默认 `true`）
*   `excludeFromExtensionStatuses`（可选）：从聚合的 `extension_statuses` 段中省略此键（默认 `true`）

### 自定义预设布局

使用 `"preset": "custom"` 定义显式行布局，而非按位置追加 `customItems`：

```json
{
  "powerline": {
    "preset": "custom",
    "custom": {
      "separator": "powerline-thin",
      "leftSegments": ["custom:model_display", "path", "git"],
      "rightSegments": ["custom:context_gauge"],
      "secondarySegments": []
    },
    "customItems": [
      { "id": "model_display" },
      { "id": "context_gauge" }
    ]
  }
}
```

`leftSegments`、`rightSegments` 和 `secondarySegments` 接受下文列出的内置段 ID 以及配置的自定义项的 `custom:<id>` 条目。使用 `preset: "custom"` 时，自定义项的 `position` 将被忽略。使用顶层 `powerline.path`、`powerline.git`、`powerline.model` 和 `powerline.time` 设置来配置内置段的选项。

如果你偏好旧风格，`"powerline": "default"` 仍然有效。

## Bash 模式

使用以下方式切换 bash 模式：

*   `ctrl+shift+b`
*   `/bash-mode on`
*   `/bash-mode off`
*   `/bash-mode toggle`

使用 `/bash-reset` 重置托管 shell。

Bash 模式激活时：

*   Enter 运行当前 shell 命令
*   右箭头将幽灵文本接受到编辑器中（不运行）
*   Tab 在有幽灵建议时接受当前建议；否则无操作
*   上和下箭头浏览匹配的 shell 历史记录
*   `escape` 退出 bash 模式并返回普通提示模式
*   `ctrl+c` 在回退到普通 pi 行为之前中断活跃的 shell 任务

托管 shell 在当前 pi 会话中持久化。命令输出显示在编辑器下方的转录区中，shell 工作目录的更改会反映在页脚路径和 `shell_mode` 段中。如果 bash 提示符为空，bash 模式会在存在最近的項目历史幽灵建议时立即显示，包括模式进入后或提示符再次清空后。一次性 `!command` 和 `!!command` 提示复用相同的 shell 预测管道，包括幽灵文本。模式进入保持安静：没有自动或手动的下拉补全面板，幽灵建议不会运行 shell 原生补全探测。

### Bash 模式配置

在 `~/.pi/agent/settings.json` 中：

```json
{
  "bashMode": {
    "toggleShortcut": "ctrl+shift+b",
    "transcriptMaxLines": 2000,
    "transcriptMaxBytes": 524288
  }
}
```

## 编辑器暂存 (Editor Stash)

在编辑草稿时使用 `Alt+S` / `Option+S` 作为快速暂存切换。它维护一个活跃暂存，并在暂存时清空编辑器。

| 编辑器状态 | 暂存状态 | `Alt+S` 结果 |
| --- | --- | --- |
| 有文本 | 空 | 暂存当前文本，清空编辑器 |
| 空 | 有暂存 | 恢复暂存到编辑器 |
| 有文本 | 有暂存 | 用当前文本更新暂存，清空编辑器 |
| 空 | 空 | 显示"没有可暂存的内容" |

代理运行后的自动恢复仅在编辑器仍为空时触发。如果你在此期间输入了内容，暂存会被保留。

`stash` 指示器显示在 powerline 栏中（在包含 `extension_statuses` 的预设上）。活跃暂存仍然局限于当前会话，在会话切换/禁用时重置，但暂存历史记录会持久化到 `~/.pi/agent/powerline-footer/stash-history.json`，以便在重启后保留。

### 暂存历史

使用以下方式打开提示历史：

*   `ctrl+alt+h`
*   `/stash-history`

提示历史现在有两个来源：

*   已暂存的提示 — 最多 12 条最近的暂存提示（最新在前）
*   最近的项目提示 — 最多 50 条从当前项目文件夹的 pi 会话中提取的最近用户提交的提示

选择一个条目将其插入到编辑器中。如果编辑器已有文本，可以选择 `替换 (Replace)`、`追加 (Append)` 或 `取消 (Cancel)`。

### 编辑器剪贴板和聊天快捷键

*   `ctrl+alt+c` — 复制编辑器全部内容
*   `ctrl+alt+x` — 剪切编辑器全部内容（先复制，再清空）
*   `cmd+up` — 固定编辑器聊天视口向上滚动
*   `cmd+down` — 固定编辑器聊天视口向下滚动
*   `cmd+shift+up` — 将编辑器光标移动到第一行开头
*   `cmd+shift+down` — 将编辑器光标移动到最后一行末尾
*   `ctrl+shift+u` — 固定编辑器聊天视口跳转到上一条用户消息
*   `ctrl+shift+i` — 固定编辑器聊天视口跳转到下一条用户消息
*   `ctrl+alt+,` — 固定编辑器聊天视口跳转到上一条 LLM 消息
*   `ctrl+alt+.` — 固定编辑器聊天视口跳转到下一条 LLM 消息
*   `ctrl+shift+g` — 固定编辑器聊天视口跳转到底部

复制/剪切操作不会修改暂存状态或暂存历史记录。从文件管理器拖拽文件、文件夹、图片或截图到自定义编辑器会插入其路径字符串。聊天跳转需要固定编辑器模式，因为它们使用其应用拥有的滚动视口。提交编辑器文本也会将视口返回到底部，以便新输出保持可见。

### 快捷键配置

你可以在 `~/.pi/agent/settings.json` 中覆盖快捷键：

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

修改绑定后，运行 `/reload`。无效的绑定、与保留键冲突（如 `Alt+S`）或重复冲突会自动回退到安全默认值。`cmd` 和 `command` 被接受为 Pi 的 `super` 修饰键的别名（用于已记录的 Command 导航键）；不支持的 Command+字母组合（如 `cmd+c`）会被忽略，而不是匹配为纯文本输入。某些终端（包括 Ghostty）自身会绑定 Command+箭头键；如果你希望 Pi 接收这些按键，请将这些终端键重新映射为发送 `\x1b[1;9A` / `\x1b[1;9B`（用于聊天滚动）和 `\x1b[1;10A` / `\x1b[1;10B`（用于编辑器边界导航）。

## 工作氛围 (Working Vibes)

将枯燥的 "Working..." 消息转换为主题短语，匹配你的风格：

```
/vibe star trek    → "Running diagnostics...", "Engaging warp drive..."
/vibe pirate       → "Hoisting the sails...", "Charting course..."
/vibe zen          → "Breathing deeply...", "Finding balance..."
/vibe noir         → "Following the trail...", "Checking the angles..."
/vibe              → 显示当前主题、模式和模型
/vibe off          → 禁用（恢复为 "Working..."）
/vibe model        → 显示当前模型
/vibe model openai/gpt-4o-mini → 使用不同的模型
/vibe mode         → 显示当前模式（generate 或 file）
/vibe mode file    → 切换到基于文件的模式（即时生成，无 API 调用）
/vibe mode generate → 切换到按需生成模式（上下文相关）
/vibe generate mafia 200 → 预生成 200 条氛围消息并保存到文件
```

### 配置

在 `~/.pi/agent/settings.json` 中：

```json
{
  "workingVibe": "star trek",                              // 主题短语
  "workingVibeMode": "generate",                           // "generate"（按需）或 "file"（预生成）
  "workingVibeModel": "openai-codex/gpt-5.4-mini",         // 可选：使用的模型（默认）
  "workingVibeFallback": "Working",                        // 可选：回退消息
  "workingVibeRefreshInterval": 30,                        // 可选：刷新间隔秒数（默认 30）
  "workingVibePrompt": "Generate a {theme} loading message for: {task}",  // 可选：自定义提示模板
  "workingVibeMaxLength": 65                               // 可选：最大消息长度（默认 65）
}
```

### 模式

| 模式 | 描述 | 优点 | 缺点 |
| --- | --- | --- | --- |
| `generate` | 按需 AI 生成（默认） | 上下文相关，暗示实际任务 | 模型相关的费用和延迟 |
| `file` | 从预生成文件中读取 | 即时、零成本、可离线工作 | 不具上下文相关性 |

**文件模式设置：**

```
/vibe generate mafia 200    # 生成 200 条氛围消息，保存到 ~/.pi/agent/vibes/mafia.txt
/vibe mode file             # 切换到文件模式
/vibe mafia                 # 现在使用该文件
```

**文件模式工作原理：**

1.  从 `~/.pi/agent/vibes/{theme}.txt` 将氛围消息加载到内存
2.  使用种子洗牌算法（Mulberry32 PRNG）—— 在重复之前循环遍历所有氛围消息
3.  每次会话使用新种子—— 每次重启 pi 时顺序不同
4.  零延迟、零成本、可离线工作

**提示模板变量（仅 generate 模式）：**

*   `{theme}` — 当前的氛围主题（如 "star trek"、"mafia"）
*   `{task}` — 上下文提示（初始为用户提示，后续为代理的回复文本或工具信息）
*   `{exclude}` — 最近使用过应避免的氛围消息（自动填充，如 "Don't use: vibe1, vibe2..."）

**工作原理：**

1.  当你发送消息时，显示 "Channeling {theme}..." 占位符
2.  AI 在后台生成主题消息（3 秒超时）
3.  消息更新为主题版本（如 "Engaging warp drive..."）
4.  在长时间任务中，通过工具调用刷新（速率限制，默认 30 秒）
5.  费用和延迟取决于你配置的 `workingVibeModel`

## 思考级别显示

思考段在更改思考级别时实时更新：

| 级别 | 显示 | 颜色 |
| --- | --- | --- |
| off | `think:off` | 灰色 |
| minimal | `think:min` | 紫灰色 |
| low | `think:low` | 蓝色 |
| medium | `think:med` | 青色 |
| high | `think:high` | 彩虹色 |
| xhigh | `think:xhigh` | 彩虹色 |

## 路径显示

路径段支持三种模式：

| 模式 | 示例 | 描述 |
| --- | --- | --- |
| `basename` | `powerline-footer` | 仅目录名（默认） |
| `abbreviated` | `…/extensions/powerline-footer` | 完整路径，主目录缩写并有长度限制 |
| `full` | `~/.pi/agent/extensions/powerline-footer` | 完整路径，主目录缩写 |

通过预设选项配置：`path: { mode: "full" }`

## Git 轮询

默认情况下，Git 段同时轮询分支和脏状态。如果后台 `git status --porcelain` 调用干扰了你的工作流，请使用仅分支轮询：

```json
{
  "powerline": {
    "git": { "polling": "branch" }
  }
}
```

使用 `"off"` 可完全禁用扩展拥有的 Git 轮询，仅在可用时显示 Pi 报告的分支。

## 段 (Segments)

`model` · `thinking` · `shell_mode` · `path` · `git` · `subagents` · `token_in` · `token_out` · `token_total` · `cost` · `context_pct` · `context_total` · `time_spent` · `time` · `session` · `hostname` · `cache_read` · `cache_write`

自定义预设布局也可以使用配置自定义项的 `custom:<id>` 条目。

## 分隔符 (Separators)

`powerline` · `powerline-thin` · `slash` · `pipe` · `dot` · `chevron` · `star` · `block` · `none` · `ascii`

## 主题

颜色可通过 Pi 的主题系统进行配置。每个预设定义自己的配色方案，你可以使用扩展目录中的 `theme.json` 文件覆盖各个颜色和图标。

### 默认颜色

| 语义 | 主题颜色 | 描述 |
| --- | --- | --- |
| `model` | `#d787af` | 模型名称 |
| `shellMode` | `accent` | Bash 模式段 |
| `path` | `#00afaf` | 目录路径 |
| `gitClean` | `success` | Git 分支（干净） |
| `gitDirty` | `warning` | Git 分支（脏） |
| `thinking` | `thinkingOff` | 思考级别（`off`） |
| `thinkingMinimal` | `thinkingMinimal` | 思考级别（`minimal`） |
| `thinkingLow` | `thinkingLow` | 思考级别（`low`） |
| `thinkingMedium` | `thinkingMedium` | 思考级别（`medium`） |
| `context` | `dim` | 上下文使用量 |
| `contextWarn` | `warning` | 上下文使用量 >70% |
| `contextError` | `error` | 上下文使用量 >90% |
| `cost` | `text` | 费用显示 |
| `tokens` | `muted` | Token 计数 |

### 自定义主题覆盖

创建 `~/.pi/agent/extensions/powerline-footer/theme.json`：

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

颜色可以是：

*   **主题颜色名称**：`accent`、`muted`、`dim`、`text`、`success`、`warning`、`error`、`border`、`borderAccent`、`borderMuted`
*   **十六进制颜色**：`#ff5500`、`#d787af`

图标可以是任意字符串，包括 `""`（当你想完全隐藏某个特定字形时）。

更多可用选项参见 `theme.example.json`。

---

*由 DeepSeek V4 Pro 翻译*
