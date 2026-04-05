export interface ToolStepDisplayOptions {
  maxSummaryChars?: number;
}

export function formatToolStepLine(
  toolName: string,
  summary?: string | null,
  options?: ToolStepDisplayOptions,
): string {
  const normalizedName = toolName.trim() || 'unknown';
  const normalizedSummary = (summary || '').trim();
  if (!normalizedSummary) return normalizedName;

  const maxSummaryChars = options?.maxSummaryChars ?? 60;
  const compactSummary =
    normalizedSummary.length > maxSummaryChars
      ? `${normalizedSummary.slice(0, maxSummaryChars)}...`
      : normalizedSummary;

  return `${normalizedName} · ${compactSummary}`;
}
