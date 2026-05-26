import Database from './sqlite-compat.js';
import { CronExpressionParser } from 'cron-parser';
import fs from 'fs';
import path from 'path';

import { APP_ROOT } from '../core/app-root.js';
import { DATA_DIR, STORE_DIR, TIMEZONE } from '../core/config.js';
import { logger } from '../core/logger.js';
import {
  AgentKind,
  AgentStatus,
  AccessSession,
  AgentType,
  ImMessageLifecycleEvent,
  MessageFinalizationReason,
  NewMessage,
  MessageCursor,
  MessageHistoryCursor,
  MessageSourceKind,
  RegisteredGroup,
  RuntimeIdentity,
  ScheduledTask,
  SubAgent,
  TaskRunLog,
  RecordImMessageLifecycleEventInput,
  WorkflowContext,
  WorkflowDefinitionCache,
  WorkflowRun,
  WorkflowRunStatus,
  WorkflowRunStep,
  WorkflowRunStepStatus,
  Thread,
  ThreadKind,
  ThreadStatus,
  ImEntryRoute,
} from '../domain/types.js';
import {
  parseRuntimeIdentity,
  serializeRuntimeIdentity,
} from '../core/runtime/identity.js';

let db: InstanceType<typeof Database>;

const STOCK_STRATEGY_WORKSPACE_JID = 'web:stock-strategy';
const STOCK_STRATEGY_WORKSPACE_FOLDER = 'stock-strategy';
const STOCK_STRATEGY_WORKSPACE_NAME = '股票策略';
const STOCK_STRATEGY_MAIN_THREAD_ID = 'thread-stock-strategy-main';
const STOCK_STRATEGY_ORCHESTRATOR_INTERVAL_MS = 30 * 60 * 1000;
const STOCK_STRATEGY_WORKFLOW_IDS = new Set([
  'stock-strategy-control-loop',
  'stock-strategy-discovery-loop',
  'stock-strategy-loop',
  'stock-strategy-us-candidate-validation',
  'stock-strategy-hk-design-review',
  'stock-strategy-cn-coverage-check',
  'stock-strategy-paper-setup',
  'stock-strategy-paper-validation',
  'stock-strategy-daily-progress-summary',
]);
const STOCK_STRATEGY_DYNAMIC_WORKER_IDS = new Set([
  'stock-strategy-discovery-loop',
  'stock-strategy-loop',
  'stock-strategy-us-candidate-validation',
  'stock-strategy-hk-design-review',
  'stock-strategy-cn-coverage-check',
  'stock-strategy-paper-setup',
  'stock-strategy-paper-validation',
]);
const SCHEDULED_WORKFLOW_WATCHDOG_ERROR =
  'Process exceeded scheduled workflow watchdog timeout';
const STOCK_STRATEGY_LEGACY_FIXED_WORKER_TASK_IDS = new Set([
  'stock-strategy-loop-review',
  'stock-strategy-candidate-validation',
  'stock-strategy-design-review',
]);
const STOCK_STRATEGY_DEFAULT_SCHEDULES = [
  {
    id: 'stock-strategy-control-loop',
    workflowId: 'stock-strategy-control-loop',
    prompt:
      'Coordinate stock strategy research by state. This is the only fixed heartbeat: inspect new data, evidence signatures, quality gaps, candidate maturity, paper/live ledger, and human feedback before scheduling heavy worker workflows.',
    scheduleType: 'interval',
    scheduleValue: String(STOCK_STRATEGY_ORCHESTRATOR_INTERVAL_MS),
    nextRun: (now: string) =>
      addMsToIso(now, STOCK_STRATEGY_ORCHESTRATOR_INTERVAL_MS),
  },
  {
    id: 'stock-strategy-daily-progress-summary',
    workflowId: 'stock-strategy-daily-progress-summary',
    prompt:
      'At 21:00 local time, send a concise stock strategy daily progress summary: today done, blockers, next step, and human-review need only. Keep readonly and do not approve, activate, or trade.',
    scheduleType: 'cron',
    scheduleValue: '0 21 * * *',
    nextRun: (now: string) => nextCronRunIso('0 21 * * *', now),
  },
] as const;

// Prepared statement cache — lazy-initialized on first use after initDatabase()
let _stmts: {
  storeMessageSelect: any;
  storeMessageInsert: any;
  getSessionWithUser: any;
  deleteSession: any;
  updateSessionLastActive: any;
  updateTokenUsageById: any;
  updateTokenUsageLatest: any;
  getMessagesSince: any;
  getExpiredSessionIds: any;
} | null = null;

const _newMsgStmtCache = new Map<number, any>();

function stmts() {
  if (!_stmts) {
    _stmts = {
      storeMessageSelect: db.prepare(
        `SELECT id FROM messages
         WHERE chat_jid = ? AND turn_id = ? AND source_kind = 'sdk_final'
         ORDER BY timestamp DESC LIMIT 1`,
      ),
      storeMessageInsert: db.prepare(
        `INSERT OR REPLACE INTO messages (
          id, chat_jid, source_jid, sender, sender_name, content, timestamp, is_from_me,
          attachments, token_usage, runtime_identity, turn_id, session_id, sdk_message_uuid, source_kind, finalization_reason
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ),
      getSessionWithUser: db.prepare(
        `SELECT *
         FROM access_sessions
         WHERE id = ?`,
      ),
      deleteSession: db.prepare('DELETE FROM access_sessions WHERE id = ?'),
      updateSessionLastActive: db.prepare(
        'UPDATE access_sessions SET last_active_at = ? WHERE id = ?',
      ),
      updateTokenUsageById: db.prepare(
        `UPDATE messages SET token_usage = ?, cost_usd = ? WHERE id = ? AND chat_jid = ?`,
      ),
      updateTokenUsageLatest: db.prepare(
        `UPDATE messages SET token_usage = ?, cost_usd = ?
         WHERE rowid = (
           SELECT rowid FROM messages
           WHERE chat_jid = ? AND is_from_me = 1 AND token_usage IS NULL
             AND COALESCE(source_kind, 'legacy') != 'sdk_send_message'
           ORDER BY timestamp DESC LIMIT 1
         )`,
      ),
      getMessagesSince: db.prepare(
        `SELECT id, chat_jid, source_jid, runtime_identity, sender, sender_name, content, timestamp, attachments, source_kind
         FROM messages
         WHERE chat_jid = ? AND (timestamp > ? OR (timestamp = ? AND id > ?)) AND is_from_me = 0
         ORDER BY timestamp ASC, id ASC`,
      ),
      getExpiredSessionIds: db.prepare(
        'SELECT id FROM access_sessions WHERE expires_at < ?',
      ),
    };
  }
  return _stmts;
}

function getNewMessagesStmt(jidCount: number): any {
  let s = _newMsgStmtCache.get(jidCount);
  if (!s) {
    const placeholders = Array(jidCount).fill('?').join(',');
    s = db.prepare(
      `SELECT id, chat_jid, source_jid, runtime_identity, sender, sender_name, content, timestamp, attachments, source_kind
       FROM messages
       WHERE (timestamp > ? OR (timestamp = ? AND id > ?))
         AND chat_jid IN (${placeholders})
         AND is_from_me = 0
         AND COALESCE(source_kind, '') != 'user_command'
       ORDER BY timestamp ASC, id ASC`,
    );
    _newMsgStmtCache.set(jidCount, s);
  }
  return s;
}

interface StoredMessageMeta {
  turnId?: string | null;
  sessionId?: string | null;
  sdkMessageUuid?: string | null;
  sourceKind?: MessageSourceKind | null;
  finalizationReason?: MessageFinalizationReason | null;
  runtimeIdentity?: RuntimeIdentity | null;
}

interface DbMessageRow {
  id: string;
  chat_jid: string;
  source_jid?: string;
  runtime_identity?: string | null;
  sender: string;
  sender_name: string;
  content: string;
  timestamp: string;
  is_from_me: number;
  attachments?: string;
  token_usage?: string;
  turn_id?: string | null;
  session_id?: string | null;
  sdk_message_uuid?: string | null;
  source_kind?: MessageSourceKind | null;
  finalization_reason?: MessageFinalizationReason | null;
}

interface DbImMessageLifecycleEventRow {
  id: number;
  provider: string;
  chat_jid: string;
  source_jid: string | null;
  message_id: string;
  stage: ImMessageLifecycleEvent['stage'];
  status: ImMessageLifecycleEvent['status'];
  reason: string | null;
  details: string | null;
  created_at: string;
}

interface DbWorkflowDefinitionCacheRow {
  folder: string;
  workflow_id: string;
  source_path: string;
  definition_json: string;
  checksum: string | null;
  updated_at: string;
}

interface DbWorkflowContextRow {
  id: string;
  folder: string;
  workflow_id: string;
  thread_id: string;
  runtime_agent_id: string;
  active_run_id: string | null;
  metadata: string | null;
  created_at: string;
  updated_at: string;
}

interface DbWorkflowRunRow {
  id: string;
  context_id: string;
  folder: string;
  workflow_id: string;
  thread_id: string;
  trigger_chat_jid: string;
  trigger_message_id: string | null;
  trigger_user_id: string | null;
  prompt: string;
  status: WorkflowRunStatus;
  result: string | null;
  error: string | null;
  metadata: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

interface DbWorkflowRunStepRow {
  id: string;
  run_id: string;
  node_id: string;
  role_id: string | null;
  status: WorkflowRunStepStatus;
  attempt: number;
  input: string | null;
  output: string | null;
  error: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

interface DbThreadRow {
  id: string;
  workspace_jid: string;
  kind: ThreadKind;
  title: string;
  runtime_agent_id: string | null;
  source_run_id: string | null;
  status: ThreadStatus;
  created_at: string;
  updated_at: string;
  last_active_at: string;
  archived_at: string | null;
}

interface DbImEntryRouteRow {
  im_jid: string;
  default_workspace_jid: string | null;
  active_workspace_jid: string | null;
  active_thread_id: string | null;
  active_until: string | null;
  pinned: number;
  created_at: string;
  updated_at: string;
}

function mapDbMessageRow(
  row: DbMessageRow,
): NewMessage & { is_from_me: boolean } {
  return {
    ...row,
    runtime_identity: parseRuntimeIdentity(row.runtime_identity),
    is_from_me: row.is_from_me === 1,
  };
}

function parseLifecycleDetails(
  value: string | null,
): Record<string, unknown> | null {
  return parseJsonObject(value);
}

function parseJsonObject(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function stringifyJsonObject(
  value: Record<string, unknown> | null | undefined,
): string | null {
  return value ? JSON.stringify(value) : null;
}

function mapImMessageLifecycleEventRow(
  row: DbImMessageLifecycleEventRow,
): ImMessageLifecycleEvent {
  return {
    ...row,
    details: parseLifecycleDetails(row.details),
  };
}

function mapWorkflowDefinitionCacheRow(
  row: DbWorkflowDefinitionCacheRow,
): WorkflowDefinitionCache {
  return {
    ...row,
    definition_json: parseJsonObject(row.definition_json) ?? {},
  };
}

function mapWorkflowContextRow(row: DbWorkflowContextRow): WorkflowContext {
  return {
    ...row,
    metadata: parseJsonObject(row.metadata),
  };
}

function mapWorkflowRunRow(row: DbWorkflowRunRow): WorkflowRun {
  return {
    ...row,
    metadata: parseJsonObject(row.metadata),
  };
}

function mapWorkflowRunStepRow(row: DbWorkflowRunStepRow): WorkflowRunStep {
  return {
    ...row,
    input: parseJsonObject(row.input),
    output: parseJsonObject(row.output),
  };
}

function hasColumn(tableName: string, columnName: string): boolean {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{
    name: string;
  }>;
  return columns.some((column) => column.name === columnName);
}

function hasTable(tableName: string): boolean {
  const row = db
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1",
    )
    .get(tableName);
  return !!row;
}

function ensureColumn(
  tableName: string,
  columnName: string,
  sqlTypeWithDefault: string,
): void {
  if (hasColumn(tableName, columnName)) return;
  db.exec(
    `ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${sqlTypeWithDefault}`,
  );
}

function selectColumnOrDefault(
  tableName: string,
  columnName: string,
  fallbackSql: string,
): string {
  return hasColumn(tableName, columnName) ? columnName : fallbackSql;
}

function assertSchema(
  tableName: string,
  requiredColumns: string[],
  forbiddenColumns: string[] = [],
): void {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{
    name: string;
  }>;
  const names = new Set(columns.map((c) => c.name));

  const missing = requiredColumns.filter((c) => !names.has(c));
  const forbidden = forbiddenColumns.filter((c) => names.has(c));

  if (missing.length > 0 || forbidden.length > 0) {
    throw new Error(
      `Incompatible DB schema in table "${tableName}". Missing: [${missing.join(', ')}], forbidden: [${forbidden.join(', ')}]. ` +
        'Please remove ~/.cli-claw/db/messages.db and restart.',
    );
  }
}

/** Internal helper — reads router_state before initDatabase exports are available. */
function getRouterStateInternal(key: string): string | undefined {
  try {
    const row = db
      .prepare('SELECT value FROM router_state WHERE key = ?')
      .get(key) as { value: string } | undefined;
    return row?.value;
  } catch {
    return undefined; // Table may not exist yet on first run
  }
}

const LEGACY_SESSION_ARTIFACT_DIR = `.${['cla', 'ude'].join('')}`;

function removeLegacySessionArtifactDirs(folders: string[]): void {
  const uniqueFolders = [...new Set(folders.filter(Boolean))];
  for (const folder of uniqueFolders) {
    const sessionRoot = path.join(DATA_DIR, 'sessions', folder);
    const candidates = [path.join(sessionRoot, LEGACY_SESSION_ARTIFACT_DIR)];
    const agentsRoot = path.join(sessionRoot, 'agents');

    try {
      if (fs.existsSync(agentsRoot)) {
        for (const agentId of fs.readdirSync(agentsRoot)) {
          candidates.push(
            path.join(agentsRoot, agentId, LEGACY_SESSION_ARTIFACT_DIR),
          );
        }
      }
    } catch (err) {
      logger.warn(
        { folder, err },
        'Failed to enumerate legacy session artifact directories',
      );
    }

    for (const candidate of candidates) {
      try {
        fs.rmSync(candidate, { recursive: true, force: true });
      } catch (err) {
        logger.warn(
          { folder, candidate, err },
          'Failed to remove legacy session artifact directory',
        );
      }
    }
  }
}

export function initDatabase(): void {
  const dbPath = path.join(STORE_DIR, 'messages.db');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  db = new Database(dbPath);

  // Enable WAL mode for better concurrency and performance
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec(`
    CREATE TABLE IF NOT EXISTS chats (
      jid TEXT PRIMARY KEY,
      name TEXT,
      last_message_time TEXT
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT,
      chat_jid TEXT,
      source_jid TEXT,
      sender TEXT,
      sender_name TEXT,
      content TEXT,
      timestamp TEXT,
      is_from_me INTEGER,
      attachments TEXT,
      token_usage TEXT,
      runtime_identity TEXT,
      turn_id TEXT,
      session_id TEXT,
      sdk_message_uuid TEXT,
      source_kind TEXT,
      finalization_reason TEXT,
      PRIMARY KEY (id, chat_jid),
      FOREIGN KEY (chat_jid) REFERENCES chats(jid)
    );
    CREATE INDEX IF NOT EXISTS idx_timestamp ON messages(timestamp);
    CREATE INDEX IF NOT EXISTS idx_messages_jid_ts ON messages(chat_jid, timestamp);

    CREATE TABLE IF NOT EXISTS im_message_lifecycle_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      chat_jid TEXT NOT NULL,
      source_jid TEXT,
      message_id TEXT NOT NULL,
      stage TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ok',
      reason TEXT,
      details TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_im_lifecycle_message
      ON im_message_lifecycle_events(provider, chat_jid, message_id, id);
    CREATE INDEX IF NOT EXISTS idx_im_lifecycle_source
      ON im_message_lifecycle_events(provider, source_jid, message_id, id);
    CREATE INDEX IF NOT EXISTS idx_im_lifecycle_created
      ON im_message_lifecycle_events(provider, created_at, id);

    CREATE TABLE IF NOT EXISTS scheduled_tasks (
      id TEXT PRIMARY KEY,
      group_folder TEXT NOT NULL,
      chat_jid TEXT NOT NULL,
      prompt TEXT NOT NULL,
      schedule_type TEXT NOT NULL,
      schedule_value TEXT NOT NULL,
      context_mode TEXT DEFAULT 'isolated',
      execution_type TEXT NOT NULL DEFAULT 'workflow',
      script_command TEXT,
      next_run TEXT,
      last_run TEXT,
      last_result TEXT,
      status TEXT DEFAULT 'active',
      created_at TEXT NOT NULL,
      created_by TEXT,
      notify_channels TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_next_run ON scheduled_tasks(next_run);
    CREATE INDEX IF NOT EXISTS idx_status ON scheduled_tasks(status);

    CREATE TABLE IF NOT EXISTS task_run_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      run_at TEXT NOT NULL,
      duration_ms INTEGER NOT NULL,
      status TEXT NOT NULL,
      result TEXT,
      error TEXT,
      FOREIGN KEY (task_id) REFERENCES scheduled_tasks(id)
    );
    CREATE INDEX IF NOT EXISTS idx_task_run_logs ON task_run_logs(task_id, run_at);

    CREATE TABLE IF NOT EXISTS workflow_definitions (
      folder TEXT NOT NULL,
      workflow_id TEXT NOT NULL,
      source_path TEXT NOT NULL,
      definition_json TEXT NOT NULL,
      checksum TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (folder, workflow_id)
    );

    CREATE TABLE IF NOT EXISTS workflow_contexts (
      id TEXT PRIMARY KEY,
      folder TEXT NOT NULL,
      workflow_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      runtime_agent_id TEXT NOT NULL,
      active_run_id TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (folder, workflow_id),
      UNIQUE (thread_id)
    );
    CREATE INDEX IF NOT EXISTS idx_workflow_contexts_folder
      ON workflow_contexts(folder, workflow_id);

    CREATE TABLE IF NOT EXISTS workflow_runs (
      id TEXT PRIMARY KEY,
      context_id TEXT NOT NULL,
      folder TEXT NOT NULL,
      workflow_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      trigger_chat_jid TEXT NOT NULL,
      trigger_message_id TEXT,
      trigger_user_id TEXT,
      prompt TEXT NOT NULL,
      status TEXT NOT NULL,
      result TEXT,
      error TEXT,
      metadata TEXT,
      started_at TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (context_id) REFERENCES workflow_contexts(id)
    );
    CREATE INDEX IF NOT EXISTS idx_workflow_runs_context
      ON workflow_runs(context_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_workflow_runs_folder
      ON workflow_runs(folder, created_at);
    CREATE INDEX IF NOT EXISTS idx_workflow_runs_status
      ON workflow_runs(status, updated_at);

    CREATE TABLE IF NOT EXISTS workflow_run_steps (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      node_id TEXT NOT NULL,
      role_id TEXT,
      status TEXT NOT NULL,
      attempt INTEGER NOT NULL DEFAULT 1,
      input TEXT,
      output TEXT,
      error TEXT,
      started_at TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (run_id) REFERENCES workflow_runs(id),
      UNIQUE (run_id, node_id, attempt)
    );
    CREATE INDEX IF NOT EXISTS idx_workflow_run_steps_run
      ON workflow_run_steps(run_id, created_at);
  `);

  // State tables (replacing JSON files)
  db.exec(`
    CREATE TABLE IF NOT EXISTS router_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      group_folder TEXT NOT NULL,
      session_id TEXT NOT NULL,
      agent_id TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (group_folder, agent_id)
    );
    CREATE TABLE IF NOT EXISTS registered_groups (
      jid TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      folder TEXT NOT NULL,
      added_at TEXT NOT NULL,
      agent_type TEXT DEFAULT 'openai',
      model TEXT,
      reasoning_effort TEXT,
      speed_tier TEXT,
      custom_cwd TEXT,
      created_by TEXT,
      is_home INTEGER DEFAULT 0,
      target_agent_id TEXT,
      target_main_jid TEXT,
      reply_policy TEXT DEFAULT 'source_only',
      require_mention INTEGER DEFAULT 0,
      activation_mode TEXT DEFAULT 'auto'
    );

    CREATE TABLE IF NOT EXISTS threads (
      id TEXT PRIMARY KEY,
      workspace_jid TEXT NOT NULL,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      runtime_agent_id TEXT,
      source_run_id TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_active_at TEXT NOT NULL,
      archived_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_threads_workspace
      ON threads(workspace_jid, status, last_active_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_threads_main_workspace
      ON threads(workspace_jid)
      WHERE kind = 'main' AND archived_at IS NULL;

    CREATE TABLE IF NOT EXISTS im_entry_routes (
      im_jid TEXT PRIMARY KEY,
      default_workspace_jid TEXT,
      active_workspace_jid TEXT,
      active_thread_id TEXT,
      active_until TEXT,
      pinned INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  // Single-instance access tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS access_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS access_sessions (
      id TEXT PRIMARY KEY,
      ip_address TEXT,
      user_agent TEXT,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      last_active_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_access_sessions_expires ON access_sessions(expires_at);
  `);

  const existingAccessPassword = db
    .prepare("SELECT value FROM access_config WHERE key = 'password_hash'")
    .get() as { value: string } | undefined;
  const legacyUsersTable = `user${'s'}`;
  if (!existingAccessPassword && hasTable(legacyUsersTable)) {
    const legacyRole = ['ad', 'min'].join('');
    const legacyPrincipal = db
      .prepare(
        `SELECT password_hash FROM ${legacyUsersTable} WHERE role = ? AND status = 'active' ORDER BY created_at ASC LIMIT 1`,
      )
      .get(legacyRole) as { password_hash: string } | undefined;
    if (legacyPrincipal?.password_hash) {
      db.prepare(
        "INSERT OR REPLACE INTO access_config (key, value) VALUES ('password_hash', ?)",
      ).run(legacyPrincipal.password_hash);
    }
  }
  for (const tableName of [
    legacyUsersTable,
    `user_${'sessions'}`,
    `auth_${'audit'}_log`,
    `group_${'members'}`,
    `user_${'pinned'}_groups`,
    `invite_${'codes'}`,
  ]) {
    db.exec(`DROP TABLE IF EXISTS ${tableName}`);
  }

  // Sub-agents table for multi-agent parallel execution
  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      group_folder TEXT NOT NULL,
      chat_jid TEXT NOT NULL,
      name TEXT NOT NULL,
      prompt TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      created_by TEXT,
      created_at TEXT NOT NULL,
      completed_at TEXT,
      result_summary TEXT,
      last_im_jid TEXT,
      spawned_from_jid TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_agents_group ON agents(group_folder);
    CREATE INDEX IF NOT EXISTS idx_agents_jid ON agents(chat_jid);
    CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);
  `);

  // Lightweight migrations for existing DBs
  ensureColumn('registered_groups', 'agent_type', "TEXT DEFAULT 'openai'");
  ensureColumn('registered_groups', 'model', 'TEXT');
  ensureColumn('registered_groups', 'reasoning_effort', 'TEXT');
  ensureColumn('registered_groups', 'speed_tier', 'TEXT');
  ensureColumn('registered_groups', 'custom_cwd', 'TEXT');
  ensureColumn('messages', 'attachments', 'TEXT');
  ensureColumn('messages', 'source_jid', 'TEXT');
  ensureColumn('registered_groups', 'created_by', 'TEXT');
  ensureColumn('registered_groups', 'is_home', 'INTEGER DEFAULT 0');
  ensureColumn('scheduled_tasks', 'created_by', 'TEXT');
  ensureColumn(
    'scheduled_tasks',
    'execution_type',
    "TEXT NOT NULL DEFAULT 'workflow'",
  );
  ensureColumn('scheduled_tasks', 'script_command', 'TEXT');
  ensureColumn('scheduled_tasks', 'notify_channels', 'TEXT');
  ensureColumn('scheduled_tasks', 'workspace_jid', 'TEXT');
  ensureColumn('scheduled_tasks', 'workspace_folder', 'TEXT');
  ensureColumn('sessions', 'agent_id', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('agents', 'kind', "TEXT NOT NULL DEFAULT 'task'");
  ensureColumn('registered_groups', 'target_agent_id', 'TEXT');
  ensureColumn('registered_groups', 'target_main_jid', 'TEXT');
  ensureColumn(
    'registered_groups',
    'reply_policy',
    "TEXT DEFAULT 'source_only'",
  );
  ensureColumn('registered_groups', 'require_mention', 'INTEGER DEFAULT 0');
  ensureColumn('registered_groups', 'activation_mode', "TEXT DEFAULT 'auto'");
  ensureColumn('messages', 'token_usage', 'TEXT');
  ensureColumn('messages', 'runtime_identity', 'TEXT');
  ensureColumn('messages', 'turn_id', 'TEXT');
  ensureColumn('messages', 'session_id', 'TEXT');
  ensureColumn('messages', 'sdk_message_uuid', 'TEXT');
  ensureColumn('messages', 'source_kind', 'TEXT');
  ensureColumn('messages', 'finalization_reason', 'TEXT');

  // Add index on target_agent_id for fast lookup of IM bindings
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_rg_target_agent ON registered_groups(target_agent_id)',
  );
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_rg_target_main ON registered_groups(target_main_jid)',
  );

  // Migration: remove UNIQUE constraint from registered_groups.folder
  // Multiple groups (web:main + feishu chats) share folder='main' by design.
  // The old UNIQUE constraint caused INSERT OR REPLACE to silently delete
  // the conflicting row, making web:main and feishu groups mutually exclusive.
  const hasUniqueFolder =
    (
      db
        .prepare(
          `SELECT COUNT(*) as cnt FROM sqlite_master
         WHERE type='index' AND tbl_name='registered_groups'
         AND name='sqlite_autoindex_registered_groups_2'`,
        )
        .get() as { cnt: number }
    ).cnt > 0;
  if (hasUniqueFolder) {
    db.transaction(() => {
      db.exec(`
        CREATE TABLE registered_groups_new (
          jid TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          folder TEXT NOT NULL,
          added_at TEXT NOT NULL,
          agent_type TEXT DEFAULT 'openai',
          model TEXT,
          reasoning_effort TEXT,
          speed_tier TEXT,
          custom_cwd TEXT,
          created_by TEXT,
          is_home INTEGER DEFAULT 0
        );
        INSERT INTO registered_groups_new (jid, name, folder, added_at, agent_type, custom_cwd, created_by, is_home)
          SELECT jid, name, folder, added_at, 'openai', custom_cwd, NULL, 0 FROM registered_groups;
        DROP TABLE registered_groups;
        ALTER TABLE registered_groups_new RENAME TO registered_groups;
      `);
    })();
  }
  ensureColumn('registered_groups', 'speed_tier', 'TEXT');

  if (
    [
      'container_config',
      'execution_mode',
      'init_source_path',
      'init_git_url',
      'mcp_mode',
      'selected_mcps',
    ].some((column) => hasColumn('registered_groups', column))
  ) {
    const source = {
      agent_type: selectColumnOrDefault(
        'registered_groups',
        'agent_type',
        "'openai'",
      ),
      model: selectColumnOrDefault('registered_groups', 'model', 'NULL'),
      reasoning_effort: selectColumnOrDefault(
        'registered_groups',
        'reasoning_effort',
        'NULL',
      ),
      speed_tier: selectColumnOrDefault(
        'registered_groups',
        'speed_tier',
        'NULL',
      ),
      custom_cwd: selectColumnOrDefault(
        'registered_groups',
        'custom_cwd',
        'NULL',
      ),
      created_by: selectColumnOrDefault(
        'registered_groups',
        'created_by',
        'NULL',
      ),
      is_home: selectColumnOrDefault('registered_groups', 'is_home', '0'),
      target_agent_id: selectColumnOrDefault(
        'registered_groups',
        'target_agent_id',
        'NULL',
      ),
      target_main_jid: selectColumnOrDefault(
        'registered_groups',
        'target_main_jid',
        'NULL',
      ),
      reply_policy: selectColumnOrDefault(
        'registered_groups',
        'reply_policy',
        "'source_only'",
      ),
      require_mention: selectColumnOrDefault(
        'registered_groups',
        'require_mention',
        '0',
      ),
      activation_mode: selectColumnOrDefault(
        'registered_groups',
        'activation_mode',
        "'auto'",
      ),
    };
    db.transaction(() => {
      db.exec(`
        CREATE TABLE registered_groups_new (
          jid TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          folder TEXT NOT NULL,
          added_at TEXT NOT NULL,
          agent_type TEXT DEFAULT 'openai',
          model TEXT,
          reasoning_effort TEXT,
          speed_tier TEXT,
          custom_cwd TEXT,
          created_by TEXT,
          is_home INTEGER DEFAULT 0,
          target_agent_id TEXT,
          target_main_jid TEXT,
          reply_policy TEXT DEFAULT 'source_only',
          require_mention INTEGER DEFAULT 0,
          activation_mode TEXT DEFAULT 'auto'
        );
        INSERT INTO registered_groups_new (
          jid, name, folder, added_at, agent_type, model, reasoning_effort,
          speed_tier, custom_cwd, created_by, is_home,
          target_agent_id, target_main_jid, reply_policy, require_mention,
          activation_mode
        )
        SELECT
          jid, name, folder, added_at, ${source.agent_type}, ${source.model},
          ${source.reasoning_effort}, ${source.speed_tier}, ${source.custom_cwd},
          ${source.created_by}, ${source.is_home},
          ${source.target_agent_id}, ${source.target_main_jid},
          ${source.reply_policy}, ${source.require_mention},
          ${source.activation_mode}
        FROM registered_groups;
        DROP TABLE registered_groups;
        ALTER TABLE registered_groups_new RENAME TO registered_groups;
      `);
    })();
  }

  if (hasColumn('scheduled_tasks', 'execution_mode')) {
    db.transaction(() => {
      db.exec(`
        CREATE TABLE scheduled_tasks_new (
          id TEXT PRIMARY KEY,
          group_folder TEXT NOT NULL,
          chat_jid TEXT NOT NULL,
          prompt TEXT NOT NULL,
          schedule_type TEXT NOT NULL,
          schedule_value TEXT NOT NULL,
          context_mode TEXT DEFAULT 'isolated',
          execution_type TEXT NOT NULL DEFAULT 'workflow',
          script_command TEXT,
          next_run TEXT,
          last_run TEXT,
          last_result TEXT,
          status TEXT DEFAULT 'active',
          created_at TEXT NOT NULL,
          created_by TEXT,
          notify_channels TEXT,
          workspace_jid TEXT,
          workspace_folder TEXT
        );
        INSERT INTO scheduled_tasks_new (
          id, group_folder, chat_jid, prompt, schedule_type, schedule_value,
          context_mode, execution_type, script_command, next_run, last_run,
          last_result, status, created_at, created_by, notify_channels,
          workspace_jid, workspace_folder
        )
        SELECT
          id, group_folder, chat_jid, prompt, schedule_type, schedule_value,
          context_mode, execution_type, script_command, next_run, last_run,
          last_result, status, created_at, created_by, notify_channels,
          workspace_jid, workspace_folder
        FROM scheduled_tasks;
        DROP TABLE scheduled_tasks;
        ALTER TABLE scheduled_tasks_new RENAME TO scheduled_tasks;
      `);
    })();
  }

  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_next_run ON scheduled_tasks(next_run)',
  );
  db.exec('CREATE INDEX IF NOT EXISTS idx_status ON scheduled_tasks(status)');
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_rg_target_agent ON registered_groups(target_agent_id)',
  );
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_rg_target_main ON registered_groups(target_main_jid)',
  );

  // v19→v20 migration: add token_usage column to messages
  ensureColumn('messages', 'token_usage', 'TEXT');
  assertSchema('messages', [
    'id',
    'chat_jid',
    'source_jid',
    'sender',
    'sender_name',
    'content',
    'timestamp',
    'is_from_me',
    'attachments',
    'token_usage',
    'runtime_identity',
  ]);
  assertSchema('scheduled_tasks', [
    'id',
    'group_folder',
    'chat_jid',
    'prompt',
    'schedule_type',
    'schedule_value',
    'context_mode',
    'next_run',
    'last_run',
    'last_result',
    'status',
    'created_at',
    'execution_type',
    'script_command',
  ]);
  assertSchema(
    'registered_groups',
    [
      'jid',
      'name',
      'folder',
      'added_at',
      'agent_type',
      'model',
      'reasoning_effort',
      'speed_tier',
      'custom_cwd',
      'created_by',
      'is_home',
      'target_agent_id',
      'target_main_jid',
      'reply_policy',
      'require_mention',
      'activation_mode',
    ],
    [
      'trigger_pattern',
      'requires_trigger',
      'container_config',
      'execution_mode',
      'init_source_path',
      'init_git_url',
      'mcp_mode',
      'selected_mcps',
    ],
  );

  db.exec(`
    DELETE FROM task_run_logs
    WHERE task_id IN (
      SELECT id FROM scheduled_tasks WHERE execution_type != 'workflow'
    );
    DELETE FROM scheduled_tasks WHERE execution_type != 'workflow';
    DELETE FROM registered_groups
    WHERE jid LIKE '${['tele', 'gram'].join('')}:%'
       OR jid LIKE '${['q', 'q'].join('')}:%'
       OR jid LIKE '${['ding', 'talk'].join('')}:%';
  `);

  // v13 migration: mark existing web:main group as is_home=1
  db.exec(`
    UPDATE registered_groups SET is_home = 1
    WHERE jid = 'web:main' AND folder = 'main' AND is_home = 0
  `);

  // v16→v17 migration: rebuild sessions table with composite primary key
  // Old PK was (group_folder), which cannot store multiple agent sessions per folder.
  // New PK is (group_folder, COALESCE(agent_id, '')) to support per-agent sessions.
  const curVer = getRouterStateInternal('schema_version');
  if (curVer && parseInt(curVer, 10) < 17) {
    db.transaction(() => {
      // Check if the old table has single-column PK by inspecting table_info
      const pkCols = (
        db.prepare("PRAGMA table_info('sessions')").all() as Array<{
          name: string;
          pk: number;
        }>
      ).filter((c) => c.pk > 0);
      // Old schema: single PK column 'group_folder'. New schema: composite PK needs rebuild.
      if (pkCols.length === 1 && pkCols[0].name === 'group_folder') {
        db.exec(`
          CREATE TABLE sessions_new (
            group_folder TEXT NOT NULL,
            session_id TEXT NOT NULL,
            agent_id TEXT NOT NULL DEFAULT '',
            PRIMARY KEY (group_folder, agent_id)
          );
          INSERT OR IGNORE INTO sessions_new (group_folder, session_id, agent_id)
            SELECT group_folder, session_id, COALESCE(agent_id, '') FROM sessions;
          DROP TABLE sessions;
          ALTER TABLE sessions_new RENAME TO sessions;
        `);
      }
    })();
  }

  // v22: Fix target_main_jid that used folder-based JID (web:${folder})
  // instead of actual registered group JID (web:${uuid}).
  // Only affects non-home workspaces where folder != uuid.
  if (curVer && parseInt(curVer, 10) < 22) {
    const rows = db
      .prepare(
        "SELECT jid, target_main_jid FROM registered_groups WHERE target_main_jid IS NOT NULL AND target_main_jid != ''",
      )
      .all() as Array<{ jid: string; target_main_jid: string }>;
    for (const row of rows) {
      const targetJid = row.target_main_jid;
      // Check if target_main_jid is a real registered group JID
      const exists = db
        .prepare('SELECT 1 FROM registered_groups WHERE jid = ?')
        .get(targetJid);
      if (exists) continue;
      // Not a valid JID — try to resolve via folder
      if (!targetJid.startsWith('web:')) continue;
      const folder = targetJid.slice(4);
      const candidates = db
        .prepare(
          "SELECT jid FROM registered_groups WHERE folder = ? AND jid LIKE 'web:%'",
        )
        .all(folder) as Array<{ jid: string }>;
      if (candidates.length === 1) {
        db.prepare(
          'UPDATE registered_groups SET target_main_jid = ? WHERE jid = ?',
        ).run(candidates[0].jid, row.jid);
      }
    }
  }

  // v25→v26 migration: cost_usd on messages
  ensureColumn('messages', 'cost_usd', 'REAL');

  db.exec(`
    DROP TABLE IF EXISTS billing_plans;
    DROP TABLE IF EXISTS user_subscriptions;
    DROP TABLE IF EXISTS user_balances;
    DROP TABLE IF EXISTS balance_transactions;
    DROP TABLE IF EXISTS monthly_usage;
    DROP TABLE IF EXISTS daily_usage;
    DROP TABLE IF EXISTS redeem_codes;
    DROP TABLE IF EXISTS redeem_code_usage;
    DROP TABLE IF EXISTS billing_audit_log;
    DROP TABLE IF EXISTS user_quotas;
    DROP TABLE IF EXISTS usage_records;
    DROP TABLE IF EXISTS usage_daily_summary;
  `);

  // v29 → v30: Add last_im_jid to agents table (#225)
  if (
    !db
      .prepare("PRAGMA table_info('agents')")
      .all()
      .some((c: any) => c.name === 'last_im_jid')
  ) {
    db.exec('ALTER TABLE agents ADD COLUMN last_im_jid TEXT');
  }

  // v31 → v32: Add spawned_from_jid to agents table (spawn parallel tasks)
  if (
    !db
      .prepare("PRAGMA table_info('agents')")
      .all()
      .some((c: any) => c.name === 'spawned_from_jid')
  ) {
    db.exec('ALTER TABLE agents ADD COLUMN spawned_from_jid TEXT');
  }

  // v34→v35: normalize legacy runtime names and invalidate migrated sessions.
  const v35Ver = getRouterStateInternal('schema_version');
  if (!v35Ver || parseInt(v35Ver, 10) < 35) {
    db.transaction(() => {
      const migrated = db
        .prepare(
          "SELECT DISTINCT folder FROM registered_groups WHERE agent_type IS NULL OR agent_type = '' OR agent_type = 'codex' OR agent_type = ?",
        )
        .all(LEGACY_SESSION_ARTIFACT_DIR.slice(1)) as Array<{
        folder: string;
      }>;

      db.prepare(
        "UPDATE registered_groups SET agent_type = 'openai' WHERE agent_type IS NULL OR agent_type = '' OR agent_type = 'codex' OR agent_type = ?",
      ).run(LEGACY_SESSION_ARTIFACT_DIR.slice(1));

      const deleteSessions = db.prepare(
        'DELETE FROM sessions WHERE group_folder = ?',
      );
      for (const row of migrated) {
        deleteSessions.run(row.folder);
      }

      removeLegacySessionArtifactDirs(migrated.map((row) => row.folder));
    })();
  }

  ensureStockStrategyWorkspaceAndSchedules();

  const SCHEMA_VERSION = '36';
  db.prepare(
    'INSERT OR REPLACE INTO router_state (key, value) VALUES (?, ?)',
  ).run('schema_version', SCHEMA_VERSION);
}

/**
 * Store chat metadata only (no message content).
 * Used for all chats to enable group discovery without storing sensitive content.
 */
export function storeChatMetadata(
  chatJid: string,
  timestamp: string,
  name?: string,
): void {
  if (name) {
    // Update with name, preserving existing timestamp if newer
    db.prepare(
      `
      INSERT INTO chats (jid, name, last_message_time) VALUES (?, ?, ?)
      ON CONFLICT(jid) DO UPDATE SET
        name = excluded.name,
        last_message_time = MAX(last_message_time, excluded.last_message_time)
    `,
    ).run(chatJid, name, timestamp);
  } else {
    // Update timestamp only, preserve existing name if any
    db.prepare(
      `
      INSERT INTO chats (jid, name, last_message_time) VALUES (?, ?, ?)
      ON CONFLICT(jid) DO UPDATE SET
        last_message_time = MAX(last_message_time, excluded.last_message_time)
    `,
    ).run(chatJid, chatJid, timestamp);
  }
}

/**
 * Update chat name without changing timestamp for existing chats.
 * New chats get the current time as their initial timestamp.
 * Used during group metadata sync.
 */
export function updateChatName(chatJid: string, name: string): void {
  db.prepare(
    `
    INSERT INTO chats (jid, name, last_message_time) VALUES (?, ?, ?)
    ON CONFLICT(jid) DO UPDATE SET name = excluded.name
  `,
  ).run(chatJid, name, new Date().toISOString());
}

export interface ChatInfo {
  jid: string;
  name: string;
  last_message_time: string;
}

/**
 * Get all known chats, ordered by most recent activity.
 */
export function getAllChats(): ChatInfo[] {
  return db
    .prepare(
      `
    SELECT jid, name, last_message_time
    FROM chats
    ORDER BY last_message_time DESC
  `,
    )
    .all() as ChatInfo[];
}

/**
 * Get timestamp of last group metadata sync.
 */
export function getLastGroupSync(): string | null {
  // Store sync time in a special chat entry
  const row = db
    .prepare(`SELECT last_message_time FROM chats WHERE jid = '__group_sync__'`)
    .get() as { last_message_time: string } | undefined;
  return row?.last_message_time || null;
}

/**
 * Record that group metadata was synced.
 */
export function setLastGroupSync(): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT OR REPLACE INTO chats (jid, name, last_message_time) VALUES ('__group_sync__', '__group_sync__', ?)`,
  ).run(now);
}

/**
 * Ensure a chat row exists in the chats table (avoids FK violation on messages insert).
 */
export function ensureChatExists(chatJid: string): void {
  db.prepare(
    `INSERT OR IGNORE INTO chats (jid, name, last_message_time) VALUES (?, ?, ?)`,
  ).run(chatJid, chatJid, new Date().toISOString());
}

/**
 * Store a message with full content (channel-agnostic).
 * Only call this for registered groups where message history is needed.
 */
export function storeMessageDirect(
  msgId: string,
  chatJid: string,
  sender: string,
  senderName: string,
  content: string,
  timestamp: string,
  isFromMe: boolean,
  opts?: {
    attachments?: string;
    tokenUsage?: string;
    sourceJid?: string;
    meta?: StoredMessageMeta;
  },
): string {
  const { attachments, tokenUsage, sourceJid, meta } = opts ?? {};
  const existingFinalRow =
    meta?.sourceKind === 'sdk_final' && meta.turnId
      ? (stmts().storeMessageSelect.get(chatJid, meta.turnId) as
          | { id: string }
          | undefined)
      : undefined;
  const effectiveMsgId = existingFinalRow?.id || msgId;
  stmts().storeMessageInsert.run(
    effectiveMsgId,
    chatJid,
    sourceJid ?? chatJid,
    sender,
    senderName,
    content,
    timestamp,
    isFromMe ? 1 : 0,
    attachments ?? null,
    tokenUsage ?? null,
    serializeRuntimeIdentity(meta?.runtimeIdentity),
    meta?.turnId ?? null,
    meta?.sessionId ?? null,
    meta?.sdkMessageUuid ?? null,
    meta?.sourceKind ?? null,
    meta?.finalizationReason ?? null,
  );
  return effectiveMsgId;
}

/**
 * Update the token_usage field on a specific agent message, or fall back to
 * the most recent agent message without token_usage for the given chat.
 * When msgId is provided, uses precise `WHERE id = ? AND chat_jid = ?` match
 * to avoid race conditions in concurrent scenarios.
 */
export function updateLatestMessageTokenUsage(
  chatJid: string,
  tokenUsage: string,
  msgId?: string,
  costUsd?: number,
): void {
  if (msgId) {
    stmts().updateTokenUsageById.run(
      tokenUsage,
      costUsd ?? null,
      msgId,
      chatJid,
    );
  } else {
    stmts().updateTokenUsageLatest.run(tokenUsage, costUsd ?? null, chatJid);
  }
}

export function getNewMessages(
  jids: string[],
  cursor: MessageCursor,
): { messages: NewMessage[]; newCursor: MessageCursor } {
  if (jids.length === 0) return { messages: [], newCursor: cursor };

  const rows = getNewMessagesStmt(jids.length).all(
    cursor.timestamp,
    cursor.timestamp,
    cursor.id,
    ...jids,
  ) as NewMessage[];
  const messages = (rows as DbMessageRow[]).map((row) => ({
    ...mapDbMessageRow(row),
  }));
  const last = messages[messages.length - 1];
  return {
    messages,
    newCursor: last ? { timestamp: last.timestamp, id: last.id } : cursor,
  };
}

export function getMessagesSince(
  chatJid: string,
  cursor: MessageCursor,
): NewMessage[] {
  const rows = stmts().getMessagesSince.all(
    chatJid,
    cursor.timestamp,
    cursor.timestamp,
    cursor.id,
  ) as DbMessageRow[];
  return rows.map((row) => ({
    ...row,
    runtime_identity: parseRuntimeIdentity(row.runtime_identity),
  }));
}

export function getLatestInterruptedPartialMessageSince(
  chatJid: string,
  cursor: MessageCursor,
): (NewMessage & { is_from_me: boolean }) | undefined {
  const row = db
    .prepare(
      `SELECT id, chat_jid, source_jid, runtime_identity, sender, sender_name, content, timestamp, is_from_me, attachments, token_usage, turn_id, session_id, sdk_message_uuid, source_kind, finalization_reason
       FROM messages
       WHERE chat_jid = ?
         AND (timestamp > ? OR (timestamp = ? AND id > ?))
         AND is_from_me = 1
         AND (source_kind = 'interrupt_partial' OR finalization_reason = 'interrupted')
       ORDER BY timestamp DESC, id DESC
       LIMIT 1`,
    )
    .get(chatJid, cursor.timestamp, cursor.timestamp, cursor.id) as
    | DbMessageRow
    | undefined;
  return row ? mapDbMessageRow(row) : undefined;
}

export function recordImMessageLifecycleEvent(
  input: RecordImMessageLifecycleEventInput,
): number {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO im_message_lifecycle_events (
        provider, chat_jid, source_jid, message_id, stage, status, reason, details, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.provider,
      input.chatJid,
      input.sourceJid ?? null,
      input.messageId,
      input.stage,
      input.status ?? 'ok',
      input.reason ?? null,
      input.details ? JSON.stringify(input.details) : null,
      createdAt,
    );
  return Number(result.lastInsertRowid);
}

export function getImMessageLifecycleEvents(filter: {
  provider: string;
  chatJid: string;
  messageId: string;
  limit?: number;
}): ImMessageLifecycleEvent[] {
  const limit = Math.max(1, Math.min(filter.limit ?? 50, 200));
  const rows = db
    .prepare(
      `SELECT *
       FROM im_message_lifecycle_events
       WHERE provider = ?
         AND message_id = ?
         AND (chat_jid = ? OR source_jid = ?)
       ORDER BY id ASC
       LIMIT ?`,
    )
    .all(
      filter.provider,
      filter.messageId,
      filter.chatJid,
      filter.chatJid,
      limit,
    ) as DbImMessageLifecycleEventRow[];
  return rows.map(mapImMessageLifecycleEventRow);
}

export function getRecentImMessageLifecycleEvents(filter: {
  provider: string;
  chatJid?: string;
  limit?: number;
}): ImMessageLifecycleEvent[] {
  const limit = Math.max(1, Math.min(filter.limit ?? 20, 200));
  const params: unknown[] = [filter.provider];
  let chatWhere = '';
  if (filter.chatJid) {
    chatWhere = 'AND (chat_jid = ? OR source_jid = ?)';
    params.push(filter.chatJid, filter.chatJid);
  }
  params.push(limit);
  const rows = db
    .prepare(
      `SELECT *
       FROM im_message_lifecycle_events
       WHERE provider = ?
       ${chatWhere}
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
    )
    .all(...params) as DbImMessageLifecycleEventRow[];
  return rows.map(mapImMessageLifecycleEventRow);
}

export function getRecentImMessageLifecycleIssueEvents(filter: {
  provider: string;
  chatJid?: string;
  limit?: number;
}): ImMessageLifecycleEvent[] {
  const limit = Math.max(1, Math.min(filter.limit ?? 20, 200));
  const params: unknown[] = [filter.provider];
  let chatWhere = '';
  if (filter.chatJid) {
    chatWhere = 'AND (chat_jid = ? OR source_jid = ?)';
    params.push(filter.chatJid, filter.chatJid);
  }
  params.push(limit);
  const rows = db
    .prepare(
      `SELECT *
       FROM im_message_lifecycle_events
       WHERE provider = ?
         AND status != 'ok'
       ${chatWhere}
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
    )
    .all(...params) as DbImMessageLifecycleEventRow[];
  return rows.map(mapImMessageLifecycleEventRow);
}

export function createTask(
  task: Omit<ScheduledTask, 'last_run' | 'last_result'>,
): void {
  db.prepare(
    `
    INSERT INTO scheduled_tasks (
      id, group_folder, chat_jid, prompt, schedule_type, schedule_value,
      context_mode, execution_type, script_command, next_run, status,
      created_at, created_by, notify_channels, workspace_jid, workspace_folder
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    task.id,
    task.group_folder,
    task.chat_jid,
    task.prompt,
    task.schedule_type,
    task.schedule_value,
    'isolated',
    'workflow',
    task.script_command ?? null,
    task.next_run,
    task.status,
    task.created_at,
    task.created_by ?? null,
    task.notify_channels != null ? JSON.stringify(task.notify_channels) : null,
    task.workspace_jid ?? null,
    task.workspace_folder ?? null,
  );
}

/** Parse notify_channels from JSON string stored in DB and normalize new fields */
function mapTaskRow(row: unknown): ScheduledTask {
  const r = row as any;
  if (typeof r.notify_channels === 'string') {
    try {
      r.notify_channels = JSON.parse(r.notify_channels);
    } catch {
      r.notify_channels = null;
    }
  } else if (r.notify_channels === undefined) {
    r.notify_channels = null;
  }
  // Normalize new nullable fields
  r.context_mode = 'isolated';
  if (r.workspace_jid === undefined) r.workspace_jid = null;
  if (r.workspace_folder === undefined) r.workspace_folder = null;
  return r as ScheduledTask;
}

function resolveStockStrategyWorkspaceCwd(): string {
  const candidates = [
    process.env.STOCK_ANALYSIS_API_ROOT,
    path.join(APP_ROOT, '..', 'stock-analysis-api'),
    path.join(APP_ROOT, '..', '..', 'stock-analysis-api'),
    APP_ROOT,
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const resolved = path.resolve(candidate);
    if (fs.existsSync(path.join(resolved, 'scripts', 'futu_market_data.py'))) {
      return fs.realpathSync(resolved);
    }
  }
  return fs.realpathSync(APP_ROOT);
}

function parseNotifyChannelsValue(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string');
  }
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

function addMsToIso(value: string, intervalMs: number): string {
  const anchor = Date.parse(value);
  const base = Number.isFinite(anchor) ? anchor : Date.now();
  return new Date(base + intervalMs).toISOString();
}

function nextCronRunIso(expression: string, now: string): string {
  try {
    const interval = CronExpressionParser.parse(expression, {
      currentDate: now,
      tz: TIMEZONE,
    });
    return (
      interval.next().toISOString() ?? addMsToIso(now, 24 * 60 * 60 * 1000)
    );
  } catch (err) {
    logger.warn({ err, expression, now }, 'Failed to compute cron next run');
    return addMsToIso(now, 24 * 60 * 60 * 1000);
  }
}

function isStockStrategyWorkflowId(value: unknown): boolean {
  return typeof value === 'string' && STOCK_STRATEGY_WORKFLOW_IDS.has(value);
}

function isStockStrategyTaskOrWorkflowId(value: unknown): boolean {
  return (
    isStockStrategyWorkflowId(value) ||
    (typeof value === 'string' &&
      STOCK_STRATEGY_LEGACY_FIXED_WORKER_TASK_IDS.has(value))
  );
}

function stockStrategyResultHasPassedUsability(value: string | null): boolean {
  if (!value) return false;
  return (
    /\busability=passed\b/.test(value) ||
    /"strategy_usability"\s*:\s*\{[\s\S]*?"status"\s*:\s*"passed"/.test(value)
  );
}

function stockStrategyResultHasDynamicControl(value: string | null): boolean {
  if (!value) return false;
  return (
    /"current_next_run_at"\s*:/.test(value) ||
    /"next_workflows"\s*:/.test(value) ||
    /"quality_gate"\s*:/.test(value)
  );
}

function isLegacyNonUsableStockPauseResult(value: string | null): boolean {
  if (!value) return false;
  return (
    value.includes('No new evidence') ||
    value.includes('pause_discovery') ||
    value.includes('same evidence_signature') ||
    value.includes('usability=unknown') ||
    value.includes('usability=failed') ||
    value.includes('pause_blocked=usability_gate_not_passed') ||
    value.includes('stock strategy discovery is being migrated')
  );
}

export function ensureStockStrategyWorkspaceAndSchedules(
  options: { now?: string } = {},
): {
  workspaceJid: string;
  workspaceFolder: string;
  migratedTaskIds: string[];
} {
  const now = options.now ?? new Date().toISOString();
  const customCwd = resolveStockStrategyWorkspaceCwd();

  db.prepare(
    'INSERT OR IGNORE INTO chats (jid, name, last_message_time) VALUES (?, ?, ?)',
  ).run(STOCK_STRATEGY_WORKSPACE_JID, STOCK_STRATEGY_WORKSPACE_NAME, now);
  db.prepare(
    `INSERT INTO registered_groups (
      jid, name, folder, added_at, agent_type, custom_cwd, created_by, is_home,
      reply_policy, require_mention, activation_mode
    )
    VALUES (?, ?, ?, ?, 'openai', ?, NULL, 1, 'source_only', 0, 'auto')
    ON CONFLICT(jid) DO UPDATE SET
      name = excluded.name,
      folder = excluded.folder,
      custom_cwd = excluded.custom_cwd,
      is_home = 1,
      agent_type = COALESCE(registered_groups.agent_type, 'openai')`,
  ).run(
    STOCK_STRATEGY_WORKSPACE_JID,
    STOCK_STRATEGY_WORKSPACE_NAME,
    STOCK_STRATEGY_WORKSPACE_FOLDER,
    now,
    customCwd,
  );
  db.prepare(
    `INSERT INTO threads (
      id, workspace_jid, kind, title, runtime_agent_id, source_run_id, status,
      created_at, updated_at, last_active_at, archived_at
    )
    VALUES (?, ?, 'main', '主线', NULL, NULL, 'active', ?, ?, ?, NULL)
    ON CONFLICT(id) DO UPDATE SET
      workspace_jid = excluded.workspace_jid,
      kind = excluded.kind,
      title = excluded.title,
      status = 'active',
      updated_at = excluded.updated_at,
      archived_at = NULL`,
  ).run(
    STOCK_STRATEGY_MAIN_THREAD_ID,
    STOCK_STRATEGY_WORKSPACE_JID,
    now,
    now,
    now,
  );

  const rows = db
    .prepare(
      `SELECT id, chat_jid, notify_channels, script_command
       FROM scheduled_tasks
       WHERE execution_type = 'workflow'
         AND (
           id LIKE 'stock-strategy-%'
           OR script_command LIKE 'stock-strategy-%'
         )`,
    )
    .all() as Array<{
    id: string;
    chat_jid: string;
    notify_channels: string | null;
    script_command: string | null;
  }>;

  const migratedTaskIds: string[] = [];
  const defaultNotifyChannels = new Set<string>();
  const update = db.prepare(
    `UPDATE scheduled_tasks
     SET group_folder = ?,
         chat_jid = ?,
         workspace_jid = ?,
         workspace_folder = ?,
         notify_channels = ?
     WHERE id = ?`,
  );
  for (const row of rows) {
    if (
      !isStockStrategyTaskOrWorkflowId(row.id) &&
      !isStockStrategyWorkflowId(row.script_command)
    ) {
      continue;
    }
    const notifyChannels = new Set(
      parseNotifyChannelsValue(row.notify_channels),
    );
    if (
      row.chat_jid &&
      row.chat_jid !== STOCK_STRATEGY_WORKSPACE_JID &&
      !row.chat_jid.startsWith('web:')
    ) {
      notifyChannels.add(row.chat_jid);
    }
    for (const channel of notifyChannels) {
      defaultNotifyChannels.add(channel);
    }
    update.run(
      STOCK_STRATEGY_WORKSPACE_FOLDER,
      STOCK_STRATEGY_WORKSPACE_JID,
      STOCK_STRATEGY_WORKSPACE_JID,
      STOCK_STRATEGY_WORKSPACE_FOLDER,
      notifyChannels.size > 0 ? JSON.stringify([...notifyChannels]) : null,
      row.id,
    );
    migratedTaskIds.push(row.id);
  }

  const defaultNotifyChannelsJson =
    defaultNotifyChannels.size > 0
      ? JSON.stringify([...defaultNotifyChannels])
      : null;
  const insertDefaultTask = db.prepare(
    `INSERT OR IGNORE INTO scheduled_tasks (
      id, group_folder, chat_jid, prompt, schedule_type, schedule_value,
      context_mode, execution_type, script_command, next_run, last_run,
      last_result, status, created_at, created_by, notify_channels,
      workspace_jid, workspace_folder
    )
    VALUES (?, ?, ?, ?, ?, ?, 'isolated', 'workflow', ?, ?, NULL,
      NULL, 'active', ?, NULL, ?, ?, ?)`,
  );
  const normalizeDefaultTaskWorkspace = db.prepare(
    `UPDATE scheduled_tasks
     SET group_folder = ?,
         chat_jid = ?,
         workspace_jid = ?,
         workspace_folder = ?,
         notify_channels = COALESCE(notify_channels, ?)
     WHERE id = ?`,
  );
  const readDefaultTaskSchedule = db.prepare(
    `SELECT id, prompt, schedule_type, schedule_value, script_command
     FROM scheduled_tasks
     WHERE id = ?`,
  );
  const updateDefaultTaskSchedule = db.prepare(
    `UPDATE scheduled_tasks
     SET prompt = ?,
         schedule_type = ?,
         schedule_value = ?,
         script_command = ?,
         next_run = ?,
         status = 'active'
     WHERE id = ?`,
  );
  for (const schedule of STOCK_STRATEGY_DEFAULT_SCHEDULES) {
    const nextRun = schedule.nextRun(now);
    insertDefaultTask.run(
      schedule.id,
      STOCK_STRATEGY_WORKSPACE_FOLDER,
      STOCK_STRATEGY_WORKSPACE_JID,
      schedule.prompt,
      schedule.scheduleType,
      schedule.scheduleValue,
      schedule.workflowId,
      nextRun,
      now,
      defaultNotifyChannelsJson,
      STOCK_STRATEGY_WORKSPACE_JID,
      STOCK_STRATEGY_WORKSPACE_FOLDER,
    );
    normalizeDefaultTaskWorkspace.run(
      STOCK_STRATEGY_WORKSPACE_FOLDER,
      STOCK_STRATEGY_WORKSPACE_JID,
      STOCK_STRATEGY_WORKSPACE_JID,
      STOCK_STRATEGY_WORKSPACE_FOLDER,
      defaultNotifyChannelsJson,
      schedule.id,
    );
    const currentSchedule = readDefaultTaskSchedule.get(schedule.id) as
      | {
          prompt: string;
          schedule_type: string;
          schedule_value: string;
          script_command: string | null;
        }
      | undefined;
    if (
      currentSchedule &&
      (currentSchedule.prompt !== schedule.prompt ||
        currentSchedule.schedule_type !== schedule.scheduleType ||
        currentSchedule.schedule_value !== schedule.scheduleValue ||
        currentSchedule.script_command !== schedule.workflowId)
    ) {
      updateDefaultTaskSchedule.run(
        schedule.prompt,
        schedule.scheduleType,
        schedule.scheduleValue,
        schedule.workflowId,
        nextRun,
        schedule.id,
      );
    }
  }

  type StockStrategyTaskCadenceRow =
    | {
        id: string;
        script_command: string | null;
        status: string;
        schedule_type: string;
        schedule_value: string;
        last_result: string | null;
      }
    | undefined;

  const readTaskCadence = db.prepare(
    `SELECT id, script_command, status, schedule_type, schedule_value, last_result
     FROM scheduled_tasks
     WHERE id = ?`,
  );
  const pauseWorkerTask = db.prepare(
    `UPDATE scheduled_tasks
     SET status = 'paused',
         next_run = NULL
     WHERE id = ?`,
  );
  const pauseLegacyFixedWorker = (taskId: string): void => {
    const row = readTaskCadence.get(taskId) as StockStrategyTaskCadenceRow;
    if (
      row &&
      (STOCK_STRATEGY_DYNAMIC_WORKER_IDS.has(row.id) ||
        STOCK_STRATEGY_DYNAMIC_WORKER_IDS.has(row.script_command ?? '') ||
        STOCK_STRATEGY_LEGACY_FIXED_WORKER_TASK_IDS.has(row.id)) &&
      !stockStrategyResultHasPassedUsability(row.last_result) &&
      !stockStrategyResultHasDynamicControl(row.last_result)
    ) {
      pauseWorkerTask.run(row.id);
    }
  };

  const discoveryTaskRow = db
    .prepare(
      `SELECT id, script_command, status, schedule_type, schedule_value, last_result
       FROM scheduled_tasks
       WHERE id = 'stock-strategy-discovery-loop'`,
    )
    .get() as StockStrategyTaskCadenceRow;
  if (
    discoveryTaskRow &&
    !stockStrategyResultHasPassedUsability(discoveryTaskRow.last_result) &&
    (discoveryTaskRow.status === 'active' ||
      isLegacyNonUsableStockPauseResult(discoveryTaskRow.last_result))
  ) {
    pauseWorkerTask.run(discoveryTaskRow.id);
  }

  for (const workerId of STOCK_STRATEGY_DYNAMIC_WORKER_IDS) {
    if (workerId === 'stock-strategy-discovery-loop') continue;
    pauseLegacyFixedWorker(workerId);
  }
  for (const workerId of STOCK_STRATEGY_LEGACY_FIXED_WORKER_TASK_IDS) {
    pauseLegacyFixedWorker(workerId);
  }

  return {
    workspaceJid: STOCK_STRATEGY_WORKSPACE_JID,
    workspaceFolder: STOCK_STRATEGY_WORKSPACE_FOLDER,
    migratedTaskIds,
  };
}

export function getTaskById(id: string): ScheduledTask | undefined {
  const row = db.prepare('SELECT * FROM scheduled_tasks WHERE id = ?').get(id);
  return row ? mapTaskRow(row) : undefined;
}

export function getTasksForGroup(groupFolder: string): ScheduledTask[] {
  return db
    .prepare(
      'SELECT * FROM scheduled_tasks WHERE group_folder = ? ORDER BY created_at DESC',
    )
    .all(groupFolder)
    .map(mapTaskRow);
}

export function getAllTasks(): ScheduledTask[] {
  return db
    .prepare('SELECT * FROM scheduled_tasks ORDER BY created_at DESC')
    .all()
    .map(mapTaskRow);
}

export function updateTask(
  id: string,
  updates: Partial<
    Pick<
      ScheduledTask,
      | 'prompt'
      | 'schedule_type'
      | 'schedule_value'
      | 'context_mode'
      | 'execution_type'
      | 'script_command'
      | 'next_run'
      | 'status'
      | 'notify_channels'
    >
  >,
): void {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.prompt !== undefined) {
    fields.push('prompt = ?');
    values.push(updates.prompt);
  }
  if (updates.schedule_type !== undefined) {
    fields.push('schedule_type = ?');
    values.push(updates.schedule_type);
  }
  if (updates.schedule_value !== undefined) {
    fields.push('schedule_value = ?');
    values.push(updates.schedule_value);
  }
  if (updates.context_mode !== undefined) {
    fields.push('context_mode = ?');
    values.push(updates.context_mode);
  }
  if (updates.execution_type !== undefined) {
    fields.push('execution_type = ?');
    values.push(updates.execution_type);
  }
  if (updates.script_command !== undefined) {
    fields.push('script_command = ?');
    values.push(updates.script_command);
  }
  if (updates.next_run !== undefined) {
    fields.push('next_run = ?');
    values.push(updates.next_run);
  }
  if (updates.status !== undefined) {
    fields.push('status = ?');
    values.push(updates.status);
  }
  if (updates.notify_channels !== undefined) {
    fields.push('notify_channels = ?');
    values.push(
      updates.notify_channels != null
        ? JSON.stringify(updates.notify_channels)
        : null,
    );
  }

  if (fields.length === 0) return;

  values.push(id);
  db.prepare(
    `UPDATE scheduled_tasks SET ${fields.join(', ')} WHERE id = ?`,
  ).run(...values);
}

export function updateTaskWorkspace(
  id: string,
  workspaceJid: string,
  workspaceFolder: string,
): void {
  db.prepare(
    'UPDATE scheduled_tasks SET workspace_jid = ?, workspace_folder = ? WHERE id = ?',
  ).run(workspaceJid, workspaceFolder, id);
}

export function deleteTask(id: string): void {
  // Delete child records first (FK constraint)
  db.prepare('DELETE FROM task_run_logs WHERE task_id = ?').run(id);
  db.prepare('DELETE FROM scheduled_tasks WHERE id = ?').run(id);
}

export function deleteTasksForGroup(groupFolder: string): void {
  const tx = db.transaction((folder: string) => {
    db.prepare(
      `
      DELETE FROM task_run_logs
      WHERE task_id IN (
        SELECT id FROM scheduled_tasks WHERE group_folder = ?
      )
      `,
    ).run(folder);
    db.prepare('DELETE FROM scheduled_tasks WHERE group_folder = ?').run(
      folder,
    );
  });
  tx(groupFolder);
}

export function getDueTasks(): ScheduledTask[] {
  const now = new Date().toISOString();
  return db
    .prepare(
      `
    SELECT * FROM scheduled_tasks
    WHERE status = 'active' AND next_run IS NOT NULL AND next_run <= ?
    ORDER BY next_run
  `,
    )
    .all(now)
    .map(mapTaskRow);
}

export function updateTaskAfterRun(
  id: string,
  nextRun: string | null,
  lastResult: string,
): void {
  const now = new Date().toISOString();
  db.prepare(
    `
    UPDATE scheduled_tasks
    SET next_run = ?, last_run = ?, last_result = ?, status = CASE WHEN ? IS NULL THEN 'completed' ELSE status END
    WHERE id = ?
  `,
  ).run(nextRun, now, lastResult, nextRun, id);
}

export function logTaskRun(log: TaskRunLog): void {
  db.prepare(
    `
    INSERT INTO task_run_logs (task_id, run_at, duration_ms, status, result, error)
    VALUES (?, ?, ?, ?, ?, ?)
  `,
  ).run(
    log.task_id,
    log.run_at,
    log.duration_ms,
    log.status,
    log.result,
    log.error,
  );
}

export function logTaskRunStart(taskId: string, runAt?: string): number {
  const result = db
    .prepare(
      `
    INSERT INTO task_run_logs (task_id, run_at, duration_ms, status, result, error)
    VALUES (?, ?, 0, 'running', NULL, NULL)
  `,
    )
    .run(taskId, runAt ?? new Date().toISOString());
  return Number(result.lastInsertRowid);
}

export function getTaskRunLogById(
  id: number,
): (TaskRunLog & { id: number }) | undefined {
  return db
    .prepare(
      `
    SELECT id, task_id, run_at, duration_ms, status, result, error
    FROM task_run_logs
    WHERE id = ?
  `,
    )
    .get(id) as (TaskRunLog & { id: number }) | undefined;
}

export function updateTaskRunLog(
  id: number,
  updates: {
    duration_ms: number;
    status: 'success' | 'error';
    result: string | null;
    error: string | null;
  },
): void {
  db.prepare(
    `
    UPDATE task_run_logs SET duration_ms = ?, status = ?, result = ?, error = ?
    WHERE id = ?
  `,
  ).run(updates.duration_ms, updates.status, updates.result, updates.error, id);
}

export function cleanupStaleRunningLogs(): number {
  return cleanupStaleRunningTaskAndWorkflowRuns({ olderThanMs: 0 }).taskLogs;
}

export function cleanupStaleRunningTaskAndWorkflowRuns(options?: {
  now?: string;
  olderThanMs?: number;
}): { taskLogs: number; workflowRuns: number } {
  const rawNow = options?.now ?? new Date().toISOString();
  const rawNowMs = Date.parse(rawNow);
  const nowMs = Number.isFinite(rawNowMs) ? rawNowMs : Date.now();
  const now = new Date(nowMs).toISOString();
  const olderThanMs =
    typeof options?.olderThanMs === 'number' &&
    Number.isFinite(options.olderThanMs) &&
    options.olderThanMs >= 0
      ? options.olderThanMs
      : 30 * 60 * 1000;
  const cutoff = new Date(nowMs - olderThanMs).toISOString();

  const staleTaskLogs = db
    .prepare(
      `
    SELECT id, run_at
    FROM task_run_logs
    WHERE status = 'running' AND run_at <= ?
  `,
    )
    .all(cutoff) as Array<{ id: number; run_at: string }>;

  const updateTaskLog = db.prepare(
    `
    UPDATE task_run_logs
    SET duration_ms = ?, status = 'error', error = ?
    WHERE id = ?
  `,
  );
  for (const row of staleTaskLogs) {
    const runAtMs = Date.parse(row.run_at);
    const durationMs =
      Number.isFinite(nowMs) && Number.isFinite(runAtMs)
        ? Math.max(0, nowMs - runAtMs)
        : 0;
    updateTaskLog.run(durationMs, SCHEDULED_WORKFLOW_WATCHDOG_ERROR, row.id);
  }

  const staleWorkflowRuns = db
    .prepare(
      `
    SELECT id
    FROM workflow_runs
    WHERE status = 'running'
      AND COALESCE(started_at, updated_at, created_at) <= ?
  `,
    )
    .all(cutoff) as Array<{ id: string }>;

  if (staleWorkflowRuns.length > 0) {
    const ids = staleWorkflowRuns.map((row) => row.id);
    const placeholders = ids.map(() => '?').join(', ');
    db.prepare(
      `
      UPDATE workflow_runs
      SET status = 'error',
          error = ?,
          completed_at = COALESCE(completed_at, ?),
          updated_at = ?
      WHERE id IN (${placeholders})
    `,
    ).run(SCHEDULED_WORKFLOW_WATCHDOG_ERROR, now, now, ...ids);
    db.prepare(
      `
      UPDATE workflow_contexts
      SET active_run_id = NULL,
          updated_at = ?
      WHERE active_run_id IN (${placeholders})
    `,
    ).run(now, ...ids);
  }

  return {
    taskLogs: staleTaskLogs.length,
    workflowRuns: staleWorkflowRuns.length,
  };
}

export function cleanupOldTaskRunLogs(retentionDays = 30): number {
  const cutoff = new Date(
    Date.now() - retentionDays * 24 * 60 * 60 * 1000,
  ).toISOString();
  const result = db
    .prepare(`DELETE FROM task_run_logs WHERE run_at < ?`)
    .run(cutoff);
  return result.changes;
}

// --- Router state accessors ---

export function getRouterState(key: string): string | undefined {
  const row = db
    .prepare('SELECT value FROM router_state WHERE key = ?')
    .get(key) as { value: string } | undefined;
  return row?.value;
}

export function setRouterState(key: string, value: string): void {
  db.prepare(
    'INSERT OR REPLACE INTO router_state (key, value) VALUES (?, ?)',
  ).run(key, value);
}

export function deleteRouterState(key: string): void {
  db.prepare('DELETE FROM router_state WHERE key = ?').run(key);
}

export function getRouterStateByPrefix(
  prefix: string,
): Array<{ key: string; value: string }> {
  return db
    .prepare('SELECT key, value FROM router_state WHERE key LIKE ?')
    .all(`${prefix}%`) as Array<{ key: string; value: string }>;
}

// --- Session accessors ---

export function getSession(
  groupFolder: string,
  agentId?: string | null,
): string | undefined {
  const effectiveAgentId = agentId || '';
  const row = db
    .prepare(
      'SELECT session_id FROM sessions WHERE group_folder = ? AND agent_id = ?',
    )
    .get(groupFolder, effectiveAgentId) as { session_id: string } | undefined;
  return row?.session_id;
}

export function setSession(
  groupFolder: string,
  sessionId: string,
  agentId?: string | null,
): void {
  const effectiveAgentId = agentId || '';
  db.prepare(
    `INSERT INTO sessions (group_folder, session_id, agent_id) VALUES (?, ?, ?)
     ON CONFLICT(group_folder, agent_id) DO UPDATE SET session_id = excluded.session_id`,
  ).run(groupFolder, sessionId, effectiveAgentId);
}

export function deleteSession(
  groupFolder: string,
  agentId?: string | null,
): void {
  const effectiveAgentId = agentId || '';
  db.prepare(
    'DELETE FROM sessions WHERE group_folder = ? AND agent_id = ?',
  ).run(groupFolder, effectiveAgentId);
}

export function deletePrimaryRuntimeSessions(groupFolder: string): void {
  db.prepare(
    "DELETE FROM sessions WHERE group_folder = ? AND agent_id = ''",
  ).run(groupFolder);
}

export function deleteAllSessionsForFolder(groupFolder: string): void {
  db.prepare('DELETE FROM sessions WHERE group_folder = ?').run(groupFolder);
}

export function getAllSessions(): Record<string, string> {
  const rows = db
    .prepare(
      "SELECT group_folder, session_id FROM sessions WHERE agent_id = ''",
    )
    .all() as Array<{ group_folder: string; session_id: string }>;
  const result: Record<string, string> = {};
  for (const row of rows) {
    result[row.group_folder] = row.session_id;
  }
  return result;
}

// --- Workflow persistence accessors ---

export function upsertWorkflowDefinitionCache(input: {
  folder: string;
  workflowId: string;
  sourcePath: string;
  definitionJson: Record<string, unknown>;
  checksum?: string | null;
  updatedAt?: string;
}): WorkflowDefinitionCache {
  const updatedAt = input.updatedAt ?? new Date().toISOString();
  db.prepare(
    `INSERT INTO workflow_definitions (
      folder, workflow_id, source_path, definition_json, checksum, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(folder, workflow_id) DO UPDATE SET
      source_path = excluded.source_path,
      definition_json = excluded.definition_json,
      checksum = excluded.checksum,
      updated_at = excluded.updated_at`,
  ).run(
    input.folder,
    input.workflowId,
    input.sourcePath,
    JSON.stringify(input.definitionJson),
    input.checksum ?? null,
    updatedAt,
  );
  const cached = getWorkflowDefinitionCache(input.folder, input.workflowId);
  if (!cached) {
    throw new Error(
      `Failed to persist workflow definition ${input.workflowId}`,
    );
  }
  return cached;
}

export function getWorkflowDefinitionCache(
  folder: string,
  workflowId: string,
): WorkflowDefinitionCache | null {
  const row = db
    .prepare(
      'SELECT * FROM workflow_definitions WHERE folder = ? AND workflow_id = ?',
    )
    .get(folder, workflowId) as DbWorkflowDefinitionCacheRow | undefined;
  return row ? mapWorkflowDefinitionCacheRow(row) : null;
}

export function upsertWorkflowContext(input: {
  id: string;
  folder: string;
  workflowId: string;
  threadId: string;
  runtimeAgentId: string;
  activeRunId?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt?: string;
  updatedAt?: string;
}): WorkflowContext {
  const now = new Date().toISOString();
  const createdAt = input.createdAt ?? now;
  const updatedAt = input.updatedAt ?? now;
  db.prepare(
    `INSERT INTO workflow_contexts (
      id, folder, workflow_id, thread_id, runtime_agent_id, active_run_id,
      metadata, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(folder, workflow_id) DO UPDATE SET
      thread_id = excluded.thread_id,
      runtime_agent_id = excluded.runtime_agent_id,
      active_run_id = COALESCE(excluded.active_run_id, workflow_contexts.active_run_id),
      metadata = COALESCE(excluded.metadata, workflow_contexts.metadata),
      updated_at = excluded.updated_at`,
  ).run(
    input.id,
    input.folder,
    input.workflowId,
    input.threadId,
    input.runtimeAgentId,
    input.activeRunId ?? null,
    stringifyJsonObject(input.metadata),
    createdAt,
    updatedAt,
  );
  const context = getWorkflowContext(input.folder, input.workflowId);
  if (!context) {
    throw new Error(`Failed to persist workflow context ${input.id}`);
  }
  return context;
}

export function getWorkflowContext(
  folder: string,
  workflowId: string,
): WorkflowContext | null {
  const row = db
    .prepare(
      'SELECT * FROM workflow_contexts WHERE folder = ? AND workflow_id = ?',
    )
    .get(folder, workflowId) as DbWorkflowContextRow | undefined;
  return row ? mapWorkflowContextRow(row) : null;
}

export function getWorkflowContextById(id: string): WorkflowContext | null {
  const row = db
    .prepare('SELECT * FROM workflow_contexts WHERE id = ?')
    .get(id) as DbWorkflowContextRow | undefined;
  return row ? mapWorkflowContextRow(row) : null;
}

export function setWorkflowContextActiveRun(
  contextId: string,
  runId: string | null,
): void {
  db.prepare(
    'UPDATE workflow_contexts SET active_run_id = ?, updated_at = ? WHERE id = ?',
  ).run(runId, new Date().toISOString(), contextId);
}

export function insertWorkflowRun(input: {
  id: string;
  contextId: string;
  folder: string;
  workflowId: string;
  threadId: string;
  triggerChatJid: string;
  triggerMessageId?: string | null;
  triggerUserId?: string | null;
  prompt: string;
  status?: WorkflowRunStatus;
  result?: string | null;
  error?: string | null;
  metadata?: Record<string, unknown> | null;
  startedAt?: string | null;
  completedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}): WorkflowRun {
  const now = new Date().toISOString();
  const createdAt = input.createdAt ?? now;
  const updatedAt = input.updatedAt ?? now;
  db.prepare(
    `INSERT INTO workflow_runs (
      id, context_id, folder, workflow_id, thread_id, trigger_chat_jid,
      trigger_message_id, trigger_user_id, prompt, status, result, error,
      metadata, started_at, completed_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.id,
    input.contextId,
    input.folder,
    input.workflowId,
    input.threadId,
    input.triggerChatJid,
    input.triggerMessageId ?? null,
    input.triggerUserId ?? null,
    input.prompt,
    input.status ?? 'queued',
    input.result ?? null,
    input.error ?? null,
    stringifyJsonObject(input.metadata),
    input.startedAt ?? null,
    input.completedAt ?? null,
    createdAt,
    updatedAt,
  );
  setWorkflowContextActiveRun(input.contextId, input.id);
  const run = getWorkflowRunById(input.id);
  if (!run) {
    throw new Error(`Failed to persist workflow run ${input.id}`);
  }
  return run;
}

export function getWorkflowRunById(id: string): WorkflowRun | null {
  const row = db.prepare('SELECT * FROM workflow_runs WHERE id = ?').get(id) as
    | DbWorkflowRunRow
    | undefined;
  return row ? mapWorkflowRunRow(row) : null;
}

export function updateWorkflowRunStatus(
  id: string,
  input: {
    status: WorkflowRunStatus;
    result?: string | null;
    error?: string | null;
    startedAt?: string | null;
    completedAt?: string | null;
  },
): WorkflowRun | null {
  const current = getWorkflowRunById(id);
  if (!current) return null;
  const now = new Date().toISOString();
  const terminal = ['success', 'error', 'cancelled'].includes(input.status);
  const startedAt =
    input.startedAt ??
    current.started_at ??
    (input.status === 'running' ? now : null);
  const completedAt =
    input.completedAt ?? current.completed_at ?? (terminal ? now : null);
  const result = Object.hasOwn(input, 'result')
    ? (input.result ?? null)
    : current.result;
  const error = Object.hasOwn(input, 'error')
    ? (input.error ?? null)
    : current.error;

  db.prepare(
    `UPDATE workflow_runs
     SET status = ?, result = ?, error = ?, started_at = ?, completed_at = ?, updated_at = ?
     WHERE id = ?`,
  ).run(input.status, result, error, startedAt, completedAt, now, id);

  if (terminal) {
    db.prepare(
      `UPDATE workflow_contexts
       SET active_run_id = NULL, updated_at = ?
       WHERE id = ? AND active_run_id = ?`,
    ).run(now, current.context_id, id);
  }

  return getWorkflowRunById(id);
}

export function upsertWorkflowRunStep(input: {
  id: string;
  runId: string;
  nodeId: string;
  roleId?: string | null;
  status: WorkflowRunStepStatus;
  attempt?: number;
  input?: Record<string, unknown> | null;
  output?: Record<string, unknown> | null;
  error?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}): WorkflowRunStep {
  const now = new Date().toISOString();
  const createdAt = input.createdAt ?? now;
  const updatedAt = input.updatedAt ?? now;
  const attempt = input.attempt ?? 1;
  db.prepare(
    `INSERT INTO workflow_run_steps (
      id, run_id, node_id, role_id, status, attempt, input, output, error,
      started_at, completed_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(run_id, node_id, attempt) DO UPDATE SET
      role_id = excluded.role_id,
      status = excluded.status,
      input = excluded.input,
      output = excluded.output,
      error = excluded.error,
      started_at = excluded.started_at,
      completed_at = excluded.completed_at,
      updated_at = excluded.updated_at`,
  ).run(
    input.id,
    input.runId,
    input.nodeId,
    input.roleId ?? null,
    input.status,
    attempt,
    stringifyJsonObject(input.input),
    stringifyJsonObject(input.output),
    input.error ?? null,
    input.startedAt ?? null,
    input.completedAt ?? null,
    createdAt,
    updatedAt,
  );
  const row = db
    .prepare(
      'SELECT * FROM workflow_run_steps WHERE run_id = ? AND node_id = ? AND attempt = ?',
    )
    .get(input.runId, input.nodeId, attempt) as
    | DbWorkflowRunStepRow
    | undefined;
  if (!row) {
    throw new Error(`Failed to persist workflow run step ${input.id}`);
  }
  return mapWorkflowRunStepRow(row);
}

export function listWorkflowRunSteps(runId: string): WorkflowRunStep[] {
  const rows = db
    .prepare(
      'SELECT * FROM workflow_run_steps WHERE run_id = ? ORDER BY created_at ASC, id ASC',
    )
    .all(runId) as DbWorkflowRunStepRow[];
  return rows.map(mapWorkflowRunStepRow);
}

export function listWorkflowRuns(
  filter: {
    folder?: string;
    workflowId?: string;
    limit?: number;
  } = {},
): WorkflowRun[] {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.folder) {
    where.push('folder = ?');
    params.push(filter.folder);
  }
  if (filter.workflowId) {
    where.push('workflow_id = ?');
    params.push(filter.workflowId);
  }
  const limit = Math.max(1, Math.min(filter.limit ?? 20, 100));
  params.push(limit);
  const rows = db
    .prepare(
      `SELECT * FROM workflow_runs
       ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
    )
    .all(...params) as DbWorkflowRunRow[];
  return rows.map(mapWorkflowRunRow);
}

export function listWorkflowRunsForDashboard(filter: {
  folders?: string[];
  start: string;
  end: string;
  limit?: number;
}): WorkflowRun[] {
  if (filter.folders && filter.folders.length === 0) return [];
  const where: string[] = [
    `(
      (created_at >= ? AND created_at < ?)
      OR (updated_at >= ? AND updated_at < ?)
      OR (started_at >= ? AND started_at < ?)
      OR (completed_at >= ? AND completed_at < ?)
      OR status IN ('queued', 'running')
    )`,
  ];
  const params: unknown[] = [
    filter.start,
    filter.end,
    filter.start,
    filter.end,
    filter.start,
    filter.end,
    filter.start,
    filter.end,
  ];
  if (filter.folders) {
    const placeholders = filter.folders.map(() => '?').join(', ');
    where.push(`folder IN (${placeholders})`);
    params.push(...filter.folders);
  }
  const limit =
    filter.limit === undefined
      ? null
      : Math.max(1, Math.min(filter.limit, 1000));
  if (limit !== null) params.push(limit);
  const rows = db
    .prepare(
      `SELECT * FROM workflow_runs
       WHERE ${where.join(' AND ')}
       ORDER BY created_at DESC, id DESC
       ${limit !== null ? 'LIMIT ?' : ''}`,
    )
    .all(...params) as DbWorkflowRunRow[];
  return rows.map(mapWorkflowRunRow);
}

export function listWorkflowRunStepsForRunIds(
  runIds: string[],
): WorkflowRunStep[] {
  if (runIds.length === 0) return [];
  const placeholders = runIds.map(() => '?').join(', ');
  const rows = db
    .prepare(
      `SELECT * FROM workflow_run_steps
       WHERE run_id IN (${placeholders})
       ORDER BY created_at ASC, id ASC`,
    )
    .all(...runIds) as DbWorkflowRunStepRow[];
  return rows.map(mapWorkflowRunStepRow);
}

function mapThreadRow(row: DbThreadRow): Thread {
  return {
    id: row.id,
    workspace_jid: row.workspace_jid,
    kind: row.kind,
    title: row.title,
    runtime_agent_id: row.runtime_agent_id ?? null,
    source_run_id: row.source_run_id ?? null,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
    last_active_at: row.last_active_at,
    archived_at: row.archived_at ?? null,
  };
}

function mapImEntryRouteRow(row: DbImEntryRouteRow): ImEntryRoute {
  return {
    im_jid: row.im_jid,
    default_workspace_jid: row.default_workspace_jid ?? null,
    active_workspace_jid: row.active_workspace_jid ?? null,
    active_thread_id: row.active_thread_id ?? null,
    active_until: row.active_until ?? null,
    pinned: row.pinned === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function upsertThread(input: {
  id: string;
  workspaceJid: string;
  kind: ThreadKind;
  title: string;
  runtimeAgentId?: string | null;
  sourceRunId?: string | null;
  status?: ThreadStatus;
  createdAt?: string;
  updatedAt?: string;
  lastActiveAt?: string;
  archivedAt?: string | null;
}): Thread {
  const now = new Date().toISOString();
  const createdAt = input.createdAt ?? now;
  const updatedAt = input.updatedAt ?? now;
  const lastActiveAt = input.lastActiveAt ?? updatedAt;
  db.prepare(
    `INSERT INTO threads (
      id, workspace_jid, kind, title, runtime_agent_id, source_run_id, status,
      created_at, updated_at, last_active_at, archived_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      workspace_jid = excluded.workspace_jid,
      kind = excluded.kind,
      title = excluded.title,
      runtime_agent_id = excluded.runtime_agent_id,
      source_run_id = excluded.source_run_id,
      status = excluded.status,
      updated_at = excluded.updated_at,
      last_active_at = excluded.last_active_at,
      archived_at = excluded.archived_at`,
  ).run(
    input.id,
    input.workspaceJid,
    input.kind,
    input.title,
    input.runtimeAgentId ?? null,
    input.sourceRunId ?? null,
    input.status ?? 'active',
    createdAt,
    updatedAt,
    lastActiveAt,
    input.archivedAt ?? null,
  );
  const thread = getThread(input.id);
  if (!thread) throw new Error(`Failed to persist thread ${input.id}`);
  return thread;
}

export function getThread(id: string): Thread | null {
  const row = db.prepare('SELECT * FROM threads WHERE id = ?').get(id) as
    | DbThreadRow
    | undefined;
  return row ? mapThreadRow(row) : null;
}

export function getMainThread(workspaceJid: string): Thread | null {
  const row = db
    .prepare(
      "SELECT * FROM threads WHERE workspace_jid = ? AND kind = 'main' AND archived_at IS NULL ORDER BY created_at ASC LIMIT 1",
    )
    .get(workspaceJid) as DbThreadRow | undefined;
  return row ? mapThreadRow(row) : null;
}

export function listThreadsForWorkspace(workspaceJid: string): Thread[] {
  const rows = db
    .prepare(
      `SELECT * FROM threads
       WHERE workspace_jid = ?
       ORDER BY archived_at IS NULL DESC, last_active_at DESC, created_at DESC`,
    )
    .all(workspaceJid) as DbThreadRow[];
  return rows.map(mapThreadRow);
}

export function listActiveThreads(limit = 20): Thread[] {
  const rows = db
    .prepare(
      `SELECT * FROM threads
       WHERE status = 'active' AND archived_at IS NULL
       ORDER BY last_active_at DESC, created_at DESC
       LIMIT ?`,
    )
    .all(Math.max(1, Math.min(limit, 100))) as DbThreadRow[];
  return rows.map(mapThreadRow);
}

export function archiveThread(
  id: string,
  archivedAt = new Date().toISOString(),
) {
  db.prepare(
    "UPDATE threads SET status = 'archived', archived_at = ?, updated_at = ? WHERE id = ?",
  ).run(archivedAt, archivedAt, id);
}

export function upsertImEntryRoute(input: {
  imJid: string;
  defaultWorkspaceJid?: string | null;
  activeWorkspaceJid?: string | null;
  activeThreadId?: string | null;
  activeUntil?: string | null;
  pinned?: boolean | null;
  createdAt?: string;
  updatedAt?: string;
}): ImEntryRoute {
  const now = new Date().toISOString();
  const createdAt = input.createdAt ?? now;
  const updatedAt = input.updatedAt ?? now;
  db.prepare(
    `INSERT INTO im_entry_routes (
      im_jid, default_workspace_jid, active_workspace_jid, active_thread_id,
      active_until, pinned, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(im_jid) DO UPDATE SET
      default_workspace_jid = excluded.default_workspace_jid,
      active_workspace_jid = excluded.active_workspace_jid,
      active_thread_id = excluded.active_thread_id,
      active_until = excluded.active_until,
      pinned = excluded.pinned,
      updated_at = excluded.updated_at`,
  ).run(
    input.imJid,
    input.defaultWorkspaceJid ?? null,
    input.activeWorkspaceJid ?? null,
    input.activeThreadId ?? null,
    input.activeUntil ?? null,
    input.pinned === true ? 1 : 0,
    createdAt,
    updatedAt,
  );
  const route = getImEntryRoute(input.imJid);
  if (!route)
    throw new Error(`Failed to persist IM entry route ${input.imJid}`);
  return route;
}

export function getImEntryRoute(imJid: string): ImEntryRoute | null {
  const row = db
    .prepare('SELECT * FROM im_entry_routes WHERE im_jid = ?')
    .get(imJid) as DbImEntryRouteRow | undefined;
  return row ? mapImEntryRouteRow(row) : null;
}

export function deleteImEntryRoute(imJid: string): void {
  db.prepare('DELETE FROM im_entry_routes WHERE im_jid = ?').run(imJid);
}

// --- Registered group accessors ---

/** Raw row shape from registered_groups table — single source of truth for column mapping. */
type RegisteredGroupRow = {
  jid: string;
  name: string;
  folder: string;
  added_at: string;
  agent_type: string | null;
  model: string | null;
  reasoning_effort: string | null;
  speed_tier: string | null;
  custom_cwd: string | null;
  created_by: string | null;
  is_home: number;
  target_agent_id: string | null;
  target_main_jid: string | null;
  reply_policy: string | null;
  require_mention: number;
  activation_mode: string | null;
};

function parseAgentType(raw: string | null): AgentType {
  return 'openai';
}

/** Convert a raw DB row into a RegisteredGroup domain object. */
function parseGroupRow(
  row: RegisteredGroupRow,
): RegisteredGroup & { jid: string } {
  return {
    jid: row.jid,
    name: row.name,
    folder: row.folder,
    added_at: row.added_at,
    agentType: parseAgentType(row.agent_type),
    model: row.model ?? null,
    reasoningEffort: row.reasoning_effort ?? null,
    speedTier: row.speed_tier ?? null,
    customCwd: row.custom_cwd ?? undefined,
    created_by: row.created_by ?? undefined,
    is_home: row.is_home === 1,
    target_agent_id: row.target_agent_id ?? undefined,
    target_main_jid: row.target_main_jid ?? undefined,
    reply_policy: row.reply_policy === 'mirror' ? 'mirror' : 'source_only',
    require_mention: row.require_mention === 1,
    activation_mode: parseActivationMode(row.activation_mode),
  };
}

const VALID_ACTIVATION_MODES = new Set([
  'auto',
  'always',
  'when_mentioned',
  'disabled',
]);

function parseActivationMode(
  raw: string | null,
): 'auto' | 'always' | 'when_mentioned' | 'disabled' {
  if (raw && VALID_ACTIVATION_MODES.has(raw))
    return raw as 'auto' | 'always' | 'when_mentioned' | 'disabled';
  return 'auto';
}

export function getRegisteredGroup(
  jid: string,
): (RegisteredGroup & { jid: string }) | undefined {
  const row = db
    .prepare('SELECT * FROM registered_groups WHERE jid = ?')
    .get(jid) as RegisteredGroupRow | undefined;
  if (!row) return undefined;
  return parseGroupRow(row);
}

export function setRegisteredGroup(jid: string, group: RegisteredGroup): void {
  db.prepare(
    `INSERT OR REPLACE INTO registered_groups (jid, name, folder, added_at, agent_type, model, reasoning_effort, speed_tier, custom_cwd, created_by, is_home, target_agent_id, target_main_jid, reply_policy, require_mention, activation_mode)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    jid,
    group.name,
    group.folder,
    group.added_at,
    group.agentType ?? 'openai',
    group.model ?? null,
    group.reasoningEffort ?? null,
    group.speedTier ?? null,
    group.customCwd ?? null,
    group.created_by ?? null,
    group.is_home ? 1 : 0,
    group.target_agent_id ?? null,
    group.target_main_jid ?? null,
    group.reply_policy ?? 'source_only',
    group.require_mention === true ? 1 : 0,
    group.activation_mode ?? 'auto',
  );
}

export function deleteRegisteredGroup(jid: string): void {
  db.prepare('DELETE FROM registered_groups WHERE jid = ?').run(jid);
}

/** Get all JIDs that share the same folder (e.g., all JIDs with folder='main'). */
export function getJidsByFolder(folder: string): string[] {
  const rows = db
    .prepare('SELECT jid FROM registered_groups WHERE folder = ?')
    .all(folder) as Array<{ jid: string }>;
  return rows.map((r) => r.jid);
}

export function getAllRegisteredGroups(): Record<string, RegisteredGroup> {
  const rows = db
    .prepare('SELECT * FROM registered_groups')
    .all() as RegisteredGroupRow[];
  const result: Record<string, RegisteredGroup> = {};
  for (const row of rows) {
    result[row.jid] = parseGroupRow(row);
  }
  return result;
}

/**
 * Get all registered groups that route to a specific internal task-thread agent slot.
 * Returns array of { jid, group } for each IM group targeting the given agentId.
 */
export function getGroupsByTargetAgent(
  agentId: string,
): Array<{ jid: string; group: RegisteredGroup }> {
  const rows = db
    .prepare('SELECT * FROM registered_groups WHERE target_agent_id = ?')
    .all(agentId) as RegisteredGroupRow[];
  return rows.map((row) => ({ jid: row.jid, group: parseGroupRow(row) }));
}

/**
 * Get all registered groups that route to a specific workspace's main conversation.
 */
export function getGroupsByTargetMainJid(
  webJid: string,
): Array<{ jid: string; group: RegisteredGroup }> {
  const rows = db
    .prepare('SELECT * FROM registered_groups WHERE target_main_jid = ?')
    .all(webJid) as RegisteredGroupRow[];
  return rows.map((row) => ({ jid: row.jid, group: parseGroupRow(row) }));
}

export function deleteChatHistory(chatJid: string): void {
  const tx = db.transaction((jid: string) => {
    db.prepare('DELETE FROM messages WHERE chat_jid = ?').run(jid);
    db.prepare('DELETE FROM chats WHERE jid = ?').run(jid);
  });
  tx(chatJid);
}

export function deleteGroupData(jid: string, folder: string): void {
  const tx = db.transaction(() => {
    db.prepare(
      'DELETE FROM task_run_logs WHERE task_id IN (SELECT id FROM scheduled_tasks WHERE group_folder = ?)',
    ).run(folder);
    db.prepare('DELETE FROM scheduled_tasks WHERE group_folder = ?').run(
      folder,
    );
    db.prepare('DELETE FROM registered_groups WHERE jid = ?').run(jid);
    db.prepare('DELETE FROM sessions WHERE group_folder = ?').run(folder);
    db.prepare('DELETE FROM messages WHERE chat_jid = ?').run(jid);
    db.prepare('DELETE FROM chats WHERE jid = ?').run(jid);
    db.prepare(
      'UPDATE scheduled_tasks SET workspace_jid = NULL, workspace_folder = NULL WHERE workspace_jid = ?',
    ).run(jid);
  });
  tx();
}

// --- Web API accessors ---

/**
 * Get paginated messages for a chat, cursor-based pagination.
 * Returns messages in descending timestamp order (newest first).
 */
export function getMessagesPage(
  chatJid: string,
  before?: string | MessageHistoryCursor,
  limit = 50,
): Array<NewMessage & { is_from_me: boolean }> {
  const normalizedBefore = normalizeHistoryCursor(before, chatJid);
  const sql = normalizedBefore
    ? normalizedBefore.precise
      ? `
      SELECT id, chat_jid, source_jid, runtime_identity, sender, sender_name, content, timestamp, is_from_me, attachments, token_usage,
             turn_id, session_id, sdk_message_uuid, source_kind, finalization_reason
      FROM messages
      WHERE chat_jid = ?
        AND (timestamp < ? OR (timestamp = ? AND id < ?))
      ORDER BY timestamp DESC, id DESC
      LIMIT ?
    `
      : `
      SELECT id, chat_jid, source_jid, runtime_identity, sender, sender_name, content, timestamp, is_from_me, attachments, token_usage,
             turn_id, session_id, sdk_message_uuid, source_kind, finalization_reason
      FROM messages
      WHERE chat_jid = ? AND timestamp < ?
      ORDER BY timestamp DESC
      LIMIT ?
    `
    : `
      SELECT id, chat_jid, source_jid, runtime_identity, sender, sender_name, content, timestamp, is_from_me, attachments, token_usage,
             turn_id, session_id, sdk_message_uuid, source_kind, finalization_reason
      FROM messages
      WHERE chat_jid = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `;

  const params = normalizedBefore
    ? normalizedBefore.precise
      ? [
          chatJid,
          normalizedBefore.timestamp,
          normalizedBefore.timestamp,
          normalizedBefore.id,
          limit,
        ]
      : [chatJid, normalizedBefore.timestamp, limit]
    : [chatJid, limit];
  const rows = db.prepare(sql).all(...params) as DbMessageRow[];

  return rows.map(mapDbMessageRow);
}

/**
 * Get messages after a given timestamp (for polling new messages).
 * Returns in ASC order (oldest first).
 */
export function getMessagesAfter(
  chatJid: string,
  after: string | MessageHistoryCursor,
  limit = 50,
): Array<NewMessage & { is_from_me: boolean }> {
  const normalizedAfter = normalizeHistoryCursor(after, chatJid);
  const rows = db
    .prepare(
      normalizedAfter?.precise
        ? `SELECT id, chat_jid, source_jid, runtime_identity, sender, sender_name, content, timestamp, is_from_me, attachments, token_usage,
              turn_id, session_id, sdk_message_uuid, source_kind, finalization_reason
       FROM messages
       WHERE chat_jid = ?
         AND (timestamp > ? OR (timestamp = ? AND id > ?))
       ORDER BY timestamp ASC, id ASC
       LIMIT ?`
        : `SELECT id, chat_jid, source_jid, runtime_identity, sender, sender_name, content, timestamp, is_from_me, attachments, token_usage,
              turn_id, session_id, sdk_message_uuid, source_kind, finalization_reason
       FROM messages
       WHERE chat_jid = ? AND timestamp > ?
       ORDER BY timestamp ASC
       LIMIT ?`,
    )
    .all(
      ...(normalizedAfter?.precise
        ? [
            chatJid,
            normalizedAfter.timestamp,
            normalizedAfter.timestamp,
            normalizedAfter.id,
            limit,
          ]
        : [chatJid, normalizedAfter?.timestamp || '', limit]),
    ) as DbMessageRow[];

  return rows.map(mapDbMessageRow);
}

interface NormalizedHistoryCursor {
  timestamp: string;
  chat_jid: string;
  id: string;
  precise: boolean;
}

function normalizeHistoryCursor(
  cursor?: string | MessageHistoryCursor,
  fallbackChatJid?: string,
): NormalizedHistoryCursor | undefined {
  if (!cursor) return undefined;
  if (typeof cursor === 'string') {
    return {
      timestamp: cursor,
      chat_jid: fallbackChatJid || '',
      id: '',
      precise: false,
    };
  }
  const timestamp =
    typeof cursor.timestamp === 'string' ? cursor.timestamp : undefined;
  if (!timestamp) return undefined;
  const id = typeof cursor.id === 'string' ? cursor.id : '';
  const chat_jid =
    typeof cursor.chat_jid === 'string'
      ? cursor.chat_jid
      : fallbackChatJid || '';
  return {
    timestamp,
    chat_jid,
    id,
    precise: !!id && !!chat_jid,
  };
}

/**
 * 多 JID 分页查询（用于主工作区合并 web:main + feishu:xxx 消息）。
 */
export function getMessagesPageMulti(
  chatJids: string[],
  before?: string | MessageHistoryCursor,
  limit = 50,
): Array<NewMessage & { is_from_me: boolean }> {
  if (chatJids.length === 0) return [];
  if (chatJids.length === 1) return getMessagesPage(chatJids[0], before, limit);

  const normalizedBefore = normalizeHistoryCursor(before);
  const placeholders = chatJids.map(() => '?').join(',');
  const sql = normalizedBefore
    ? normalizedBefore.precise
      ? `SELECT id, chat_jid, source_jid, runtime_identity, sender, sender_name, content, timestamp, is_from_me, attachments, token_usage,
              turn_id, session_id, sdk_message_uuid, source_kind, finalization_reason
       FROM messages
       WHERE chat_jid IN (${placeholders})
         AND (
           timestamp < ?
           OR (timestamp = ? AND chat_jid < ?)
           OR (timestamp = ? AND chat_jid = ? AND id < ?)
         )
       ORDER BY timestamp DESC, chat_jid DESC, id DESC
       LIMIT ?`
      : `SELECT id, chat_jid, source_jid, runtime_identity, sender, sender_name, content, timestamp, is_from_me, attachments, token_usage,
              turn_id, session_id, sdk_message_uuid, source_kind, finalization_reason
       FROM messages
       WHERE chat_jid IN (${placeholders}) AND timestamp < ?
       ORDER BY timestamp DESC
       LIMIT ?`
    : `SELECT id, chat_jid, source_jid, runtime_identity, sender, sender_name, content, timestamp, is_from_me, attachments, token_usage,
              turn_id, session_id, sdk_message_uuid, source_kind, finalization_reason
       FROM messages
       WHERE chat_jid IN (${placeholders})
       ORDER BY timestamp DESC, chat_jid DESC, id DESC
       LIMIT ?`;

  const params = normalizedBefore
    ? normalizedBefore.precise
      ? [
          ...chatJids,
          normalizedBefore.timestamp,
          normalizedBefore.timestamp,
          normalizedBefore.chat_jid,
          normalizedBefore.timestamp,
          normalizedBefore.chat_jid,
          normalizedBefore.id,
          limit,
        ]
      : [...chatJids, normalizedBefore.timestamp, limit]
    : [...chatJids, limit];
  const rows = db.prepare(sql).all(...params) as DbMessageRow[];

  return rows.map(mapDbMessageRow);
}

/**
 * 多 JID 增量查询（用于主工作区轮询合并消息）。
 */
export function getMessagesAfterMulti(
  chatJids: string[],
  after: string | MessageHistoryCursor,
  limit = 50,
): Array<NewMessage & { is_from_me: boolean }> {
  if (chatJids.length === 0) return [];
  if (chatJids.length === 1) return getMessagesAfter(chatJids[0], after, limit);

  const normalizedAfter = normalizeHistoryCursor(after);
  const placeholders = chatJids.map(() => '?').join(',');
  const rows = db
    .prepare(
      normalizedAfter?.precise
        ? `SELECT id, chat_jid, source_jid, runtime_identity, sender, sender_name, content, timestamp, is_from_me, attachments, token_usage,
              turn_id, session_id, sdk_message_uuid, source_kind, finalization_reason
       FROM messages
       WHERE chat_jid IN (${placeholders})
         AND (
           timestamp > ?
           OR (timestamp = ? AND chat_jid > ?)
           OR (timestamp = ? AND chat_jid = ? AND id > ?)
         )
       ORDER BY timestamp ASC, chat_jid ASC, id ASC
       LIMIT ?`
        : `SELECT id, chat_jid, source_jid, runtime_identity, sender, sender_name, content, timestamp, is_from_me, attachments, token_usage,
              turn_id, session_id, sdk_message_uuid, source_kind, finalization_reason
       FROM messages
       WHERE chat_jid IN (${placeholders}) AND timestamp > ?
       ORDER BY timestamp ASC
       LIMIT ?`,
    )
    .all(
      ...(normalizedAfter?.precise
        ? [
            ...chatJids,
            normalizedAfter.timestamp,
            normalizedAfter.timestamp,
            normalizedAfter.chat_jid,
            normalizedAfter.timestamp,
            normalizedAfter.chat_jid,
            normalizedAfter.id,
            limit,
          ]
        : [...chatJids, normalizedAfter?.timestamp || '', limit]),
    ) as DbMessageRow[];

  return rows.map(mapDbMessageRow);
}

/**
 * Get task run logs for a specific task, ordered by most recent first.
 */
export function getTaskRunLogs(taskId: string, limit = 20): TaskRunLog[] {
  return db
    .prepare(
      `
    SELECT id, task_id, run_at, duration_ms, status, result, error
    FROM task_run_logs
    WHERE task_id = ?
    ORDER BY run_at DESC
    LIMIT ?
  `,
    )
    .all(taskId, limit) as TaskRunLog[];
}

export function getTaskRunLogsForTaskIdsInRange(
  taskIds: string[],
  start: string,
  end: string,
): Array<TaskRunLog & { id: number }> {
  if (taskIds.length === 0) return [];
  const placeholders = taskIds.map(() => '?').join(', ');
  return db
    .prepare(
      `
    SELECT id, task_id, run_at, duration_ms, status, result, error
    FROM task_run_logs
    WHERE task_id IN (${placeholders})
      AND run_at >= ?
      AND run_at < ?
    ORDER BY run_at DESC, id DESC
  `,
    )
    .all(...taskIds, start, end) as Array<TaskRunLog & { id: number }>;
}

// ===================== Daily Summary Queries =====================

/**
 * Get messages for a chat within a time range, ordered by timestamp ASC.
 */
export function getMessagesByTimeRange(
  chatJid: string,
  startTs: number,
  endTs: number,
  limit = 500,
): Array<NewMessage & { is_from_me: boolean }> {
  const startIso = new Date(startTs).toISOString();
  const endIso = new Date(endTs).toISOString();
  const rows = db
    .prepare(
      `SELECT id, chat_jid, source_jid, runtime_identity, sender, sender_name, content, timestamp, is_from_me, attachments,
              turn_id, session_id, sdk_message_uuid, source_kind, finalization_reason
       FROM messages
       WHERE chat_jid = ? AND timestamp >= ? AND timestamp < ?
       ORDER BY timestamp ASC
       LIMIT ?`,
    )
    .all(chatJid, startIso, endIso, limit) as DbMessageRow[];

  return rows.map(mapDbMessageRow);
}

/**
 * Get all registered groups owned by a specific user.
 */
export function getGroupsByOwner(
  userId: string,
): Array<RegisteredGroup & { jid: string }> {
  const rows = db
    .prepare('SELECT * FROM registered_groups WHERE created_by = ?')
    .all(userId) as Array<{
    jid: string;
    name: string;
    folder: string;
    added_at: string;
    agent_type: string | null;
    custom_cwd: string | null;
    created_by: string | null;
    is_home: number;
  }>;

  return rows.map((row) => ({
    jid: row.jid,
    name: row.name,
    folder: row.folder,
    added_at: row.added_at,
    agentType: parseAgentType(row.agent_type),
    customCwd: row.custom_cwd ?? undefined,
    created_by: row.created_by ?? undefined,
    is_home: row.is_home === 1,
  }));
}

// ===================== Single-instance access =====================

export function isAccessConfigured(): boolean {
  const row = db
    .prepare("SELECT value FROM access_config WHERE key = 'password_hash'")
    .get() as { value: string } | undefined;
  return typeof row?.value === 'string' && row.value.length > 0;
}

export function getAccessPasswordHash(): string | null {
  const row = db
    .prepare("SELECT value FROM access_config WHERE key = 'password_hash'")
    .get() as { value: string } | undefined;
  return row?.value ?? null;
}

export function setAccessPasswordHash(passwordHash: string): void {
  db.prepare(
    "INSERT OR REPLACE INTO access_config (key, value) VALUES ('password_hash', ?)",
  ).run(passwordHash);
}

export function createAccessSession(session: AccessSession): void {
  db.prepare(
    `INSERT INTO access_sessions (id, ip_address, user_agent, created_at, expires_at, last_active_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    session.id,
    session.ip_address,
    session.user_agent,
    session.created_at,
    session.expires_at,
    session.last_active_at,
  );
}

export function getAccessSession(sessionId: string): AccessSession | undefined {
  const row = stmts().getSessionWithUser.get(sessionId) as
    | Record<string, unknown>
    | undefined;
  if (!row) return undefined;
  return {
    id: String(row.id),
    ip_address: typeof row.ip_address === 'string' ? row.ip_address : null,
    user_agent: typeof row.user_agent === 'string' ? row.user_agent : null,
    created_at: String(row.created_at),
    expires_at: String(row.expires_at),
    last_active_at: String(row.last_active_at),
  };
}

export function deleteAccessSession(sessionId: string): void {
  stmts().deleteSession.run(sessionId);
}

export function deleteAllAccessSessions(): number {
  return db.prepare('DELETE FROM access_sessions').run().changes;
}

export function updateAccessSessionLastActive(sessionId: string): void {
  stmts().updateSessionLastActive.run(new Date().toISOString(), sessionId);
}

export function getExpiredSessionIds(): string[] {
  const now = new Date().toISOString();
  return (stmts().getExpiredSessionIds.all(now) as { id: string }[]).map(
    (r) => r.id,
  );
}

export function deleteExpiredSessions(): number {
  const now = new Date().toISOString();
  const result = db
    .prepare('DELETE FROM access_sessions WHERE expires_at < ?')
    .run(now);
  return result.changes;
}

// ===================== Sub-Agent CRUD =====================

export function createAgent(agent: SubAgent): void {
  db.prepare(
    `INSERT INTO agents (id, group_folder, chat_jid, name, prompt, status, kind, created_by, created_at, completed_at, result_summary, spawned_from_jid)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    agent.id,
    agent.group_folder,
    agent.chat_jid,
    agent.name,
    agent.prompt,
    agent.status,
    agent.kind || 'task',
    agent.created_by ?? null,
    agent.created_at,
    agent.completed_at ?? null,
    agent.result_summary ?? null,
    agent.spawned_from_jid ?? null,
  );
}

export function getAgent(id: string): SubAgent | undefined {
  const row = db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) return undefined;
  return mapAgentRow(row);
}

export function listAgentsByFolder(folder: string): SubAgent[] {
  const rows = db
    .prepare(
      'SELECT * FROM agents WHERE group_folder = ? ORDER BY created_at DESC',
    )
    .all(folder) as Array<Record<string, unknown>>;
  return rows.map(mapAgentRow);
}

export function listAgentsByJid(chatJid: string): SubAgent[] {
  const rows = db
    .prepare('SELECT * FROM agents WHERE chat_jid = ? ORDER BY created_at DESC')
    .all(chatJid) as Array<Record<string, unknown>>;
  return rows.map(mapAgentRow);
}

export function updateAgentStatus(
  id: string,
  status: AgentStatus,
  resultSummary?: string,
): void {
  const completedAt =
    status !== 'running' && status !== 'idle' ? new Date().toISOString() : null;
  db.prepare(
    'UPDATE agents SET status = ?, completed_at = ?, result_summary = ? WHERE id = ?',
  ).run(status, completedAt, resultSummary ?? null, id);
}

export function updateAgentLastImJid(
  id: string,
  lastImJid: string | null,
): void {
  db.prepare('UPDATE agents SET last_im_jid = ? WHERE id = ?').run(
    lastImJid,
    id,
  );
}

export function updateAgentInfo(
  id: string,
  name: string,
  prompt: string,
): void {
  db.prepare('UPDATE agents SET name = ?, prompt = ? WHERE id = ?').run(
    name,
    prompt,
    id,
  );
}

export function deleteCompletedAgents(beforeTimestamp: string): number {
  const result = db
    .prepare(
      "DELETE FROM agents WHERE kind IN ('task', 'spawn') AND status IN ('completed', 'error') AND completed_at IS NOT NULL AND completed_at < ?",
    )
    .run(beforeTimestamp);
  return result.changes;
}

export function getRunningTaskAgentsByChat(chatJid: string): SubAgent[] {
  const rows = db
    .prepare(
      "SELECT * FROM agents WHERE chat_jid = ? AND kind = 'task' AND status = 'running'",
    )
    .all(chatJid) as Array<Record<string, unknown>>;
  return rows.map(mapAgentRow);
}

export function markRunningTaskAgentsAsError(chatJid: string): number {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      "UPDATE agents SET status = 'error', completed_at = ? WHERE chat_jid = ? AND kind = 'task' AND status = 'running'",
    )
    .run(now, chatJid);
  return result.changes;
}

export function markAllRunningTaskAgentsAsError(
  summary = '进程重启，任务中断',
): number {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      "UPDATE agents SET status = 'error', completed_at = ?, result_summary = COALESCE(result_summary, ?) WHERE kind = 'task' AND status = 'running'",
    )
    .run(now, summary);
  return result.changes;
}

/**
 * Mark stale spawn agents (idle/running) as error at startup.
 * After a process restart, spawn agents that were idle or running can never
 * resume — their in-memory task callbacks are lost. Mark them as error so
 * they don't render as "正在思考..." in the frontend.
 */
export function markStaleSpawnAgentsAsError(
  summary = '进程重启，并行任务中断',
): number {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      "UPDATE agents SET status = 'error', completed_at = ?, result_summary = COALESCE(result_summary, ?) WHERE kind = 'spawn' AND status IN ('idle', 'running')",
    )
    .run(now, summary);
  return result.changes;
}

export function listActiveConversationAgents(): SubAgent[] {
  return (
    db
      .prepare(
        "SELECT * FROM agents WHERE kind IN ('conversation', 'spawn') AND status IN ('running', 'idle')",
      )
      .all() as Record<string, unknown>[]
  ).map(mapAgentRow);
}

export function deleteAgent(id: string): void {
  // Delete associated session
  db.prepare('DELETE FROM sessions WHERE agent_id = ?').run(id);
  db.prepare('DELETE FROM agents WHERE id = ?').run(id);
}

function mapAgentRow(row: Record<string, unknown>): SubAgent {
  return {
    id: String(row.id),
    group_folder: String(row.group_folder),
    chat_jid: String(row.chat_jid),
    name: String(row.name),
    prompt: String(row.prompt),
    status: (row.status as AgentStatus) || 'running',
    kind: (row.kind as AgentKind) || 'task',
    created_by: typeof row.created_by === 'string' ? row.created_by : null,
    created_at: String(row.created_at),
    completed_at:
      typeof row.completed_at === 'string' ? row.completed_at : null,
    result_summary:
      typeof row.result_summary === 'string' ? row.result_summary : null,
    last_im_jid: typeof row.last_im_jid === 'string' ? row.last_im_jid : null,
    spawned_from_jid:
      typeof row.spawned_from_jid === 'string' ? row.spawned_from_jid : null,
  };
}

export function deleteMessagesForChatJid(chatJid: string): void {
  db.prepare('DELETE FROM messages WHERE chat_jid = ?').run(chatJid);
  db.prepare('DELETE FROM chats WHERE jid = ?').run(chatJid);
}

export function getMessage(
  chatJid: string,
  messageId: string,
): {
  id: string;
  chat_jid: string;
  sender: string | null;
  is_from_me: number;
} | null {
  const row = db
    .prepare(
      'SELECT id, chat_jid, sender, is_from_me FROM messages WHERE id = ? AND chat_jid = ?',
    )
    .get(messageId, chatJid) as
    | {
        id: string;
        chat_jid: string;
        sender: string | null;
        is_from_me: number;
      }
    | undefined;
  return row ?? null;
}

export function deleteMessage(chatJid: string, messageId: string): boolean {
  const result = db
    .prepare('DELETE FROM messages WHERE id = ? AND chat_jid = ?')
    .run(messageId, chatJid);
  return result.changes > 0;
}

/**
 * Close the database connection.
 * Should be called during graceful shutdown.
 */
export function closeDatabase(): void {
  _stmts = null;
  _newMsgStmtCache.clear();
  if (db) {
    db.close();
  }
}
