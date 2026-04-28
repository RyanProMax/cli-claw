import { describe, expect, test, vi } from 'vitest';

import {
  encodeImSlashRewriteMessage,
  resolveImSlashCommandReply,
} from '../src/im-slash-command.ts';

describe('IM slash command reply policy', () => {
  test('returns hardcoded command replies unchanged', async () => {
    const onCommand = vi.fn().mockResolvedValue('⚡ 状态: 空闲');

    await expect(
      resolveImSlashCommandReply('feishu:room', 'status', onCommand),
    ).resolves.toEqual({ kind: 'reply', content: '⚡ 状态: 空闲' });
    expect(onCommand).toHaveBeenCalledWith('feishu:room', 'status');
  });

  test('returns local usage command replies unchanged', async () => {
    const onCommand = vi.fn().mockResolvedValue('📈 用量查询');

    await expect(
      resolveImSlashCommandReply('feishu:room', 'usage', onCommand),
    ).resolves.toEqual({ kind: 'reply', content: '📈 用量查询' });
    expect(onCommand).toHaveBeenCalledWith('feishu:room', 'usage');
  });

  test('converts unknown slash commands into local unsupported replies', async () => {
    const onCommand = vi.fn().mockResolvedValue(null);

    await expect(
      resolveImSlashCommandReply('feishu:room', 'statsu', onCommand),
    ).resolves.toEqual({
      kind: 'reply',
      content: '不支持的命令 /statsu，请使用 /help 查看当前可用命令',
    });
  });

  test('decodes rewrite sentinels into passthrough messages', async () => {
    const onCommand = vi
      .fn()
      .mockResolvedValue(encodeImSlashRewriteMessage('请分析当前港股 IPO 池'));

    await expect(
      resolveImSlashCommandReply('feishu:room', 'hkipo', onCommand),
    ).resolves.toEqual({
      kind: 'rewrite_message',
      content: '请分析当前港股 IPO 池',
      sourceKind: 'assistant_prompt',
    });
  });
});
