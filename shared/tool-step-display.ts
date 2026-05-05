export interface ToolStepDisplayOptions {
  maxSummaryChars?: number;
}

const TOOL_EMOJI_BY_NAME: Array<[RegExp, string]> = [
  [/^(exec_command|shell|bash|zsh|terminal)$/i, '💻'],
  [/^write_stdin$/i, '⌨️'],
  [/^(apply_patch|edit|write|update_file|create_file)$/i, '✏️'],
  [/^(read|read_file|open|fetch_file|fetch_blob)$/i, '📖'],
  [/^(grep|rg|find|search|search_query)$/i, '🔎'],
  [/^(web|web_search|browser|fetch|open_url|image_query)$/i, '🌐'],
  [/^(todo|todo_write|plan|update_plan)$/i, '📋'],
  [/^(list|ls|list_files|rg_files)$/i, '📂'],
  [/^(delete|remove|rm|delete_file)$/i, '🗑️'],
  [/^(move|rename|mv)$/i, '🚚'],
  [/^(copy|cp)$/i, '📋'],
  [/^(test|verify|validate|review)$/i, '✅'],
  [/^(download|upload)$/i, '📦'],
  [/^(screenshot|view_image|imagegen)$/i, '🖼️'],
  [/^(mcp|read_mcp_resource|list_mcp_resources)$/i, '🔌'],
  [/^(spawn_agent|send_input|wait_agent)$/i, '🤖'],
];

const STEP_EMOJI_BY_SUMMARY: Array<[RegExp, string]> = [
  [/^(read|open|fetch|view)\b/i, '📖'],
  [/^(search|find|grep|rg|look up|looking up)\b/i, '🔎'],
  [/^(edit|write|update|patch|modify|create)\b/i, '✏️'],
  [/^(delete|remove)\b/i, '🗑️'],
  [/^(move|rename)\b/i, '🚚'],
  [/^(copy)\b/i, '📋'],
  [/^(run|execute|exec|shell|bash|zsh|terminal)\b/i, '💻'],
  [/^(test|verify|validate|review|check)\b/i, '✅'],
  [/^(plan|todo)\b/i, '📋'],
  [/^(download|upload|install|build)\b/i, '📦'],
  [/^(screenshot|view image|generate image|image)\b/i, '🖼️'],
  [/^(spawn|delegate|wait for agent|send input)\b/i, '🤖'],
  [/\bweb\b|^(searching the web|browse|browser|open url)\b/i, '🌐'],
];

function getToolNameEmoji(toolName: string): string | undefined {
  return TOOL_EMOJI_BY_NAME.find(([pattern]) => pattern.test(toolName))?.[1];
}

function getSummaryEmoji(summary?: string): string | undefined {
  return summary
    ? STEP_EMOJI_BY_SUMMARY.find(([pattern]) => pattern.test(summary))?.[1]
    : undefined;
}

function getToolEmoji(toolName: string, summary?: string): string {
  const toolNameEmoji = getToolNameEmoji(toolName);
  if (toolNameEmoji) return toolNameEmoji;

  const summaryEmoji = summary ? getSummaryEmoji(summary) : undefined;
  if (summaryEmoji) return summaryEmoji;

  return '🛠️';
}

export function formatToolStepLine(
  toolName: string,
  summary?: string | null,
  options?: ToolStepDisplayOptions,
): string {
  const normalizedName = toolName.trim() || 'unknown';
  const normalizedSummary = (summary || '').trim();
  const displayName = `${getToolEmoji(normalizedName, normalizedSummary)} ${normalizedName}`;
  if (!normalizedSummary) return displayName;

  const maxSummaryChars = options?.maxSummaryChars ?? 60;
  const compactSummary =
    normalizedSummary.length > maxSummaryChars
      ? `${normalizedSummary.slice(0, maxSummaryChars)}...`
      : normalizedSummary;

  return `${displayName} · ${compactSummary}`;
}
