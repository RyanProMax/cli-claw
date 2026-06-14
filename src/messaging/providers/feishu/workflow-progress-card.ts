import * as lark from '@larksuiteoapi/node-sdk';

import { logger } from '../../../core/logger.js';
import type {
  WorkflowProgressReporter,
  WorkflowProgressSnapshot,
} from '../../../agent/workflow/progress.js';
import type {
  WorkflowDefinition,
  WorkflowNodeDefinition,
  WorkflowRoleDefinition,
} from '../../../agent/workflow/config.js';
import type { WorkflowRun, WorkflowRunStep } from '../../../domain/types.js';
import { optimizeMarkdownStyle } from './markdown-style.js';

interface FeishuWorkflowProgressReporterOptions {
  client: lark.Client;
  chatId: string;
  onCardCreated?: (messageId: string) => void;
}

interface FeishuCardMarkdownElement {
  tag: 'markdown';
  content: string;
  text_size?: string;
}

type DisplayStepStatus =
  | 'pending'
  | 'running'
  | 'success'
  | 'error'
  | 'degraded'
  | 'skipped';

const RUN_STATUS_LABEL: Record<WorkflowRun['status'], string> = {
  queued: '排队中',
  running: '运行中',
  success: '已完成',
  error: '失败',
  cancelled: '已取消',
};

const RUN_STATUS_ICON: Record<WorkflowRun['status'], string> = {
  queued: '🕒',
  running: '⏳',
  success: '✅',
  error: '❌',
  cancelled: '⚠️',
};

const STEP_STATUS_LABEL: Record<DisplayStepStatus, string> = {
  pending: '待处理',
  running: '运行中',
  success: '已完成',
  error: '失败',
  degraded: '降级完成',
  skipped: '已跳过',
};

const STEP_STATUS_ICON: Record<DisplayStepStatus, string> = {
  pending: '○',
  running: '⏳',
  success: '✅',
  error: '❌',
  degraded: '⚠️',
  skipped: '⊘',
};

function truncateText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function formatInstant(value: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '-';
  return date.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function formatDurationMs(ms: number): string {
  const normalized = Math.max(0, Math.round(ms));
  if (normalized < 1000) return `${normalized}ms`;
  const seconds = normalized / 1000;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = Math.round(seconds % 60);
  return `${minutes}m ${remaining}s`;
}

function formatStepDuration(step: WorkflowRunStep | undefined): string {
  if (!step?.started_at) return '未开始';
  const started = new Date(step.started_at).getTime();
  if (!Number.isFinite(started)) return '未知';
  const completed = step.completed_at
    ? new Date(step.completed_at).getTime()
    : Date.now();
  if (!Number.isFinite(completed)) return '未知';
  return formatDurationMs(completed - started);
}

function formatRunDuration(run: WorkflowRun): string {
  const startedAt = run.started_at ?? run.created_at;
  const started = new Date(startedAt).getTime();
  if (!Number.isFinite(started)) return '未知';
  const completed = run.completed_at
    ? new Date(run.completed_at).getTime()
    : Date.now();
  if (!Number.isFinite(completed)) return '未知';
  return formatDurationMs(completed - started);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readStringField(
  record: Record<string, unknown>,
  field: string,
): string | null {
  const value = record[field];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function extractOutputSummary(
  step: WorkflowRunStep | undefined,
): string | null {
  if (!step) return null;
  if (step.error) return step.error;
  const output = step.output;
  if (!output) return null;
  if (typeof output.result === 'string' && output.result.trim()) {
    return output.result;
  }
  const artifact = output.artifact;
  if (isRecord(artifact)) {
    const artifactStatus = readStringField(artifact, 'status');
    const artifactReason = readStringField(artifact, 'reason');
    const artifactSummary =
      readStringField(artifact, 'result') ??
      readStringField(artifact, 'summary') ??
      readStringField(artifact, 'message') ??
      readStringField(artifact, 'title') ??
      readStringField(artifact, 'description');
    if (artifactStatus && artifactReason) {
      return `${artifactStatus}: ${artifactReason}`;
    }
    if (artifactSummary) {
      return artifactStatus && artifactStatus !== 'ok'
        ? `${artifactStatus}: ${artifactSummary}`
        : artifactSummary;
    }
    if (artifactStatus) return artifactStatus;
  }
  return JSON.stringify(output);
}

function deriveStepStatus(
  step: WorkflowRunStep | undefined,
): DisplayStepStatus {
  if (!step) return 'pending';
  if (step.status === 'success') {
    const artifact = step.output?.artifact;
    if (
      isRecord(artifact) &&
      typeof artifact.status === 'string' &&
      artifact.status === 'degraded'
    ) {
      return 'degraded';
    }
    return 'success';
  }
  return step.status;
}

function findLatestStepForNode(
  steps: Map<string, WorkflowRunStep>,
  nodeId: string,
): WorkflowRunStep | undefined {
  return steps.get(nodeId);
}

function describeNodeContent(
  node: WorkflowNodeDefinition,
  role: WorkflowRoleDefinition | undefined,
  step: WorkflowRunStep | undefined,
): string | null {
  const outputSummary = extractOutputSummary(step);
  if (outputSummary) return truncateText(outputSummary, 180);
  const pieces = [node.prompt].filter((part): part is string =>
    Boolean(part?.trim()),
  );
  return pieces.length > 0 ? truncateText(pieces.join(' · '), 180) : null;
}

function buildNodeLine(input: {
  index: number;
  node: WorkflowNodeDefinition;
  role?: WorkflowRoleDefinition;
  step?: WorkflowRunStep;
}): string {
  const status = deriveStepStatus(input.step);
  const label = STEP_STATUS_LABEL[status];
  const icon = STEP_STATUS_ICON[status];
  const attempt =
    input.step && input.step.attempt > 1
      ? ` · 第 ${input.step.attempt} 次`
      : '';
  const duration = formatStepDuration(input.step);
  const content = describeNodeContent(input.node, input.role, input.step);
  const taskLine =
    input.node.type === 'local_task' && input.node.taskId
      ? `🧩 本地任务：\`${input.node.taskId}\``
      : null;
  const roleLine =
    input.role && input.node.type !== 'local_task'
      ? `🎭 角色：${input.role.name}`
      : null;
  return [
    `**${input.index}. ${icon} ${input.node.id}**`,
    `📌 状态：${label}${attempt}`,
    `⏱️ 耗时：${duration}`,
    content ? `🧾 内容：${content}` : null,
    taskLine,
    roleLine,
  ]
    .filter((line): line is string => Boolean(line))
    .join('<br>');
}

function buildWorkflowProgressCard(input: {
  snapshot: WorkflowProgressSnapshot;
  run: WorkflowRun;
  steps: Map<string, WorkflowRunStep>;
}): object {
  const { workflow, roles, prompt } = input.snapshot;
  const run = input.run;
  const runLabel = RUN_STATUS_LABEL[run.status];
  const runIcon = RUN_STATUS_ICON[run.status];
  const nodeLines = workflow.nodes.map((node, index) => {
    const role = node.roleId ? roles.get(node.roleId) : undefined;
    return buildNodeLine({
      index: index + 1,
      node,
      role,
      step: findLatestStepForNode(input.steps, node.id),
    });
  });
  const summary = `Workflow 进度｜${workflow.name} ${runLabel}`;
  const headerElements: Array<FeishuCardMarkdownElement | null> = [
    {
      tag: 'markdown',
      content: optimizeMarkdownStyle(
        `## ${runIcon} Workflow 进度｜${workflow.name}`,
        2,
      ),
    },
    {
      tag: 'markdown',
      content: `🆔 Run：\`${run.id}\``,
      text_size: 'notation',
    },
    {
      tag: 'markdown',
      content: [
        `📌 状态：${runLabel}`,
        `🧩 节点：${workflow.nodes.length}`,
        `⏱️ 总耗时：${formatRunDuration(run)}`,
      ].join('\n'),
      text_size: 'notation',
    },
    {
      tag: 'markdown',
      content: [
        `🕘 开始：${formatInstant(run.started_at ?? run.created_at)}`,
        `🔄 更新：${formatInstant(run.updated_at)}`,
      ].join('\n'),
      text_size: 'notation',
    },
    prompt
      ? {
          tag: 'markdown',
          content: `📝 任务：${truncateText(prompt, 220)}`,
          text_size: 'notation',
        }
      : null,
  ].filter((element): element is FeishuCardMarkdownElement => Boolean(element));

  return {
    schema: '2.0',
    config: {
      wide_screen_mode: true,
      summary: { content: summary },
    },
    body: {
      elements: [
        ...headerElements,
        {
          tag: 'markdown',
          content: '---',
          text_size: 'notation',
        },
        ...nodeLines.map((line) => ({
          tag: 'markdown',
          content: optimizeMarkdownStyle(line, 2),
        })),
        {
          tag: 'markdown',
          content: `*${runIcon} ${runLabel} · 🔄 最后更新 ${formatInstant(
            run.updated_at,
          )}*`,
          text_size: 'notation',
        },
      ],
    },
  };
}

function getCardId(resp: unknown): string | null {
  const cardId = (resp as { data?: { card_id?: unknown } })?.data?.card_id;
  return typeof cardId === 'string' && cardId.trim() ? cardId.trim() : null;
}

function getMessageId(resp: unknown): string | null {
  const messageId = (resp as { data?: { message_id?: unknown } })?.data
    ?.message_id;
  return typeof messageId === 'string' && messageId.trim()
    ? messageId.trim()
    : null;
}

function hasCardKit(client: lark.Client): boolean {
  const v1 = (client as any).cardkit?.v1;
  return (
    typeof v1?.card?.create === 'function' &&
    typeof v1?.card?.update === 'function' &&
    typeof (client as any).im?.v1?.message?.create === 'function'
  );
}

export class FeishuWorkflowProgressReporter implements WorkflowProgressReporter {
  private readonly client: lark.Client;
  private readonly chatId: string;
  private readonly onCardCreated?: (messageId: string) => void;
  private snapshot: WorkflowProgressSnapshot | null = null;
  private run: WorkflowRun | null = null;
  private readonly steps = new Map<string, WorkflowRunStep>();
  private cardId: string | null = null;
  private messageId: string | null = null;
  private sequence = 0;
  private lastPayload = '';
  private queue: Promise<void> = Promise.resolve();

  constructor(options: FeishuWorkflowProgressReporterOptions) {
    this.client = options.client;
    this.chatId = options.chatId;
    this.onCardCreated = options.onCardCreated;
  }

  onRunCreated(snapshot: WorkflowProgressSnapshot): Promise<void> {
    this.snapshot = snapshot;
    this.run = snapshot.run;
    return this.enqueueUpdate();
  }

  onRunStatus(run: WorkflowRun): Promise<void> {
    this.run = run;
    return this.enqueueUpdate();
  }

  onStep(step: WorkflowRunStep): Promise<void> {
    const existing = this.steps.get(step.node_id);
    if (!existing || existing.attempt <= step.attempt) {
      this.steps.set(step.node_id, step);
    }
    return this.enqueueUpdate();
  }

  waitForIdle(): Promise<void> {
    return this.queue;
  }

  private enqueueUpdate(): Promise<void> {
    const payload = this.buildPayload();
    if (!payload) return this.queue;
    this.queue = this.queue
      .catch(() => undefined)
      .then(() => this.commitUpdate(payload))
      .catch((err) => {
        logger.debug(
          { err, chatId: this.chatId },
          'Feishu workflow progress card update failed',
        );
      });
    return this.queue;
  }

  private buildPayload(): string | null {
    if (!this.snapshot || !this.run) return null;
    const card = buildWorkflowProgressCard({
      snapshot: this.snapshot,
      run: this.run,
      steps: this.steps,
    });
    return JSON.stringify(card);
  }

  private async commitUpdate(payload: string): Promise<void> {
    if (this.messageId && payload === this.lastPayload) return;

    if (!hasCardKit(this.client)) {
      await this.commitLegacyCard(payload);
      this.lastPayload = payload;
      return;
    }

    if (!this.cardId) {
      const resp = await (this.client as any).cardkit.v1.card.create({
        data: {
          type: 'card_json',
          data: payload,
        },
      });
      const cardId = getCardId(resp);
      if (!cardId) {
        throw new Error('Feishu workflow progress card.create returned no id');
      }
      this.cardId = cardId;
      this.sequence = 1;
      this.lastPayload = payload;
    } else if (payload !== this.lastPayload) {
      this.sequence += 1;
      await (this.client as any).cardkit.v1.card.update({
        path: { card_id: this.cardId },
        data: {
          card: { type: 'card_json', data: payload },
          sequence: this.sequence,
        },
      });
      this.lastPayload = payload;
    }

    if (!this.messageId) {
      const sent = await (this.client as any).im.v1.message.create({
        params: { receive_id_type: 'chat_id' },
        data: {
          receive_id: this.chatId,
          msg_type: 'interactive',
          content: JSON.stringify({
            type: 'card',
            data: { card_id: this.cardId },
          }),
        },
      });
      this.messageId = getMessageId(sent);
      if (this.messageId) this.onCardCreated?.(this.messageId);
    }
  }

  private async commitLegacyCard(payload: string): Promise<void> {
    if (!this.messageId) {
      const sent = await (this.client as any).im.v1.message.create({
        params: { receive_id_type: 'chat_id' },
        data: {
          receive_id: this.chatId,
          msg_type: 'interactive',
          content: payload,
        },
      });
      this.messageId = getMessageId(sent);
      if (this.messageId) this.onCardCreated?.(this.messageId);
      return;
    }
    if (typeof (this.client as any).im?.v1?.message?.patch !== 'function') {
      return;
    }
    await (this.client as any).im.v1.message.patch({
      path: { message_id: this.messageId },
      data: { content: payload },
    });
  }
}

export function createFeishuWorkflowProgressReporter(
  options: FeishuWorkflowProgressReporterOptions,
): WorkflowProgressReporter {
  return new FeishuWorkflowProgressReporter(options);
}
