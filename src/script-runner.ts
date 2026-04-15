import { exec } from 'child_process';
import path from 'path';

import { GROUPS_DIR } from './config.js';
import { logger } from './logger.js';
import { getSystemSettings } from './runtime-config.js';
import { serializeErrorForOutput } from '../shared/dist/error-serialization.js';
import {
  BLOCKED_CLI_CLAW_SERVICE_CONTROL_MESSAGE,
  detectUnsafeCliClawServiceControl,
} from '../shared/dist/service-restart-guard.js';

export interface ScriptRunResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
}

let activeScriptCount = 0;

export function getActiveScriptCount(): number {
  return activeScriptCount;
}

export function hasScriptCapacity(): boolean {
  const { maxConcurrentScripts } = getSystemSettings();
  return activeScriptCount < maxConcurrentScripts;
}

const MAX_BUFFER = 1024 * 1024; // 1MB

export async function runScript(
  command: string,
  groupFolder: string,
  cwdOverride?: string,
): Promise<ScriptRunResult> {
  const { scriptTimeout } = getSystemSettings();
  const cwd = cwdOverride || path.join(GROUPS_DIR, groupFolder);
  const startTime = Date.now();
  const blocked = detectUnsafeCliClawServiceControl(command, {
    backendPid: process.pid,
    launchdServiceName: process.env.CLI_CLAW_LAUNCHD_SERVICE_NAME || null,
  });

  if (blocked) {
    logger.warn(
      { command: command.slice(0, 200), groupFolder, reason: blocked.reason },
      'Blocked unsafe direct cli-claw service control script',
    );
    return {
      stdout: '',
      stderr: BLOCKED_CLI_CLAW_SERVICE_CONTROL_MESSAGE,
      exitCode: 1,
      timedOut: false,
      durationMs: Date.now() - startTime,
    };
  }

  activeScriptCount++;

  try {
    return await new Promise<ScriptRunResult>((resolve) => {
      const child = exec(
        command,
        {
          cwd,
          timeout: scriptTimeout,
          maxBuffer: MAX_BUFFER,
          env: {
            PATH: process.env.PATH,
            LANG: process.env.LANG || 'en_US.UTF-8',
            TZ:
              process.env.TZ ||
              Intl.DateTimeFormat().resolvedOptions().timeZone,
            GROUP_FOLDER: groupFolder,
            HOME: cwd,
          },
          shell: '/bin/sh',
        },
        (error, stdout, stderr) => {
          activeScriptCount--;
          const durationMs = Date.now() - startTime;
          const timedOut = error?.killed === true;

          if (timedOut) {
            logger.warn(
              { command: command.slice(0, 100), groupFolder, durationMs },
              'Script timed out',
            );
          }

          resolve({
            stdout: stdout.slice(0, MAX_BUFFER),
            stderr: stderr.slice(0, MAX_BUFFER),
            exitCode: timedOut ? null : (child.exitCode ?? (error ? 1 : 0)),
            timedOut,
            durationMs,
          });
        },
      );
    });
  } catch (err) {
    activeScriptCount--;
    const durationMs = Date.now() - startTime;
    logger.error(
      { command: command.slice(0, 100), groupFolder, err },
      'Script exec() threw synchronously',
    );
    return {
      stdout: '',
      stderr: serializeErrorForOutput(err),
      exitCode: 1,
      timedOut: false,
      durationMs,
    };
  }
}
