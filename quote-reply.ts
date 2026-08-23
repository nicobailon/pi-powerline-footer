import type { ExtensionContext, SessionEntry, Theme } from "@earendil-works/pi-coding-agent";
import { decodeKittyPrintable, fuzzyFilter, Key, matchesKey, truncateToWidth, visibleWidth, type Component, type OverlayHandle } from "@earendil-works/pi-tui";

type QuoteRole = "assistant" | "user";

interface QuoteCandidate {
  id: string;
  role: QuoteRole;
  text: string;
  timestampMs: number;
  searchText: string;
}

const MAX_QUOTE_CHARS = 6_000;
const MAX_EXCERPT_CHARS = 220;
const MAX_VISIBLE_ITEMS = 8;
const MAX_RPC_OPTIONS = 80;
const MAX_CANDIDATES = 200;
const MAX_SEARCH_TEXT_CHARS = 1_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((block) => (isRecord(block) && block.type === "text" && typeof block.text === "string" ? [block.text] : []))
    .join("\n\n");
}

function timestampMs(entry: SessionEntry, fallback: unknown): number {
  if (typeof fallback === "number" && Number.isFinite(fallback)) return fallback;
  const parsed = Date.parse(entry.timestamp);
  return Number.isNaN(parsed) ? Date.now() : parsed;
}

function buildCandidate(entry: SessionEntry): QuoteCandidate | undefined {
  if (entry.type !== "message") return undefined;
  const { message } = entry;
  if (message.role !== "assistant" && message.role !== "user") return undefined;

  const id = entry.id.trim();
  if (!id) throw new Error("Session entry id must not be empty.");

  const text = contentText(message.content).trim();
  if (!text) return undefined;

  const role = message.role;
  return {
    id,
    role,
    text,
    timestampMs: timestampMs(entry, message.timestamp),
    searchText: `${id} ${role} ${text}`.slice(0, MAX_SEARCH_TEXT_CHARS).toLowerCase(),
  };
}

function collectCandidates(ctx: ExtensionContext): QuoteCandidate[] {
  const candidates: QuoteCandidate[] = [];
  const branch = ctx.sessionManager.getBranch();
  for (let index = branch.length - 1; index >= 0 && candidates.length < MAX_CANDIDATES; index--) {
    const candidate = buildCandidate(branch[index]);
    if (candidate) candidates.push(candidate);
  }
  return candidates;
}

function sameLocalDate(date: Date, other: Date): boolean {
  return date.getFullYear() === other.getFullYear() && date.getMonth() === other.getMonth() && date.getDate() === other.getDate();
}

function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return sameLocalDate(date, now) ? time : `${date.toLocaleDateString()} ${time}`;
}

function excerpt(text: string, maxChars = MAX_EXCERPT_CHARS): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= maxChars) return compact;
  return `${compact.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function formatQuote(candidate: QuoteCandidate): string {
  const truncated = candidate.text.length > MAX_QUOTE_CHARS;
  const quoteText = truncated ? candidate.text.slice(0, MAX_QUOTE_CHARS).trimEnd() : candidate.text;
  const lines = [
    `Quoted previous ${candidate.role} message ${candidate.id} for reference only:`,
    "",
    quoteText.split(/\r?\n/).map((line) => (line ? `> ${line}` : ">")).join("\n"),
  ];
  if (truncated) lines.push("", `> [Quote truncated from ${candidate.text.length.toLocaleString()} characters.]`);
  lines.push("", "My reply:", "");
  return lines.join("\n");
}

function insertQuote(ctx: ExtensionContext, candidate: QuoteCandidate): void {
  ctx.ui.setEditorText(`${formatQuote(candidate)}${ctx.ui.getEditorText()}`);
  ctx.ui.notify(`Inserted quote from ${candidate.role} message ${candidate.id}.`, "info");
}

function printableInput(data: string): string | undefined {
  const kittyPrintable = decodeKittyPrintable(data);
  if (kittyPrintable !== undefined) return kittyPrintable;
  if (!data) return undefined;
  return [...data].some((char) => {
    const code = char.charCodeAt(0);
    return code < 32 || code === 0x7f || (code >= 0x80 && code <= 0x9f);
  }) ? undefined : data;
}

function filterCandidates(candidates: QuoteCandidate[], query: string): QuoteCandidate[] {
  const trimmed = query.trim();
  return trimmed ? fuzzyFilter(candidates, trimmed, (candidate) => candidate.searchText) : candidates;
}

class QuotePicker implements Component {
  private query = "";
  private selectedIndex = 0;
  private readonly candidates: QuoteCandidate[];
  private readonly theme: Theme;
  private readonly onSelect: (candidate: QuoteCandidate) => void;
  private readonly onCancel: () => void;

  constructor(candidates: QuoteCandidate[], theme: Theme, onSelect: (candidate: QuoteCandidate) => void, onCancel: () => void) {
    this.candidates = candidates;
    this.theme = theme;
    this.onSelect = onSelect;
    this.onCancel = onCancel;
  }

  render(width: number): string[] {
    const innerWidth = Math.max(0, width - 2);
    const filtered = filterCandidates(this.candidates, this.query);
    this.selectedIndex = filtered.length === 0 ? 0 : Math.min(this.selectedIndex, filtered.length - 1);
    const lines = [this.topBorder(innerWidth, " Reply "), this.emptyRow(innerWidth), this.row(innerWidth, this.searchLine()), this.emptyRow(innerWidth), this.divider(innerWidth)];

    if (filtered.length === 0) {
      lines.push(this.emptyRow(innerWidth), this.row(innerWidth, this.theme.fg("warning", this.theme.italic("No matching messages"))), this.emptyRow(innerWidth));
    } else {
      lines.push(this.emptyRow(innerWidth));
      const start = Math.max(0, Math.min(this.selectedIndex - Math.floor(MAX_VISIBLE_ITEMS / 2), filtered.length - MAX_VISIBLE_ITEMS));
      for (const [offset, candidate] of filtered.slice(start, start + MAX_VISIBLE_ITEMS).entries()) {
        lines.push(this.row(innerWidth, this.renderCandidate(innerWidth, candidate, start + offset === this.selectedIndex)));
      }
      lines.push(this.emptyRow(innerWidth));
      if (filtered.length > MAX_VISIBLE_ITEMS) lines.push(this.row(innerWidth, this.scrollIndicator(filtered.length)), this.emptyRow(innerWidth));
    }

    lines.push(this.divider(innerWidth), this.emptyRow(innerWidth), this.row(innerWidth, this.help()), this.bottomBorder(innerWidth));
    return lines;
  }

  handleInput(data: string): void {
    const filtered = filterCandidates(this.candidates, this.query);
    if (matchesKey(data, Key.up)) {
      this.selectedIndex = filtered.length === 0 ? 0 : (this.selectedIndex - 1 + filtered.length) % filtered.length;
      return;
    }
    if (matchesKey(data, Key.down)) {
      this.selectedIndex = filtered.length === 0 ? 0 : (this.selectedIndex + 1) % filtered.length;
      return;
    }
    if (matchesKey(data, Key.enter)) {
      const selected = filtered[this.selectedIndex];
      if (selected) this.onSelect(selected);
      return;
    }
    if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
      this.onCancel();
      return;
    }
    if (matchesKey(data, Key.backspace)) {
      this.query = Array.from(this.query).slice(0, -1).join("");
      this.selectedIndex = 0;
      return;
    }
    if (matchesKey(data, Key.ctrl("u"))) {
      this.query = "";
      this.selectedIndex = 0;
      return;
    }
    const printable = printableInput(data);
    if (printable) {
      this.query += printable;
      this.selectedIndex = 0;
    }
  }

  invalidate(): void {}

  private searchLine(): string {
    const cursor = this.theme.fg("accent", "│");
    const icon = this.theme.fg("dim", "◎");
    const query = this.query ? `${this.query}${cursor}` : `${cursor}${this.theme.fg("dim", this.theme.italic("type to filter messages..."))}`;
    return `${icon}  ${query}`;
  }

  private renderCandidate(innerWidth: number, candidate: QuoteCandidate, selected: boolean): string {
    const prefix = selected ? this.theme.fg("accent", "▸") : this.theme.fg("borderMuted", "·");
    const role = this.theme.fg(candidate.role === "assistant" ? "accent" : "success", candidate.role);
    const meta = this.theme.fg("dim", `${candidate.id}  ${formatTimestamp(candidate.timestampMs)}`);
    const head = `${prefix} ${selected ? this.theme.bold(role) : role} ${meta}`;
    const maxExcerptWidth = Math.max(0, innerWidth - visibleWidth(head) - 8);
    const preview = maxExcerptWidth > 18 ? this.theme.fg("muted", excerpt(candidate.text, maxExcerptWidth)) : "";
    const separator = preview ? `  ${this.theme.fg("borderMuted", "—")}  ` : "";
    return selected ? this.theme.fg("accent", `${head}${separator}${preview}`) : `${head}${separator}${preview}`;
  }

  private scrollIndicator(total: number): string {
    const filled = Math.max(1, Math.round(((this.selectedIndex + 1) / total) * 10));
    const dots = Array.from({ length: 10 }, (_, index) => index < filled ? "●" : "○").map((dot, index) => index < filled ? this.theme.fg("accent", dot) : this.theme.fg("dim", dot)).join(" ");
    return `${dots}  ${this.theme.fg("dim", `${this.selectedIndex + 1}/${total}`)}`;
  }

  private topBorder(innerWidth: number, title: string): string {
    const borderLength = Math.max(0, innerWidth - visibleWidth(title));
    const left = Math.floor(borderLength / 2);
    return this.border(`╭${"─".repeat(left)}`) + this.theme.fg("dim", title) + this.border(`${"─".repeat(borderLength - left)}╮`);
  }

  private divider(innerWidth: number): string { return this.border(`├${"─".repeat(innerWidth)}┤`); }
  private bottomBorder(innerWidth: number): string { return this.border(`╰${"─".repeat(innerWidth)}╯`); }
  private emptyRow(innerWidth: number): string { return this.border("│") + " ".repeat(innerWidth) + this.border("│"); }
  private row(innerWidth: number, content: string): string { return this.border("│") + truncateToWidth(` ${content}`, innerWidth, "…", true) + this.border("│"); }
  private border(text: string): string { return this.theme.fg("borderMuted", text); }
  private help(): string { return this.theme.fg("dim", `${this.theme.italic("↑↓")} navigate  ${this.theme.italic("enter")} quote  ${this.theme.italic("esc")} cancel  ${this.theme.italic("⌫")} edit`); }
}

async function pickCandidate(ctx: ExtensionContext, candidates: QuoteCandidate[]): Promise<QuoteCandidate | undefined> {
  if (ctx.mode !== "tui") {
    const options = candidates.slice(0, MAX_RPC_OPTIONS).map((candidate) => `${candidate.id} ${candidate.role}: ${excerpt(candidate.text)}`);
    const selected = await ctx.ui.select("Reply to previous message", options);
    if (!selected) return undefined;
    const [id] = selected.split(" ");
    return id ? candidates.find((candidate) => candidate.id === id) : undefined;
  }

  let overlayHandle: OverlayHandle | undefined;
  let finished = false;
  return ctx.ui.custom<QuoteCandidate | undefined>((tui, theme, _keybindings, done) => {
    const finish = (candidate: QuoteCandidate | undefined) => {
      if (finished) return;
      finished = true;
      done(candidate);
      overlayHandle?.hide();
      tui.requestRender(true);
    };
    const picker = new QuotePicker(candidates, theme, finish, () => finish(undefined));
    return {
      render: (width: number) => picker.render(width),
      handleInput: (data: string) => { picker.handleInput(data); if (!finished) tui.requestRender(); },
      invalidate: () => picker.invalidate(),
    };
  }, { overlay: true, overlayOptions: { width: "85%", minWidth: 72, maxHeight: "80%" }, onHandle: (handle) => { overlayHandle = handle; } });
}

export async function reply(args: string, ctx: ExtensionContext): Promise<void> {
  const candidates = collectCandidates(ctx);
  if (candidates.length === 0) {
    ctx.ui.notify("No user or assistant messages are available to quote.", "warning");
    return;
  }

  const query = args.trim().replace(/^#/, "").toLowerCase();
  if (query) {
    const matches = candidates.filter((candidate) => candidate.id.toLowerCase().startsWith(query));
    const candidate = matches[0];
    if (matches.length === 1 && candidate) {
      insertQuote(ctx, candidate);
      return;
    }
    ctx.ui.notify(matches.length > 1 ? `Message id "${query}" matches ${matches.length} messages. Type more of the id.` : `No quotable message matches id "${query}".`, "warning");
    return;
  }

  const candidate = await pickCandidate(ctx, candidates);
  if (candidate) insertQuote(ctx, candidate);
}
