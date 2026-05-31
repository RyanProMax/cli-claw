/**
 * Instance-level IM connection manager.
 *
 * Cli Claw now runs as a single self-hosted instance: each supported IM
 * provider has at most one connection and routes by JID prefix.
 */
import {
  createFeishuChannel,
  createWeChatChannel,
  extractChatId,
  getChannelType,
  type IMChannel,
  type IMChannelConnectOpts,
  type OutboundMessageMeta,
} from './channel.js';
import type { FeishuConnectionConfig } from './providers/feishu/index.js';
import type { WeChatConnectionConfig } from './providers/wechat/index.js';
import type { StreamingCardController } from './providers/feishu/streaming-card.js';
import { logger } from '../core/logger.js';
import type { IMCommandContext } from './slash-command.js';

export interface FeishuConnectConfig {
  appId: string;
  appSecret: string;
  enabled?: boolean;
}

export interface WeChatConnectConfig {
  botToken: string;
  ilinkBotId: string;
  baseUrl?: string;
  cdnBaseUrl?: string;
  getUpdatesBuf?: string;
  enabled?: boolean;
}

export interface ConnectFeishuOptions {
  ignoreMessagesBefore?: number;
  startupBackfillChatIds?: string[];
  startupBackfillIgnoreMessagesBefore?: number;
  onCommand?: (
    chatJid: string,
    command: string,
    context?: IMCommandContext,
  ) => Promise<string | null>;
  resolveManagedCommandText?: (chatJid: string, text: string) => string | null;
  resolveGroupFolder?: (chatJid: string) => string | undefined;
  resolveEffectiveChatJid?: (
    chatJid: string,
  ) => { effectiveJid: string; agentId: string | null } | null;
  onAgentMessage?: (baseChatJid: string, agentId: string) => void;
  onBotAddedToGroup?: (chatJid: string, chatName: string) => void;
  onBotRemovedFromGroup?: (chatJid: string) => void;
  shouldProcessGroupMessage?: (chatJid: string) => boolean;
  onCardInterrupt?: (chatJid: string) => void;
  onCardRuntimeUpdate?: (
    chatJid: string,
    update: {
      action: 'set_runtime_model' | 'set_runtime_effort' | 'set_runtime_speed';
      value: string;
    },
  ) => Promise<string | null>;
}

class IMConnectionManager {
  private channels = new Map<string, IMChannel>();

  private async connectChannel(
    channelType: 'feishu' | 'wechat',
    channel: IMChannel,
    opts: IMChannelConnectOpts,
  ): Promise<boolean> {
    await this.disconnectChannel(channelType);
    const connected = await channel.connect(opts);
    if (connected) {
      this.channels.set(channelType, channel);
      logger.info({ channelType }, 'IM channel connected');
    }
    return connected;
  }

  async disconnectChannel(channelType: 'feishu' | 'wechat'): Promise<void> {
    const channel = this.channels.get(channelType);
    if (!channel) return;
    await channel.disconnect();
    this.channels.delete(channelType);
    logger.info({ channelType }, 'IM channel disconnected');
  }

  private findChannelForJid(jid: string): IMChannel | undefined {
    const channelType = getChannelType(jid);
    if (channelType !== 'feishu' && channelType !== 'wechat') return undefined;
    const channel = this.channels.get(channelType);
    return channel?.isConnected() ? channel : undefined;
  }

  async sendMessage(
    jid: string,
    text: string,
    localImagePaths?: string[],
    messageMeta?: OutboundMessageMeta,
  ): Promise<void> {
    const channel = this.findChannelForJid(jid);
    if (!channel) {
      throw new Error(`No IM channel available for ${jid}`);
    }
    await channel.sendMessage(
      extractChatId(jid),
      text,
      localImagePaths,
      messageMeta,
    );
  }

  async sendImage(
    jid: string,
    imageBuffer: Buffer,
    mimeType: string,
    caption?: string,
    fileName?: string,
  ): Promise<void> {
    const channel = this.findChannelForJid(jid);
    if (channel?.sendImage) {
      await channel.sendImage(
        extractChatId(jid),
        imageBuffer,
        mimeType,
        caption,
        fileName,
      );
      return;
    }
    if (caption && channel) {
      await channel.sendMessage(extractChatId(jid), caption);
      return;
    }
    throw new Error(`No IM channel available to send image for ${jid}`);
  }

  async sendFile(
    jid: string,
    filePath: string,
    fileName: string,
  ): Promise<void> {
    const channel = this.findChannelForJid(jid);
    if (!channel?.sendFile) {
      throw new Error(`Channel for ${jid} does not support file sending`);
    }
    await channel.sendFile(extractChatId(jid), filePath, fileName);
  }

  async setTyping(jid: string, isTyping: boolean): Promise<void> {
    const channel = this.findChannelForJid(jid);
    if (channel) await channel.setTyping(extractChatId(jid), isTyping);
  }

  clearAckReaction(jid: string): void {
    const channel = this.findChannelForJid(jid);
    channel?.clearAckReaction?.(extractChatId(jid));
  }

  createStreamingSession(
    jid: string,
    onCardCreated?: (messageId: string) => void,
  ): StreamingCardController | undefined {
    const channelType = getChannelType(jid);
    if (channelType !== 'feishu') return undefined;
    return this.channels
      .get('feishu')
      ?.createStreamingSession?.(extractChatId(jid), onCardCreated);
  }

  getConnectedChannelTypes(): string[] {
    return [...this.channels.entries()]
      .filter(([, channel]) => channel.isConnected())
      .map(([type]) => type);
  }

  isChannelAvailableForJid(jid: string): boolean {
    return !!this.findChannelForJid(jid);
  }

  async connectFeishu(
    config: FeishuConnectConfig,
    onNewChat: (chatJid: string, chatName: string) => void,
    options?: ConnectFeishuOptions,
  ): Promise<boolean> {
    if (!config.enabled || !config.appId || !config.appSecret) {
      logger.info('Feishu config disabled or incomplete, skipping connection');
      return false;
    }

    const channel = createFeishuChannel({
      appId: config.appId,
      appSecret: config.appSecret,
    } satisfies FeishuConnectionConfig);

    return this.connectChannel('feishu', channel, {
      onReady: () => logger.info('Feishu WebSocket connected'),
      onNewChat,
      ignoreMessagesBefore: options?.ignoreMessagesBefore,
      startupBackfillChatIds: options?.startupBackfillChatIds,
      startupBackfillIgnoreMessagesBefore:
        options?.startupBackfillIgnoreMessagesBefore,
      onCommand: options?.onCommand,
      resolveManagedCommandText: options?.resolveManagedCommandText,
      resolveGroupFolder: options?.resolveGroupFolder,
      resolveEffectiveChatJid: options?.resolveEffectiveChatJid,
      onAgentMessage: options?.onAgentMessage,
      onBotAddedToGroup: options?.onBotAddedToGroup,
      onBotRemovedFromGroup: options?.onBotRemovedFromGroup,
      shouldProcessGroupMessage: options?.shouldProcessGroupMessage,
      onCardInterrupt: options?.onCardInterrupt,
      onCardRuntimeUpdate: options?.onCardRuntimeUpdate,
    });
  }

  async disconnectFeishu(): Promise<void> {
    await this.disconnectChannel('feishu');
  }

  async connectWeChat(
    config: WeChatConnectConfig,
    onNewChat: (chatJid: string, chatName: string) => void,
    options?: {
      ignoreMessagesBefore?: number;
      onCommand?: (
        chatJid: string,
        command: string,
        context?: IMCommandContext,
      ) => Promise<string | null>;
      resolveGroupFolder?: (jid: string) => string | undefined;
      resolveEffectiveChatJid?: (
        chatJid: string,
      ) => { effectiveJid: string; agentId: string | null } | null;
      onAgentMessage?: (baseChatJid: string, agentId: string) => void;
    },
  ): Promise<boolean> {
    if (!config.enabled || !config.botToken || !config.ilinkBotId) {
      logger.info('WeChat config disabled or incomplete, skipping connection');
      return false;
    }

    const channel = createWeChatChannel({
      botToken: config.botToken,
      ilinkBotId: config.ilinkBotId,
      baseUrl: config.baseUrl,
      cdnBaseUrl: config.cdnBaseUrl,
      getUpdatesBuf: config.getUpdatesBuf,
    } satisfies WeChatConnectionConfig);

    return this.connectChannel('wechat', channel, {
      onReady: () => logger.info('WeChat bot connected'),
      onNewChat,
      ignoreMessagesBefore: options?.ignoreMessagesBefore,
      onCommand: options?.onCommand,
      resolveGroupFolder: options?.resolveGroupFolder,
      resolveEffectiveChatJid: options?.resolveEffectiveChatJid,
      onAgentMessage: options?.onAgentMessage,
    });
  }

  async disconnectWeChat(): Promise<void> {
    await this.disconnectChannel('wechat');
  }

  async syncFeishuGroups(): Promise<void> {
    const channel = this.channels.get('feishu');
    if (channel?.isConnected() && channel.syncGroups) {
      await channel.syncGroups();
    }
  }

  isFeishuConnected(): boolean {
    return this.channels.get('feishu')?.isConnected() ?? false;
  }

  isWeChatConnected(): boolean {
    return this.channels.get('wechat')?.isConnected() ?? false;
  }

  async getFeishuChatInfo(chatId: string): Promise<{
    avatar?: string;
    name?: string;
    user_count?: string;
    chat_type?: string;
    chat_mode?: string;
  } | null> {
    const channel = this.channels.get('feishu');
    if (!channel?.getChatInfo) return null;
    return channel.getChatInfo(chatId);
  }

  async getChatInfo(jid: string): Promise<{
    avatar?: string;
    name?: string;
    user_count?: string;
    chat_type?: string;
    chat_mode?: string;
  } | null> {
    const channel = this.findChannelForJid(jid);
    if (!channel?.getChatInfo) return null;
    return channel.getChatInfo(extractChatId(jid));
  }
}

export const imManager = new IMConnectionManager();
