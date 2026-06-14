import fs from 'fs';
import path from 'path';

import { APP_ROOT } from '../../core/app-root.js';
import { GROUPS_DIR } from '../../core/config.js';
import { logger } from '../../core/logger.js';
import type { RegisteredGroup } from '../../domain/types.js';
import { createWorkflowRun, getOrCreateWorkflowContext } from './context.js';
import {
  discoverWorkflowConfigs,
  type WorkflowRoleDefinition,
} from './config.js';
import {
  getPersistentWorkflowCheckpointer,
  runWorkflowGraph,
  summarizeAgentRuntimeError,
  type WorkflowLocalTaskRegistry,
} from './engine.js';
import {
  createDefaultWorkflowLocalTasks,
  getDefaultWorkflowLocalTaskIds,
} from './local-tasks.js';
import type { WorkflowProgressReporter } from './progress.js';
import { DEFAULT_WORKFLOW_KNOWN_TOOLS } from './tools.js';

type WorkflowDiscovery = ReturnType<typeof discoverWorkflowConfigs>;

export interface WorkflowCommandOptions {
  group: RegisteredGroup;
  chatJid: string;
  argsText: string;
  triggerUserId?: string | null;
  workspaceRoot?: string;
  knownTools?: string[];
  knownLocalTasks?: string[];
  initialInput?: Record<string, unknown>;
  localTasks?: WorkflowLocalTaskRegistry;
  runGraph?: typeof runWorkflowGraph;
  background?: boolean;
  onBackgroundResult?: (message: string) => Promise<void> | void;
  triggerMessageId?: string | null;
  progressReporter?: WorkflowProgressReporter | null;
}

function splitWorkflowArgs(argsText: string): {
  workflowId: string | null;
  prompt: string;
} {
  const trimmed = argsText.trim();
  if (!trimmed) return { workflowId: null, prompt: '' };
  const [workflowId = '', ...rest] = trimmed.split(/\s+/);
  return {
    workflowId,
    prompt: rest.join(' ').trim(),
  };
}

function resolveWorkflowWorkspaceRoot(
  group: RegisteredGroup,
  explicitRoot?: string,
): string {
  const candidate =
    explicitRoot || group.customCwd || path.join(GROUPS_DIR, group.folder);
  return fs.existsSync(candidate) ? fs.realpathSync(candidate) : candidate;
}

function formatWorkflowErrors(errors: string[]): string {
  return ['工作流配置存在错误：', ...errors.map((error) => `- ${error}`)].join(
    '\n',
  );
}

function formatWorkflowList(
  workflows: ReturnType<typeof discoverWorkflowConfigs>['workflows'],
): string {
  if (workflows.length === 0) {
    return '当前工作区没有可用工作流，请在 .agents/workflows/ 下添加配置';
  }
  return [
    '可用工作流：',
    ...workflows.map((workflow) => `- ${workflow.id}：${workflow.name}`),
    '',
    '用法：/workflow <id> <任务>',
  ].join('\n');
}

function formatWorkflowStarted(options: {
  workflow: WorkflowDiscovery['workflows'][number];
  runId: string;
  prompt: string;
}): string {
  return [
    `🚀 已启动：${options.workflow.name}`,
    `🧩 Workflow：${options.workflow.id}`,
    `🆔 Run：${options.runId}`,
    ...(options.prompt ? [`📝 任务：${options.prompt}`] : []),
    '📬 完成、失败或超时后，我会回到这里通知你。',
  ].join('\n');
}

function formatScoreComponent(
  label: string,
  value: string,
  denominator: number,
): string {
  const normalized = value.toUpperCase() === 'NA' ? 'N/A' : value;
  return /N\/?A/i.test(normalized)
    ? `${label}N/A`
    : `${label}${normalized}/${denominator}`;
}

function normalizeHkipoFinalReport(result: string): string {
  return result
    .replaceAll('Chief Securities IPO', '致富证券 IPO')
    .replace(/致富证券(?! IPO)/g, '致富证券 IPO')
    .replace(/孖展\s*多源未取到/g, '融资/孖展倍数暂无多源核验')
    .replace(/孖展[：:]\s*多源未取到/g, '融资/孖展倍数暂无多源核验')
    .replace(
      /[｜|]\s*(?:卡[：:]\s*)?热(\d+|N\/?A|NA)\s+结构(\d+|N\/?A|NA)\s+回测(\d+|N\/?A|NA)\s+基本面(\d+|N\/?A|NA)\s+估值(\d+|N\/?A|NA)\s+证据(\d+|N\/?A|NA)/gi,
      (
        _match,
        heat: string,
        structure: string,
        backtest: string,
        fundamental: string,
        valuation: string,
        evidence: string,
      ) =>
        [
          '',
          '🧮 评分：',
          formatScoreComponent('热度', heat, 20),
          '｜',
          formatScoreComponent('结构', structure, 20),
          '｜',
          formatScoreComponent('回测', backtest, 20),
          '｜',
          formatScoreComponent('基本面', fundamental, 20),
          '｜',
          formatScoreComponent('估值', valuation, 10),
          '｜',
          formatScoreComponent('证据', evidence, 10),
        ].join(''),
    );
}

function hasSourceWarning(text: string): boolean {
  return /存疑|低置信|不置信|不可访问|无法访问|原站不可访问|账号失败|抓取失败|未成功|失败|镜像|缓存|搜索缓存|unavailable|error|failed|No account/i.test(
    text,
  );
}

function removeDefaultKolConfidenceSection(result: string): string {
  const headingMatch = result.match(
    /(?:^|\n)(\*\*)?账号与来源可信度\1?[：:]?\s*\n?/,
  );
  if (!headingMatch || headingMatch.index === undefined) return result;
  const start = headingMatch.index;
  const section = result.slice(start + headingMatch[0].length);
  const nextSectionMatch = section.match(
    /\n(?:---\s*\n+)?\*\*(?:\d+\.|来源提醒|[^\n]+)\*\*/,
  );
  const end = nextSectionMatch?.index
    ? start + headingMatch[0].length + nextSectionMatch.index
    : result.length;
  const sectionBody = result.slice(start, end);
  if (hasSourceWarning(sectionBody)) {
    return `${result.slice(0, start)}\n\n**来源提醒**\n${result
      .slice(start + headingMatch[0].length, end)
      .trim()}${result.slice(end)}`;
  }
  return `${result.slice(0, start).trimEnd()}${result.slice(end)}`;
}

function compactKolSeparators(result: string): string {
  return result
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\n*\s*---\s*\n*/g, '\n---\n')
    .replace(/(?:\n---\n\s*){2,}/g, '\n---\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function mergeKolCoverageLines(result: string): string {
  return result
    .replace(
      /(^|\n)覆盖[：:]\s*(\d+)\s*位\s*KOL\s*\n覆盖\s*KOL[：:]\s*([^\n]+)/g,
      (_match, prefix: string, count: string, summary: string) =>
        `${prefix}覆盖 KOL（${count}）：${summary.trim()}`,
    )
    .replace(
      /(^|\n)覆盖\s*KOL\s*\((\d+)\)[：:]\s*([^\n]+)/g,
      (_match, prefix: string, count: string, summary: string) =>
        `${prefix}覆盖 KOL（${count}）：${summary.trim()}`,
    );
}

function normalizeKolDate(value: string | null | undefined): string | null {
  const match = value
    ?.trim()
    .match(/(20\d{2})[年\/-](\d{1,2})[月\/-](\d{1,2})/);
  if (!match) return null;
  return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(
    2,
    '0',
  )}`;
}

function normalizeKolSourceLinks(result: string): string {
  return result.replace(
    /\[([^\]\n]*?)\s*\|\s*x\]\(([^)\n]+)\)([^\n]*)/gi,
    (_match, rawTitle: string, url: string, rawTail: string) => {
      const title = rawTitle.trim();
      const date = normalizeKolDate(rawTail);
      const tail = rawTail
        .replace(
          /\s*(?:[\[（(]\s*)?20\d{2}[年\/-]\d{1,2}[月\/-]\d{1,2}(?:\s*[\]）)])?/g,
          '',
        )
        .trim();
      return `[${title}](${url})${date ? ` [${date}]` : ''}${
        tail ? ` ${tail}` : ''
      }`;
    },
  );
}

function splitKolSentences(value: string): string[] {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return [];
  const matches = normalized.match(/[^。！？]+[。！？]?/g) ?? [normalized];
  return matches.map((item) => item.trim()).filter(Boolean);
}

function splitKolNumberedItems(value: string): string[] {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return [];
  const parts = normalized
    .split(/\s*(?:\d+[）、]|\d+[.)]\s+)/g)
    .map((item) => item.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : splitKolSentences(normalized);
}

function isLowValueKolText(value: string): boolean {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return true;
  if (/不构成投资建议|仅供参考|供参考|非投资建议/.test(normalized)) {
    return true;
  }
  if (
    /(?:整体来看|总体来看|总的来看).*(?:继续观察|仍需观察|保持关注|值得关注|多因素影响)/.test(
      normalized,
    )
  ) {
    return true;
  }
  return /(?:继续观察|持续关注|保持关注|值得关注)(?:市场情绪|后续变化|相关方向|多因素影响)/.test(
    normalized,
  );
}

function filterKolSignalItems(items: string[], limit = 3): string[] {
  return items
    .map((item) => item.trim())
    .filter((item) => item && !isLowValueKolText(item))
    .slice(0, limit);
}

function formatKolNumberedSection(title: string, items: string[]): string {
  const normalizedItems = items.length > 0 ? items : ['暂无高置信内容。'];
  return [
    title,
    ...normalizedItems.map((item, index) => `${index + 1}. ${item}`),
  ].join('\n');
}

function normalizeKolConclusion(result: string): string {
  return result.replace(
    /(^|\n)🧾\s*\*\*结论\/总结\*\*[：:]\s*([\s\S]*?)(?=\n\s*---|\n\s*\*\*近期投资方向|$)/g,
    (_match, prefix: string, rawBody: string) => {
      const body = rawBody.replace(/\s+/g, ' ').trim();
      const split = body.match(/([\s\S]*?)下一步重点核验[：:]\s*([\s\S]*)/);
      const summaryText = (split?.[1] ?? body).trim();
      const verificationText = split?.[2]?.trim() ?? '';
      const sections = [
        formatKolNumberedSection(
          '🧾 **结论/总结**',
          filterKolSignalItems(splitKolSentences(summaryText)),
        ),
      ];
      if (verificationText) {
        sections.push(
          formatKolNumberedSection(
            '🔍 **下一步重点核验**',
            filterKolSignalItems(splitKolNumberedItems(verificationText)),
          ),
        );
      }
      return `${prefix}${sections.join('\n\n')}`;
    },
  );
}

function compactKolThemeSummary(result: string): string {
  return result.replace(
    /(^|\n)高信号主题[：:]\s*([^\n]+)/g,
    (_match, prefix: string, rawThemes: string) => {
      const themes = rawThemes
        .split(/[、，,]/)
        .map((theme) => theme.trim())
        .filter(Boolean)
        .slice(0, 3);
      return themes.length > 0
        ? `${prefix}高信号主题：${themes.join('、')}`
        : '';
    },
  );
}

function removeLowValueKolLines(result: string): string {
  return result
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      if (/^📌\s*\*\*说明\*\*/.test(trimmed)) return false;
      return !isLowValueKolText(trimmed);
    })
    .join('\n');
}

function insertCompactKolSeparators(result: string): string {
  return result
    .replace(
      /\n+(?!\s*---\s*\n)(\*\*近期投资方向与高信号内容\*\*)/g,
      '\n---\n$1',
    )
    .replace(/\n+(?!\s*---\s*\n)(\*\*[2-9]\.\s+)/g, '\n---\n$1');
}

function compactKolFieldSpacing(result: string): string {
  return result
    .replace(/\n{2,}(?=(?:🧭|📝|🏷️|📊|🔮|🎯|🔗)\s+\*\*)/g, '\n')
    .replace(/((?:📝|🔗)\s+\*\*[^*\n]+\*\*[：:]?)\n{2,}(?=-\s)/g, '$1\n')
    .replace(/(\n-\s+\*\*[^：:\n]+[：:].+)\n{2,}(?=-\s+\*\*)/g, '$1\n');
}

function limitKolThemeSections(result: string, maxThemes = 3): string {
  return result
    .split(/\n---\n/)
    .filter((section) => {
      const heading = section.match(/^\*\*(\d+)\.\s+/m);
      if (!heading) return true;
      return Number(heading[1]) <= maxThemes;
    })
    .join('\n---\n');
}

function normalizeKolFinalReport(result: string): string {
  let normalized = removeDefaultKolConfidenceSection(result);
  normalized = mergeKolCoverageLines(normalized);
  normalized = normalizeKolSourceLinks(normalized);
  normalized = normalizeKolConclusion(normalized);
  normalized = compactKolThemeSummary(normalized);
  normalized = removeLowValueKolLines(normalized);
  normalized = insertCompactKolSeparators(normalized);
  normalized = compactKolSeparators(normalized);
  normalized = limitKolThemeSections(normalized);
  normalized = compactKolFieldSpacing(normalized);
  return compactKolSeparators(normalized);
}

function normalizeWorkflowResultForDelivery(
  workflowId: string,
  result: string,
): string {
  if (workflowId === 'hkipo') return normalizeHkipoFinalReport(result);
  if (workflowId === 'kol') return normalizeKolFinalReport(result);
  return result;
}

async function notifyWorkflowProgress(
  reporter: WorkflowProgressReporter | null | undefined,
  label: string,
  notify: (reporter: WorkflowProgressReporter) => Promise<void> | void,
): Promise<void> {
  if (!reporter) return;
  try {
    await notify(reporter);
  } catch (err) {
    logger.debug({ err, label }, 'Workflow progress reporter failed');
  }
}

async function waitForWorkflowProgressReporter(
  reporter: WorkflowProgressReporter | null | undefined,
): Promise<void> {
  if (!reporter?.waitForIdle) return;
  await notifyWorkflowProgress(reporter, 'wait_for_idle', (activeReporter) =>
    activeReporter.waitForIdle?.(),
  );
}

function formatWorkflowSuccess(options: {
  workflow: WorkflowDiscovery['workflows'][number];
  result: string;
}): string {
  const normalizedResult = normalizeWorkflowResultForDelivery(
    options.workflow.id,
    options.result,
  );
  return [
    `✅ 工作流 ${options.workflow.name} (${options.workflow.id}) 完成：`,
    normalizedResult || '无输出',
  ].join('\n');
}

function formatWorkflowFailure(options: {
  workflow: WorkflowDiscovery['workflows'][number];
  message: string;
}): string {
  const runtimeSummary = summarizeAgentRuntimeError(options.message);
  const message =
    runtimeSummary === options.message
      ? options.message
      : `${runtimeSummary}。已记录运行日志，请稍后重试。`;
  return `❌ 工作流 ${options.workflow.name} (${options.workflow.id}) 失败：${message}`;
}

function discoverWorkflowConfigsWithBuiltins(options: {
  workspaceRoot: string;
  knownTools: string[];
  knownLocalTasks: string[];
}): WorkflowDiscovery {
  const roots = Array.from(new Set([APP_ROOT, options.workspaceRoot]));
  const workflowById = new Map<
    string,
    WorkflowDiscovery['workflows'][number]
  >();
  const roles = new Map<string, WorkflowRoleDefinition>();
  const errors: string[] = [];

  for (const root of roots) {
    const discovered = discoverWorkflowConfigs({
      workspaceRoot: root,
      knownTools: options.knownTools,
      knownLocalTasks: options.knownLocalTasks,
    });
    errors.push(...discovered.errors);
    for (const [roleId, role] of discovered.roles.entries()) {
      roles.set(roleId, role);
    }
    for (const workflow of discovered.workflows) {
      workflowById.set(workflow.id, workflow);
    }
  }

  return {
    workflows: [...workflowById.values()].sort((left, right) =>
      left.id.localeCompare(right.id),
    ),
    roles,
    errors: Array.from(new Set(errors)),
  };
}

export async function executeWorkflowCommand(
  options: WorkflowCommandOptions,
): Promise<string> {
  const workspaceRoot = resolveWorkflowWorkspaceRoot(
    options.group,
    options.workspaceRoot,
  );
  const knownTools = options.knownTools ?? [...DEFAULT_WORKFLOW_KNOWN_TOOLS];
  const knownLocalTasks =
    options.knownLocalTasks ?? getDefaultWorkflowLocalTaskIds();
  const { workflowId, prompt } = splitWorkflowArgs(options.argsText);

  if (!workflowId) {
    const discovered = discoverWorkflowConfigsWithBuiltins({
      workspaceRoot,
      knownTools,
      knownLocalTasks,
    });
    if (discovered.errors.length > 0) {
      return formatWorkflowErrors(discovered.errors);
    }
    return formatWorkflowList(discovered.workflows);
  }

  if (!prompt) {
    return `用法：/workflow ${workflowId} <任务>`;
  }

  const discovered = discoverWorkflowConfigsWithBuiltins({
    workspaceRoot,
    knownTools,
    knownLocalTasks,
  });
  const workflow =
    discovered.workflows.find((candidate) => candidate.id === workflowId) ??
    null;
  if (!workflow) {
    return formatWorkflowErrors([
      ...discovered.errors,
      `workflow ${workflowId} not found`,
    ]);
  }
  if (discovered.errors.length > 0) {
    return formatWorkflowErrors(discovered.errors);
  }

  const context = getOrCreateWorkflowContext({
    folder: options.group.folder,
    workflowId: workflow.id,
    workspaceJid: options.chatJid.startsWith('web:') ? options.chatJid : null,
    metadata: { workspaceRoot },
  });
  const run = createWorkflowRun({
    contextId: context.id,
    folder: options.group.folder,
    workflowId: workflow.id,
    triggerChatJid: options.chatJid,
    triggerMessageId: options.triggerMessageId ?? null,
    triggerUserId: options.triggerUserId ?? null,
    prompt,
    metadata: {
      source: 'slash-command',
      initialInput: options.initialInput ?? {},
    },
  });
  await notifyWorkflowProgress(
    options.progressReporter,
    'run_created',
    (reporter) =>
      reporter.onRunCreated?.({
        workflow,
        roles: discovered.roles,
        run,
        prompt,
      }),
  );

  const runAndFormatResult = async (): Promise<string> => {
    const graphRunner = options.runGraph ?? runWorkflowGraph;
    try {
      const result = await graphRunner({
        workflow,
        roles: discovered.roles,
        group: options.group,
        context,
        run,
        prompt,
        initialInput: options.initialInput,
        localTasks:
          options.localTasks ??
          createDefaultWorkflowLocalTasks({ workspaceRoot }),
        executionCwd: workspaceRoot,
        checkpointer: getPersistentWorkflowCheckpointer(),
        ...(options.progressReporter
          ? { progressReporter: options.progressReporter }
          : {}),
      });
      await waitForWorkflowProgressReporter(options.progressReporter);
      return formatWorkflowSuccess({
        workflow,
        result: result.result ?? '',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await waitForWorkflowProgressReporter(options.progressReporter);
      return formatWorkflowFailure({ workflow, message });
    }
  };

  if (options.background) {
    const startedMessage = formatWorkflowStarted({
      workflow,
      runId: run.id,
      prompt,
    });
    void (async () => {
      const message = await runAndFormatResult();
      if (!options.onBackgroundResult) return;
      try {
        await options.onBackgroundResult(message);
      } catch {
        // Delivery failures are logged by the caller's transport when available.
      }
    })();
    return startedMessage;
  }

  return runAndFormatResult();
}
