import Database from './sqlite-compat.js';
import fs from 'fs';
import path from 'path';

import { DATA_DIR, STORE_DIR } from '../core/config.js';
import { logger } from '../core/logger.js';
import {
  AgentKind,
  AgentStatus,
  AuthAuditLog,
  AgentType,
  AuthEventType,
  GroupMember,
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
  User,
  UserPublic,
  UserStatus,
  UserRole,
  UserSession,
  UserSessionWithUser,
  Permission,
  RecordImMessageLifecycleEventInput,
  WorkflowContext,
  WorkflowDefinitionCache,
  WorkflowRun,
  WorkflowRunStatus,
  WorkflowRunStep,
  WorkflowRunStepStatus,
} from '../domain/types.js';
import {
  getDefaultPermissions,
  normalizePermissions,
} from '../core/permissions.js';
import {
  parseRuntimeIdentity,
  serializeRuntimeIdentity,
} from '../core/runtime/identity.js';

let db: InstanceType<typeof Database>;

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
        `SELECT s.*, u.username, u.role, u.status, u.display_name, u.permissions, u.must_change_password
         FROM user_sessions s
         JOIN users u ON s.user_id = u.id
         WHERE s.id = ?`,
      ),
      deleteSession: db.prepare('DELETE FROM user_sessions WHERE id = ?'),
      updateSessionLastActive: db.prepare(
        'UPDATE user_sessions SET last_active_at = ? WHERE id = ?',
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
        'SELECT id FROM user_sessions WHERE expires_at < ?',
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
      execution_type TEXT DEFAULT 'agent',
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
  `);

  // Auth tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT 'member',
      status TEXT NOT NULL DEFAULT 'active',
      permissions TEXT NOT NULL DEFAULT '[]',
      must_change_password INTEGER NOT NULL DEFAULT 0,
      disable_reason TEXT,
      notes TEXT,
      avatar_emoji TEXT,
      avatar_color TEXT,
      ai_name TEXT,
      ai_avatar_emoji TEXT,
      ai_avatar_color TEXT,
      ai_avatar_url TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_login_at TEXT,
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS user_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      ip_address TEXT,
      user_agent TEXT,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      last_active_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS auth_audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      username TEXT NOT NULL,
      actor_username TEXT,
      ip_address TEXT,
      user_agent TEXT,
      details TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_auth_audit_created ON auth_audit_log(created_at);
    CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_user_sessions_expires ON user_sessions(expires_at);
    CREATE INDEX IF NOT EXISTS idx_users_status_role ON users(status, role);
    CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at);
  `);
  db.exec('DROP TABLE IF EXISTS invite_codes;');

  // Group members table for shared workspaces
  db.exec(`
    CREATE TABLE IF NOT EXISTS group_members (
      group_folder TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      added_at TEXT NOT NULL,
      added_by TEXT,
      PRIMARY KEY (group_folder, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_group_members_user ON group_members(user_id);
  `);

  // User pinned groups (per-user workspace pinning)
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_pinned_groups (
      user_id TEXT NOT NULL,
      jid TEXT NOT NULL,
      pinned_at TEXT NOT NULL,
      PRIMARY KEY (user_id, jid)
    );
  `);

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
  ensureColumn('users', 'permissions', "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn('users', 'must_change_password', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('users', 'disable_reason', 'TEXT');
  ensureColumn('users', 'notes', 'TEXT');
  ensureColumn('users', 'deleted_at', 'TEXT');
  ensureColumn('users', 'avatar_emoji', 'TEXT');
  ensureColumn('users', 'avatar_color', 'TEXT');
  ensureColumn('registered_groups', 'agent_type', "TEXT DEFAULT 'openai'");
  ensureColumn('registered_groups', 'model', 'TEXT');
  ensureColumn('registered_groups', 'reasoning_effort', 'TEXT');
  ensureColumn('registered_groups', 'speed_tier', 'TEXT');
  ensureColumn('registered_groups', 'custom_cwd', 'TEXT');
  ensureColumn('messages', 'attachments', 'TEXT');
  ensureColumn('messages', 'source_jid', 'TEXT');
  ensureColumn('registered_groups', 'created_by', 'TEXT');
  ensureColumn('registered_groups', 'is_home', 'INTEGER DEFAULT 0');
  ensureColumn('users', 'avatar_url', 'TEXT');
  ensureColumn('users', 'ai_name', 'TEXT');
  ensureColumn('users', 'ai_avatar_emoji', 'TEXT');
  ensureColumn('users', 'ai_avatar_color', 'TEXT');
  ensureColumn('users', 'ai_avatar_url', 'TEXT');
  ensureColumn('scheduled_tasks', 'created_by', 'TEXT');
  ensureColumn('scheduled_tasks', 'execution_type', "TEXT DEFAULT 'agent'");
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
          execution_type TEXT DEFAULT 'agent',
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
    'created_by',
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

  assertSchema('users', [
    'id',
    'username',
    'password_hash',
    'display_name',
    'role',
    'status',
    'permissions',
    'must_change_password',
    'disable_reason',
    'notes',
    'avatar_emoji',
    'avatar_color',
    'avatar_url',
    'ai_name',
    'ai_avatar_emoji',
    'ai_avatar_color',
    'ai_avatar_url',
    'created_at',
    'updated_at',
    'last_login_at',
    'deleted_at',
  ]);
  assertSchema('user_sessions', [
    'id',
    'user_id',
    'ip_address',
    'user_agent',
    'created_at',
    'expires_at',
    'last_active_at',
  ]);
  assertSchema('auth_audit_log', [
    'id',
    'event_type',
    'username',
    'actor_username',
    'ip_address',
    'user_agent',
    'details',
    'created_at',
  ]);

  // Store schema version after all migrations complete
  // Migrate existing web groups: assign to first admin
  db.exec(`
    UPDATE registered_groups SET created_by = (
      SELECT id FROM users WHERE role = 'admin' AND status = 'active' ORDER BY created_at ASC LIMIT 1
    ) WHERE jid LIKE 'web:%' AND folder != 'main' AND created_by IS NULL
  `);

  // Backfill owner for legacy web:main if missing.
  db.exec(`
    UPDATE registered_groups SET created_by = (
      SELECT id FROM users WHERE role = 'admin' AND status = 'active' ORDER BY created_at ASC LIMIT 1
    ) WHERE jid = 'web:main' AND created_by IS NULL
  `);

  // Backfill created_by for feishu/telegram groups by matching sibling groups in the same folder.
  // Only backfill when the folder has exactly one distinct owner; otherwise keep NULL
  // to avoid misrouting in ambiguous folders (e.g., shared admin main).
  db.exec(`
    UPDATE registered_groups
    SET created_by = (
      SELECT MIN(rg2.created_by)
      FROM registered_groups rg2
      WHERE rg2.folder = registered_groups.folder
        AND rg2.created_by IS NOT NULL
    )
    WHERE (jid LIKE 'feishu:%' OR jid LIKE 'telegram:%')
      AND created_by IS NULL
      AND (
        SELECT COUNT(DISTINCT rg3.created_by)
        FROM registered_groups rg3
        WHERE rg3.folder = registered_groups.folder
          AND rg3.created_by IS NOT NULL
      ) = 1
  `);

  // v13 migration: mark existing web:main group as is_home=1
  db.exec(`
    UPDATE registered_groups SET is_home = 1
    WHERE jid = 'web:main' AND folder = 'main' AND is_home = 0
  `);

  // v15 migration: backfill group_members for existing web groups
  const currentVersion = getRouterStateInternal('schema_version');
  if (!currentVersion || parseInt(currentVersion, 10) < 15) {
    db.transaction(() => {
      // Backfill owner records for all web groups with created_by set
      const webGroups = db
        .prepare(
          "SELECT DISTINCT folder, created_by FROM registered_groups WHERE jid LIKE 'web:%' AND created_by IS NOT NULL",
        )
        .all() as Array<{ folder: string; created_by: string }>;
      for (const g of webGroups) {
        db.prepare(
          `INSERT OR IGNORE INTO group_members (group_folder, user_id, role, added_at, added_by)
           VALUES (?, ?, 'owner', ?, ?)`,
        ).run(g.folder, g.created_by, new Date().toISOString(), g.created_by);
      }
    })();
  }

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
    INSERT INTO scheduled_tasks (id, group_folder, chat_jid, prompt, schedule_type, schedule_value, context_mode, execution_type, script_command, next_run, status, created_at, created_by, notify_channels)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    task.id,
    task.group_folder,
    task.chat_jid,
    task.prompt,
    task.schedule_type,
    task.schedule_value,
    'isolated',
    task.execution_type || 'agent',
    task.script_command ?? null,
    task.next_run,
    task.status,
    task.created_at,
    task.created_by ?? null,
    task.notify_channels != null ? JSON.stringify(task.notify_channels) : null,
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

export function logTaskRunStart(taskId: string): number {
  const result = db
    .prepare(
      `
    INSERT INTO task_run_logs (task_id, run_at, duration_ms, status, result, error)
    VALUES (?, ?, 0, 'running', NULL, NULL)
  `,
    )
    .run(taskId, new Date().toISOString());
  return Number(result.lastInsertRowid);
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
  const result = db
    .prepare(
      `
    UPDATE task_run_logs SET status = 'error', error = 'Process crashed before completion'
    WHERE status = 'running'
  `,
    )
    .run();
  return result.changes;
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
 * Get all registered groups that route to a specific conversation agent.
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

/**
 * Find a user's home group (is_home=1 + created_by=userId).
 * For admin users, also matches web:main even if created_by differs
 * (all admins share folder=main).
 */
export function getUserHomeGroup(
  userId: string,
): (RegisteredGroup & { jid: string }) | undefined {
  // First try exact match: is_home=1 AND created_by=userId
  let row = db
    .prepare(
      'SELECT * FROM registered_groups WHERE is_home = 1 AND created_by = ?',
    )
    .get(userId) as RegisteredGroupRow | undefined;

  // Fallback for admin users: all admins share web:main (folder=main).
  // If no exact match, check if the user is an admin and web:main exists.
  if (!row) {
    const user = db
      .prepare("SELECT role FROM users WHERE id = ? AND status = 'active'")
      .get(userId) as { role: string } | undefined;
    if (user?.role === 'admin') {
      row = db
        .prepare(
          "SELECT * FROM registered_groups WHERE jid = 'web:main' AND is_home = 1",
        )
        .get() as RegisteredGroupRow | undefined;
    }
  }

  if (!row) return undefined;
  return parseGroupRow(row);
}

/**
 * Ensure a user has a home group. If not, create one.
 * Admin gets folder='main'. Member gets folder='home-{userId}'.
 * Returns the JID of the home group.
 */
export function ensureUserHomeGroup(
  userId: string,
  role: 'admin' | 'member',
  username?: string,
): string {
  const existing = getUserHomeGroup(userId);
  if (existing) return existing.jid;

  const now = new Date().toISOString();
  const isAdmin = role === 'admin';
  const jid = isAdmin ? 'web:main' : `web:home-${userId}`;
  const folder = isAdmin ? 'main' : `home-${userId}`;

  // For admin: check if web:main already exists (created by another admin)
  // In that case, reuse it rather than overwriting created_by
  if (isAdmin) {
    const existingMain = getRegisteredGroup(jid);
    if (existingMain) {
      // web:main already exists.
      // Ensure is_home and created_by are correct for owner-based routing.
      const patched = { ...existingMain };
      let changed = false;
      if (!patched.is_home) {
        patched.is_home = true;
        changed = true;
      }
      if (!patched.created_by) {
        patched.created_by = userId;
        changed = true;
      }
      if (changed) {
        setRegisteredGroup(jid, patched);
      }
      ensureChatExists(jid);
      return jid;
    }
  }

  const name = username ? `${username} Home` : isAdmin ? 'Main' : 'Home';

  const group: RegisteredGroup = {
    name,
    folder,
    added_at: now,
    agentType: 'openai',
    created_by: userId,
    is_home: true,
  };

  setRegisteredGroup(jid, group);

  // Ensure chat row exists
  ensureChatExists(jid);

  return jid;
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
    // 1. 删除定时任务运行日志 + 定时任务
    db.prepare(
      'DELETE FROM task_run_logs WHERE task_id IN (SELECT id FROM scheduled_tasks WHERE group_folder = ?)',
    ).run(folder);
    db.prepare('DELETE FROM scheduled_tasks WHERE group_folder = ?').run(
      folder,
    );
    // 2. 删除成员记录
    db.prepare('DELETE FROM group_members WHERE group_folder = ?').run(folder);
    // 3. 删除注册信息
    db.prepare('DELETE FROM registered_groups WHERE jid = ?').run(jid);
    // 4. 删除会话
    db.prepare('DELETE FROM sessions WHERE group_folder = ?').run(folder);
    // 5. 删除聊天记录
    db.prepare('DELETE FROM messages WHERE chat_jid = ?').run(jid);
    db.prepare('DELETE FROM chats WHERE jid = ?').run(jid);
    // 6. 删除 pin 记录
    db.prepare('DELETE FROM user_pinned_groups WHERE jid = ?').run(jid);
    // 7. 清除定时任务的工作区关联（任务本身不删，只断开绑定）
    db.prepare(
      'UPDATE scheduled_tasks SET workspace_jid = NULL, workspace_folder = NULL WHERE workspace_jid = ?',
    ).run(jid);
  });
  tx();
}

// --- User pinned groups ---

export function getUserPinnedGroups(userId: string): Record<string, string> {
  const rows = db
    .prepare('SELECT jid, pinned_at FROM user_pinned_groups WHERE user_id = ?')
    .all(userId) as Array<{ jid: string; pinned_at: string }>;
  const result: Record<string, string> = {};
  for (const row of rows) result[row.jid] = row.pinned_at;
  return result;
}

export function pinGroup(userId: string, jid: string): string {
  const pinned_at = new Date().toISOString();
  db.prepare(
    'INSERT OR REPLACE INTO user_pinned_groups (user_id, jid, pinned_at) VALUES (?, ?, ?)',
  ).run(userId, jid, pinned_at);
  return pinned_at;
}

export function unpinGroup(userId: string, jid: string): void {
  db.prepare(
    'DELETE FROM user_pinned_groups WHERE user_id = ? AND jid = ?',
  ).run(userId, jid);
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

// ===================== Auth CRUD =====================

function parseUserRole(value: unknown): UserRole {
  return value === 'admin' ? 'admin' : 'member';
}

function parseUserStatus(value: unknown): UserStatus {
  if (value === 'deleted') return 'deleted';
  if (value === 'disabled') return 'disabled';
  return 'active';
}

function parsePermissionsFromDb(raw: unknown, role: UserRole): Permission[] {
  if (typeof raw === 'string') {
    try {
      const parsed = normalizePermissions(JSON.parse(raw));
      if (parsed.length > 0) return parsed;
    } catch {
      // ignore and fall back to role defaults
    }
  }
  return getDefaultPermissions(role);
}

function parseJsonDetails(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function mapUserRow(row: Record<string, unknown>): User {
  const role = parseUserRole(row.role);
  const status = parseUserStatus(row.status);
  return {
    id: String(row.id),
    username: String(row.username),
    password_hash: String(row.password_hash),
    display_name: String(row.display_name ?? ''),
    role,
    status,
    permissions: parsePermissionsFromDb(row.permissions, role),
    must_change_password: !!row.must_change_password,
    disable_reason:
      typeof row.disable_reason === 'string' ? row.disable_reason : null,
    notes: typeof row.notes === 'string' ? row.notes : null,
    avatar_emoji:
      typeof row.avatar_emoji === 'string' ? row.avatar_emoji : null,
    avatar_color:
      typeof row.avatar_color === 'string' ? row.avatar_color : null,
    avatar_url: typeof row.avatar_url === 'string' ? row.avatar_url : null,
    ai_name: typeof row.ai_name === 'string' ? row.ai_name : null,
    ai_avatar_emoji:
      typeof row.ai_avatar_emoji === 'string' ? row.ai_avatar_emoji : null,
    ai_avatar_color:
      typeof row.ai_avatar_color === 'string' ? row.ai_avatar_color : null,
    ai_avatar_url:
      typeof row.ai_avatar_url === 'string' ? row.ai_avatar_url : null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    last_login_at:
      typeof row.last_login_at === 'string' ? row.last_login_at : null,
    deleted_at: typeof row.deleted_at === 'string' ? row.deleted_at : null,
  };
}

function toUserPublic(user: User, lastActiveAt: string | null): UserPublic {
  return {
    id: user.id,
    username: user.username,
    display_name: user.display_name,
    role: user.role,
    status: user.status,
    permissions: user.permissions,
    must_change_password: user.must_change_password,
    disable_reason: user.disable_reason,
    notes: user.notes,
    avatar_emoji: user.avatar_emoji,
    avatar_color: user.avatar_color,
    avatar_url: user.avatar_url,
    ai_name: user.ai_name,
    ai_avatar_emoji: user.ai_avatar_emoji,
    ai_avatar_color: user.ai_avatar_color,
    ai_avatar_url: user.ai_avatar_url,
    created_at: user.created_at,
    last_login_at: user.last_login_at,
    last_active_at: lastActiveAt,
    deleted_at: user.deleted_at,
  };
}

// --- Users ---

export interface CreateUserInput {
  id: string;
  username: string;
  password_hash: string;
  display_name: string;
  role: UserRole;
  status: UserStatus;
  created_at: string;
  updated_at: string;
  permissions?: Permission[];
  must_change_password?: boolean;
  disable_reason?: string | null;
  notes?: string | null;
  last_login_at?: string | null;
  deleted_at?: string | null;
}

export function createUser(user: CreateUserInput): void {
  const permissions = normalizePermissions(
    user.permissions ?? getDefaultPermissions(user.role),
  );
  db.prepare(
    `INSERT INTO users (
      id, username, password_hash, display_name, role, status, permissions, must_change_password,
      disable_reason, notes, created_at, updated_at, last_login_at, deleted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    user.id,
    user.username,
    user.password_hash,
    user.display_name,
    user.role,
    user.status,
    JSON.stringify(permissions),
    user.must_change_password ? 1 : 0,
    user.disable_reason ?? null,
    user.notes ?? null,
    user.created_at,
    user.updated_at,
    user.last_login_at ?? null,
    user.deleted_at ?? null,
  );
}

export type CreateInitialAdminResult =
  | { ok: true }
  | { ok: false; reason: 'already_initialized' | 'username_taken' };

export function createInitialAdminUser(
  user: CreateUserInput,
): CreateInitialAdminResult {
  const tx = db.transaction(
    (input: CreateUserInput): CreateInitialAdminResult => {
      const row = db.prepare('SELECT COUNT(*) as count FROM users').get() as {
        count: number;
      };
      if (row.count > 0) return { ok: false, reason: 'already_initialized' };
      createUser(input);
      return { ok: true };
    },
  );

  try {
    return tx(user);
  } catch (err) {
    if (
      err instanceof Error &&
      err.message.includes('UNIQUE constraint failed: users.username')
    ) {
      return { ok: false, reason: 'username_taken' };
    }
    throw err;
  }
}

export function getUserById(id: string): User | undefined {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? mapUserRow(row) : undefined;
}

export function getUserByUsername(username: string): User | undefined {
  const row = db
    .prepare('SELECT * FROM users WHERE username = ?')
    .get(username) as Record<string, unknown> | undefined;
  return row ? mapUserRow(row) : undefined;
}

export interface ListUsersOptions {
  query?: string;
  role?: UserRole | 'all';
  status?: UserStatus | 'all';
  page?: number;
  pageSize?: number;
}

export interface ListUsersResult {
  users: UserPublic[];
  total: number;
  page: number;
  pageSize: number;
}

export function listUsers(options: ListUsersOptions = {}): ListUsersResult {
  const role = options.role && options.role !== 'all' ? options.role : null;
  const status =
    options.status && options.status !== 'all' ? options.status : null;
  const query = options.query?.trim() || '';
  const page = Math.max(1, Math.floor(options.page || 1));
  const pageSize = Math.min(
    200,
    Math.max(1, Math.floor(options.pageSize || 50)),
  );
  const offset = (page - 1) * pageSize;

  const whereParts: string[] = [];
  const params: unknown[] = [];
  if (role) {
    whereParts.push('u.role = ?');
    params.push(role);
  }
  if (status) {
    whereParts.push('u.status = ?');
    params.push(status);
  }
  if (query) {
    whereParts.push(
      "(u.username LIKE ? OR u.display_name LIKE ? OR COALESCE(u.notes, '') LIKE ?)",
    );
    const like = `%${query}%`;
    params.push(like, like, like);
  }

  const whereClause =
    whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : '';

  const totalRow = db
    .prepare(`SELECT COUNT(*) as count FROM users u ${whereClause}`)
    .get(...params) as { count: number };

  const rows = db
    .prepare(
      `
      SELECT u.*, MAX(s.last_active_at) AS last_active_at
      FROM users u
      LEFT JOIN user_sessions s ON s.user_id = u.id
      ${whereClause}
      GROUP BY u.id
      ORDER BY
        CASE u.status
          WHEN 'active' THEN 0
          WHEN 'disabled' THEN 1
          ELSE 2
        END,
        u.created_at DESC
      LIMIT ? OFFSET ?
      `,
    )
    .all(...params, pageSize, offset) as Array<Record<string, unknown>>;

  return {
    users: rows.map((row) => {
      const user = mapUserRow(row);
      const lastActiveAt =
        typeof row.last_active_at === 'string' ? row.last_active_at : null;
      return toUserPublic(user, lastActiveAt);
    }),
    total: totalRow.count,
    page,
    pageSize,
  };
}

export function getAllUsers(): UserPublic[] {
  return listUsers({ role: 'all', status: 'all', page: 1, pageSize: 1000 })
    .users;
}

export function getUserCount(includeDeleted = false): number {
  const row = includeDeleted
    ? (db.prepare('SELECT COUNT(*) as count FROM users').get() as {
        count: number;
      })
    : (db
        .prepare('SELECT COUNT(*) as count FROM users WHERE status != ?')
        .get('deleted') as { count: number });
  return row.count;
}

export function getActiveAdminCount(): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) as count
       FROM users
       WHERE role = 'admin' AND status = 'active'`,
    )
    .get() as { count: number };
  return row.count;
}

export function updateUserFields(
  id: string,
  updates: Partial<
    Pick<
      User,
      | 'username'
      | 'display_name'
      | 'role'
      | 'status'
      | 'password_hash'
      | 'last_login_at'
      | 'permissions'
      | 'must_change_password'
      | 'disable_reason'
      | 'notes'
      | 'avatar_emoji'
      | 'avatar_color'
      | 'avatar_url'
      | 'ai_name'
      | 'ai_avatar_emoji'
      | 'ai_avatar_color'
      | 'ai_avatar_url'
      | 'deleted_at'
    >
  >,
): void {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.username !== undefined) {
    fields.push('username = ?');
    values.push(updates.username);
  }
  if (updates.display_name !== undefined) {
    fields.push('display_name = ?');
    values.push(updates.display_name);
  }
  if (updates.role !== undefined) {
    fields.push('role = ?');
    values.push(updates.role);
  }
  if (updates.status !== undefined) {
    fields.push('status = ?');
    values.push(updates.status);
  }
  if (updates.password_hash !== undefined) {
    fields.push('password_hash = ?');
    values.push(updates.password_hash);
  }
  if (updates.last_login_at !== undefined) {
    fields.push('last_login_at = ?');
    values.push(updates.last_login_at);
  }
  if (updates.permissions !== undefined) {
    fields.push('permissions = ?');
    values.push(JSON.stringify(normalizePermissions(updates.permissions)));
  }
  if (updates.must_change_password !== undefined) {
    fields.push('must_change_password = ?');
    values.push(updates.must_change_password ? 1 : 0);
  }
  if (updates.disable_reason !== undefined) {
    fields.push('disable_reason = ?');
    values.push(updates.disable_reason);
  }
  if (updates.notes !== undefined) {
    fields.push('notes = ?');
    values.push(updates.notes);
  }
  if (updates.avatar_emoji !== undefined) {
    fields.push('avatar_emoji = ?');
    values.push(updates.avatar_emoji);
  }
  if (updates.avatar_color !== undefined) {
    fields.push('avatar_color = ?');
    values.push(updates.avatar_color);
  }
  if (updates.avatar_url !== undefined) {
    fields.push('avatar_url = ?');
    values.push(updates.avatar_url);
  }
  if (updates.ai_name !== undefined) {
    fields.push('ai_name = ?');
    values.push(updates.ai_name);
  }
  if (updates.ai_avatar_emoji !== undefined) {
    fields.push('ai_avatar_emoji = ?');
    values.push(updates.ai_avatar_emoji);
  }
  if (updates.ai_avatar_color !== undefined) {
    fields.push('ai_avatar_color = ?');
    values.push(updates.ai_avatar_color);
  }
  if (updates.ai_avatar_url !== undefined) {
    fields.push('ai_avatar_url = ?');
    values.push(updates.ai_avatar_url);
  }
  if (updates.deleted_at !== undefined) {
    fields.push('deleted_at = ?');
    values.push(updates.deleted_at);
  }

  if (fields.length === 0) return;

  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);

  db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(
    ...values,
  );
}

export function deleteUser(id: string): void {
  const now = new Date().toISOString();
  const tx = db.transaction((userId: string) => {
    db.prepare('DELETE FROM user_sessions WHERE user_id = ?').run(userId);
    db.prepare(
      `UPDATE users
       SET status = 'deleted', deleted_at = ?, disable_reason = COALESCE(disable_reason, 'deleted_by_admin'), updated_at = ?
       WHERE id = ?`,
    ).run(now, now, userId);
  });
  tx(id);
}

export function restoreUser(id: string): void {
  db.prepare(
    `UPDATE users
     SET status = 'disabled', deleted_at = NULL, disable_reason = NULL, updated_at = ?
     WHERE id = ?`,
  ).run(new Date().toISOString(), id);
}

// --- User Sessions ---

export function createUserSession(session: UserSession): void {
  db.prepare(
    `INSERT INTO user_sessions (id, user_id, ip_address, user_agent, created_at, expires_at, last_active_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    session.id,
    session.user_id,
    session.ip_address,
    session.user_agent,
    session.created_at,
    session.expires_at,
    session.last_active_at,
  );
}

export function getSessionWithUser(
  sessionId: string,
): UserSessionWithUser | undefined {
  const row = stmts().getSessionWithUser.get(sessionId) as
    | Record<string, unknown>
    | undefined;
  if (!row) return undefined;
  const role = parseUserRole(row.role);
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    ip_address: typeof row.ip_address === 'string' ? row.ip_address : null,
    user_agent: typeof row.user_agent === 'string' ? row.user_agent : null,
    created_at: String(row.created_at),
    expires_at: String(row.expires_at),
    last_active_at: String(row.last_active_at),
    username: String(row.username),
    role,
    status: parseUserStatus(row.status),
    display_name: String(row.display_name ?? ''),
    permissions: parsePermissionsFromDb(row.permissions, role),
    must_change_password: !!row.must_change_password,
  };
}

export function getUserSessions(userId: string): UserSession[] {
  return db
    .prepare(
      `SELECT * FROM user_sessions WHERE user_id = ? ORDER BY last_active_at DESC`,
    )
    .all(userId) as UserSession[];
}

export function deleteUserSession(sessionId: string): void {
  stmts().deleteSession.run(sessionId);
}

export function deleteUserSessionsByUserId(userId: string): void {
  db.prepare('DELETE FROM user_sessions WHERE user_id = ?').run(userId);
}

export function updateSessionLastActive(sessionId: string): void {
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
    .prepare('DELETE FROM user_sessions WHERE expires_at < ?')
    .run(now);
  return result.changes;
}

// --- Auth Audit Log ---

export function logAuthEvent(event: {
  event_type: AuthEventType;
  username: string;
  actor_username?: string | null;
  ip_address?: string | null;
  user_agent?: string | null;
  details?: Record<string, unknown> | null;
}): void {
  db.prepare(
    `INSERT INTO auth_audit_log (event_type, username, actor_username, ip_address, user_agent, details, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    event.event_type,
    event.username,
    event.actor_username ?? null,
    event.ip_address ?? null,
    event.user_agent ?? null,
    event.details ? JSON.stringify(event.details) : null,
    new Date().toISOString(),
  );
}

export interface AuthAuditLogQuery {
  limit?: number;
  offset?: number;
  event_type?: AuthEventType | 'all';
  username?: string;
  actor_username?: string;
  from?: string;
  to?: string;
}

export interface AuthAuditLogPage {
  logs: AuthAuditLog[];
  total: number;
  limit: number;
  offset: number;
}

export function queryAuthAuditLogs(
  query: AuthAuditLogQuery = {},
): AuthAuditLogPage {
  const limit = Math.min(500, Math.max(1, Math.floor(query.limit || 100)));
  const offset = Math.max(0, Math.floor(query.offset || 0));

  const whereParts: string[] = [];
  const params: unknown[] = [];
  if (query.event_type && query.event_type !== 'all') {
    whereParts.push('event_type = ?');
    params.push(query.event_type);
  }
  if (query.username?.trim()) {
    whereParts.push('username LIKE ?');
    params.push(`%${query.username.trim()}%`);
  }
  if (query.actor_username?.trim()) {
    whereParts.push('actor_username LIKE ?');
    params.push(`%${query.actor_username.trim()}%`);
  }
  if (query.from) {
    whereParts.push('created_at >= ?');
    params.push(query.from);
  }
  if (query.to) {
    whereParts.push('created_at <= ?');
    params.push(query.to);
  }
  const whereClause =
    whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : '';

  const total = (
    db
      .prepare(`SELECT COUNT(*) as count FROM auth_audit_log ${whereClause}`)
      .get(...params) as {
      count: number;
    }
  ).count;

  const rows = db
    .prepare(
      `SELECT * FROM auth_audit_log ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as Array<Record<string, unknown>>;

  const logs = rows.map((row) => ({
    id: Number(row.id),
    event_type: row.event_type as AuthEventType,
    username: String(row.username),
    actor_username:
      typeof row.actor_username === 'string' ? row.actor_username : null,
    ip_address: typeof row.ip_address === 'string' ? row.ip_address : null,
    user_agent: typeof row.user_agent === 'string' ? row.user_agent : null,
    details: parseJsonDetails(row.details),
    created_at: String(row.created_at),
  }));

  return { logs, total, limit, offset };
}

export function getAuthAuditLogs(limit = 100, offset = 0): AuthAuditLog[] {
  return queryAuthAuditLogs({ limit, offset }).logs;
}

export function checkLoginRateLimitFromAudit(
  username: string,
  ip: string,
  maxAttempts: number,
  lockoutMinutes: number,
): { allowed: boolean; retryAfterSeconds?: number; attempts: number } {
  if (maxAttempts <= 0) return { allowed: true, attempts: 0 };
  const windowStart = new Date(
    Date.now() - lockoutMinutes * 60 * 1000,
  ).toISOString();
  const rows = db
    .prepare(
      `
      SELECT created_at
      FROM auth_audit_log
      WHERE event_type = 'login_failed'
        AND username = ?
        AND ip_address = ?
        AND created_at >= ?
        AND (details IS NULL OR details NOT LIKE '%"reason":"rate_limited"%')
      ORDER BY created_at ASC
      `,
    )
    .all(username, ip, windowStart) as Array<{ created_at: string }>;

  const attempts = rows.length;
  if (attempts < maxAttempts) return { allowed: true, attempts };

  const oldest = rows[0]?.created_at;
  const oldestTs = oldest ? Date.parse(oldest) : Date.now();
  const retryAt = oldestTs + lockoutMinutes * 60 * 1000;
  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((retryAt - Date.now()) / 1000),
  );
  return { allowed: false, retryAfterSeconds, attempts };
}

// ===================== Group Members =====================

export function addGroupMember(
  groupFolder: string,
  userId: string,
  role: 'owner' | 'member',
  addedBy?: string,
): void {
  db.prepare(
    `INSERT INTO group_members (group_folder, user_id, role, added_at, added_by)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(group_folder, user_id) DO UPDATE SET
       role = CASE WHEN excluded.role = 'owner' THEN 'owner'
                   WHEN group_members.role = 'owner' THEN 'owner'
                   ELSE excluded.role END,
       added_by = COALESCE(excluded.added_by, group_members.added_by)`,
  ).run(groupFolder, userId, role, new Date().toISOString(), addedBy ?? null);
}

export function removeGroupMember(groupFolder: string, userId: string): void {
  db.prepare(
    'DELETE FROM group_members WHERE group_folder = ? AND user_id = ?',
  ).run(groupFolder, userId);
}

export function getGroupMembers(groupFolder: string): GroupMember[] {
  const rows = db
    .prepare(
      `SELECT gm.user_id, gm.role, gm.added_at, gm.added_by,
              u.username, COALESCE(u.display_name, '') as display_name
       FROM group_members gm
       JOIN users u ON gm.user_id = u.id
       WHERE gm.group_folder = ?
       ORDER BY gm.role DESC, gm.added_at ASC`,
    )
    .all(groupFolder) as Array<{
    user_id: string;
    role: string;
    added_at: string;
    added_by: string | null;
    username: string;
    display_name: string;
  }>;
  return rows.map((r) => ({
    user_id: r.user_id,
    role: r.role as 'owner' | 'member',
    added_at: r.added_at,
    added_by: r.added_by ?? undefined,
    username: r.username,
    display_name: r.display_name,
  }));
}

export function getGroupMemberRole(
  groupFolder: string,
  userId: string,
): 'owner' | 'member' | null {
  const row = db
    .prepare(
      'SELECT role FROM group_members WHERE group_folder = ? AND user_id = ?',
    )
    .get(groupFolder, userId) as { role: string } | undefined;
  if (!row) return null;
  return row.role as 'owner' | 'member';
}

export function getUserMemberFolders(
  userId: string,
): Array<{ group_folder: string; role: 'owner' | 'member' }> {
  const rows = db
    .prepare('SELECT group_folder, role FROM group_members WHERE user_id = ?')
    .all(userId) as Array<{ group_folder: string; role: string }>;
  return rows.map((r) => ({
    group_folder: r.group_folder,
    role: r.role as 'owner' | 'member',
  }));
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

export function isGroupShared(groupFolder: string): boolean {
  const row = db
    .prepare('SELECT COUNT(*) as cnt FROM group_members WHERE group_folder = ?')
    .get(groupFolder) as { cnt: number };
  return row.cnt > 1;
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
