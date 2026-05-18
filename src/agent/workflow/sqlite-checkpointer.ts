import type { RunnableConfig } from '@langchain/core/runnables';
import {
  BaseCheckpointSaver,
  TASKS,
  copyCheckpoint,
  maxChannelVersion,
  type Checkpoint,
  type CheckpointListOptions,
  type CheckpointMetadata,
  type CheckpointTuple,
  type PendingWrite,
  type SerializerProtocol,
} from '@langchain/langgraph-checkpoint';

import Database from '../../storage/sqlite-compat.js';

const CHECKPOINT_METADATA_KEYS = ['source', 'step', 'parents'] as const;

type MetadataFilterKey = (typeof CHECKPOINT_METADATA_KEYS)[number];

interface CheckpointRow {
  thread_id: string;
  checkpoint_ns: string;
  checkpoint_id: string;
  parent_checkpoint_id: string | null;
  type: string | null;
  checkpoint: Uint8Array | string;
  metadata: Uint8Array | string;
  pending_writes: string | null;
  pending_sends: string | null;
}

function isMetadataFilterKey(key: string): key is MetadataFilterKey {
  return CHECKPOINT_METADATA_KEYS.includes(key as MetadataFilterKey);
}

function parseJsonArray(value: string | null): unknown[] {
  if (!value) return [];
  const parsed = JSON.parse(value) as unknown;
  return Array.isArray(parsed) ? parsed : [];
}

function prepareLatestOrSpecificCheckpoint(db: any, checkpointId: boolean) {
  const sql = `
  SELECT
    thread_id,
    checkpoint_ns,
    checkpoint_id,
    parent_checkpoint_id,
    type,
    checkpoint,
    metadata,
    (
      SELECT
        json_group_array(
          json_object(
            'task_id', pw.task_id,
            'channel', pw.channel,
            'type', pw.type,
            'value', CAST(pw.value AS TEXT)
          )
        )
      FROM writes as pw
      WHERE pw.thread_id = checkpoints.thread_id
        AND pw.checkpoint_ns = checkpoints.checkpoint_ns
        AND pw.checkpoint_id = checkpoints.checkpoint_id
    ) as pending_writes,
    (
      SELECT
        json_group_array(
          json_object(
            'type', ps.type,
            'value', CAST(ps.value AS TEXT)
          )
        )
      FROM writes as ps
      WHERE ps.thread_id = checkpoints.thread_id
        AND ps.checkpoint_ns = checkpoints.checkpoint_ns
        AND ps.checkpoint_id = checkpoints.parent_checkpoint_id
        AND ps.channel = '${TASKS}'
      ORDER BY ps.idx
    ) as pending_sends
  FROM checkpoints
  WHERE thread_id = ? AND checkpoint_ns = ? ${
    checkpointId
      ? 'AND checkpoint_id = ?'
      : 'ORDER BY checkpoint_id DESC LIMIT 1'
  }`;
  return db.prepare(sql);
}

export class WorkflowSqliteSaver extends BaseCheckpointSaver {
  private db: any;
  private isSetup = false;
  private withoutCheckpoint: any;
  private withCheckpoint: any;

  constructor(sqlitePath: string, serde?: SerializerProtocol) {
    super(serde);
    this.db = new Database(sqlitePath);
  }

  private setup(): void {
    if (this.isSetup) return;
    if (typeof this.db.pragma === 'function') {
      this.db.pragma('journal_mode=WAL');
    } else {
      this.db.exec('PRAGMA journal_mode=WAL');
    }
    this.db.exec(`
CREATE TABLE IF NOT EXISTS checkpoints (
  thread_id TEXT NOT NULL,
  checkpoint_ns TEXT NOT NULL DEFAULT '',
  checkpoint_id TEXT NOT NULL,
  parent_checkpoint_id TEXT,
  type TEXT,
  checkpoint BLOB,
  metadata BLOB,
  PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
);`);
    this.db.exec(`
CREATE TABLE IF NOT EXISTS writes (
  thread_id TEXT NOT NULL,
  checkpoint_ns TEXT NOT NULL DEFAULT '',
  checkpoint_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  channel TEXT NOT NULL,
  type TEXT,
  value BLOB,
  PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx)
);`);
    this.withoutCheckpoint = prepareLatestOrSpecificCheckpoint(this.db, false);
    this.withCheckpoint = prepareLatestOrSpecificCheckpoint(this.db, true);
    this.isSetup = true;
  }

  private async rowToTuple(
    row: CheckpointRow,
    checkpointNs: string,
    finalConfig: RunnableConfig,
  ): Promise<CheckpointTuple> {
    if (
      finalConfig.configurable?.thread_id === undefined ||
      finalConfig.configurable?.checkpoint_id === undefined
    ) {
      throw new Error('Missing thread_id or checkpoint_id');
    }
    const pendingWrites = await Promise.all(
      parseJsonArray(row.pending_writes).map(async (entry) => {
        const write = entry as {
          task_id: string;
          channel: string;
          type?: string | null;
          value?: string | null;
        };
        return [
          write.task_id,
          write.channel,
          await this.serde.loadsTyped(write.type ?? 'json', write.value ?? ''),
        ] as [string, string, unknown];
      }),
    );
    const checkpoint = await this.serde.loadsTyped(
      row.type ?? 'json',
      row.checkpoint,
    );
    if (checkpoint.v < 4 && row.parent_checkpoint_id != null) {
      await this.migratePendingSends(
        checkpoint,
        row.thread_id,
        row.parent_checkpoint_id,
      );
    }
    return {
      checkpoint,
      config: finalConfig,
      metadata: await this.serde.loadsTyped(row.type ?? 'json', row.metadata),
      parentConfig: row.parent_checkpoint_id
        ? {
            configurable: {
              thread_id: row.thread_id,
              checkpoint_ns: checkpointNs,
              checkpoint_id: row.parent_checkpoint_id,
            },
          }
        : undefined,
      pendingWrites,
    };
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    this.setup();
    const {
      thread_id,
      checkpoint_ns = '',
      checkpoint_id,
    } = config.configurable ?? {};
    const args = [thread_id, checkpoint_ns];
    if (checkpoint_id) args.push(checkpoint_id);
    const row = (
      checkpoint_id ? this.withCheckpoint : this.withoutCheckpoint
    ).get(...args) as CheckpointRow | null | undefined;
    if (!row) return undefined;
    const finalConfig = checkpoint_id
      ? config
      : {
          configurable: {
            thread_id: row.thread_id,
            checkpoint_ns,
            checkpoint_id: row.checkpoint_id,
          },
        };
    return this.rowToTuple(row, checkpoint_ns, finalConfig);
  }

  async *list(
    config: RunnableConfig,
    options?: CheckpointListOptions,
  ): AsyncGenerator<CheckpointTuple> {
    this.setup();
    const { limit, before, filter } = options ?? {};
    const threadId = config.configurable?.thread_id;
    const checkpointNs = config.configurable?.checkpoint_ns;
    const whereClause: string[] = [];
    const args: unknown[] = [];
    if (threadId) {
      whereClause.push('thread_id = ?');
      args.push(threadId);
    }
    if (checkpointNs !== undefined && checkpointNs !== null) {
      whereClause.push('checkpoint_ns = ?');
      args.push(checkpointNs);
    }
    if (before?.configurable?.checkpoint_id !== undefined) {
      whereClause.push('checkpoint_id < ?');
      args.push(before.configurable.checkpoint_id);
    }
    for (const [key, value] of Object.entries(filter ?? {})) {
      if (value === undefined || !isMetadataFilterKey(key)) continue;
      whereClause.push(`json_extract(CAST(metadata AS TEXT), '$.${key}') = ?`);
      args.push(value);
    }
    let sql = `
      SELECT
        thread_id,
        checkpoint_ns,
        checkpoint_id,
        parent_checkpoint_id,
        type,
        checkpoint,
        metadata,
        (
          SELECT
            json_group_array(
              json_object(
                'task_id', pw.task_id,
                'channel', pw.channel,
                'type', pw.type,
                'value', CAST(pw.value AS TEXT)
              )
            )
          FROM writes as pw
          WHERE pw.thread_id = checkpoints.thread_id
            AND pw.checkpoint_ns = checkpoints.checkpoint_ns
            AND pw.checkpoint_id = checkpoints.checkpoint_id
        ) as pending_writes,
        (
          SELECT
            json_group_array(
              json_object(
                'type', ps.type,
                'value', CAST(ps.value AS TEXT)
              )
            )
          FROM writes as ps
          WHERE ps.thread_id = checkpoints.thread_id
            AND ps.checkpoint_ns = checkpoints.checkpoint_ns
            AND ps.checkpoint_id = checkpoints.parent_checkpoint_id
            AND ps.channel = '${TASKS}'
          ORDER BY ps.idx
        ) as pending_sends
      FROM checkpoints
    `;
    if (whereClause.length > 0) {
      sql += `WHERE ${whereClause.join(' AND ')}\n`;
    }
    sql += 'ORDER BY checkpoint_id DESC';
    if (limit) sql += ` LIMIT ${Number.parseInt(String(limit), 10)}`;
    const rows = this.db.prepare(sql).all(...args) as CheckpointRow[];
    for (const row of rows ?? []) {
      yield this.rowToTuple(row, row.checkpoint_ns, {
        configurable: {
          thread_id: row.thread_id,
          checkpoint_ns: row.checkpoint_ns,
          checkpoint_id: row.checkpoint_id,
        },
      });
    }
  }

  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
  ): Promise<RunnableConfig> {
    this.setup();
    if (!config.configurable) throw new Error('Empty configuration supplied.');
    const threadId = config.configurable.thread_id;
    const checkpointNs = config.configurable.checkpoint_ns ?? '';
    const parentCheckpointId = config.configurable.checkpoint_id;
    if (!threadId) {
      throw new Error(
        'Missing "thread_id" field in passed "config.configurable".',
      );
    }
    const preparedCheckpoint = copyCheckpoint(checkpoint);
    const [[type1, serializedCheckpoint], [type2, serializedMetadata]] =
      await Promise.all([
        this.serde.dumpsTyped(preparedCheckpoint),
        this.serde.dumpsTyped(metadata),
      ]);
    if (type1 !== type2) {
      throw new Error(
        'Failed to serialize checkpoint and metadata to the same type.',
      );
    }
    this.db
      .prepare(
        `INSERT OR REPLACE INTO checkpoints (thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, type, checkpoint, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        threadId,
        checkpointNs,
        checkpoint.id,
        parentCheckpointId,
        type1,
        serializedCheckpoint,
        serializedMetadata,
      );
    return {
      configurable: {
        thread_id: threadId,
        checkpoint_ns: checkpointNs,
        checkpoint_id: checkpoint.id,
      },
    };
  }

  async putWrites(
    config: RunnableConfig,
    writes: PendingWrite[],
    taskId: string,
  ): Promise<void> {
    this.setup();
    if (!config.configurable) throw new Error('Empty configuration supplied.');
    if (!config.configurable.thread_id) {
      throw new Error('Missing thread_id field in config.configurable.');
    }
    if (!config.configurable.checkpoint_id) {
      throw new Error('Missing checkpoint_id field in config.configurable.');
    }
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO writes
      (thread_id, checkpoint_ns, checkpoint_id, task_id, idx, channel, type, value)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const rows = await Promise.all(
      writes.map(async (write, idx) => {
        const [type, serializedWrite] = await this.serde.dumpsTyped(write[1]);
        return [
          config.configurable?.thread_id,
          config.configurable?.checkpoint_ns ?? '',
          config.configurable?.checkpoint_id,
          taskId,
          idx,
          write[0],
          type,
          serializedWrite,
        ];
      }),
    );
    this.db.transaction((values: unknown[][]) => {
      for (const row of values) stmt.run(...row);
    })(rows);
  }

  async deleteThread(threadId: string): Promise<void> {
    this.setup();
    this.db.transaction(() => {
      this.db
        .prepare('DELETE FROM checkpoints WHERE thread_id = ?')
        .run(threadId);
      this.db.prepare('DELETE FROM writes WHERE thread_id = ?').run(threadId);
    })();
  }

  private async migratePendingSends(
    checkpoint: Checkpoint,
    threadId: string,
    parentCheckpointId: string,
  ): Promise<void> {
    const row = this.db
      .prepare(
        `
          SELECT
            checkpoint_id,
            json_group_array(
              json_object(
                'type', ps.type,
                'value', CAST(ps.value AS TEXT)
              )
            ) as pending_sends
          FROM writes as ps
          WHERE ps.thread_id = ?
            AND ps.checkpoint_id = ?
            AND ps.channel = '${TASKS}'
          ORDER BY ps.idx
        `,
      )
      .get(threadId, parentCheckpointId) as
      | { pending_sends: string | null }
      | undefined;
    const pendingSends = parseJsonArray(row?.pending_sends ?? null);
    const mutableCheckpoint = checkpoint as Checkpoint & {
      channel_values: Record<string, unknown>;
      channel_versions: Record<string, string | number>;
    };
    mutableCheckpoint.channel_values ??= {};
    mutableCheckpoint.channel_values[TASKS] = await Promise.all(
      pendingSends.map((entry) => {
        const send = entry as { type?: string | null; value?: string | null };
        return this.serde.loadsTyped(send.type ?? 'json', send.value ?? '');
      }),
    );
    mutableCheckpoint.channel_versions[TASKS] =
      Object.keys(checkpoint.channel_versions).length > 0
        ? maxChannelVersion(...Object.values(checkpoint.channel_versions))
        : this.getNextVersion(undefined);
  }
}

export function createWorkflowSqliteSaver(
  sqlitePath: string,
): WorkflowSqliteSaver {
  return new WorkflowSqliteSaver(sqlitePath);
}
