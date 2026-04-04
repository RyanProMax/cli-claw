import path from 'node:path';

export const AGENT_MEMORY_FILENAME = 'AGENTS.md';
export const AGENT_MEMORY_TEMPLATE_FILENAME = 'global-agents-md.template.md';

export function getAgentMemoryPath(dir: string): string {
  return path.join(dir, AGENT_MEMORY_FILENAME);
}
