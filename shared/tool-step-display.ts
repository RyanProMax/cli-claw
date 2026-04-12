export interface ToolStepDisplayOptions {
  maxSummaryChars?: number;
}

const TOOL_EMOJI_BY_NAME: Array<[RegExp, string]> = [
  [/^(exec_command|shell|bash|zsh|terminal)$/i, '💻'],
  [/^write_stdin$/i, '⌨️'],
  [/^(apply_patch|edit|write|update_file)$/i, '✏️'],
  [/^(read|read_file|open|fetch_file)$/i, '📄'],
  [/^(grep|rg|find|search)$/i, '🔎'],
  [/^(web|web_search|browser|fetch|open_url)$/i, '🌐'],
  [/^(todo|todo_write|plan)$/i, '📋'],
];

function getToolEmoji(toolName: string): string {
  return (
    TOOL_EMOJI_BY_NAME.find(([pattern]) => pattern.test(toolName))?.[1] ??
    '🛠️'
  );
}

export function formatToolStepLine(
  toolName: string,
  summary?: string | null,
  options?: ToolStepDisplayOptions,
): string {
  const normalizedName = toolName.trim() || 'unknown';
  const displayName = `${getToolEmoji(normalizedName)} ${normalizedName}`;
  const normalizedSummary = (summary || '').trim();
  if (!normalizedSummary) return displayName;

  const maxSummaryChars = options?.maxSummaryChars ?? 60;
  const compactSummary =
    normalizedSummary.length > maxSummaryChars
      ? `${normalizedSummary.slice(0, maxSummaryChars)}...`
      : normalizedSummary;

  return `${displayName} · ${compactSummary}`;
}
