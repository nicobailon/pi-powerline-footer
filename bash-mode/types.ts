export interface BashModeSettings {
  toggleShortcut: string | null;
  completions: boolean;
  transcriptMaxLines: number;
  transcriptMaxBytes: number;
}

export interface BashCommandRecord {
  id: string;
  command: string;
  startedAt: number;
  cwdAtStart: string;
  output: string[];
  outputBytes: number;
  exitCode: number | null;
  finishedAt: number | null;
  truncated: boolean;
}

export interface BashTranscriptSnapshot {
  commands: BashCommandRecord[];
  totalLines: number;
  totalBytes: number;
  truncatedCommands: number;
}

export interface GhostSuggestion {
  value: string;
  source:
    | "project-history"
    | "global-history"
    | "git"
    | "path"
    | "executable";
}

export interface ExtendedCompletionItem {
  value: string;
  label: string;
  description?: string;
  replacement: string;
  startCol: number;
  endCol: number;
  source:
    | "project-history"
    | "global-history"
    | "git"
    | "path"
    | "executable";
  score: number;
}

export interface ShellSessionState {
  ready: boolean;
  running: boolean;
  shellPath: string;
  shellName: string;
  cwd: string;
  lastExitCode: number | null;
}
