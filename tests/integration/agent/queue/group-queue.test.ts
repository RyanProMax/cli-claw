import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, test, vi } from 'vitest';

const tempHomes: string[] = [];

async function loadGroupQueueModule() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-claw-group-queue-'));
  tempHomes.push(home);
  vi.stubEnv('HOME', home);
  const mod = await import('../../../../src/agent/queue/group-queue.ts');
  const { DATA_DIR } = await import('../../../../src/core/config.js');
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
  test('preserves waiting order when drainWaiting releases a slot', async () => {
    const { GroupQueue } = await loadGroupQueueModule();
    const { saveSystemSettings } = await import('../../../../src/core/runtime/config.js');
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
    expect(calls[1]).toBe('web:main');
  });

  test('drains pending messages before low-priority background tasks', async () => {
    const { GroupQueue } = await loadGroupQueueModule();
    const { saveSystemSettings } = await import('../../../../src/core/runtime/config.js');
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
      'background:workspace:main',
      async () => {
        calls.push('task:background');
      },
      { priority: 'background' },
    );
    queue.enqueueMessageCheck('web:main');

    releaseBusyRun();

    await vi.waitFor(() => {
      expect(calls).toEqual([
        'messages:other:busy',
        'messages:web:main',
        'task:background',
      ]);
    });
  });

  test('closes an active background task when a user message arrives', async () => {
    const { GroupQueue, DATA_DIR } = await loadGroupQueueModule();
    const queue = new GroupQueue();
    const calls: string[] = [];
    const fakeProcess = { pid: 11225, killed: false } as any;
    const taskId = 'background:workspace:main';
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
        calls.push('task:background');
        queue.registerProcess(
          'web:main',
          fakeProcess,
          null,
          'main',
          'background-runner',
          undefined,
          taskId,
        );
        await backgroundRunDone;
      },
      { priority: 'background' },
    );

    await vi.waitFor(() => {
      expect(calls).toEqual(['task:background']);
    });

    queue.enqueueMessageCheck('web:main');

    await vi.waitFor(() => {
      expect(fs.existsSync(closePath)).toBe(true);
    });

    releaseBackgroundRun();
    await vi.waitFor(() => {
      expect(calls).toEqual(['task:background', 'messages:web:main']);
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

    queue.markRunnerQueryIdle('web:main');

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

  test('queues same-source workspace work while the active query is still in flight', async () => {
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
      queue.registerProcess(
        groupJid,
        fakeProcess,
        null,
        'main',
        undefined,
        undefined,
        undefined,
        'feishu:chat-1',
      );
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
        'feishu:chat-1',
      ),
    ).toBe('no_active');
    const ipcFiles = fs.existsSync(inputDir)
      ? fs.readdirSync(inputDir).filter((name) => name.endsWith('.json'))
      : [];
    expect(ipcFiles).toHaveLength(0);

    releaseFirstRun();
  });

  test('IPC-injects same-source workspace work only after the active query is idle', async () => {
    const { GroupQueue, DATA_DIR } = await loadGroupQueueModule();
    const queue = new GroupQueue();
    const calls: string[] = [];
    const fakeProcess = { pid: 22348, killed: false } as any;
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
      queue.registerProcess(
        groupJid,
        fakeProcess,
        null,
        'main',
        undefined,
        undefined,
        undefined,
        'feishu:chat-1',
      );
      if (groupJid === 'web:main') {
        await firstRunDone;
      }
      return true;
    });

    queue.enqueueMessageCheck('web:main');
    await vi.waitFor(() => {
      expect(calls).toEqual(['web:main']);
    });

    queue.markRunnerQueryIdle('web:main');

    expect(
      queue.sendMessage(
        'feishu:chat-1',
        'new stock alert task from feishu',
        undefined,
        undefined,
        {
          timestamp: '2026-04-26T12:15:01.000Z',
          id: 'msg-feishu-fresh-idle',
        },
        'feishu:chat-1',
      ),
    ).toBe('sent');
    const ipcFiles = fs.existsSync(inputDir)
      ? fs.readdirSync(inputDir).filter((name) => name.endsWith('.json'))
      : [];
    expect(ipcFiles).toHaveLength(1);

    releaseFirstRun();
  });

  test('does not IPC-inject different-source workspace work into the active runner', async () => {
    const { GroupQueue, DATA_DIR } = await loadGroupQueueModule();
    const queue = new GroupQueue();
    const calls: string[] = [];
    const fakeProcess = { pid: 22347, killed: false } as any;
    const inputDir = path.join(DATA_DIR, 'ipc', 'main', 'input');

    queue.setHostModeChecker(() => true);
    queue.setSerializationKeyResolver((groupJid: string) =>
      groupJid === 'web:main' ? 'main' : groupJid,
    );

    let releaseFirstRun!: () => void;
    const firstRunDone = new Promise<void>((resolve) => {
      releaseFirstRun = resolve;
    });

    queue.setProcessMessagesFn(async (groupJid: string) => {
      calls.push(groupJid);
      queue.registerProcess(
        groupJid,
        fakeProcess,
        null,
        'main',
        undefined,
        undefined,
        undefined,
        'feishu:chat-1',
      );
      await firstRunDone;
      return true;
    });

    queue.enqueueMessageCheck('web:main');
    await vi.waitFor(() => {
      expect(calls).toEqual(['web:main']);
    });

    expect(
      queue.sendMessage(
        'web:main',
        'browser follow-up should wait behind feishu-source turn',
        undefined,
        undefined,
        {
          timestamp: '2026-04-27T12:40:10.753Z',
          id: 'msg-web-different-source',
        },
      ),
    ).toBe('no_active');
    const ipcFiles = fs.existsSync(inputDir)
      ? fs.readdirSync(inputDir).filter((name) => name.endsWith('.json'))
      : [];
    expect(ipcFiles).toHaveLength(0);

    releaseFirstRun();
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
      queue.registerProcess(
        groupJid,
        fakeProcess,
        null,
        'main',
        undefined,
        undefined,
        undefined,
        'web:main',
      );
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

  test('drains but does not IPC-inject different-source web work into an active IM-source runner', async () => {
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
      queue.registerProcess(
        groupJid,
        fakeProcess,
        null,
        'main',
        undefined,
        undefined,
        undefined,
        'feishu:chat-1',
      );
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
    expect(fs.existsSync(drainPath)).toBe(true);

    expect(
      queue.sendMessage(
        'web:main',
        'background prompt from web',
        undefined,
        undefined,
        {
          timestamp: '2026-04-24T07:05:17.298Z',
          id: 'msg-web-1',
        },
      ),
    ).toBe('no_active');
    const ipcFiles = fs.existsSync(inputDir)
      ? fs.readdirSync(inputDir).filter((name) => name.endsWith('.json'))
      : [];
    expect(ipcFiles).toHaveLength(0);

    releaseFirstRun();
  });

  test('treats IPC-injected web sibling chat work as stuck pending work after the active query is idle', async () => {
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

    queue.markRunnerQueryIdle('web:main');

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
