import fs from 'fs';
import path from 'path';

import type { MessageSourceKind } from './types.js';

interface ActivePlanMilestone {
  title: string;
  status: string | null;
}

const TASK_MESSAGE_SOURCE_KINDS = new Set<MessageSourceKind>([
  'sdk_final',
  'sdk_send_message',
  'interrupt_partial',
  'overflow_partial',
]);

function normalizeStatusMarker(status: string | null): string {
  if (status === 'done') return '✓';
  if (status === 'in_progress') return '…';
  return '○';
}

export function shouldAppendActivePlanProgress(
  sourceKind?: MessageSourceKind | null,
): boolean {
  return !!sourceKind && TASK_MESSAGE_SOURCE_KINDS.has(sourceKind);
}

export function parseActivePlanMilestones(
  markdown: string,
): ActivePlanMilestone[] {
  const lines = markdown.split(/\r?\n/);
  const milestones: ActivePlanMilestone[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const titleMatch = lines[index]?.match(/^###\s+(.+?)\s*$/);
    if (!titleMatch) continue;

    const title = titleMatch[1].trim();
    let status: string | null = null;

    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const line = lines[cursor] ?? '';
      if (/^###\s+/.test(line)) {
        index = cursor - 1;
        break;
      }
      if (/^Status:\s*$/.test(line)) {
        const nextLine = (lines[cursor + 1] ?? '').trim();
        const bulletMatch = nextLine.match(/^-\s+(.+?)\s*$/);
        status = bulletMatch ? bulletMatch[1].trim() : null;
      }
      if (cursor === lines.length - 1) {
        index = cursor;
      }
    }

    milestones.push({ title, status });
  }

  return milestones;
}

export function formatActivePlanProgressLine(markdown: string): string | null {
  const milestones = parseActivePlanMilestones(markdown);
  if (milestones.length === 0) return null;

  const summary = milestones
    .map(
      (milestone) =>
        `${normalizeStatusMarker(milestone.status)} ${milestone.title}`,
    )
    .join(' · ');

  return `进度: ${summary}`;
}

export function appendActivePlanProgressLine(
  text: string,
  markdown: string,
): string {
  const progressLine = formatActivePlanProgressLine(markdown);
  if (!progressLine) return text;

  const normalizedText = text.trimEnd();
  if (normalizedText.endsWith(progressLine)) {
    return normalizedText;
  }
  if (!normalizedText) return progressLine;
  return `${normalizedText}\n\n${progressLine}`;
}

export function readActivePlanProgressLine(
  planPath = path.join(process.cwd(), 'PLANS', 'ACTIVE.md'),
): string | null {
  try {
    if (!fs.existsSync(planPath)) return null;
    return formatActivePlanProgressLine(fs.readFileSync(planPath, 'utf8'));
  } catch {
    return null;
  }
}

export function appendActivePlanProgressFromFile(
  text: string,
  sourceKind?: MessageSourceKind | null,
  planPath?: string,
): string {
  if (!shouldAppendActivePlanProgress(sourceKind)) return text;
  const markdown = (() => {
    try {
      const resolvedPath =
        planPath ?? path.join(process.cwd(), 'PLANS', 'ACTIVE.md');
      if (!fs.existsSync(resolvedPath)) return null;
      return fs.readFileSync(resolvedPath, 'utf8');
    } catch {
      return null;
    }
  })();
  if (!markdown) return text;
  return appendActivePlanProgressLine(text, markdown);
}
