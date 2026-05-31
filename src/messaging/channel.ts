/**
 * Unified IM Channel Interface
 *
 * Defines a standard interface for supported IM integrations.
 * and provides adapter factories that wrap existing connection implementations.
 */
import {
  createFeishuConnection,
  type FeishuConnection,
  type FeishuConnectionConfig,
} from './providers/feishu/index.js';
import {
  createWeChatConnection,
  type WeChatConnection,
  type WeChatConnectionConfig,
} from './providers/wechat/index.js';
import { logger } from '../core/logger.js';
import {
  StreamingCardController,
  type StreamingCardOptions,
} from './providers/feishu/streaming-card.js';
import { CHANNEL_PREFIXES } from './channel-prefixes.js';
import {
  formatAssistantMetaFooter,
  type AssistantFooterTokenUsage,
} from '../presentation/assistant-meta-footer.js';
import type {
  MessageFinalizationReason,
  MessageSourceKind,
  RuntimeIdentity,
} from '../domain/types.js';
import type { IMCommandContext } from './slash-command.js';

// ─── Unified Interface ──────────────────────────────────────────

export interface IMChannelConnectOpts {
  onReady: () => void;
  onNewChat: (chatJid: string, chatName: string) => void;
  onMessage?: (chatJid: string, text: string, senderName: string) => void;
  ignoreMessagesBefore?: number;
  startupBackfillChatIds?: string[];
  startupBackfillIgnoreMessagesBefore?: number;
  isChatAuthorized?: (jid: string) => boolean;
  onPairAttempt?: (
    jid: string,
    chatName: string,
    code: string,
  ) => Promise<boolean>;
  /**
   * Slash command callback (e.g. /clear).
   * Return reply text for known commands; return null to emit the default
   * unsupported-command reply without falling through to model execution.
   */
  onCommand?: (
    chatJid: string,
    command: string,
    context?: IMCommandContext,
  ) => Promise<string | null>;
  /** Explicit operator phrases rewritten to managed commands before model execution */
  resolveManagedCommandText?: (chatJid: string, text: string) => string | null;
  /** 根据 jid 解析群组 folder，用于下载文件/图片到工作区 */
  resolveGroupFolder?: (jid: string) => string | undefined;
  /** 将 IM chatJid 解析为入口路由目标 JID（任务线程或工作区主线） */
  resolveEffectiveChatJid?: (
    chatJid: string,
  ) => { effectiveJid: string; agentId: string | null } | null;
  /** 当 IM 消息被路由到任务线程后调用，触发 agent 处理 */
  onAgentMessage?: (baseChatJid: string, agentId: string) => void;
  /** Bot 被添加到群聊时调用 */
  onBotAddedToGroup?: (chatJid: string, chatName: string) => void;
  /** Bot 被移出群聊或群被解散时调用 */
  onBotRemovedFromGroup?: (chatJid: string) => void;
  /** 群聊消息过滤：bot 未被 @mention 时调用，返回 true 则处理，false 则丢弃 */
  shouldProcessGroupMessage?: (chatJid: string) => boolean;
  /** 飞书流式卡片按钮中断回调 */
  onCardInterrupt?: (chatJid: string) => void;
  /** 飞书流式卡片 runtime 修改回调 */
  onCardRuntimeUpdate?: (
    chatJid: string,
    update: {
      action: 'set_runtime_model' | 'set_runtime_effort' | 'set_runtime_speed';
      value: string;
    },
  ) => Promise<string | null>;
}

export interface OutboundMessageMeta {
  turnId?: string;
  sessionId?: string;
  sdkMessageUuid?: string;
  sourceKind?: MessageSourceKind | null;
  finalizationReason?: MessageFinalizationReason | null;
  runtimeIdentity?: RuntimeIdentity | null;
  tokenUsage?: AssistantFooterTokenUsage | string | null;
  routeFooter?: string | null;
}

export interface IMChannel {
  readonly channelType: string;
  connect(opts: IMChannelConnectOpts): Promise<boolean>;
  disconnect(): Promise<void>;
  sendMessage(
    chatId: string,
    text: string,
    localImagePaths?: string[],
    messageMeta?: OutboundMessageMeta,
  ): Promise<void>;
  /** Send file to chat (if supported) */
  sendFile?(chatId: string, filePath: string, fileName: string): Promise<void>;
  sendImage?(
    chatId: string,
    imageBuffer: Buffer,
    mimeType: string,
    caption?: string,
    fileName?: string,
  ): Promise<void>;
  setTyping(chatId: string, isTyping: boolean): Promise<void>;
  /** Clear the ack reaction for a chat (e.g. when streaming card handled the reply) */
  clearAckReaction?(chatId: string): void;
  isConnected(): boolean;
  syncGroups?(): Promise<void>;
  /** Create a streaming card session for real-time card updates (Feishu only) */
  createStreamingSession?(
    chatId: string,
    onCardCreated?: (messageId: string) => void,
  ): StreamingCardController | undefined;
  getChatInfo?(chatId: string): Promise<{
    avatar?: string;
    name?: string;
    user_count?: string;
    chat_type?: string;
    chat_mode?: string;
  } | null>;
}

function applyTextChannelFooter(
  text: string,
  messageMeta?: OutboundMessageMeta,
): string {
  if (!messageMeta) return text;
  const assistantFooter = formatAssistantMetaFooter({
    runtimeIdentity: messageMeta.runtimeIdentity,
    tokenUsage: messageMeta.tokenUsage,
  });
  const footer = [assistantFooter, messageMeta.routeFooter]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(' | ');
  if (!footer) return text;
  const base = text.trimEnd();
  return base ? `${base}\n\n${footer}` : footer;
}

// ─── Channel Registry ───────────────────────────────────────────

/** Channel registry derived from the shared CHANNEL_PREFIXES. */
export const CHANNEL_REGISTRY: Record<string, { prefix: string }> =
  Object.fromEntries(
    Object.entries(CHANNEL_PREFIXES).map(([type, prefix]) => [
      type,
      { prefix },
    ]),
  );

/**
 * Determine the channel type from a JID string.
 * Returns the matching channelType key or null if no prefix matches.
 */
export function getChannelType(jid: string): string | null {
  for (const [type, prefix] of Object.entries(CHANNEL_PREFIXES)) {
    if (type === 'web') continue;
    if (jid.startsWith(prefix)) return type;
  }
  return null;
}

/**
 * Strip the channel prefix from a JID, returning the raw chat ID.
 */
export function extractChatId(jid: string): string {
  for (const prefix of Object.values(CHANNEL_PREFIXES)) {
    if (jid.startsWith(prefix)) return jid.slice(prefix.length);
  }
  return jid;
}

// ─── Feishu Adapter ─────────────────────────────────────────────

export function createFeishuChannel(config: FeishuConnectionConfig): IMChannel {
  let inner: FeishuConnection | null = null;

  const channel: IMChannel = {
    channelType: 'feishu',

    async connect(opts: IMChannelConnectOpts): Promise<boolean> {
      inner = createFeishuConnection(config);
      const connected = await inner.connect({
        onReady: opts.onReady,
        onNewChat: opts.onNewChat,
        ignoreMessagesBefore: opts.ignoreMessagesBefore,
        startupBackfillChatIds: opts.startupBackfillChatIds,
        startupBackfillIgnoreMessagesBefore:
          opts.startupBackfillIgnoreMessagesBefore,
        onCommand: opts.onCommand,
        resolveManagedCommandText: opts.resolveManagedCommandText,
        resolveGroupFolder: opts.resolveGroupFolder,
        resolveEffectiveChatJid: opts.resolveEffectiveChatJid,
        onAgentMessage: opts.onAgentMessage,
        onBotAddedToGroup: opts.onBotAddedToGroup,
        onBotRemovedFromGroup: opts.onBotRemovedFromGroup,
        shouldProcessGroupMessage: opts.shouldProcessGroupMessage,
        onCardInterrupt: opts.onCardInterrupt,
        onCardRuntimeUpdate: opts.onCardRuntimeUpdate,
      });
      if (!connected) {
        inner = null;
      }
      return connected;
    },

    async disconnect(): Promise<void> {
      if (inner) {
        await inner.stop();
        inner = null;
      }
    },

    async sendMessage(
      chatId: string,
      text: string,
      localImagePaths?: string[],
      messageMeta?: OutboundMessageMeta,
    ): Promise<void> {
      if (!inner) {
        logger.warn(
          { chatId },
          'Feishu channel not connected, skip sending message',
        );
        throw new Error('Feishu channel not connected');
      }
      await inner.sendMessage(chatId, text, localImagePaths, messageMeta);
    },

    async sendImage(
      chatId: string,
      imageBuffer: Buffer,
      mimeType: string,
      caption?: string,
      fileName?: string,
    ): Promise<void> {
      if (!inner) {
        logger.warn(
          { chatId },
          'Feishu channel not connected, skip sending image',
        );
        return;
      }
      await inner.sendImage(chatId, imageBuffer, mimeType, caption, fileName);
    },

    async setTyping(chatId: string, isTyping: boolean): Promise<void> {
      if (!inner) return;
      await inner.sendReaction(chatId, isTyping);
    },

    clearAckReaction(chatId: string): void {
      if (!inner) return;
      inner.clearAckReaction(chatId);
    },

    isConnected(): boolean {
      return inner?.isConnected() ?? false;
    },

    async syncGroups(): Promise<void> {
      if (!inner) return;
      await inner.syncGroups();
    },

    async sendFile(
      chatId: string,
      filePath: string,
      fileName: string,
    ): Promise<void> {
      if (!inner) {
        logger.warn(
          { chatId },
          'Feishu channel not connected, skip sending file',
        );
        return;
      }
      await inner.sendFile(chatId, filePath, fileName);
    },

    async getChatInfo(chatId: string) {
      if (!inner) return null;
      return inner.getChatInfo(chatId);
    },

    createStreamingSession(
      chatId: string,
      onCardCreated?: (messageId: string) => void,
    ): StreamingCardController | undefined {
      if (!inner) return undefined;
      const larkClient = inner.getLarkClient();
      if (!larkClient) return undefined;
      const opts: StreamingCardOptions = {
        client: larkClient,
        chatId,
        replyToMsgId: inner.getLastMessageId(chatId),
        onCardCreated,
        onTerminal: () => inner?.clearAckReaction(chatId),
      };
      return new StreamingCardController(opts);
    },
  };

  return channel;
}

// ─── WeChat Adapter ─────────────────────────────────────────────

export function createWeChatChannel(config: WeChatConnectionConfig): IMChannel {
  let inner: WeChatConnection | null = null;

  const channel: IMChannel = {
    channelType: 'wechat',

    async connect(opts: IMChannelConnectOpts): Promise<boolean> {
      inner = createWeChatConnection(config);
      try {
        await inner.connect({
          onReady: opts.onReady,
          onNewChat: opts.onNewChat,
          onCommand: opts.onCommand,
          ignoreMessagesBefore: opts.ignoreMessagesBefore,
          resolveGroupFolder: opts.resolveGroupFolder,
          resolveEffectiveChatJid: opts.resolveEffectiveChatJid,
          onAgentMessage: opts.onAgentMessage,
        });
        return inner.isConnected();
      } catch (err) {
        logger.error({ err }, 'WeChat channel connect failed');
        inner = null;
        return false;
      }
    },

    async disconnect(): Promise<void> {
      if (inner) {
        await inner.disconnect();
        inner = null;
      }
    },

    async sendMessage(
      chatId: string,
      text: string,
      _localImagePaths?: string[],
      messageMeta?: OutboundMessageMeta,
    ): Promise<void> {
      if (!inner) {
        logger.warn(
          { chatId },
          'WeChat channel not connected, skip sending message',
        );
        return;
      }
      await inner.sendMessage(
        chatId,
        applyTextChannelFooter(text, messageMeta),
      );
    },

    async setTyping(chatId: string, isTyping: boolean): Promise<void> {
      if (!inner) return;
      await inner.sendTyping(chatId, isTyping);
    },

    isConnected(): boolean {
      return inner?.isConnected() ?? false;
    },
  };

  return channel;
}
