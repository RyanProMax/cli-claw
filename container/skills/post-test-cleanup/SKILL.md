---
name: post-test-cleanup
description: Use when a workspace was sent a synthetic or expensive test prompt and its runner, test messages, or runtime session must be cleaned before normal use resumes.
---

# Post-Test Cleanup

## When To Use

- A workspace received a synthetic test prompt, long generation request, or load-test message.
- A test was interrupted and may have left a runner, DB message, or runtime session behind.
- Recent test messages are polluting future assistant context.

## RULES

- Identify the exact `folder`, `jid`, and message IDs before deleting anything.
- Stop the related runner before editing DB rows or resetting the session.
- Delete only synthetic test messages; never bulk-delete normal user history.
- Reset the runtime session after deleting messages, or old context may still be reused.
- Confirm the repo worktree was not changed by the test.

## Workflow

1. Stop the runner for the target `folder`.
2. Resolve the group `jid` and inspect recent messages.
3. Delete only confirmed test message IDs.
4. Reset the runtime session for the folder.
5. Check the git worktree.

## Reference

Stop runner:

```bash
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.RunningFor}}"
ls ~/.cli-claw/ipc/
touch ~/.cli-claw/ipc/{folder}/input/_interrupt
sleep 5
touch ~/.cli-claw/ipc/{folder}/input/_close
sleep 10
docker ps --format "{{.Names}}" | grep {folder关键字}
```

Find the group and candidate messages:

```python3
python3 -c "
import os, sqlite3
conn = sqlite3.connect(os.path.expanduser('~/.cli-claw/db/messages.db'))
cur = conn.cursor()
cur.execute(\"SELECT jid, folder, name FROM registered_groups WHERE folder = '{folder}'\")
print('Group:', cur.fetchall())
cur.execute(\"\"\"
    SELECT id, content, is_from_me, timestamp
    FROM messages
    WHERE chat_jid = '{jid}'
    ORDER BY timestamp DESC LIMIT 20
\"\"\")
for r in cur.fetchall():
    print(f'id={r[0]} from_me={r[2]} | {str(r[1])[:80]}')
conn.close()
"
```

Delete confirmed message IDs:

```python3
python3 -c "
import os, sqlite3
conn = sqlite3.connect(os.path.expanduser('~/.cli-claw/db/messages.db'))
cur = conn.cursor()
test_ids = [
    'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
]
placeholders = ','.join(['?' for _ in test_ids])
cur.execute(f'DELETE FROM messages WHERE id IN ({placeholders})', test_ids)
print(f'Deleted {cur.rowcount} messages')
conn.commit()
conn.close()
"
```

Reset the runtime session:

```python3
python3 -c "
import os, sqlite3, uuid
conn = sqlite3.connect(os.path.expanduser('~/.cli-claw/db/messages.db'))
cur = conn.cursor()
new_id = str(uuid.uuid4())
cur.execute(\"UPDATE sessions SET session_id = ? WHERE group_folder = '{folder}'\", (new_id,))
print(f'Session reset: {cur.rowcount} rows, new ID: {new_id}')
conn.commit()
conn.close()
"
```

Check worktree:

```bash
git status
git diff --stat
```
