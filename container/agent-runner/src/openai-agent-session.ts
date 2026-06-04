import fs from 'node:fs';
import path from 'node:path';
import type { AgentInputItem, Session } from '@openai/agents';

const SESSION_ROOT =
  process.env.CLI_CLAW_RUNTIME_SESSION_DIR || '/workspace/.cli-claw-runtime';

function sanitizeSessionId(sessionId: string): string {
  return sessionId.replace(/[^a-zA-Z0-9_.-]/g, '_');
}

function createSessionId(): string {
  return `openai-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function atomicWriteJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2));
  fs.renameSync(tempPath, filePath);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function stripTopLevelResponseItemId(item: AgentInputItem): {
  item: AgentInputItem;
  changed: boolean;
} {
  const cloned = structuredClone(item) as unknown;
  if (!isRecord(cloned) || typeof cloned.type !== 'string') {
    return { item, changed: false };
  }
  if (!('id' in cloned)) return { item, changed: false };
  delete cloned.id;
  return { item: cloned as AgentInputItem, changed: true };
}

export function stripOpenAiNonPersistedResponseItemIds(
  items: AgentInputItem[],
): AgentInputItem[] {
  return items.map((item) => stripTopLevelResponseItemId(item).item);
}

export function filterOpenAiStoreFalseModelInput(args: {
  modelData: { input: AgentInputItem[]; instructions?: string };
}): { input: AgentInputItem[]; instructions?: string } {
  return {
    ...args.modelData,
    input: stripOpenAiNonPersistedResponseItemIds(args.modelData.input),
  };
}

function sanitizeSessionItems(items: AgentInputItem[]): {
  items: AgentInputItem[];
  changed: boolean;
} {
  let changed = false;
  const sanitized: AgentInputItem[] = [];

  for (const item of items) {
    const cloned = structuredClone(item) as unknown;
    if (!isRecord(cloned)) {
      sanitized.push(item);
      continue;
    }

    const stripped = stripTopLevelResponseItemId(cloned as AgentInputItem);
    if (stripped.changed) {
      changed = true;
    }
    const sanitizedItem = stripped.item as unknown;
    if (!isRecord(sanitizedItem)) {
      sanitized.push(stripped.item);
      continue;
    }

    if (cloned.type === 'reasoning') {
      changed = true;
      continue;
    }

    if (sanitizedItem.type === 'message') {
      if ('providerData' in sanitizedItem) {
        delete sanitizedItem.providerData;
        changed = true;
      }
    }

    sanitized.push(sanitizedItem as AgentInputItem);
  }

  return { items: sanitized, changed };
}

export function getOpenAiAgentSessionRoot(): string {
  return path.join(SESSION_ROOT, 'openai-agent');
}

export class FileOpenAiAgentSession implements Session {
  private readonly sessionId: string;
  private readonly filePath: string;
  private items: AgentInputItem[] | null = null;

  constructor(sessionId?: string) {
    this.sessionId = sessionId?.trim() || createSessionId();
    this.filePath = path.join(
      getOpenAiAgentSessionRoot(),
      `${sanitizeSessionId(this.sessionId)}.json`,
    );
  }

  async getSessionId(): Promise<string> {
    return this.sessionId;
  }

  async getItems(limit?: number): Promise<AgentInputItem[]> {
    const items = this.readItems();
    const selected =
      typeof limit === 'number' && limit > 0 ? items.slice(-limit) : items;
    return structuredClone(selected);
  }

  async addItems(items: AgentInputItem[]): Promise<void> {
    if (items.length === 0) return;
    const { items: sanitizedItems } = sanitizeSessionItems(items);
    if (sanitizedItems.length === 0) return;
    const next = [...this.readItems(), ...sanitizedItems];
    this.items = next;
    atomicWriteJson(this.filePath, next);
  }

  async popItem(): Promise<AgentInputItem | undefined> {
    const items = this.readItems();
    const popped = items.pop();
    this.items = items;
    atomicWriteJson(this.filePath, items);
    return popped;
  }

  async clearSession(): Promise<void> {
    this.items = [];
    atomicWriteJson(this.filePath, []);
  }

  private readItems(): AgentInputItem[] {
    if (this.items) return this.items;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
      const rawItems = Array.isArray(parsed)
        ? (parsed as AgentInputItem[])
        : [];
      const { items, changed } = sanitizeSessionItems(rawItems);
      this.items = items;
      if (changed) {
        atomicWriteJson(this.filePath, items);
      }
    } catch {
      this.items = [];
    }
    return this.items;
  }
}

export function createOpenAiAgentSession(
  sessionId?: string,
): FileOpenAiAgentSession {
  return new FileOpenAiAgentSession(sessionId);
}
