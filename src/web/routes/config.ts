// Configuration management routes

import QRCode from 'qrcode';
import { Hono } from 'hono';
import { updateWeChatNoProxy } from '../../core/config.js';
import type { Variables } from '../context.js';
import { getWebDeps } from '../context.js';
import { getChannelType } from '../../messaging/channel.js';
import { getAgent } from '../../storage/agents.js';
import {
  getRegisteredGroup,
  setRegisteredGroup,
} from '../../storage/workspaces.js';
import { authMiddleware } from '../middleware/auth.js';
import {
  AppearanceConfigSchema,
  FeishuConfigSchema,
  SystemSettingsSchema,
  WeChatConfigSchema,
} from '../../core/schemas.js';
import {
  getAppearanceConfig,
  getFeishuProviderConfig,
  getFeishuProviderConfigWithSource,
  getSystemSettings,
  getWeChatProviderConfig,
  saveAppearanceConfig,
  saveFeishuProviderConfig,
  saveSystemSettings,
  saveWeChatProviderConfig,
  toPublicFeishuProviderConfig,
} from '../../core/runtime/config.js';
import type { RegisteredGroup } from '../../domain/types.js';
import { logger } from '../../core/logger.js';

const configRoutes = new Hono<{ Variables: Variables }>();
const DEFAULT_MAIN_JID = 'web:main';
const WECHAT_API_BASE = 'https://ilinkai.weixin.qq.com';
const WECHAT_QR_BOT_TYPE = '3';

let deps: any = null;
export function injectConfigDeps(d: any) {
  deps = d;
}

function maskBotToken(token: string | undefined): string | null {
  if (!token) return null;
  if (token.length <= 10) return '****';
  return `${token.slice(0, 6)}...${token.slice(-4)}`;
}

function publicWeChatConfig() {
  const config = getWeChatProviderConfig();
  const connected = deps?.isWeChatConnected?.() ?? false;
  if (!config) {
    return {
      ilinkBotId: '',
      hasBotToken: false,
      botTokenMasked: null,
      bypassProxy: true,
      enabled: false,
      updatedAt: null,
      connected,
    };
  }
  return {
    ilinkBotId: config.ilinkBotId || '',
    hasBotToken: !!config.botToken,
    botTokenMasked: maskBotToken(config.botToken),
    bypassProxy: config.bypassProxy ?? true,
    enabled: config.enabled ?? false,
    updatedAt: config.updatedAt,
    connected,
  };
}

function isFeishuProviderConfigured(): boolean {
  const { config, source } = getFeishuProviderConfigWithSource();
  const publicConfig = toPublicFeishuProviderConfig(config, source);
  return (
    publicConfig.enabled &&
    Boolean(publicConfig.appId) &&
    publicConfig.hasAppSecret
  );
}

function isWeChatProviderConfigured(): boolean {
  const config = getWeChatProviderConfig();
  return Boolean(
    config && config.enabled !== false && config.ilinkBotId && config.botToken,
  );
}

function applyBindingUpdate(imJid: string, updated: RegisteredGroup): void {
  setRegisteredGroup(imJid, updated);
  const webDeps = getWebDeps();
  if (webDeps) {
    const groups = webDeps.getRegisteredGroups();
    if (groups[imJid]) groups[imJid] = updated;
    webDeps.clearImFailCounts?.(imJid);
  }
}

configRoutes.get('/feishu', authMiddleware, (c) => {
  try {
    const { config, source } = getFeishuProviderConfigWithSource();
    const connected = deps?.isFeishuConnected?.() ?? false;
    return c.json({
      ...toPublicFeishuProviderConfig(config, source),
      connected,
    });
  } catch (err) {
    logger.error({ err }, 'Failed to load Feishu config');
    return c.json({ error: 'Failed to load Feishu config' }, 500);
  }
});

configRoutes.put('/feishu', authMiddleware, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const validation = FeishuConfigSchema.safeParse(body);
  if (!validation.success) {
    return c.json(
      { error: 'Invalid request body', details: validation.error.format() },
      400,
    );
  }

  const current = getFeishuProviderConfig();
  const next = { ...current };
  if (typeof validation.data.appId === 'string') {
    next.appId = validation.data.appId;
  }
  if (typeof validation.data.appSecret === 'string') {
    next.appSecret = validation.data.appSecret;
  } else if (validation.data.clearAppSecret === true) {
    next.appSecret = '';
  }
  if (typeof validation.data.enabled === 'boolean') {
    next.enabled = validation.data.enabled;
  }

  try {
    const saved = saveFeishuProviderConfig({
      appId: next.appId,
      appSecret: next.appSecret,
      enabled: next.enabled,
    });
    let connected = false;
    if (deps?.reloadFeishuConnection) {
      connected = await deps
        .reloadFeishuConnection(saved)
        .catch((err: unknown) => {
          logger.warn({ err }, 'Failed to reload Feishu connection');
          return false;
        });
    }
    return c.json({
      ...toPublicFeishuProviderConfig(saved, 'runtime'),
      connected,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Invalid Feishu config payload';
    return c.json({ error: message }, 400);
  }
});

configRoutes.get('/appearance', authMiddleware, (c) => {
  return c.json(getAppearanceConfig());
});

configRoutes.put('/appearance', authMiddleware, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const validation = AppearanceConfigSchema.safeParse(body);
  if (!validation.success) {
    return c.json(
      { error: 'Invalid request body', details: validation.error.format() },
      400,
    );
  }
  return c.json(saveAppearanceConfig(validation.data));
});

configRoutes.get('/appearance/public', (c) => {
  return c.json(getAppearanceConfig());
});

configRoutes.get('/system', authMiddleware, (c) => {
  return c.json(getSystemSettings());
});

configRoutes.put('/system', authMiddleware, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const validation = SystemSettingsSchema.safeParse(body);
  if (!validation.success) {
    return c.json(
      { error: 'Invalid request body', details: validation.error.format() },
      400,
    );
  }
  return c.json(saveSystemSettings(validation.data));
});

configRoutes.get('/user-im/status', authMiddleware, (c) => {
  return c.json({
    feishu: isFeishuProviderConfigured(),
    wechat: isWeChatProviderConfigured(),
  });
});

configRoutes.get('/user-im/feishu', authMiddleware, (c) => {
  try {
    const { config, source } = getFeishuProviderConfigWithSource();
    const connected = deps?.isFeishuConnected?.() ?? false;
    return c.json({
      ...toPublicFeishuProviderConfig(config, source),
      connected,
    });
  } catch (err) {
    logger.error({ err }, 'Failed to load Feishu config');
    return c.json({ error: 'Failed to load Feishu config' }, 500);
  }
});

configRoutes.put('/user-im/feishu', authMiddleware, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const validation = FeishuConfigSchema.safeParse(body);
  if (!validation.success) {
    return c.json(
      { error: 'Invalid request body', details: validation.error.format() },
      400,
    );
  }

  const current = getFeishuProviderConfig();
  const next = {
    appId: current.appId || '',
    appSecret: current.appSecret || '',
    enabled: current.enabled ?? true,
  };
  if (typeof validation.data.appId === 'string') {
    const appId = validation.data.appId.trim();
    if (appId) next.appId = appId;
  }
  if (typeof validation.data.appSecret === 'string') {
    const appSecret = validation.data.appSecret.trim();
    if (appSecret) next.appSecret = appSecret;
  } else if (validation.data.clearAppSecret === true) {
    next.appSecret = '';
  }
  if (typeof validation.data.enabled === 'boolean') {
    next.enabled = validation.data.enabled;
  }

  try {
    const saved = saveFeishuProviderConfig(next);
    if (deps?.reloadFeishuConnection) {
      await deps.reloadFeishuConnection(saved).catch((err: unknown) => {
        logger.warn({ err }, 'Failed to hot-reload Feishu connection');
      });
    }
    const connected = deps?.isFeishuConnected?.() ?? false;
    return c.json({
      ...toPublicFeishuProviderConfig(saved, 'runtime'),
      connected,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Invalid Feishu config payload';
    return c.json({ error: message }, 400);
  }
});

configRoutes.get('/user-im/wechat', authMiddleware, (c) => {
  return c.json(publicWeChatConfig());
});

configRoutes.put('/user-im/wechat', authMiddleware, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const validation = WeChatConfigSchema.safeParse(body);
  if (!validation.success) {
    return c.json(
      { error: 'Invalid request body', details: validation.error.format() },
      400,
    );
  }

  const current = getWeChatProviderConfig();
  const next = {
    botToken: current?.botToken || '',
    ilinkBotId: current?.ilinkBotId || '',
    baseUrl: current?.baseUrl,
    cdnBaseUrl: current?.cdnBaseUrl,
    getUpdatesBuf: current?.getUpdatesBuf,
    bypassProxy: current?.bypassProxy ?? true,
    enabled: current?.enabled ?? false,
  };

  if (validation.data.clearBotToken === true) {
    next.botToken = '';
    next.ilinkBotId = '';
  }
  if (typeof validation.data.enabled === 'boolean') {
    next.enabled = validation.data.enabled;
  }
  if (typeof validation.data.bypassProxy === 'boolean') {
    next.bypassProxy = validation.data.bypassProxy;
  }

  try {
    const saved = saveWeChatProviderConfig(next);
    updateWeChatNoProxy(saved.bypassProxy ?? true);
    if (deps?.reloadUserIMConfig) {
      await deps.reloadUserIMConfig('wechat').catch((err: unknown) => {
        logger.warn({ err }, 'Failed to hot-reload WeChat connection');
      });
    }
    return c.json(publicWeChatConfig());
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Invalid WeChat config payload';
    return c.json({ error: message }, 400);
  }
});

configRoutes.post('/user-im/wechat/qrcode', authMiddleware, async (c) => {
  try {
    const url = `${WECHAT_API_BASE}/ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(WECHAT_QR_BOT_TYPE)}`;
    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      logger.error({ status: res.status, body }, 'WeChat QR code fetch failed');
      return c.json({ error: `Failed to fetch QR code: ${res.status}` }, 502);
    }
    const data = (await res.json()) as {
      qrcode?: string;
      qrcode_img_content?: string;
    };
    if (!data.qrcode) {
      return c.json({ error: 'No QR code in response' }, 502);
    }

    let qrcodeDataUri = '';
    if (data.qrcode_img_content) {
      qrcodeDataUri = await QRCode.toDataURL(data.qrcode_img_content, {
        width: 512,
        margin: 2,
        color: { dark: '#000000', light: '#ffffff' },
      }).catch(() => '');
    }

    return c.json({ qrcode: data.qrcode, qrcodeUrl: qrcodeDataUri });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Failed to generate QR code';
    logger.error({ err }, 'WeChat QR code generation failed');
    return c.json({ error: message }, 500);
  }
});

configRoutes.get('/user-im/wechat/qrcode-status', authMiddleware, async (c) => {
  const qrcode = c.req.query('qrcode');
  if (!qrcode) return c.json({ error: 'qrcode query parameter required' }, 400);

  try {
    const url = `${WECHAT_API_BASE}/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 35000);
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { 'iLink-App-ClientVersion': '1' },
        signal: controller.signal,
      });
      clearTimeout(timer);
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof Error && err.name === 'AbortError') {
        return c.json({ status: 'wait' });
      }
      throw err;
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return c.json(
        { error: `QR status poll failed: ${res.status}`, body },
        502,
      );
    }

    const data = (await res.json()) as {
      status?: 'wait' | 'scaned' | 'confirmed' | 'expired';
      bot_token?: string;
      ilink_bot_id?: string;
      baseurl?: string;
    };

    if (data.status === 'confirmed' && data.bot_token && data.ilink_bot_id) {
      const saved = saveWeChatProviderConfig({
        botToken: data.bot_token,
        ilinkBotId: data.ilink_bot_id.replace(/[^a-zA-Z0-9@._-]/g, ''),
        baseUrl: data.baseurl || undefined,
        enabled: true,
      });
      if (deps?.reloadUserIMConfig) {
        await deps.reloadUserIMConfig('wechat').catch((err: unknown) => {
          logger.warn({ err }, 'Failed to hot-reload WeChat after QR login');
        });
      }
      return c.json({ status: 'confirmed', ilinkBotId: saved.ilinkBotId });
    }

    return c.json({ status: data.status || 'wait' });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'QR status poll failed';
    logger.error({ err }, 'WeChat QR status poll failed');
    return c.json({ error: message }, 500);
  }
});

configRoutes.post('/user-im/wechat/disconnect', authMiddleware, async (c) => {
  const current = getWeChatProviderConfig();
  if (current) {
    saveWeChatProviderConfig({
      botToken: '',
      ilinkBotId: '',
      enabled: false,
      getUpdatesBuf: current.getUpdatesBuf,
    });
  }
  if (deps?.reloadUserIMConfig) {
    await deps.reloadUserIMConfig('wechat').catch((err: unknown) => {
      logger.warn({ err }, 'Failed to disconnect WeChat');
    });
  }
  return c.json({ success: true, ...publicWeChatConfig() });
});

configRoutes.put('/user-im/bindings/:imJid', authMiddleware, async (c) => {
  const imJid = decodeURIComponent(c.req.param('imJid'));
  const channelType = getChannelType(imJid);
  if (channelType !== 'feishu' && channelType !== 'wechat') {
    return c.json({ error: 'Invalid IM JID' }, 400);
  }

  const imGroup = getRegisteredGroup(imJid);
  if (!imGroup) return c.json({ error: 'IM group not found' }, 404);

  const body = await c.req.json().catch(() => ({}));
  if (body.unbind === true) {
    applyBindingUpdate(imJid, {
      ...imGroup,
      target_main_jid: undefined,
      target_agent_id: undefined,
    });
    return c.json({ success: true });
  }

  if (typeof body.target_agent_id === 'string' && body.target_agent_id.trim()) {
    const agentId = body.target_agent_id.trim();
    const agent = getAgent(agentId);
    if (!agent) return c.json({ error: 'Agent not found' }, 404);
    if (agent.kind !== 'conversation') {
      return c.json(
        { error: 'Only conversation agents can bind IM groups' },
        400,
      );
    }
    const replyPolicy =
      body.reply_policy === 'mirror' ? 'mirror' : 'source_only';
    applyBindingUpdate(imJid, {
      ...imGroup,
      target_agent_id: agentId,
      target_main_jid: undefined,
      reply_policy: replyPolicy,
    });
    return c.json({ success: true });
  }

  if (typeof body.target_main_jid === 'string' && body.target_main_jid.trim()) {
    const targetMainJid = body.target_main_jid.trim();
    const targetGroup = getRegisteredGroup(targetMainJid);
    if (!targetGroup) {
      return c.json({ error: 'Target workspace not found' }, 404);
    }
    if (targetMainJid === DEFAULT_MAIN_JID) {
      return c.json(
        { error: 'Home workspace main conversation uses default IM routing' },
        400,
      );
    }
    const replyPolicy =
      body.reply_policy === 'mirror' ? 'mirror' : 'source_only';
    applyBindingUpdate(imJid, {
      ...imGroup,
      target_main_jid: targetMainJid,
      target_agent_id: undefined,
      reply_policy: replyPolicy,
    });
    return c.json({ success: true });
  }

  return c.json({ error: 'No binding target provided' }, 400);
});

export default configRoutes;
