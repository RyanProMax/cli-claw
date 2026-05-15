#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

function parseArgs(argv) {
  const args = {
    stateFile: path.join(
      process.cwd(),
      '.cli-claw',
      'maintenance-loop-state.json',
    ),
    emit: false,
  };

  for (const arg of argv) {
    if (arg === '--emit') {
      args.emit = true;
    } else if (arg.startsWith('--state-file=')) {
      args.stateFile = arg.slice('--state-file='.length);
    }
  }

  return args;
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return {};
  }
}

function writeJsonFile(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const previous = readJsonFile(args.stateFile);
  const now = new Date().toISOString();
  const payload = {
    loop: 'maintenance_loop',
    status: 'active',
    phase: 'watching_for_improvements',
    current_focus:
      previous.current_focus ||
      'market-aware loop policy, usage guard, self-iteration workers',
    last_tick_at: now,
    tick_count: Number(previous.tick_count || 0) + 1,
    boundaries: [
      'separate_from_market_loop',
      'paper_only',
      'requires_review_and_regression_before_runtime_changes',
    ],
  };
  writeJsonFile(args.stateFile, payload);

  if (args.emit) {
    process.stdout.write(
      `maintenance_loop heartbeat ${payload.last_tick_at} focus=${payload.current_focus}\n`,
    );
  }
}

main();
