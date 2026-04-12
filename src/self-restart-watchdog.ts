import { pathToFileURL } from 'node:url';
import path from 'node:path';

import { logger } from './logger.js';
import { runSelfRestartWatchdog } from './self-restart.js';

async function main(): Promise<void> {
  const intentPath = process.argv[2];
  if (!intentPath) {
    logger.error('Missing self-restart intent path');
    process.exit(2);
  }

  const result = await runSelfRestartWatchdog(intentPath);
  if (result.status === 'passed' || result.status === 'preflight_failed') {
    process.exit(0);
  }
  process.exit(1);
}

function isDirectExecution(moduleUrl: string): boolean {
  const entryPath = process.argv[1];
  if (!entryPath) return false;
  return moduleUrl === pathToFileURL(path.resolve(entryPath)).href;
}

if (isDirectExecution(import.meta.url)) {
  void main().catch((err) => {
    logger.error({ err }, 'Self-restart watchdog failed');
    process.exit(1);
  });
}
