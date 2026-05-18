import * as lark from '@larksuiteoapi/node-sdk';
import { describe, expect, test } from 'vitest';

import {
  getFeishuProviderConfigWithSource,
  getUserFeishuConfig,
  type FeishuProviderConfig,
} from '../../../src/core/runtime/config.ts';

const LIVE_ENABLED = process.env.FEISHU_LIVE_E2E === '1';
const liveTest = LIVE_ENABLED ? test : test.skip;

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `${name} is required when FEISHU_LIVE_E2E=1. ` +
        'Use a dedicated test chat to avoid posting smoke messages to production groups.',
    );
  }
  return value;
}

function resolveReceiveIdType(
  chatId: string,
): 'chat_id' | 'open_id' | 'user_id' | 'union_id' | 'email' {
  const configured = process.env.FEISHU_LIVE_RECEIVE_ID_TYPE?.trim();
  if (
    configured === 'chat_id' ||
    configured === 'open_id' ||
    configured === 'user_id' ||
    configured === 'union_id' ||
    configured === 'email'
  ) {
    return configured;
  }
  return chatId.startsWith('oc_') ? 'chat_id' : 'open_id';
}

function extractTextContent(value: unknown): string {
  if (typeof value !== 'string') return '';
  try {
    const parsed = JSON.parse(value) as { text?: unknown };
    return typeof parsed.text === 'string' ? parsed.text : value;
  } catch {
    return value;
  }
}

function readMessageItems(response: unknown): Array<Record<string, unknown>> {
  const items = (response as { data?: { items?: unknown[] } } | null)?.data
    ?.items;
  if (!Array.isArray(items)) return [];
  return items.filter(
    (item): item is Record<string, unknown> =>
      item !== null && typeof item === 'object',
  );
}

function readItemContent(item: Record<string, unknown>): string {
  const body = item.body as { content?: unknown } | undefined;
  return extractTextContent(body?.content ?? item.content);
}

function resolveLiveFeishuConfig(): {
  config: FeishuProviderConfig;
  source: 'env' | 'runtime' | 'user';
} {
  const userId = process.env.FEISHU_LIVE_USER_ID?.trim();
  if (userId) {
    const config = getUserFeishuConfig(userId);
    if (!config?.appId || !config.appSecret) {
      throw new Error(
        `No enabled Feishu config found for FEISHU_LIVE_USER_ID=${userId}.`,
      );
    }
    return { config, source: 'user' };
  }

  const { config, source } = getFeishuProviderConfigWithSource();
  if (source === 'none') return { config, source: 'env' };
  return { config, source };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForReadableMessage(params: {
  client: lark.Client;
  chatId: string;
  messageId: string;
  expectedText: string;
  startSec: number;
  timeoutMs: number;
}): Promise<{ messageId: string; content: string; source: 'get' | 'list' }> {
  const deadline = Date.now() + params.timeoutMs;
  let lastError: unknown = null;

  while (Date.now() < deadline) {
    try {
      const getResponse = await params.client.im.v1.message.get({
        path: { message_id: params.messageId },
      });
      for (const item of readMessageItems(getResponse)) {
        const content = readItemContent(item);
        if (content.includes(params.expectedText)) {
          return { messageId: params.messageId, content, source: 'get' };
        }
      }
    } catch (error) {
      lastError = error;
    }

    try {
      const listResponse = await params.client.im.v1.message.list({
        params: {
          container_id_type: 'chat',
          container_id: params.chatId,
          sort_type: 'ByCreateTimeDesc',
          start_time: String(params.startSec),
          end_time: String(Math.floor(Date.now() / 1000) + 60),
          page_size: 20,
        },
      });
      for (const item of readMessageItems(listResponse)) {
        const messageId =
          typeof item.message_id === 'string' ? item.message_id : '';
        const content = readItemContent(item);
        if (
          messageId === params.messageId &&
          content.includes(params.expectedText)
        ) {
          return { messageId, content, source: 'list' };
        }
      }
    } catch (error) {
      lastError = error;
    }

    await sleep(1000);
  }

  const reason =
    lastError instanceof Error
      ? `${lastError.name}: ${lastError.message}`
      : JSON.stringify(lastError);
  throw new Error(
    `Timed out waiting for Feishu message ${params.messageId} to become readable. Last error: ${reason}`,
  );
}

describe('live Feishu smoke', () => {
  liveTest(
    'sends a real text message and verifies it can be read back',
    async () => {
      const chatId = requiredEnv('FEISHU_LIVE_CHAT_ID');
      const { config, source } = resolveLiveFeishuConfig();
      if (!config.appId || !config.appSecret) {
        throw new Error(
          'Feishu credentials are required. Configure FEISHU_APP_ID/FEISHU_APP_SECRET, runtime Feishu settings, or FEISHU_LIVE_USER_ID before running live smoke.',
        );
      }

      const client = new lark.Client({
        appId: config.appId,
        appSecret: config.appSecret,
        appType: lark.AppType.SelfBuild,
      });

      const nonce = `cli-claw-live-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;
      const text = `[e2e] ${nonce}`;
      const startSec = Math.floor(Date.now() / 1000) - 30;
      const receiveIdType = resolveReceiveIdType(chatId);

      const createResponse = (await client.im.v1.message.create({
        params: { receive_id_type: receiveIdType },
        data: {
          receive_id: chatId,
          msg_type: 'text',
          content: JSON.stringify({ text }),
        },
      })) as { data?: { message_id?: unknown } };

      const messageId = createResponse.data?.message_id;
      expect(typeof messageId).toBe('string');
      expect((messageId as string).trim()).not.toBe('');

      const readable = await waitForReadableMessage({
        client,
        chatId,
        messageId: messageId as string,
        expectedText: nonce,
        startSec,
        timeoutMs: Number(process.env.FEISHU_LIVE_TIMEOUT_MS || 15_000),
      });

      expect(readable.content).toContain(nonce);
      expect(['get', 'list']).toContain(readable.source);
      expect(source).toMatch(/^(runtime|env|user)$/);
    },
    Number(process.env.FEISHU_LIVE_TEST_TIMEOUT_MS || 30_000),
  );
});
