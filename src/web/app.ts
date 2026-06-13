import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { WebSocketServer, WebSocket } from 'ws';
import crypto from 'crypto';
import { resolveAppPath } from '../core/app-root.js';

// Web context and shared utilities
import {
  type WebDeps,
  type Variables,
  type WsClientInfo,
  setWebDeps,
  getWebDeps,
  wsClients,
  lastActiveCache,
  LAST_ACTIVE_DEBOUNCE_MS,
  parseCookie,
  getCachedAccessSession,
  invalidateSessionCache,
} from './context.js';

// Schemas
import { MessageCreateSchema } from '../core/schemas.js';

// Middleware
import { authMiddleware } from './middleware/auth.js';

// Route modules
import authRoutes from './routes/auth.js';
import groupRoutes from './routes/groups.js';
import configRoutes, { injectConfigDeps } from './routes/config.js';
import tasksRoutes from './routes/tasks.js';
import workflowRoutes from './routes/workflows.js';
import fileRoutes from './routes/files.js';
import monitorRoutes from './routes/monitor.js';
import browseRoutes from './routes/browse.js';
import agentRoutes from './routes/agents.js';

// Database and types (only for handleWebUserMessage and broadcast)
import { ensureChatExists, storeMessageDirect } from '../storage/messages.js';
import {
  getRegisteredGroup,
  getJidsByFolder,
  setRegisteredGroup,
} from '../storage/workspaces.js';
import {
  deleteAccessSession,
  updateAccessSessionLastActive,
} from '../storage/access.js';
import { getAgent } from '../storage/agents.js';
import { isSessionExpired } from '../core/auth.js';
import type {
  NewMessage,
  MessageSourceKind,
  RuntimeIdentity,
  WsMessageOut,
  WsMessageIn,
  StreamEvent,
} from '../domain/types.js';
import {
  WEB_PORT,
  SESSION_COOKIE_NAME_SECURE,
  SESSION_COOKIE_NAME_PLAIN,
  ASSISTANT_NAME,
} from '../core/config.js';
import {
  appendStreamPresentationText,
  createEmptyStreamPresentationTextState,
} from '../../shared/dist/stream-presentation.js';
import { logger } from '../core/logger.js';
import { executeSessionReset } from '../commands.js';
import {
  normalizeImageAttachments,
  toAgentImages,
} from '../messaging/attachments.js';
import { getChannelType } from '../messaging/channel.js';
import {
  executeRuntimeWorkspaceCommand,
  resolveRuntimeWorkspaceTarget,
  type ResolvedRuntimeWorkspaceTarget,
} from '../core/runtime/command-handler.js';
import {
  formatUnknownRuntimeCommandReply,
  parseRuntimeCommand,
  parseSlashCommandCandidate,
} from '../core/runtime/command-registry.js';
import {
  discoverSkillCommands,
  executeDiscoveredSkillCommandResult,
  formatSkillCommandHelpLines,
  resolveSkillCommandRoots,
  type SkillCommandExecutionResult,
  type SkillCommandDiscoveryResult,
} from '../skills/command-dispatch.js';

// --- App Setup ---

const app = new Hono<{ Variables: Variables }>();

// --- CORS Middleware ---
const CORS_ALLOWED_ORIGINS = process.env.CORS_ALLOWED_ORIGINS || '';
const CORS_ALLOW_LOCALHOST = process.env.CORS_ALLOW_LOCALHOST !== 'false'; // default: true

function isAllowedOrigin(origin: string | undefined): string | null {
  if (!origin) return null; // same-origin requests
  // 环境变量设为 '*' 时允许所有来源
  if (CORS_ALLOWED_ORIGINS === '*') return origin;
  // 允许 localhost / 127.0.0.1 的任意端口（开发 & 自托管场景，可通过 CORS_ALLOW_LOCALHOST=false 关闭）
  if (CORS_ALLOW_LOCALHOST) {
    try {
      const url = new URL(origin);
      if (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
        return origin;
    } catch {
      /* invalid origin */
    }
  }
  // 自定义白名单（逗号分隔）
  if (CORS_ALLOWED_ORIGINS) {
    const allowed = CORS_ALLOWED_ORIGINS.split(',').map((s) => s.trim());
    if (allowed.includes(origin)) return origin;
  }
  return null;
}

app.use(
  '/api/*',
  cors({
    origin: (origin) => isAllowedOrigin(origin),
    credentials: true,
  }),
);

// --- Global State ---

let deps: WebDeps | null = null;

// --- Route Mounting ---

app.route('/api/auth', authRoutes);
app.route('/api/groups', groupRoutes);
app.route('/api/groups', fileRoutes); // File routes also under /api/groups
app.route('/api/config', configRoutes);
app.route('/api/tasks', tasksRoutes);
app.route('/api/workflows', workflowRoutes);
app.route('/api/browse', browseRoutes);
app.route('/api/groups', agentRoutes); // Agent routes under /api/groups/:jid/agents
app.route('/api', monitorRoutes);

// --- POST /api/messages ---

app.post('/api/messages', authMiddleware, async (c) => {
  const body = await c.req.json().catch(() => ({}));

  const validation = MessageCreateSchema.safeParse(body);
  if (!validation.success) {
    return c.json(
      { error: 'Invalid request body', details: validation.error.format() },
      400,
    );
  }

  const { chatJid, content, attachments } = validation.data;
  const group = getRegisteredGroup(chatJid);
  if (!group) return c.json({ error: 'Group not found' }, 404);
  const result = await handleWebUserMessage(
    chatJid,
    content.trim(),
    attachments,
    'web',
    'Web',
  );
  if (!result.ok) return c.json({ error: result.error }, result.status);
  return c.json({
    success: true,
    messageId: result.messageId,
    timestamp: result.timestamp,
  });
});

function persistImmediateMessage(options: {
  chatJid: string;
  sender: string;
  senderName: string;
  content: string;
  isFromMe: boolean;
  attachments?: string;
  sourceKind?: MessageSourceKind;
}): { messageId: string; timestamp: string } {
  const messageId = crypto.randomUUID();
  const timestamp = new Date().toISOString();

  ensureChatExists(options.chatJid);
  storeMessageDirect(
    messageId,
    options.chatJid,
    options.sender,
    options.senderName,
    options.content,
    timestamp,
    options.isFromMe,
    options.sourceKind
      ? {
          attachments: options.attachments,
          meta: { sourceKind: options.sourceKind },
        }
      : { attachments: options.attachments },
  );

  broadcastNewMessage(options.chatJid, {
    id: messageId,
    chat_jid: options.chatJid,
    sender: options.sender,
    sender_name: options.senderName,
    content: options.content,
    timestamp,
    is_from_me: options.isFromMe,
    attachments: options.attachments,
    ...(options.sourceKind ? { source_kind: options.sourceKind } : {}),
  });

  return { messageId, timestamp };
}

async function handleWebSlashCommand(options: {
  chatJid: string;
  content: string;
  userId: string;
  displayName: string;
  agentId?: string;
  attachments?: Array<{ type: 'image'; data: string; mimeType?: string }>;
}): Promise<
  | { handled: false }
  | {
      handled: false;
      rewrittenContent: string;
      rewrittenSourceKind: MessageSourceKind;
    }
  | {
      handled: true;
      messageId: string;
      timestamp: string;
    }
> {
  if (!deps) return { handled: false };

  const slashCandidate = parseSlashCommandCandidate(options.content);
  if (!slashCandidate) return { handled: false };

  const parsed = parseRuntimeCommand(options.content);

  const displayChatJid = options.agentId
    ? `${options.chatJid}#agent:${options.agentId}`
    : options.chatJid;

  const normalizedAttachments = normalizeImageAttachments(options.attachments, {
    onMimeMismatch: ({ declaredMime, detectedMime }) => {
      logger.warn(
        {
          chatJid: displayChatJid,
          declaredMime,
          detectedMime,
        },
        'Web command attachment MIME mismatch detected, using detected MIME',
      );
    },
  });
  const attachmentsStr =
    normalizedAttachments.length > 0
      ? JSON.stringify(normalizedAttachments)
      : undefined;
  const target = resolveRuntimeWorkspaceTarget(displayChatJid, {
    getGroup: (jid) =>
      deps!.getRegisteredGroups()[jid] ?? getRegisteredGroup(jid),
    getSiblingJids: getJidsByFolder,
    getAgent,
  });

  const persistCommand = () =>
    persistImmediateMessage({
      chatJid: displayChatJid,
      sender: options.userId,
      senderName: options.displayName,
      content: options.content.trim(),
      isFromMe: false,
      attachments: attachmentsStr,
      sourceKind: 'user_command',
    });

  const persistReply = (text: string) => {
    persistImmediateMessage({
      chatJid: displayChatJid,
      sender: 'agent-fabric-agent',
      senderName: ASSISTANT_NAME,
      content: text,
      isFromMe: true,
    });
  };
  const workflowLifecycle = {
    background: true,
    onBackgroundResult: async (message: string) => {
      persistReply(message);
    },
  };

  if (!parsed) {
    const skillResult = await maybeHandleWebSkillCommand({
      displayChatJid,
      slashCandidate,
      target,
    });
    if (skillResult?.kind === 'assistant_prompt') {
      return {
        handled: false,
        rewrittenContent: skillResult.prompt,
        rewrittenSourceKind: 'assistant_prompt',
      };
    }
    if (skillResult?.kind === 'workflow') {
      const { messageId, timestamp } = persistCommand();
      if (deps.handleWorkflowCommand) {
        try {
          const workflowArgs = [skillResult.workflowId, skillResult.prompt]
            .filter((part) => part.trim().length > 0)
            .join(' ');
          persistReply(
            await deps.handleWorkflowCommand(
              displayChatJid,
              workflowArgs,
              {
                command: slashCandidate.rawName.trim().toLowerCase(),
                argsText: slashCandidate.argsText,
                input: skillResult.input,
              },
              { ...workflowLifecycle, triggerMessageId: messageId },
            ),
          );
        } catch (err) {
          logger.error(
            { chatJid: displayChatJid, err },
            '/workflow skill command failed',
          );
          persistReply('工作流触发失败，请稍后重试');
        }
      } else {
        persistReply('当前服务未启用工作流命令');
      }
      return { handled: true, messageId, timestamp };
    }
    const { messageId, timestamp } = persistCommand();
    persistReply(
      skillResult?.content ??
        formatUnknownRuntimeCommandReply(slashCandidate.rawName),
    );
    return { handled: true, messageId, timestamp };
  }

  if (parsed.name === 'sw') {
    const { messageId, timestamp } = persistCommand();
    if (deps.handleSpawnCommand && parsed.argsText) {
      try {
        await deps.handleSpawnCommand(displayChatJid, parsed.argsText);
      } catch (err) {
        logger.error({ chatJid: displayChatJid, err }, '/sw command failed');
        persistReply('并行任务创建失败，请稍后重试');
      }
    } else {
      persistReply('用法: /sw <任务描述>');
    }
    return { handled: true, messageId, timestamp };
  }

  if (parsed.name === 'workflow') {
    const { messageId, timestamp } = persistCommand();
    if (deps.handleWorkflowCommand) {
      try {
        persistReply(
          await deps.handleWorkflowCommand(
            displayChatJid,
            parsed.argsText,
            undefined,
            { ...workflowLifecycle, triggerMessageId: messageId },
          ),
        );
      } catch (err) {
        logger.error(
          { chatJid: displayChatJid, err },
          '/workflow command failed',
        );
        persistReply('工作流触发失败，请稍后重试');
      }
    } else {
      persistReply('当前服务未启用工作流命令');
    }
    return { handled: true, messageId, timestamp };
  }

  if (parsed.name === 'clear') {
    const { messageId, timestamp } = persistCommand();
    const targetGroup = getRegisteredGroup(options.chatJid);
    if (!targetGroup) {
      persistReply('未找到当前工作区');
      return { handled: true, messageId, timestamp };
    }

    try {
      await executeSessionReset(
        options.chatJid,
        targetGroup.folder,
        {
          queue: deps.queue,
          sessions: deps.getSessions(),
          broadcast: broadcastNewMessage,
          setLastAgentTimestamp: deps.setLastAgentTimestamp,
        },
        options.agentId,
      );
    } catch (err) {
      logger.error({ chatJid: displayChatJid, err }, '/clear command failed');
      persistReply('清除上下文失败，请稍后重试');
    }
    return { handled: true, messageId, timestamp };
  }

  const runtimeResult = await executeRuntimeWorkspaceCommand({
    entrypoint: 'web',
    chatJid: displayChatJid,
    commandText: options.content,
    deps: {
      getGroup: (jid) =>
        deps!.getRegisteredGroups()[jid] ?? getRegisteredGroup(jid),
      setGroup: (jid, group) => {
        setRegisteredGroup(jid, group);
        deps!.getRegisteredGroups()[jid] = group;
      },
      getSiblingJids: getJidsByFolder,
      getAgent,
      queue: deps.queue,
      getSessions: deps.getSessions,
    },
  });

  if (runtimeResult.handled) {
    const { messageId, timestamp } = persistCommand();
    if (runtimeResult.reply) {
      const replyText =
        parsed.name === 'help' && target
          ? appendSkillCommandHelp(
              runtimeResult.reply,
              await discoverSkillCommandsForWebTarget(target),
            )
          : runtimeResult.reply;
      persistReply(replyText);
    }
    return { handled: true, messageId, timestamp };
  }

  const { messageId, timestamp } = persistCommand();
  persistReply(
    `当前 Web 入口不支持 /${parsed.name}，请使用 /help 查看当前可用命令`,
  );
  return { handled: true, messageId, timestamp };
}

async function discoverSkillCommandsForWebTarget(
  target: ResolvedRuntimeWorkspaceTarget,
): Promise<SkillCommandDiscoveryResult> {
  return discoverSkillCommands({
    entrypoint: 'web',
    roots: resolveSkillCommandRoots({
      workspaceGroup: target.workspaceGroup,
      homeGroup: target.runtimeOwnerGroup.is_home
        ? target.runtimeOwnerGroup
        : null,
    }),
  });
}

function appendSkillCommandHelp(
  baseReply: string,
  discovered: SkillCommandDiscoveryResult,
): string {
  const skillLines = formatSkillCommandHelpLines(discovered.commands);
  const sections: string[] = [baseReply];

  if (skillLines.length > 0) {
    sections.push(['技能命令：', ...skillLines].join('\n'));
  }

  if (discovered.errors.length > 0) {
    sections.push(
      ['技能命令冲突：', ...discovered.errors.map((line) => `- ${line}`)].join(
        '\n',
      ),
    );
  }

  return sections.join('\n\n');
}

async function maybeHandleWebSkillCommand(options: {
  displayChatJid: string;
  slashCandidate: NonNullable<ReturnType<typeof parseSlashCommandCandidate>>;
  target: ResolvedRuntimeWorkspaceTarget | null;
}): Promise<SkillCommandExecutionResult | null> {
  if (!options.target) return null;

  const discovered = await discoverSkillCommandsForWebTarget(options.target);
  const normalizedName = options.slashCandidate.rawName.trim().toLowerCase();
  const conflictMessage =
    discovered.errors.find((message) =>
      message.includes(`/${normalizedName}`),
    ) ?? null;
  if (conflictMessage) return { kind: 'error', content: conflictMessage };

  const matched = discovered.commands.find(
    (command) => command.name === normalizedName,
  );
  if (!matched) return null;

  return executeDiscoveredSkillCommandResult({
    commandName: normalizedName,
    discovered,
    entrypoint: 'web',
    chatJid: options.displayChatJid,
    argsText: options.slashCandidate.argsText,
    args: options.slashCandidate.args,
    workspace: {
      jid: options.target.workspaceJid,
      folder: options.target.workspaceGroup.folder,
      name: options.target.workspaceGroup.name,
    },
  });
}

// --- handleWebUserMessage ---

async function handleWebUserMessage(
  chatJid: string,
  content: string,
  attachments?: Array<{ type: 'image'; data: string; mimeType?: string }>,
  userId = 'web-user',
  displayName = 'Web',
): Promise<
  | {
      ok: true;
      messageId: string;
      timestamp: string;
    }
  | {
      ok: false;
      status: 404 | 500;
      error: string;
    }
> {
  if (!deps) return { ok: false, status: 500, error: 'Server not initialized' };

  let group = deps.getRegisteredGroups()[chatJid];
  if (!group) {
    // Group may exist in DB but not in memory cache after loadState.
    const dbGroup = getRegisteredGroup(chatJid);
    if (!dbGroup) return { ok: false, status: 404, error: 'Group not found' };
    group = dbGroup;
  }

  const commandResult = await handleWebSlashCommand({
    chatJid,
    content,
    attachments,
    userId,
    displayName,
  });
  if (commandResult.handled) {
    return {
      ok: true,
      messageId: commandResult.messageId,
      timestamp: commandResult.timestamp,
    };
  }

  const contentForProcessing =
    'rewrittenContent' in commandResult && commandResult.rewrittenContent
      ? commandResult.rewrittenContent
      : content;
  const sourceKind =
    'rewrittenSourceKind' in commandResult
      ? commandResult.rewrittenSourceKind
      : null;

  ensureChatExists(chatJid);

  const messageId = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  const normalizedAttachments = normalizeImageAttachments(attachments, {
    onMimeMismatch: ({ declaredMime, detectedMime }) => {
      logger.warn(
        { chatJid, messageId, declaredMime, detectedMime },
        'Web attachment MIME mismatch detected, using detected MIME',
      );
    },
  });
  const attachmentsStr =
    normalizedAttachments.length > 0
      ? JSON.stringify(normalizedAttachments)
      : undefined;
  storeMessageDirect(
    messageId,
    chatJid,
    userId,
    displayName,
    contentForProcessing,
    timestamp,
    false,
    {
      attachments: attachmentsStr,
      meta: sourceKind ? { sourceKind } : undefined,
    },
  );

  broadcastNewMessage(chatJid, {
    id: messageId,
    chat_jid: chatJid,
    sender: userId,
    sender_name: displayName,
    content: contentForProcessing,
    timestamp,
    is_from_me: false,
    attachments: attachmentsStr,
    ...(sourceKind ? { source_kind: sourceKind } : {}),
  });

  const messageForAgent: NewMessage = {
    id: messageId,
    chat_jid: chatJid,
    sender: userId,
    sender_name: displayName,
    content: contentForProcessing,
    timestamp,
    attachments: attachmentsStr,
    source_kind: sourceKind ?? null,
  };
  const formatted = deps.formatMessages([messageForAgent], false);

  // IPC-inject the message into the running agent process.  For home groups,
  // the reply route is dynamically updated via activeRouteUpdaters so we no
  // longer need to kill and restart the process (#99).
  let pipedToActive = false;
  const images = toAgentImages(normalizedAttachments);
  const updateRoute = deps.updateReplyRoute;
  const ipcDecision = deps.shouldBypassActiveRuntimeIpc?.({
    chatJid,
    groupFolder: group.folder,
    messages: [messageForAgent],
  });
  if (ipcDecision?.bypass) {
    deps.queue.enqueueMessageCheck(chatJid);
    logger.warn(
      {
        chatJid,
        groupFolder: group.folder,
        messageId,
        sourceKind: sourceKind ?? null,
        reason: ipcDecision.reason ?? null,
        ignoredSessionId: ipcDecision.ignoredSessionId ?? null,
      },
      'Web active runner IPC bypassed for runtime session isolation',
    );
  } else {
    const sendResult = deps.queue.sendMessage(
      chatJid,
      formatted,
      images,
      () => {
        // IPC write succeeded. Web workspaces clear IM routing; IM-backed
        // workspaces keep their channel JID so active-runner replies still
        // return to the originating channel.
        const replySourceJid = getChannelType(chatJid) ? chatJid : null;
        updateRoute?.(
          group.folder,
          replySourceJid,
          replySourceJid ? [messageForAgent] : undefined,
        );
      },
      { timestamp, id: messageId },
    );
    if (sendResult === 'sent') {
      pipedToActive = true;
    } else {
      deps.queue.enqueueMessageCheck(chatJid);
    }
  }

  // Only advance per-group cursor when we piped directly into a running process.
  //
  // When piped to active, we also mark the group as having pending IPC-injected
  // messages. If the agent crashes without processing them, the close handler
  // resets pendingMessages so drainGroup re-reads from DB.
  if (pipedToActive) {
    deps.advanceAcceptedCursor(chatJid, { timestamp, id: messageId });
    deps.queue.markIpcInjectedMessage(chatJid);
  }
  deps.advanceGlobalCursor({ timestamp, id: messageId });
  return { ok: true, messageId, timestamp };
}

// --- Agent Conversation Message Handler ---

async function handleAgentConversationMessage(
  chatJid: string,
  agentId: string,
  content: string,
  userId: string,
  displayName: string,
  attachments?: Array<{ type: 'image'; data: string; mimeType?: string }>,
): Promise<void> {
  if (!deps) return;

  const agent = getAgent(agentId);
  if (!agent || agent.kind !== 'conversation' || agent.chat_jid !== chatJid) {
    logger.warn(
      { chatJid, agentId },
      'Agent conversation message rejected: agent not found or not a conversation',
    );
    return;
  }

  const virtualChatJid = `${chatJid}#agent:${agentId}`;

  // Store message with virtual chat_jid
  const messageId = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  const normalizedAttachments = normalizeImageAttachments(attachments, {
    onMimeMismatch: ({ declaredMime, detectedMime }) => {
      logger.warn(
        { chatJid, messageId, agentId, declaredMime, detectedMime },
        'Agent conversation attachment MIME mismatch detected, using detected MIME',
      );
    },
  });
  const attachmentsStr =
    normalizedAttachments.length > 0
      ? JSON.stringify(normalizedAttachments)
      : undefined;

  ensureChatExists(virtualChatJid);
  storeMessageDirect(
    messageId,
    virtualChatJid,
    userId,
    displayName,
    content,
    timestamp,
    false,
    { attachments: attachmentsStr },
  );

  // Broadcast new_message with agentId so frontend routes to agent tab
  broadcastNewMessage(
    virtualChatJid,
    {
      id: messageId,
      chat_jid: virtualChatJid,
      sender: userId,
      sender_name: displayName,
      content,
      timestamp,
      is_from_me: false,
      attachments: attachmentsStr,
    },
    agentId,
  );

  // Format for agent
  const shared = false; // agent conversations are not shared
  const formatted = deps.formatMessages(
    [
      {
        id: messageId,
        chat_jid: virtualChatJid,
        sender: userId,
        sender_name: displayName,
        content,
        timestamp,
      },
    ],
    shared,
  );

  // Try to pipe into running agent process
  const agentImages = toAgentImages(normalizedAttachments);
  const agentSendResult = deps.queue.sendMessage(
    virtualChatJid,
    formatted,
    agentImages,
    undefined,
    { timestamp, id: messageId },
  );
  if (agentSendResult === 'no_active') {
    // No running process — force close any stale state and start fresh.
    // Mirrors the reliable IM path in buildOnAgentMessage() (#240).
    deps.queue.closeStdin(virtualChatJid);
    if (deps.processAgentConversation) {
      const taskId = `agent-conv:${agentId}:${Date.now()}`;
      deps.queue.enqueueTask(virtualChatJid, taskId, async () => {
        await deps!.processAgentConversation!(chatJid, agentId);
      });
    }
  }
  if (agentSendResult === 'sent') {
    deps.advanceAcceptedCursor(virtualChatJid, { timestamp, id: messageId });
    deps.queue.markIpcInjectedMessage(virtualChatJid);
  }
}

// --- Static Files ---

const WEB_DIST_ROOT = resolveAppPath('web', 'dist');

// 带 content hash 的静态资源：长期不可变缓存
app.use(
  '/assets/*',
  async (c, next) => {
    await next();
    if (c.res.status === 200) {
      c.res.headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    }
  },
  serveStatic({ root: WEB_DIST_ROOT }),
);

// SPA fallback：index.html / sw.js 等必须每次验证
app.use(
  '/*',
  async (c, next) => {
    await next();
    if (c.res.status === 200) {
      const p = c.req.path;
      // 非文件扩展名路径（SPA fallback → index.html）、SW 脚本、manifest 禁止缓存
      if (
        !p.match(/\.\w+$/) ||
        p === '/sw.js' ||
        p === '/registerSW.js' ||
        p === '/manifest.webmanifest'
      ) {
        c.res.headers.set(
          'Cache-Control',
          'no-cache, no-store, must-revalidate',
        );
      }
    }
  },
  serveStatic({
    root: WEB_DIST_ROOT,
    rewriteRequestPath: (p) => {
      // SPA fallback
      if (p.startsWith('/api') || p.startsWith('/ws')) return p;
      if (p.match(/\.\w+$/)) return p; // Has file extension
      return '/index.html';
    },
  }),
);

// --- WebSocket ---

function setupWebSocket(server: any): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request: any, socket: any, head: any) => {
    const { pathname } = new URL(request.url, `http://${request.headers.host}`);

    if (pathname !== '/ws') {
      socket.destroy();
      return;
    }

    // Verify session cookie
    const cookies = parseCookie(request.headers.cookie);
    const token =
      cookies[SESSION_COOKIE_NAME_SECURE] || cookies[SESSION_COOKIE_NAME_PLAIN];
    if (!token) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    const session = getCachedAccessSession(token);
    if (!session) {
      invalidateSessionCache(token);
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    if (isSessionExpired(session.expires_at)) {
      deleteAccessSession(token);
      invalidateSessionCache(token);
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    request.__agentFabricSessionId = token;

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });

  wss.on('connection', (ws, request: any) => {
    const sessionId = request?.__agentFabricSessionId as string | undefined;
    logger.info('WebSocket client connected');
    wsClients.set(ws, {
      sessionId: sessionId || '',
    });

    // Push streaming snapshots for active groups.
    if (sessionId && streamingSnapshots.size > 0) {
      for (const [jid, snap] of streamingSnapshots) {
        // Skip stale snapshots (> 30 min)
        // Extended from 5 min to 30 min to support long-running sub-agents.
        // See GitHub issue #241.
        if (Date.now() - snap.updatedAt > 30 * 60 * 1000) {
          streamingSnapshots.delete(jid);
          continue;
        }
        // Skip empty snapshots
        if (
          !snap.partialText &&
          !snap.commentaryText &&
          snap.activeTools.length === 0 &&
          snap.recentEvents.length === 0
        ) {
          continue;
        }
        try {
          ws.send(
            JSON.stringify({
              type: 'stream_snapshot',
              chatJid: jid,
              snapshot: {
                partialText: snap.partialText,
                commentaryText: snap.commentaryText,
                activeTools: snap.activeTools,
                recentEvents: snap.recentEvents,
                todos: snap.todos,
                systemStatus: snap.systemStatus,
                turnId: snap.turnId,
                sessionId: snap.sessionId,
                runtimeIdentity: snap.runtimeIdentity ?? null,
              },
            } satisfies WsMessageOut),
          );
        } catch {
          /* client not ready */
        }
      }
    }

    // Push runner_state: 'running' for all active groups on WS connect.
    // This prevents a race where a late-arriving new_message clears
    // waiting=false after snapshot restore, blocking all subsequent
    // stream events. The runner_state event resets waiting=true.
    if (sessionId && deps) {
      const queueStatus = deps.queue.getStatus();
      for (const g of queueStatus.groups) {
        if (!g.active) continue;
        const jid = normalizeHomeJid(g.jid);
        try {
          ws.send(
            JSON.stringify({
              type: 'runner_state',
              chatJid: jid,
              state: 'running',
            } satisfies WsMessageOut),
          );
        } catch {
          /* client not ready */
        }
      }
    }

    ws.on('message', async (data) => {
      if (!deps) return;

      try {
        if (!sessionId) {
          ws.close(1008, 'Unauthorized');
          return;
        }

        const session = getCachedAccessSession(sessionId);
        if (!session || isSessionExpired(session.expires_at)) {
          if (session && isSessionExpired(session.expires_at)) {
            deleteAccessSession(sessionId);
          }
          invalidateSessionCache(sessionId);
          ws.close(1008, 'Unauthorized');
          return;
        }

        const now = Date.now();
        const lastUpdate = lastActiveCache.get(sessionId) || 0;
        if (now - lastUpdate > LAST_ACTIVE_DEBOUNCE_MS) {
          lastActiveCache.set(sessionId, now);
          try {
            updateAccessSessionLastActive(sessionId);
          } catch {
            /* best effort */
          }
        }

        const msg: WsMessageIn = JSON.parse(data.toString());

        const sendWsError = (error: string, chatJid?: string) => {
          const msg: WsMessageOut = { type: 'ws_error', error, chatJid };
          ws.send(JSON.stringify(msg));
        };

        if (msg.type === 'send_message') {
          const wsValidation = MessageCreateSchema.safeParse({
            chatJid: msg.chatJid,
            content: msg.content,
            attachments: msg.attachments,
          });
          if (!wsValidation.success) {
            sendWsError('消息格式无效', msg.chatJid);
            logger.warn(
              {
                chatJid: msg.chatJid,
                issues: wsValidation.error.issues.map((i) => i.message),
              },
              'WebSocket send_message validation failed',
            );
            return;
          }
          const { chatJid, content, attachments } = wsValidation.data;
          const agentId = (msg as { agentId?: string }).agentId;

          const commandResult = await handleWebSlashCommand({
            chatJid,
            content,
            attachments,
            userId: 'web',
            displayName: 'Web',
            agentId,
          });
          if (commandResult.handled) {
            return;
          }

          // Route to agent conversation handler if agentId is present
          if (agentId && deps) {
            await handleAgentConversationMessage(
              chatJid,
              agentId,
              content.trim(),
              'web',
              'Web',
              attachments,
            );
            return;
          }

          const result = await handleWebUserMessage(
            chatJid,
            content.trim(),
            attachments,
            'web',
            'Web',
          );
          if (!result.ok) {
            logger.warn(
              { chatJid, status: result.status, error: result.error },
              'WebSocket message rejected',
            );
          }
        }
      } catch (err) {
        logger.error({ err }, 'Error handling WebSocket message');
      }
    });

    ws.on('close', () => {
      logger.info('WebSocket client disconnected');
      wsClients.delete(ws);
    });

    ws.on('error', (err) => {
      logger.error({ err }, 'WebSocket error');
      wsClients.delete(ws);
    });
  });

  return wss;
}

// --- Broadcast Functions ---

/**
 * Broadcast a WebSocket message to authenticated instance sessions.
 */
function safeBroadcast(msg: WsMessageOut): void {
  const data = JSON.stringify(msg);
  for (const [client, clientInfo] of wsClients) {
    if (client.readyState !== WebSocket.OPEN) {
      wsClients.delete(client);
      continue;
    }

    if (!clientInfo.sessionId) {
      wsClients.delete(client);
      try {
        client.close(1008, 'Unauthorized');
      } catch {
        /* ignore */
      }
      continue;
    }

    const session = getCachedAccessSession(clientInfo.sessionId);
    const expired = !!session && isSessionExpired(session.expires_at);
    const invalid = !session || expired;
    if (invalid) {
      if (expired) {
        deleteAccessSession(clientInfo.sessionId);
      }
      invalidateSessionCache(clientInfo.sessionId);
      wsClients.delete(client);
      try {
        client.close(1008, 'Unauthorized');
      } catch {
        /* ignore */
      }
      continue;
    }

    try {
      client.send(data);
    } catch {
      wsClients.delete(client);
    }
  }
}

export function invalidateAllowedUserCache(chatJid: string): void {
  void chatJid;
}

/**
 * Normalize chatJid for WebSocket broadcasts.
 * IM groups that share a folder with an is_home group are mapped
 * to that home group's web JID so the frontend can match all home-session events.
 */
function normalizeHomeJid(chatJid: string): string {
  if (chatJid.startsWith('web:')) return chatJid;
  const group = getRegisteredGroup(chatJid);
  if (!group) return chatJid;

  // Find the web: JID that shares this folder (typically the is_home group)
  const jids = getJidsByFolder(group.folder);
  for (const jid of jids) {
    if (jid.startsWith('web:')) {
      return jid;
    }
  }
  return chatJid;
}

export function broadcastToWebClients(chatJid: string, text: string): void {
  const timestamp = new Date().toISOString();
  const jid = normalizeHomeJid(chatJid);
  safeBroadcast({ type: 'agent_reply', chatJid: jid, text, timestamp });
}

export function broadcastNewMessage(
  chatJid: string,
  msg: NewMessage & { is_from_me?: boolean },
  agentId?: string,
  source?: string,
): void {
  // For virtual JIDs like "web:xxx#agent:yyy", extract base JID and agentId
  let baseChatJid = chatJid;
  let effectiveAgentId = agentId;
  if (chatJid.includes('#agent:')) {
    const parts = chatJid.split('#agent:');
    baseChatJid = parts[0];
    if (!effectiveAgentId) effectiveAgentId = parts[1];
  }
  const jid = normalizeHomeJid(baseChatJid);
  const wsMsg: WsMessageOut = {
    type: 'new_message',
    chatJid: jid,
    message: { ...msg, is_from_me: msg.is_from_me ?? false },
    ...(effectiveAgentId ? { agentId: effectiveAgentId } : {}),
    ...(source ? { source } : {}),
  };
  safeBroadcast(wsMsg);
}

export function broadcastTyping(chatJid: string, isTyping: boolean): void {
  const jid = normalizeHomeJid(chatJid);
  safeBroadcast({ type: 'typing', chatJid: jid, isTyping });
}

// ─── Streaming Snapshot Accumulation ─────────────────────────────────
// Tracks current streaming state per group so WS reconnects can recover.

interface StreamingSnapshotEntry {
  partialText: string;
  lastTextMessageUuid?: string;
  commentaryText: string;
  lastCommentaryMessageUuid?: string;
  activeTools: Array<{
    toolName: string;
    toolUseId: string;
    startTime: number;
    toolInputSummary?: string;
    parentToolUseId?: string | null;
  }>;
  recentEvents: Array<{
    id: string;
    timestamp: number;
    text: string;
    kind: 'tool' | 'skill' | 'hook' | 'status';
  }>;
  todos?: Array<{ id: string; content: string; status: string }>;
  systemStatus: string | null;
  turnId?: string;
  messageCursorId?: string;
  sessionId?: string;
  runtimeIdentity?: RuntimeIdentity | null;
  updatedAt: number;
}

const streamingSnapshots = new Map<string, StreamingSnapshotEntry>();
/** Accumulates full (non-truncated) answer/commentary text per group for shutdown persistence & disk buffer. */
const streamingFullTexts = new Map<
  string,
  {
    partialText: string;
    commentaryText: string;
    lastTextMessageUuid?: string;
    lastCommentaryMessageUuid?: string;
    turnId?: string;
    messageCursorId?: string;
  }
>();
const MAX_SNAPSHOT_TEXT = 4000;
const MAX_SNAPSHOT_EVENTS = 20;

/** Push a recent event entry and truncate to MAX_SNAPSHOT_EVENTS. */
function pushRecentEvent(
  snap: StreamingSnapshotEntry,
  event: {
    id: string;
    timestamp: number;
    text: string;
    kind: 'tool' | 'skill' | 'hook' | 'status';
  },
): void {
  snap.recentEvents.push(event);
  if (snap.recentEvents.length > MAX_SNAPSHOT_EVENTS) {
    snap.recentEvents = snap.recentEvents.slice(-MAX_SNAPSHOT_EVENTS);
  }
}

function updateStreamingSnapshot(
  normalizedJid: string,
  event: StreamEvent,
): void {
  let snap = streamingSnapshots.get(normalizedJid);
  const nextMessageCursorId = event.messageCursor?.id?.trim() || undefined;

  // Reset on new turn/cursor. Some runtimes can reuse turnId across queued IPC
  // turns, so messageCursor.id is the stricter boundary when it is present.
  const turnChanged = Boolean(
    snap?.turnId && event.turnId && snap.turnId !== event.turnId,
  );
  const cursorChanged = Boolean(
    snap?.messageCursorId &&
    nextMessageCursorId &&
    snap.messageCursorId !== nextMessageCursorId,
  );
  if (turnChanged || cursorChanged) {
    snap = undefined;
    streamingFullTexts.delete(normalizedJid);
  }

  if (!snap) {
    const initialText = createEmptyStreamPresentationTextState();
    snap = {
      partialText: initialText.answerText,
      commentaryText: initialText.commentaryText,
      activeTools: [],
      recentEvents: [],
      systemStatus: null,
      turnId: event.turnId,
      messageCursorId: nextMessageCursorId,
      sessionId: event.sessionId,
      updatedAt: Date.now(),
    };
  }

  snap.updatedAt = Date.now();
  if (event.turnId) snap.turnId = event.turnId;
  if (nextMessageCursorId) snap.messageCursorId = nextMessageCursorId;
  if (event.sessionId) snap.sessionId = event.sessionId;
  if (event.runtimeIdentity) snap.runtimeIdentity = event.runtimeIdentity;

  switch (event.eventType) {
    case 'text_delta':
      if (event.text) {
        const appended = appendStreamPresentationText(
          {
            answerText: snap.partialText,
            commentaryText: snap.commentaryText,
            lastAnswerMessageUuid: snap.lastTextMessageUuid,
            lastCommentaryMessageUuid: snap.lastCommentaryMessageUuid,
          },
          event,
          snap.runtimeIdentity,
        );
        snap.partialText = appended.answerText;
        snap.commentaryText = appended.commentaryText;
        snap.lastTextMessageUuid = appended.lastAnswerMessageUuid;
        snap.lastCommentaryMessageUuid = appended.lastCommentaryMessageUuid;
        if (snap.partialText.length > MAX_SNAPSHOT_TEXT) {
          snap.partialText = snap.partialText.slice(-MAX_SNAPSHOT_TEXT);
        }
        if (snap.commentaryText.length > MAX_SNAPSHOT_TEXT) {
          snap.commentaryText = snap.commentaryText.slice(-MAX_SNAPSHOT_TEXT);
        }
        // Accumulate full (non-truncated) answer/commentary text for shutdown persistence
        const fullAppended = appendStreamPresentationText(
          (() => {
            const current = streamingFullTexts.get(normalizedJid);
            return current
              ? {
                  answerText: current.partialText,
                  commentaryText: current.commentaryText,
                  lastAnswerMessageUuid: current.lastTextMessageUuid,
                  lastCommentaryMessageUuid: current.lastCommentaryMessageUuid,
                }
              : createEmptyStreamPresentationTextState();
          })(),
          event,
          snap.runtimeIdentity,
        );
        streamingFullTexts.set(normalizedJid, {
          partialText: fullAppended.answerText,
          commentaryText: fullAppended.commentaryText,
          lastTextMessageUuid: fullAppended.lastAnswerMessageUuid,
          lastCommentaryMessageUuid: fullAppended.lastCommentaryMessageUuid,
          turnId: snap.turnId,
          messageCursorId: snap.messageCursorId,
        });
      }
      break;

    case 'tool_use_start':
      if (event.toolUseId && event.toolName) {
        snap.activeTools.push({
          toolName: event.toolName,
          toolUseId: event.toolUseId,
          startTime: Date.now(),
          toolInputSummary: event.toolInputSummary,
          parentToolUseId: event.parentToolUseId,
        });
        pushRecentEvent(snap, {
          id: event.toolUseId,
          timestamp: Date.now(),
          text: event.skillName || event.toolName,
          kind: event.skillName ? 'skill' : 'tool',
        });
      }
      break;

    case 'tool_use_end':
      if (event.toolUseId) {
        snap.activeTools = snap.activeTools.filter(
          (t) => t.toolUseId !== event.toolUseId,
        );
      }
      break;

    case 'tool_progress':
      if (event.toolUseId) {
        const tool = snap.activeTools.find(
          (t) => t.toolUseId === event.toolUseId,
        );
        if (tool) {
          if (event.toolInputSummary)
            tool.toolInputSummary = event.toolInputSummary;
        }
      }
      break;

    case 'status':
      snap.systemStatus = event.statusText || null;
      if (event.statusText) {
        pushRecentEvent(snap, {
          id: `status-${Date.now()}`,
          timestamp: Date.now(),
          text: event.statusText,
          kind: 'status',
        });
      }
      break;

    case 'hook_started':
      if (event.hookName) {
        pushRecentEvent(snap, {
          id: `hook-${Date.now()}`,
          timestamp: Date.now(),
          text: `${event.hookName} (${event.hookEvent || ''})`,
          kind: 'hook',
        });
      }
      break;

    case 'todo_update':
      if (event.todos) {
        snap.todos = event.todos.map((t) => ({
          id: t.id,
          content: t.content,
          status: t.status,
        }));
      }
      break;
  }

  streamingSnapshots.set(normalizedJid, snap);
}

export function clearStreamingSnapshot(chatJid: string): void {
  const jid = normalizeHomeJid(chatJid);
  streamingSnapshots.delete(jid);
  streamingFullTexts.delete(jid);
}

/**
 * Return all active streaming texts with non-empty content.
 * Uses the full (non-truncated) text accumulator for shutdown persistence & disk buffer.
 */
export function getActiveStreamingTexts(): Map<
  string,
  {
    partialText: string;
    commentaryText: string;
    turnId?: string;
    messageCursorId?: string;
  }
> {
  const result = new Map<
    string,
    {
      partialText: string;
      commentaryText: string;
      turnId?: string;
      messageCursorId?: string;
    }
  >();
  for (const [jid, fullText] of streamingFullTexts) {
    const partialText = fullText.partialText.trim();
    const commentaryText = fullText.commentaryText.trim();
    if (partialText || commentaryText) {
      result.set(jid, {
        partialText,
        commentaryText,
        ...(fullText.turnId ? { turnId: fullText.turnId } : {}),
        ...(fullText.messageCursorId
          ? { messageCursorId: fullText.messageCursorId }
          : {}),
      });
    }
  }
  return result;
}

export function broadcastStreamEvent(
  chatJid: string,
  event: StreamEvent,
  agentId?: string,
): void {
  const jid = normalizeHomeJid(chatJid);
  const msg: WsMessageOut = agentId
    ? { type: 'stream_event', chatJid: jid, event, agentId }
    : { type: 'stream_event', chatJid: jid, event };
  safeBroadcast(msg);

  // Accumulate snapshot for both main and agent streams.
  // Agent streams use virtual JID format (jid#agent:agentId) as the key.
  const snapshotJid = agentId ? `${jid}#agent:${agentId}` : jid;
  updateStreamingSnapshot(snapshotJid, event);
}

export function broadcastGroupCreated(
  jid: string,
  folder: string,
  name: string,
): void {
  safeBroadcast({ type: 'group_created', jid, folder, name });
}

export function broadcastAgentStatus(
  chatJid: string,
  agentId: string,
  status: import('../domain/types.js').AgentStatus,
  name: string,
  prompt: string,
  resultSummary?: string,
  kind?: import('../domain/types.js').AgentKind,
): void {
  const jid = normalizeHomeJid(chatJid);
  // Resolve kind from DB if not provided
  const resolvedKind = kind || getAgent(agentId)?.kind;
  const msg: WsMessageOut = {
    type: 'agent_status',
    chatJid: jid,
    agentId,
    status,
    kind: resolvedKind,
    name,
    prompt,
    resultSummary,
  };
  safeBroadcast(msg);
}

export function broadcastRunnerState(
  chatJid: string,
  state: 'idle' | 'running',
): void {
  const jid = normalizeHomeJid(chatJid);
  const msg: WsMessageOut = {
    type: 'runner_state',
    chatJid: jid,
    state,
  };
  safeBroadcast(msg);

  // Clear streaming snapshots when runner goes idle (main + all agent snapshots)
  if (state === 'idle') {
    streamingSnapshots.delete(jid);
    streamingFullTexts.delete(jid);
    // Collect keys first, then delete (avoid mutating Map during iteration)
    const agentPrefix = jid + '#agent:';
    const snapshotKeysToDelete = [...streamingSnapshots.keys()].filter((k) =>
      k.startsWith(agentPrefix),
    );
    const fullTextKeysToDelete = [...streamingFullTexts.keys()].filter((k) =>
      k.startsWith(agentPrefix),
    );
    for (const key of snapshotKeysToDelete) streamingSnapshots.delete(key);
    for (const key of fullTextKeysToDelete) streamingFullTexts.delete(key);
  }
}

function broadcastStatus(): void {
  if (!deps) return;

  const queueStatus = deps.queue.getStatus();
  safeBroadcast({
    type: 'status_update',
    activeProcesses: queueStatus.activeProcessCount,
    activeTotal: queueStatus.activeCount,
    queueLength: queueStatus.waitingCount,
  });
}

// --- Server Startup ---

let statusInterval: ReturnType<typeof setInterval> | null = null;
let httpServer: ReturnType<typeof serve> | null = null;
let wss: WebSocketServer | null = null;

export function startWebServer(webDeps: WebDeps): void {
  deps = webDeps;
  setWebDeps(webDeps);
  injectConfigDeps(webDeps);

  httpServer = serve(
    {
      fetch: app.fetch,
      port: WEB_PORT,
    },
    (info) => {
      logger.info({ port: info.port }, 'Web server started');
    },
  );

  wss = setupWebSocket(httpServer);

  // Register runner state change callback for sidebar indicators
  webDeps.queue.setOnRunnerStateChange(broadcastRunnerState);

  // Broadcast status every 5 seconds
  if (statusInterval) clearInterval(statusInterval);
  statusInterval = setInterval(broadcastStatus, 5000);
}

// --- Exports ---

export function setWebDepsForTests(webDeps: WebDeps): void {
  deps = webDeps;
  setWebDeps(webDeps);
}

export { handleWebUserMessage as handleWebUserMessageForTests };

export async function shutdownWebServer(): Promise<void> {
  if (statusInterval) {
    clearInterval(statusInterval);
    statusInterval = null;
  }
  // Close all WebSocket connections
  for (const client of wsClients.keys()) {
    try {
      client.close(1001, 'Server shutting down');
    } catch {
      /* ignore */
    }
  }
  wsClients.clear();
  // Close WebSocket server
  if (wss) {
    wss.close();
    wss = null;
  }
  // Close HTTP server
  if (httpServer) {
    httpServer.close();
    httpServer = null;
  }
}

export type { WebDeps } from './context.js';
