import fs from 'node:fs';
import path from 'node:path';
import { tool, type Tool } from '@openai/agents';
import { z } from 'zod';
import { CronExpressionParser } from 'cron-parser';
import { serializeErrorForOutput } from '../../../shared/dist/error-serialization.js';
import { detectImageMimeTypeFromBase64Strict } from './image-detector.js';

export interface OpenAiToolContext {
  chatJid: string;
  groupFolder: string;
  isHome: boolean;
  isMainWorkspace: boolean;
  isScheduledTask?: boolean;
  workspaceIpc: string;
  workspaceGroup: string;
  allowedTools?: string[];
}

function writeIpcFile(dir: string, data: object): string {
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`;
  const filepath = path.join(dir, filename);
  const tempPath = `${filepath}.tmp`;
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2));
    fs.renameSync(tempPath, filepath);
  } catch (err) {
    try {
      fs.unlinkSync(tempPath);
    } catch {
      /* ignore */
    }
    throw new Error(
      `IPC write failed (${dir}): ${serializeErrorForOutput(err)}`,
    );
  }
  return filename;
}

async function pollIpcResult(
  dir: string,
  data: Record<string, unknown> & { requestId: string },
  resultFilePrefix: string,
  timeoutMs = 30_000,
): Promise<Record<string, unknown>> {
  const resultFileName = `${resultFilePrefix}_${data.requestId}.json`;
  const resultFilePath = path.join(dir, resultFileName);
  writeIpcFile(dir, data);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const raw = fs.readFileSync(resultFilePath, 'utf-8');
      fs.unlinkSync(resultFilePath);
      return JSON.parse(raw) as Record<string, unknown>;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timeout waiting for IPC result (${timeoutMs / 1000}s)`);
}

function validateWorkspacePath(
  ctx: OpenAiToolContext,
  filePath: string,
): string {
  const resolved = path.isAbsolute(filePath)
    ? path.resolve(filePath)
    : path.resolve(ctx.workspaceGroup, filePath);
  const safeRoot = ctx.workspaceGroup.endsWith(path.sep)
    ? ctx.workspaceGroup
    : ctx.workspaceGroup + path.sep;
  if (resolved !== ctx.workspaceGroup && !resolved.startsWith(safeRoot)) {
    throw new Error('file path must be within the workspace directory');
  }
  return resolved;
}

function toRelativeWorkspacePath(
  ctx: OpenAiToolContext,
  filePath: string,
): string {
  const resolved = validateWorkspacePath(ctx, filePath);
  return path.relative(ctx.workspaceGroup, resolved);
}

function filterAllowedTools(tools: Tool[], allowedTools?: string[]): Tool[] {
  if (allowedTools === undefined) return tools;
  const allowed = new Set(allowedTools);
  return tools.filter((candidate) =>
    allowed.has(String((candidate as { name?: unknown }).name || '')),
  );
}

export function createOpenAiAgentTools(ctx: OpenAiToolContext): Tool[] {
  const messagesDir = path.join(ctx.workspaceIpc, 'messages');
  const tasksDir = path.join(ctx.workspaceIpc, 'tasks');

  const tools: Tool[] = [
    tool({
      name: 'send_message',
      description:
        'Send a message to the current user or group while the agent is running.',
      parameters: z.object({ text: z.string() }),
      strict: true,
      execute: ({ text }) => {
        const data: Record<string, unknown> = {
          type: 'message',
          chatJid: ctx.chatJid,
          text,
          groupFolder: ctx.groupFolder,
          timestamp: new Date().toISOString(),
        };
        if (ctx.isScheduledTask) data.isScheduledTask = true;
        writeIpcFile(messagesDir, data);
        return 'Message sent.';
      },
    }),

    tool({
      name: 'send_image',
      description:
        'Send an image file from the workspace to the current chat. Supported formats include PNG, JPEG, GIF, WebP, TIFF, and BMP. Max size is 10MB.',
      parameters: z.object({
        file_path: z.string(),
        caption: z.string().optional(),
      }),
      strict: true,
      execute: ({ file_path, caption }) => {
        const resolved = validateWorkspacePath(ctx, file_path);
        if (!fs.existsSync(resolved))
          return `Error: file not found: ${file_path}`;
        const stat = fs.statSync(resolved);
        if (stat.size > 10 * 1024 * 1024) {
          return `Error: image file too large (${(stat.size / 1024 / 1024).toFixed(1)}MB). Maximum is 10MB.`;
        }
        if (stat.size === 0) return 'Error: image file is empty.';
        const base64 = fs.readFileSync(resolved).toString('base64');
        const mimeType = detectImageMimeTypeFromBase64Strict(base64);
        if (!mimeType) {
          return 'Error: file does not appear to be a supported image format.';
        }
        const data: Record<string, unknown> = {
          type: 'image',
          chatJid: ctx.chatJid,
          imageBase64: base64,
          mimeType,
          caption: caption || undefined,
          fileName: path.basename(resolved),
          groupFolder: ctx.groupFolder,
          timestamp: new Date().toISOString(),
        };
        if (ctx.isScheduledTask) data.isScheduledTask = true;
        writeIpcFile(messagesDir, data);
        return `Image sent: ${path.basename(resolved)} (${mimeType}, ${(stat.size / 1024).toFixed(1)}KB)`;
      },
    }),

    tool({
      name: 'send_file',
      description:
        'Send a file from the workspace to the current chat. Max file size is 30MB.',
      parameters: z.object({
        filePath: z.string(),
        fileName: z.string(),
      }),
      strict: true,
      execute: ({ filePath, fileName }) => {
        const resolved = validateWorkspacePath(ctx, filePath);
        if (!fs.existsSync(resolved))
          return `Error: file not found: ${filePath}`;
        const stat = fs.statSync(resolved);
        if (stat.size > 30 * 1024 * 1024) {
          return `Error: file too large (${(stat.size / 1024 / 1024).toFixed(1)}MB). Maximum is 30MB.`;
        }
        writeIpcFile(tasksDir, {
          type: 'send_file',
          chatJid: ctx.chatJid,
          filePath: toRelativeWorkspacePath(ctx, filePath),
          fileName,
          timestamp: new Date().toISOString(),
        });
        return `Sending file "${fileName}"...`;
      },
    }),

    tool({
      name: 'schedule_task',
      description:
        'Schedule a recurring or one-time workflow run.',
      parameters: z.object({
        workflow_id: z.string().min(1),
        prompt: z.string().optional().default(''),
        schedule_type: z.enum(['cron', 'interval', 'once']),
        schedule_value: z.string(),
        target_group_jid: z.string().optional(),
      }),
      strict: true,
      execute: (args) => {
        if (args.schedule_type === 'cron') {
          try {
            CronExpressionParser.parse(args.schedule_value, {
              tz: process.env.TZ || 'Asia/Shanghai',
            });
          } catch {
            return `Error: invalid cron "${args.schedule_value}".`;
          }
        } else if (args.schedule_type === 'interval') {
          const ms = Number.parseInt(args.schedule_value, 10);
          if (Number.isNaN(ms) || ms <= 0) {
            return `Error: invalid interval "${args.schedule_value}".`;
          }
        } else if (Number.isNaN(new Date(args.schedule_value).getTime())) {
          return `Error: invalid timestamp "${args.schedule_value}".`;
        }
        const targetJid = args.target_group_jid || ctx.chatJid;
        const data: Record<string, unknown> = {
          type: 'schedule_task',
          prompt: args.prompt || '',
          schedule_type: args.schedule_type,
          schedule_value: args.schedule_value,
          context_mode: 'isolated',
          execution_type: 'workflow',
          script_command: args.workflow_id,
          targetJid,
          createdBy: ctx.groupFolder,
          timestamp: new Date().toISOString(),
        };
        const filename = writeIpcFile(tasksDir, data);
        return `Workflow task scheduled (${filename}): ${args.workflow_id} - ${args.schedule_type} - ${args.schedule_value}`;
      },
    }),

    tool({
      name: 'list_tasks',
      description: 'List scheduled workflow tasks for the current workspace.',
      parameters: z.object({}),
      strict: true,
      execute: async () => {
        const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const result = await pollIpcResult(
          tasksDir,
          {
            type: 'list_tasks',
            requestId,
            groupFolder: ctx.groupFolder,
            timestamp: new Date().toISOString(),
          },
          'list_tasks_result',
        );
        if (!result.success) {
          return `Error listing tasks: ${result.error || 'Unknown error'}`;
        }
        const tasks = (result.tasks || []) as Array<{
          id: string;
          prompt: string;
          schedule_type: string;
          schedule_value: string;
          status: string;
          next_run?: string;
        }>;
        if (tasks.length === 0) return 'No scheduled tasks found.';
        return tasks
          .map(
            (task) =>
              `- [${task.id}] ${task.prompt.slice(0, 50)}... (${task.schedule_type}: ${task.schedule_value}) - ${task.status}, next: ${task.next_run || 'N/A'}`,
          )
          .join('\n');
      },
    }),

    taskControlTool('pause_task', 'Pause a scheduled task.', tasksDir, ctx),
    taskControlTool('resume_task', 'Resume a paused task.', tasksDir, ctx),
    taskControlTool(
      'cancel_task',
      'Cancel and delete a scheduled task.',
      tasksDir,
      ctx,
    ),

  ];

  return filterAllowedTools(tools, ctx.allowedTools);
}

function taskControlTool(
  name: 'pause_task' | 'resume_task' | 'cancel_task',
  description: string,
  tasksDir: string,
  ctx: OpenAiToolContext,
): Tool {
  const action = name.replace('_task', '');
  return tool({
    name,
    description,
    parameters: z.object({ task_id: z.string() }),
    strict: true,
    execute: ({ task_id }) => {
      writeIpcFile(tasksDir, {
        type: name,
        taskId: task_id,
        groupFolder: ctx.groupFolder,
        timestamp: new Date().toISOString(),
      });
      return `Task ${task_id} ${action} requested.`;
    },
  });
}
