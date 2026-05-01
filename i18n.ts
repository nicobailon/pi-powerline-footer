import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

type Params = Record<string, string | number>;
type Translate = (key: string, fallback: string, params?: Params) => string;

let translate: Translate = (_key, fallback, params) => format(fallback, params);

function format(text: string, params?: Params): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (_match, key: string) => String(params[key] ?? `{${key}}`));
}

export function t(key: string, fallback: string, params?: Params): string {
  return translate(key, fallback, params);
}

const bundles = [
  {
    locale: "ja",
    namespace: "pi-powerline-footer",
    messages: {
      "bash.alreadyRunning": "シェルコマンドはすでに実行中です",
      "bash.noHistoryMatches": "一致するシェル履歴がありません",
      "bash.failedRun": "シェルコマンドの実行に失敗しました: {message}",
      "bash.waitBeforeExit": "bash mode を終了する前に、現在のシェルコマンドの完了を待ってください",
      "bash.enabled": "Bash mode が有効です ({shell})",
      "bash.failedStart": "シェルセッションの開始に失敗しました: {message}",
      "bash.disabled": "Bash mode が無効です",
      "bash.usage": "使用方法: /bash-mode [on|off|toggle]",
      "bash.failedRestart": "シェルセッションの再起動に失敗しました: {message}",
      "bash.reset": "Bash セッションをリセットしました",
      "powerline.description": "powerline ステータスを設定 (toggle, preset)",
      "powerline.enabled": "Powerline が有効です",
      "powerline.disabled": "Powerline が無効です",
      "powerline.preset": "プリセットを設定しました: {preset}",
      "powerline.presetNotPersisted": "プリセットを設定しました: {preset} (保存されていません。settings.json を確認してください)",
      "powerline.availablePresets": "利用可能なプリセット: {presets}",
      "powerline.disabledStatus": "Powerline は無効です",
      "stash.editorEmpty": "エディタは空です",
      "stash.inserted": "プロンプトを挿入しました",
      "stash.replaced": "エディタをプロンプトで置き換えました",
      "stash.appended": "プロンプトを追加しました",
      "stash.nothing": "stash する内容がありません",
      "stash.restored": "Stash を復元しました",
      "stash.updated": "Stash を更新しました",
      "stash.textStashed": "テキストを stash しました",
      "stash.failedLoadPrompts": "プロジェクトプロンプトの読み込みに失敗しました: {message}",
      "stash.noHistory": "プロンプト履歴はまだありません",
      "stash.preserved": "Stash を保持しました — エディタを空にしてから Alt+S で復元してください",
      "editor.cut": "エディタテキストを切り取りました"
    }
  },
  {
    locale: "zh-CN",
    namespace: "pi-powerline-footer",
    messages: {
      "bash.alreadyRunning": "Shell 命令已在运行",
      "bash.noHistoryMatches": "没有匹配的 shell 历史",
      "bash.failedRun": "运行 shell 命令失败: {message}",
      "bash.waitBeforeExit": "离开 bash mode 前，请等待当前 shell 命令完成",
      "bash.enabled": "Bash mode 已启用 ({shell})",
      "bash.failedStart": "启动 shell 会话失败: {message}",
      "bash.disabled": "Bash mode 已关闭",
      "bash.usage": "用法: /bash-mode [on|off|toggle]",
      "bash.failedRestart": "重启 shell 会话失败: {message}",
      "bash.reset": "Bash 会话已重置",
      "powerline.description": "配置 powerline 状态栏 (toggle, preset)",
      "powerline.enabled": "Powerline 已启用",
      "powerline.disabled": "Powerline 已关闭",
      "powerline.preset": "Preset 已设置为: {preset}",
      "powerline.presetNotPersisted": "Preset 已设置为: {preset}（未持久化；请检查 settings.json）",
      "powerline.availablePresets": "可用 preset: {presets}",
      "powerline.disabledStatus": "Powerline 已关闭",
      "stash.editorEmpty": "编辑器为空",
      "stash.inserted": "已插入 prompt",
      "stash.replaced": "已用 prompt 替换编辑器内容",
      "stash.appended": "已追加 prompt",
      "stash.nothing": "没有可 stash 的内容",
      "stash.restored": "Stash 已恢复",
      "stash.updated": "Stash 已更新",
      "stash.textStashed": "文本已 stash",
      "stash.failedLoadPrompts": "加载项目 prompts 失败: {message}",
      "stash.noHistory": "还没有 prompt 历史",
      "stash.preserved": "Stash 已保留 — 清空编辑器后按 Alt+S 恢复",
      "editor.cut": "已剪切编辑器文本"
    }
  },
  {
    locale: "de",
    namespace: "pi-powerline-footer",
    messages: {
      "bash.alreadyRunning": "Shell-Befehl läuft bereits",
      "bash.noHistoryMatches": "Keine passenden Shell-Verläufe",
      "bash.failedRun": "Shell-Befehl fehlgeschlagen: {message}",
      "bash.waitBeforeExit": "Warte, bis der aktuelle Shell-Befehl fertig ist, bevor du bash mode verlässt",
      "bash.enabled": "Bash mode aktiviert ({shell})",
      "bash.failedStart": "Shell-Sitzung konnte nicht gestartet werden: {message}",
      "bash.disabled": "Bash mode deaktiviert",
      "bash.usage": "Verwendung: /bash-mode [on|off|toggle]",
      "bash.failedRestart": "Shell-Sitzung konnte nicht neu gestartet werden: {message}",
      "bash.reset": "Bash-Sitzung zurückgesetzt",
      "powerline.description": "Powerline-Status konfigurieren (toggle, preset)",
      "powerline.enabled": "Powerline aktiviert",
      "powerline.disabled": "Powerline deaktiviert",
      "powerline.preset": "Preset gesetzt auf: {preset}",
      "powerline.presetNotPersisted": "Preset gesetzt auf: {preset} (nicht gespeichert; settings.json prüfen)",
      "powerline.availablePresets": "Verfügbare Presets: {presets}",
      "powerline.disabledStatus": "Powerline ist deaktiviert",
      "stash.editorEmpty": "Editor ist leer",
      "stash.inserted": "Prompt eingefügt",
      "stash.replaced": "Editor durch Prompt ersetzt",
      "stash.appended": "Prompt angehängt",
      "stash.nothing": "Nichts zu stashen",
      "stash.restored": "Stash wiederhergestellt",
      "stash.updated": "Stash aktualisiert",
      "stash.textStashed": "Text gestasht",
      "stash.failedLoadPrompts": "Projekt-Prompts konnten nicht geladen werden: {message}",
      "stash.noHistory": "Noch kein Prompt-Verlauf",
      "stash.preserved": "Stash behalten — Editor leeren, dann Alt+S zum Wiederherstellen",
      "editor.cut": "Editor-Text ausgeschnitten"
    }
  }
];

export function initI18n(pi: ExtensionAPI): void {
  const events = pi.events;
  if (!events) return;
  for (const bundle of bundles) events.emit("pi-core/i18n/registerBundle", bundle);
  events.emit("pi-core/i18n/requestApi", {
    namespace: "pi-powerline-footer",
    callback(api: { t?: Translate } | undefined) {
      if (typeof api?.t === "function") translate = api.t;
    }
  });
}
