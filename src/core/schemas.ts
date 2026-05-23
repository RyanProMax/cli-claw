// Zod schemas and validation types for API requests

import { z } from 'zod';
import { MAX_GROUP_NAME_LEN } from '../web/context.js';

export const TaskPatchSchema = z.object({
  prompt: z.string().optional(),
  schedule_type: z.enum(['cron', 'interval', 'once']).optional(),
  schedule_value: z.string().optional(),
  execution_type: z.literal('workflow').optional(),
  script_command: z.string().max(4096).nullable().optional(),
  status: z.enum(['active', 'paused']).optional(),
  next_run: z.string().optional(),
  notify_channels: z
    .array(z.enum(['feishu', 'wechat']))
    .nullable()
    .optional(),
});

// Cron 表达式校验：5 段（分 时 日 月 周）或 6 段（秒 分 时 日 月 周）
// 也允许预定义表达式如 @daily, @hourly 等
const CRON_REGEX =
  /^(@(yearly|annually|monthly|weekly|daily|hourly|minutely|secondly)|(\S+\s+){4,5}\S+)$/;

export const TaskCreateSchema = z
  .object({
    group_folder: z.string().min(1).optional(),
    chat_jid: z.string().min(1).optional(),
    prompt: z.string().optional().default(''),
    schedule_type: z.enum(['cron', 'interval', 'once']),
    schedule_value: z.string().min(1),
    execution_type: z.literal('workflow').optional(),
    script_command: z.string().max(4096).optional(),
    notify_channels: z
      .array(z.enum(['feishu', 'wechat']))
      .nullable()
      .optional(),
  })
  .superRefine((data, ctx) => {
    if (!data.script_command?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['script_command'],
        message: 'Workflow 模式下 workflow id 为必填项',
      });
    }
    if (data.schedule_type === 'cron') {
      if (!CRON_REGEX.test(data.schedule_value.trim())) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['schedule_value'],
          message: 'Invalid cron expression (expected 5 or 6 fields)',
        });
      }
    } else if (data.schedule_type === 'interval') {
      const num = Number(data.schedule_value);
      if (!Number.isFinite(num) || num <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['schedule_value'],
          message: 'Interval must be a positive number (milliseconds)',
        });
      }
    } else if (data.schedule_type === 'once') {
      const ts = Date.parse(data.schedule_value);
      if (isNaN(ts)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['schedule_value'],
          message: 'Once schedule must be a valid ISO 8601 date string',
        });
      }
    }
  });

// 单张图片附件上限 5MB（base64 编码后约 6.67MB）
const MAX_IMAGE_BASE64_LENGTH = (5 * 1024 * 1024 * 4) / 3; // ~6.67M chars

export const MessageAttachmentSchema = z.object({
  type: z.literal('image'),
  data: z.string().min(1).max(MAX_IMAGE_BASE64_LENGTH),
  mimeType: z
    .string()
    .regex(/^image\//)
    .optional(),
});

export const MessageCreateSchema = z
  .object({
    chatJid: z.string().min(1),
    content: z.string().optional().default(''),
    attachments: z.array(MessageAttachmentSchema).max(10).optional(),
  })
  .superRefine((data, ctx) => {
    const hasContent = data.content.trim().length > 0;
    const hasAttachments = (data.attachments?.length ?? 0) > 0;
    if (!hasContent && !hasAttachments) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['content'],
        message: 'content or attachments is required',
      });
    }
  });

export const GroupCreateSchema = z.object({
  name: z.string().min(1).max(MAX_GROUP_NAME_LEN),
  agent_type: z.enum(['openai']).optional(),
  model: z.string().max(128).optional(),
  reasoning_effort: z.enum(['low', 'medium', 'high', 'xhigh']).optional(),
  speed_tier: z.enum(['standard', 'fast']).optional(),
  custom_cwd: z
    .string()
    .optional()
    .transform((val) => (val && val.trim() ? val.trim() : undefined)),
});

export const GroupMemberAddSchema = z.object({
  user_id: z.string().min(1),
});

export const GroupPatchSchema = z.object({
  name: z.string().min(1).max(MAX_GROUP_NAME_LEN).optional(),
  is_pinned: z.boolean().optional(),
  activation_mode: z
    .enum(['auto', 'always', 'when_mentioned', 'disabled'])
    .optional(),
  agent_type: z.enum(['openai']).optional(),
  model: z.string().max(128).nullable().optional(),
  reasoning_effort: z
    .enum(['low', 'medium', 'high', 'xhigh'])
    .nullable()
    .optional(),
  speed_tier: z.enum(['standard', 'fast']).nullable().optional(),
});

export const LoginSchema = z.object({
  password: z.string().min(1),
});

export const SystemSettingsSchema = z.object({
  processTimeout: z.number().int().min(60000).max(86400000).optional(),
  idleTimeout: z.number().int().min(60000).max(86400000).optional(),
  processMaxOutputSize: z.number().int().min(1048576).max(104857600).optional(),
  maxConcurrentProcesses: z.number().int().min(1).max(50).optional(),
  maxLoginAttempts: z.number().int().min(1).max(100).optional(),
  loginLockoutMinutes: z.number().int().min(1).max(1440).optional(),
});

export const AppearanceConfigSchema = z.object({
  appName: z.string().max(32).optional(),
  aiName: z.string().min(1).max(32),
  aiAvatarEmoji: z.string().min(1).max(8),
  aiAvatarColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});

export const ChangePasswordSchema = z.object({
  current_password: z.string().min(1),
  new_password: z.string().min(8).max(128),
});

export const FeishuConfigSchema = z
  .object({
    appId: z.string().max(2000).optional(),
    appSecret: z.string().max(2000).optional(),
    clearAppSecret: z.boolean().optional(),
    enabled: z.boolean().optional(),
  })
  .refine(
    (data) =>
      typeof data.appId === 'string' ||
      typeof data.appSecret === 'string' ||
      data.clearAppSecret === true ||
      typeof data.enabled === 'boolean',
    { message: 'At least one config field must be provided' },
  );

export const WeChatConfigSchema = z.object({
  enabled: z.boolean().optional(),
  clearBotToken: z.boolean().optional(),
  bypassProxy: z.boolean().optional(),
});
