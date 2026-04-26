import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, test, vi } from 'vitest';

const tempHomes: string[] = [];

async function loadGroupQueueModule() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-claw-group-queue-'));
  tempHomes.push(home);
  vi.stubEnv('HOME', home);
  const mod = await import('../src/group-queue.ts');
  const { DATA_DIR } = await import('../src/config.js');
  return { ...mod, DATA_DIR };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.resetModules();
  for (const dir of tempHomes.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('GroupQueue shared-runner IPC recovery', () => {
  test('prefers a waiting IM sibling over web work when drainWaiting releases a slot', async () => {
    const { GroupQueue } = await loadGroupQueueModule();
    const { saveSystemSettings } = await import('../src/runtime-config.js');
    saveSystemSettings({ maxConcurrentHostProcesses: 1 });

    const queue = new GroupQueue();
    const calls: string[] = [];
    const fakeProcess = { pid: 11223, killed: false } as any;

    queue.setHostModeChecker(() => true);
    queue.setSerializationKeyResolver((groupJid: string) =>
      groupJid === 'web:main' || groupJid === 'feishu:chat-1'
        ? 'main'
        : groupJid,
    );

    let releaseBusyRun!: () => void;
    const busyRunDone = new Promise<void>((resolve) => {
      releaseBusyRun = resolve;
    });

    queue.setProcessMessagesFn(async (groupJid: string) => {
      calls.push(groupJid);
      queue.registerProcess(
        groupJid,
        fakeProcess,
        null,
        groupJid === 'other:busy' ? 'other' : 'main',
      );
      if (groupJid === 'other:busy') {
        await busyRunDone;
      }
      return true;
    });

    queue.enqueueMessageCheck('other:busy');
    await vi.waitFor(() => {
      expect(calls).toEqual(['other:busy']);
    });

    queue.enqueueMessageCheck('web:main');
    queue.enqueueMessageCheck('feishu:chat-1');

    releaseBusyRun();

    await vi.waitFor(() => {
      expect(calls.length).toBeGreaterThanOrEqual(2);
    });
    expect(calls[1]).toBe('feishu:chat-1');
  });

  test('drains pending messages before low-priority background tasks', async () => {
    const { GroupQueue } = await loadGroupQueueModule();
    const { saveSystemSettings } = await import('../src/runtime-config.js');
    saveSystemSettings({ maxConcurrentHostProcesses: 1 });

    const queue = new GroupQueue();
    const calls: string[] = [];
    const fakeProcess = { pid: 11224, killed: false } as any;

    queue.setHostModeChecker(() => true);
    queue.setSerializationKeyResolver((groupJid: string) =>
      groupJid === 'web:main' ? 'main' : groupJid,
    );

    let releaseBusyRun!: () => void;
    const busyRunDone = new Promise<void>((resolve) => {
      releaseBusyRun = resolve;
    });

    queue.setProcessMessagesFn(async (groupJid: string) => {
      calls.push(`messages:${groupJid}`);
      queue.registerProcess(
        groupJid,
        fakeProcess,
        null,
        groupJid === 'other:busy' ? 'other' : 'main',
      );
      if (groupJid === 'other:busy') {
        await busyRunDone;
      }
      return true;
    });

    queue.enqueueMessageCheck('other:busy');
    await vi.waitFor(() => {
      expect(calls).toEqual(['messages:other:busy']);
    });

    queue.enqueueTask(
      'web:main',
      'autopilot:workspace:main',
      async () => {
        calls.push('task:autopilot');
      },
      { priority: 'background' },
    );
    queue.enqueueMessageCheck('web:main');

    releaseBusyRun();

    await vi.waitFor(() => {
      expect(calls).toEqual([
        'messages:other:busy',
        'messages:web:main',
        'task:autopilot',
      ]);
    });
  });

  test('closes an active background task when a user message arrives', async () => {
    const { GroupQueue, DATA_DIR } = await loadGroupQueueModule();
    const queue = new GroupQueue();
    const calls: string[] = [];
    const fakeProcess = { pid: 11225, killed: false } as any;
    const taskId = 'autopilot:workspace:main';
    const closePath = path.join(
      DATA_DIR,
      'ipc',
      'main',
      'tasks-run',
      taskId,
      'input',
      '_close',
    );

    queue.setHostModeChecker(() => true);
    queue.setSerializationKeyResolver((groupJid: string) =>
      groupJid === 'web:main' ? 'main' : groupJid,
    );

    let releaseBackgroundRun!: () => void;
    const backgroundRunDone = new Promise<void>((resolve) => {
      releaseBackgroundRun = resolve;
    });

    queue.setProcessMessagesFn(async (groupJid: string) => {
      calls.push(`messages:${groupJid}`);
      return true;
    });

    queue.enqueueTask(
      'web:main',
      taskId,
      async () => {
        calls.push('task:autopilot');
        queue.registerProcess(
          'web:main',
          fakeProcess,
          null,
          'main',
          'autopilot-runner',
          undefined,
          taskId,
        );
        await backgroundRunDone;
      },
      { priority: 'background' },
    );

    await vi.waitFor(() => {
      expect(calls).toEqual(['task:autopilot']);
    });

    queue.enqueueMessageCheck('web:main');

    await vi.waitFor(() => {
      expect(fs.existsSync(closePath)).toBe(true);
    });

    releaseBackgroundRun();
    await vi.waitFor(() => {
      expect(calls).toEqual(['task:autopilot', 'messages:web:main']);
    });
  });

  test('defers recurring web work behind a DB-pending IM sibling when waiting state was lost', async () => {
    const { GroupQueue } = await loadGroupQueueModule();
    const { saveSystemSettings } = await import('../src/runtime-config.js');
    saveSystemSettings({ maxConcurrentHostProcesses: 1 });

    const queue = new GroupQueue();
    const calls: string[] = [];
    const fakeProcess = { pid: 11334, killed: false } as any;
    let pendingImSibling = true;

    queue.setHostModeChecker(() => true);
    queue.setSerializationKeyResolver((groupJid: string) =>
      groupJid === 'web:main' || groupJid === 'feishu:chat-1'
        ? 'main'
        : groupJid,
    );
    queue.setPendingImSiblingResolver((groupJid: string) =>
      groupJid === 'web:main' && pendingImSibling ? 'feishu:chat-1' : null,
    );

    queue.setProcessMessagesFn(async (groupJid: string) => {
      calls.push(groupJid);
      queue.registerProcess(groupJid, fakeProcess, null, 'main');
      if (groupJid === 'feishu:chat-1') {
        pendingImSibling = false;
      }
      return true;
    });

    queue.enqueueMessageCheck('web:main');

    await vi.waitFor(() => {
      expect(calls[0]).toBe('feishu:chat-1');
    });
    await vi.waitFor(() => {
      expect(calls).toEqual(['feishu:chat-1', 'web:main']);
    });
  });

  test('re-enqueues the originating web sibling chat when unconsumed IPC survives runner exit', async () => {
    const { GroupQueue, DATA_DIR } = await loadGroupQueueModule();
    const queue = new GroupQueue();
    const calls: string[] = [];
    const fakeProcess = { pid: 12345, killed: false } as any;
    const inputDir = path.join(DATA_DIR, 'ipc', 'main', 'input');

    queue.setHostModeChecker(() => true);
    queue.setSerializationKeyResolver((groupJid: string) =>
      groupJid === 'web:main' || groupJid === 'web:sibling' ? 'main' : groupJid,
    );

    let releaseFirstRun!: () => void;
    const firstRunDone = new Promise<void>((resolve) => {
      releaseFirstRun = resolve;
    });
    let runCount = 0;

    queue.setProcessMessagesFn(async (groupJid: string) => {
      calls.push(groupJid);
      queue.registerProcess(groupJid, fakeProcess, null, 'main');
      runCount += 1;
      if (runCount === 1) {
        await firstRunDone;
      } else {
        for (const name of fs.readdirSync(inputDir)) {
          if (name.endsWith('.json')) {
            fs.unlinkSync(path.join(inputDir, name));
          }
        }
      }
      return true;
    });

    queue.enqueueMessageCheck('web:main');
    await vi.waitFor(() => {
      expect(calls).toEqual(['web:main']);
    });

    expect(
      queue.sendMessage(
        'web:sibling',
        'follow-up from web sibling',
        undefined,
        undefined,
        {
          timestamp: '2026-04-24T06:44:55.553Z',
          id: 'msg-web-sibling-1',
        },
      ),
    ).toBe('sent');
    queue.markIpcInjectedMessage('web:sibling');

    expect(
      fs.readdirSync(inputDir).some((name) => name.endsWith('.json')),
    ).toBe(true);

    releaseFirstRun();

    await vi.waitFor(() => {
      expect(calls.length).toBeGreaterThanOrEqual(2);
    });

    expect(calls.slice(0, 2)).toEqual(['web:main', 'web:sibling']);
  });

  test('does not IPC-inject fresh IM work into an active sibling web runner', async () => {
    const { GroupQueue, DATA_DIR } = await loadGroupQueueModule();
    const queue = new GroupQueue();
    const calls: string[] = [];
    const fakeProcess = { pid: 22345, killed: false } as any;
    const inputDir = path.join(DATA_DIR, 'ipc', 'main', 'input');

    queue.setHostModeChecker(() => true);
    queue.setSerializationKeyResolver((groupJid: string) =>
      groupJid === 'web:main' || groupJid === 'feishu:chat-1'
        ? 'main'
        : groupJid,
    );

    let releaseFirstRun!: () => void;
    const firstRunDone = new Promise<void>((resolve) => {
      releaseFirstRun = resolve;
    });

    queue.setProcessMessagesFn(async (groupJid: string) => {
      calls.push(groupJid);
      queue.registerProcess(groupJid, fakeProcess, null, 'main');
      if (groupJid === 'web:main') {
        await firstRunDone;
      }
      return true;
    });

    queue.enqueueMessageCheck('web:main');
    await vi.waitFor(() => {
      expect(calls).toEqual(['web:main']);
    });

    expect(
      queue.sendMessage(
        'feishu:chat-1',
        'new stock alert task from feishu',
        undefined,
        undefined,
        {
          timestamp: '2026-04-26T12:15:01.000Z',
          id: 'msg-feishu-fresh',
        },
      ),
    ).toBe('no_active');
    expect(fs.existsSync(inputDir)).toBe(false);

    queue.enqueueMessageCheck('feishu:chat-1');

    releaseFirstRun();
    await vi.waitFor(() => {
      expect(calls.slice(0, 2)).toEqual(['web:main', 'feishu:chat-1']);
    });
  });

  test('does not IPC-inject workspace-bound IM source work into an active web runner', async () => {
    const { GroupQueue, DATA_DIR } = await loadGroupQueueModule();
    const queue = new GroupQueue();
    const calls: string[] = [];
    const fakeProcess = { pid: 22346, killed: false } as any;
    const inputDir = path.join(DATA_DIR, 'ipc', 'main', 'input');

    queue.setHostModeChecker(() => true);
    queue.setSerializationKeyResolver((groupJid: string) =>
      groupJid === 'web:main' || groupJid === 'feishu:chat-1'
        ? 'main'
        : groupJid,
    );

    let releaseFirstRun!: () => void;
    const firstRunDone = new Promise<void>((resolve) => {
      releaseFirstRun = resolve;
    });

    queue.setProcessMessagesFn(async (groupJid: string) => {
      calls.push(groupJid);
      queue.registerProcess(groupJid, fakeProcess, null, 'main');
      if (groupJid === 'web:main') {
        await firstRunDone;
      }
      return true;
    });

    queue.enqueueMessageCheck('web:main');
    await vi.waitFor(() => {
      expect(calls).toEqual(['web:main']);
    });

    expect(
      queue.sendMessage(
        'web:main',
        'workspace-bound feishu task',
        undefined,
        undefined,
        {
          timestamp: '2026-04-26T12:16:01.000Z',
          id: 'msg-feishu-workspace-bound',
        },
        'feishu:chat-1',
      ),
    ).toBe('no_active');
    expect(fs.existsSync(inputDir)).toBe(false);

    queue.enqueueMessageCheck('web:main');
    expect(
      queue.sendMessage(
        'web:main',
        'browser follow-up while feishu work is pending',
        undefined,
        undefined,
        {
          timestamp: '2026-04-26T12:16:02.000Z',
          id: 'msg-web-after-feishu-pending',
        },
      ),
    ).toBe('no_active');
    const filesAfterWeb = fs.existsSync(inputDir)
      ? fs.readdirSync(inputDir).filter((name) => name.endsWith('.json'))
      : [];
    expect(filesAfterWeb).toHaveLength(0);

    releaseFirstRun();
  });

  test('does not drain or IPC-inject web work into an active sibling IM runner', async () => {
    const { GroupQueue, DATA_DIR } = await loadGroupQueueModule();
    const queue = new GroupQueue();
    const fakeProcess = { pid: 23456, killed: false } as any;
    const inputDir = path.join(DATA_DIR, 'ipc', 'main', 'input');
    const drainPath = path.join(inputDir, '_drain');
    const calls: string[] = [];

    queue.setHostModeChecker(() => true);
    queue.setSerializationKeyResolver((groupJid: string) =>
      groupJid === 'web:main' || groupJid === 'feishu:chat-1'
        ? 'main'
        : groupJid,
    );

    let releaseFirstRun!: () => void;
    const firstRunDone = new Promise<void>((resolve) => {
      releaseFirstRun = resolve;
    });
    let runCount = 0;

    queue.setProcessMessagesFn(async (groupJid: string) => {
      calls.push(groupJid);
      queue.registerProcess(groupJid, fakeProcess, null, 'main');
      runCount += 1;
      if (runCount === 1) {
        await firstRunDone;
      }
      return true;
    });

    queue.enqueueMessageCheck('feishu:chat-1');
    await vi.waitFor(() => {
      expect(calls).toEqual(['feishu:chat-1']);
    });

    queue.enqueueMessageCheck('web:main');
    expect(fs.existsSync(drainPath)).toBe(false);

    expect(
      queue.sendMessage(
        'web:main',
        'autopilot prompt from web',
        undefined,
        undefined,
        {
          timestamp: '2026-04-24T07:05:17.298Z',
          id: 'msg-web-1',
        },
      ),
    ).toBe('no_active');
    expect(fs.existsSync(inputDir)).toBe(false);

    releaseFirstRun();
  });

  test('does not IPC-inject web work while an IM sibling is waiting behind an active web runner', async () => {
    const { GroupQueue, DATA_DIR } = await loadGroupQueueModule();
    const queue = new GroupQueue();
    const fakeProcess = { pid: 24567, killed: false } as any;
    const inputDir = path.join(DATA_DIR, 'ipc', 'main', 'input');
    const calls: string[] = [];

    queue.setHostModeChecker(() => true);
    queue.setSerializationKeyResolver((groupJid: string) =>
      groupJid === 'web:main' || groupJid === 'feishu:chat-1'
        ? 'main'
        : groupJid,
    );

    let releaseFirstRun!: () => void;
    const firstRunDone = new Promise<void>((resolve) => {
      releaseFirstRun = resolve;
    });
    let runCount = 0;

    queue.setProcessMessagesFn(async (groupJid: string) => {
      calls.push(groupJid);
      queue.registerProcess(groupJid, fakeProcess, null, 'main');
      runCount += 1;
      if (runCount > 1) {
        for (const name of fs.readdirSync(inputDir)) {
          if (name.endsWith('.json')) {
            fs.unlinkSync(path.join(inputDir, name));
          }
        }
      }
      if (runCount === 1) {
        await firstRunDone;
      }
      return true;
    });

    queue.enqueueMessageCheck('web:main');
    await vi.waitFor(() => {
      expect(calls).toEqual(['web:main']);
    });

    expect(
      queue.sendMessage(
        'feishu:chat-1',
        'fresh feishu work',
        undefined,
        undefined,
        {
          timestamp: '2026-04-24T08:45:11.753Z',
          id: 'msg-feishu-route',
        },
      ),
    ).toBe('no_active');
    queue.enqueueMessageCheck('feishu:chat-1');

    const filesAfterIm = fs.existsSync(inputDir)
      ? fs.readdirSync(inputDir).filter((name) => name.endsWith('.json'))
      : [];
    expect(filesAfterIm).toHaveLength(0);

    expect(
      queue.sendMessage(
        'web:main',
        'autopilot prompt from web',
        undefined,
        undefined,
        {
          timestamp: '2026-04-24T08:45:11.903Z',
          id: 'msg-web-route',
        },
      ),
    ).toBe('no_active');
    queue.enqueueMessageCheck('web:main');
    const filesAfterWeb = fs.existsSync(inputDir)
      ? fs.readdirSync(inputDir).filter((name) => name.endsWith('.json'))
      : [];
    expect(filesAfterWeb).toHaveLength(0);

    releaseFirstRun();

    await vi.waitFor(() => {
      expect(calls.length).toBeGreaterThanOrEqual(2);
    });
    expect(calls.slice(0, 2)).toEqual(['web:main', 'feishu:chat-1']);
  });

  test('treats IPC-injected web sibling chat work as stuck pending work when the active runner goes idle', async () => {
    const { GroupQueue } = await loadGroupQueueModule();
    const queue = new GroupQueue();
    const fakeProcess = { pid: 34567, killed: false } as any;
    const calls: string[] = [];

    queue.setHostModeChecker(() => true);
    queue.setSerializationKeyResolver((groupJid: string) =>
      groupJid === 'web:main' || groupJid === 'web:sibling' ? 'main' : groupJid,
    );

    let releaseFirstRun!: () => void;
    const firstRunDone = new Promise<void>((resolve) => {
      releaseFirstRun = resolve;
    });

    queue.setProcessMessagesFn(async (groupJid: string) => {
      calls.push(groupJid);
      queue.registerProcess(groupJid, fakeProcess, null, 'main');
      await firstRunDone;
      return true;
    });

    queue.enqueueMessageCheck('web:main');
    await vi.waitFor(() => {
      expect(calls).toEqual(['web:main']);
    });

    expect(
      queue.sendMessage(
        'web:sibling',
        'follow-up from web sibling',
        undefined,
        undefined,
        {
          timestamp: '2026-04-24T07:49:24.564Z',
          id: 'msg-web-sibling-stuck',
        },
      ),
    ).toBe('sent');
    queue.markIpcInjectedMessage('web:sibling');

    expect(queue.getStuckPendingGroups(0)).toEqual([
      expect.objectContaining({
        jid: 'web:main',
      }),
    ]);

    releaseFirstRun();
  });
});
