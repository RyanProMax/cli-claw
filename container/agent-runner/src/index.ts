/**
 * cli-claw Agent Runner
 * Runs inside a container, receives config via stdin, outputs result to stdout
 *
 * Input protocol:
 *   Stdin: Full ContainerInput JSON (read until EOF, like before)
 *   IPC:   Follow-up messages written as JSON files to /workspace/ipc/input/
 *          Files: {type:"message", text:"..."}.json — polled and consumed
 *          Sentinel: /workspace/ipc/input/_close — signals session end
 *
 * Stdout protocol:
 *   Each result is wrapped in OUTPUT_START_MARKER / OUTPUT_END_MARKER pairs.
 *   Multiple results may be emitted (one per agent teams result).
 *   Final marker after loop ends signals completion.
 */

import fs from 'fs';
import path from 'path';
import {
  query,
  HookCallback,
  PreCompactHookInput,
  createSdkMcpServer,
} from '@anthropic-ai/claude-agent-sdk';
import { detectImageMimeTypeFromBase64Strict } from './image-detector.js';
import { serializeErrorForOutput } from '../../../shared/dist/error-serialization.js';
import {
  detectAgentRunnerCliClawServiceControl,
  extractShellCommandText,
} from '../../../shared/dist/service-restart-guard.js';

import type {
  ContainerInput,
  ContainerOutput,
  ImageMediaType,
  SDKUserMessage,
  StreamEvent,
} from './types.js';
export type { StreamEventType, StreamEvent } from './types.js';

import { StreamEventProcessor } from './stream-processor.js';
import { PREDEFINED_AGENTS } from './agent-definitions.js';
import { createMcpTools } from './mcp-tools.js';
import {
  buildOpenAiRuntimeIdentity,
  runOpenAiAgentLoop,
} from './openai-agent-runtime.js';
import {
  formatOpenAiRuntimeError,
  mergeRuntimeIdentityState,
  type RuntimeIdentityState,
} from './openai-agent-stream.js';
// 路径解析：优先读取环境变量，降级到容器内默认路径（保持向后兼容）
const WORKSPACE_GROUP =
  process.env.CLI_CLAW_WORKSPACE_GROUP || '/workspace/group';
const WORKSPACE_IPC = process.env.CLI_CLAW_WORKSPACE_IPC || '/workspace/ipc';

// 模型配置：支持别名（opus/sonnet/haiku）或完整模型 ID
// 别名自动解析为最新版本，如 opus → Opus 4.6
// [1m] 后缀启用 1M 上下文窗口（CLI 内部 jG() 识别后缀，sM() 返回 1M 窗口）
const CLAUDE_MODEL = process.env.ANTHROPIC_MODEL || 'opus[1m]';

const IPC_INPUT_DIR = path.join(WORKSPACE_IPC, 'input');
const IPC_INPUT_CLOSE_SENTINEL = path.join(IPC_INPUT_DIR, '_close');
const IPC_FALLBACK_POLL_MS = 5000; // 后备轮询间隔（仅防止 inotify 事件丢失）

// Module-level session ID so SIGTERM handler can emit it before exit.
// Updated in main() whenever a query returns a new session.
let latestSessionId: string | undefined;
let activeRuntimeIdentity: RuntimeIdentityState | null = null;

const CLI_CLAW_SERVICE_CONTROL_CONTEXT = {
  backendPid:
    Number.parseInt(process.env.CLI_CLAW_BACKEND_PID || '', 10) || null,
  launchdServiceName: process.env.CLI_CLAW_LAUNCHD_SERVICE_NAME || null,
};

function buildServiceControlContext(chatJid: string | undefined) {
  return {
    ...CLI_CLAW_SERVICE_CONTROL_CONTEXT,
  };
}

function normalizeRuntimeText(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function buildRuntimeIdentity(
  agentType: 'claude' | 'openai',
  requestedRuntime?: Pick<
    ContainerInput,
    'model' | 'reasoningEffort' | 'speedTier'
  >,
): RuntimeIdentityState {
  if (agentType === 'openai') {
    return buildOpenAiRuntimeIdentity(requestedRuntime);
  }
  return {
    agentType: 'claude',
    model:
      normalizeRuntimeText(requestedRuntime?.model ?? undefined) ??
      normalizeRuntimeText(CLAUDE_MODEL),
    reasoningEffort: null,
    speedTier: null,
    supportsReasoningEffort: false,
  };
}

const DEFAULT_ALLOWED_TOOLS = [
  'Bash',
  'Read',
  'Write',
  'Edit',
  'Glob',
  'Grep',
  'WebSearch',
  'WebFetch',
  'Task',
  'TaskOutput',
  'TaskStop',
  'TeamCreate',
  'TeamDelete',
  'SendMessage',
  'TodoWrite',
  'ToolSearch',
  'Skill',
  'NotebookEdit',
  'mcp__cli-claw__*',
];

const IMAGE_MAX_DIMENSION = 8000; // Anthropic API 限制

// Static runtime safety rules. Conversation continuity comes only from the
// underlying runtime session; Cli Claw must not append historical context.

const SECURITY_RULES_PATH = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  '..',
  'prompts',
  'security-rules.md',
);
const SECURITY_RULES = fs.readFileSync(SECURITY_RULES_PATH, 'utf-8');

/**
 * 规范化图片 MIME：
 * - 优先使用声明值（若合法且与内容一致）
 * - 若声明缺失或与内容不一致，使用内容识别值
 * - 最后兜底 image/jpeg
 */
function resolveImageMimeType(img: {
  data: string;
  mimeType?: string;
}): ImageMediaType {
  const declared =
    typeof img.mimeType === 'string' && img.mimeType.startsWith('image/')
      ? img.mimeType.toLowerCase()
      : undefined;
  const detected = detectImageMimeTypeFromBase64Strict(img.data);

  if (declared && detected && declared !== detected) {
    log(
      `Image MIME mismatch: declared=${declared}, detected=${detected}, using detected`,
    );
    return detected as ImageMediaType;
  }

  return (declared || detected || 'image/jpeg') as ImageMediaType;
}

/**
 * 从 base64 编码的图片数据中提取宽高（支持 PNG / JPEG / GIF / WebP / BMP）。
 * 仅解析头部字节，不需要完整解码图片。
 * 返回 null 表示无法识别格式。
 */
function getImageDimensions(
  base64Data: string,
): { width: number; height: number } | null {
  try {
    const headerB64 = base64Data.slice(0, 400);
    const buf = Buffer.from(headerB64, 'base64');

    // PNG: 固定位置 (bytes 16-23)
    if (
      buf.length >= 24 &&
      buf[0] === 0x89 &&
      buf[1] === 0x50 &&
      buf[2] === 0x4e &&
      buf[3] === 0x47
    ) {
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }

    // JPEG: 扫描 SOF marker（SOF 可能在大 EXIF/ICC 之后，需要 ~30KB）
    if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
      const JPEG_SCAN_B64_LEN = 40000; // ~30KB binary，覆盖大多数 EXIF/ICC 场景
      const fullHeader = Buffer.from(
        base64Data.slice(0, JPEG_SCAN_B64_LEN),
        'base64',
      );
      for (let i = 2; i < fullHeader.length - 9; i++) {
        if (fullHeader[i] !== 0xff) continue;
        const marker = fullHeader[i + 1];
        if (marker >= 0xc0 && marker <= 0xc3) {
          return {
            width: fullHeader.readUInt16BE(i + 7),
            height: fullHeader.readUInt16BE(i + 5),
          };
        }
        if (marker !== 0xd8 && marker !== 0xd9 && marker !== 0x00) {
          i += 1 + fullHeader.readUInt16BE(i + 2);
        }
      }
    }

    // GIF: bytes 6-9 (little-endian)
    if (
      buf.length >= 10 &&
      buf[0] === 0x47 &&
      buf[1] === 0x49 &&
      buf[2] === 0x46
    ) {
      return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
    }

    // BMP: bytes 18-25
    if (buf.length >= 26 && buf[0] === 0x42 && buf[1] === 0x4d) {
      return {
        width: buf.readInt32LE(18),
        height: Math.abs(buf.readInt32LE(22)),
      };
    }

    // WebP
    if (
      buf.length >= 30 &&
      buf[0] === 0x52 &&
      buf[1] === 0x49 &&
      buf[2] === 0x46 &&
      buf[3] === 0x46
    ) {
      const fourCC = buf.toString('ascii', 12, 16);
      if (fourCC === 'VP8 ' && buf.length >= 30)
        return {
          width: buf.readUInt16LE(26) & 0x3fff,
          height: buf.readUInt16LE(28) & 0x3fff,
        };
      if (fourCC === 'VP8L' && buf.length >= 25) {
        const b = buf.readUInt32LE(21);
        return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
      }
      if (fourCC === 'VP8X' && buf.length >= 30)
        return {
          width: (buf[24] | (buf[25] << 8) | (buf[26] << 16)) + 1,
          height: (buf[27] | (buf[28] << 8) | (buf[29] << 16)) + 1,
        };
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * 过滤超过 API 尺寸限制的图片。
 */
function filterOversizedImages(
  images: Array<{ data: string; mimeType?: string }>,
): { valid: Array<{ data: string; mimeType?: string }>; rejected: string[] } {
  const valid: Array<{ data: string; mimeType?: string }> = [];
  const rejected: string[] = [];
  for (const img of images) {
    const dims = getImageDimensions(img.data);
    if (
      dims &&
      (dims.width > IMAGE_MAX_DIMENSION || dims.height > IMAGE_MAX_DIMENSION)
    ) {
      const reason = `图片尺寸 ${dims.width}×${dims.height} 超过 API 限制（最大 ${IMAGE_MAX_DIMENSION}px），已跳过`;
      log(reason);
      rejected.push(reason);
    } else {
      valid.push(img);
    }
  }
  return { valid, rejected };
}

/**
 * Push-based async iterable for streaming user messages to the SDK.
 * Keeps the iterable alive until end() is called, preventing isSingleUserTurn.
 */
class MessageStream {
  private queue: SDKUserMessage[] = [];
  private waiting: (() => void) | null = null;
  private done = false;

  push(
    text: string,
    images?: Array<{ data: string; mimeType?: string }>,
  ): string[] {
    const rejectedReasons: string[] = [];
    let filteredImages = images;

    // 过滤超限图片，在发送给 SDK 之前拦截
    if (filteredImages && filteredImages.length > 0) {
      const { valid, rejected } = filterOversizedImages(filteredImages);
      rejectedReasons.push(...rejected);
      filteredImages = valid.length > 0 ? valid : undefined;
    }

    let content:
      | string
      | Array<
          | { type: 'text'; text: string }
          | {
              type: 'image';
              source: {
                type: 'base64';
                media_type: ImageMediaType;
                data: string;
              };
            }
        >;

    if (filteredImages && filteredImages.length > 0) {
      // 多模态消息：text + images
      content = [
        { type: 'text', text },
        ...filteredImages.map((img) => ({
          type: 'image' as const,
          source: {
            type: 'base64' as const,
            media_type: resolveImageMimeType(img),
            data: img.data,
          },
        })),
      ];
    } else {
      // 纯文本消息
      content = text;
    }

    this.queue.push({
      type: 'user',
      message: { role: 'user', content },
      parent_tool_use_id: null,
      session_id: '',
    });
    this.waiting?.();
    return rejectedReasons;
  }

  end(): void {
    this.done = true;
    this.waiting?.();
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<SDKUserMessage> {
    while (true) {
      while (this.queue.length > 0) {
        yield this.queue.shift()!;
      }
      if (this.done) return;
      await new Promise<void>((r) => {
        this.waiting = r;
      });
      this.waiting = null;
    }
  }
}

async function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

const OUTPUT_START_MARKER = '---CLI_CLAW_OUTPUT_START---';
const OUTPUT_END_MARKER = '---CLI_CLAW_OUTPUT_END---';

function writeOutput(output: ContainerOutput): void {
  const runtimeIdentity = mergeRuntimeIdentityState(
    activeRuntimeIdentity,
    output.runtimeIdentity ?? output.streamEvent?.runtimeIdentity,
  );
  if (runtimeIdentity) {
    output = {
      ...output,
      runtimeIdentity,
      ...(output.streamEvent
        ? {
            streamEvent: { ...output.streamEvent, runtimeIdentity },
          }
        : {}),
    };
  }
  console.log(OUTPUT_START_MARKER);
  console.log(JSON.stringify(output));
  console.log(OUTPUT_END_MARKER);
}

function log(message: string): void {
  console.error(`[agent-runner] ${message}`);
}

function generateTurnId(): string {
  return `ipc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Normalize isMain/isHome/isAdminHome flags for backward compatibility.
 * If the host sends the old `isMain` field, treat it as isHome=true + isAdminHome=true.
 */
function normalizeHomeFlags(input: ContainerInput): {
  isHome: boolean;
  isAdminHome: boolean;
} {
  if (input.isHome !== undefined) {
    return { isHome: !!input.isHome, isAdminHome: !!input.isAdminHome };
  }
  // Legacy: isMain was the only flag
  const legacy = !!input.isMain;
  return { isHome: legacy, isAdminHome: legacy };
}

/**
 * 检测是否为上下文溢出错误
 */
function isContextOverflowError(msg: string): boolean {
  const patterns: RegExp[] = [
    /prompt is too long/i,
    /maximum context length/i,
    /context.*too large/i,
    /exceeds.*token limit/i,
    /context window.*exceeded/i,
    /context_window_exceeded/i,
    /ran out of room in (?:the )?model'?s context window/i,
    /start a new thread or clear earlier history/i,
  ];
  return patterns.some((pattern) => pattern.test(msg));
}

/**
 * 检测会话转录中不可恢复的请求错误（400 invalid_request_error）。
 * 这类错误被固化在会话历史中，每次 resume 都会重放导致永久失败。
 * 例如：图片尺寸超过 8000px 限制、图片 MIME 声明与真实内容不一致等。
 *
 * 判定条件：必须同时满足「图片特征」+「API 拒绝」，避免对通用 400 错误误判导致会话丢失。
 */
function isImageMimeMismatchError(msg: string): boolean {
  return (
    /image\s+was\s+specified\s+using\s+the\s+image\/[a-z0-9.+-]+\s+media\s+type,\s+but\s+the\s+image\s+appears\s+to\s+be\s+(?:an?\s+)?image\/[a-z0-9.+-]+\s+image/i.test(
      msg,
    ) ||
    /image\/[a-z0-9.+-]+\s+media\s+type.*appears\s+to\s+be.*image\/[a-z0-9.+-]+/i.test(
      msg,
    )
  );
}

function isUnrecoverableTranscriptError(msg: string): boolean {
  const isImageSizeError =
    /image.*dimensions?\s+exceed/i.test(msg) ||
    /max\s+allowed\s+size.*pixels/i.test(msg);
  const isMimeMismatch = isImageMimeMismatchError(msg);
  const isApiReject = /invalid_request_error/i.test(msg);
  return isApiReject && (isImageSizeError || isMimeMismatch);
}

/**
 * Trim session JSONL file by removing all entries before the last compact_boundary.
 * After compaction, entries before the boundary are already summarized and no longer
 * needed for session reconstruction. This prevents unbounded file growth.
 *
 * Safety: uses atomic write (tmp + rename) to avoid data loss on crash.
 */
function trimSessionJsonl(jsonlPath: string): void {
  try {
    const content = fs.readFileSync(jsonlPath, 'utf-8');
    const lines = content.split('\n');
    const nonEmptyLines: { index: number; line: string }[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim()) nonEmptyLines.push({ index: i, line: lines[i] });
    }

    // Find the last compact_boundary entry
    let lastBoundaryPos = -1;
    let parseSkipped = 0;
    for (let i = nonEmptyLines.length - 1; i >= 0; i--) {
      try {
        const entry = JSON.parse(nonEmptyLines[i].line);
        if (entry.type === 'system' && entry.subtype === 'compact_boundary') {
          lastBoundaryPos = i;
          break;
        }
      } catch {
        parseSkipped++;
      }
    }
    if (parseSkipped > 0) {
      log(`Session trim: skipped ${parseSkipped} unparseable JSONL lines`);
    }

    if (lastBoundaryPos <= 0) {
      // No boundary found or it's already the first entry — nothing to trim
      log('Session trim: no compact_boundary found or already minimal');
      return;
    }

    // Keep entries from last compact_boundary onwards
    const trimmedLines = nonEmptyLines
      .slice(lastBoundaryPos)
      .map((e) => e.line);
    const removedCount = lastBoundaryPos;

    const TRIM_MIN_ENTRIES = 50; // Skip trimming if fewer entries before boundary (not worth the I/O)
    if (removedCount < TRIM_MIN_ENTRIES) {
      log(
        `Session trim: only ${removedCount} entries before boundary, skipping`,
      );
      return;
    }

    // Atomic write: temp file + rename
    const tmpPath = jsonlPath + '.trim-tmp';
    fs.writeFileSync(tmpPath, trimmedLines.join('\n') + '\n');
    fs.renameSync(tmpPath, jsonlPath);

    const sizeBefore = Buffer.byteLength(content, 'utf-8');
    const sizeAfter = fs.statSync(jsonlPath).size;
    log(
      `Session trim: ${nonEmptyLines.length} → ${trimmedLines.length} entries (removed ${removedCount}), ` +
        `${(sizeBefore / 1024 / 1024).toFixed(1)}MB → ${(sizeAfter / 1024 / 1024).toFixed(1)}MB`,
    );
  } catch (err) {
    log(
      `Session trim failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Trim the runtime JSONL file before compaction.
 * Cli Claw does not archive transcript content outside the runtime session.
 */
function createPreCompactHook(): HookCallback {
  return async (input, _toolUseId, _context) => {
    const preCompact = input as PreCompactHookInput;
    const transcriptPath = preCompact.transcript_path;
    // Skip sub-agent compactions — they operate on the main transcript file.
    if (preCompact.agent_id) {
      log(
        `PreCompact: skipping sub-agent compact (agent_id=${preCompact.agent_id})`,
      );
      return {};
    }

    if (!transcriptPath || !fs.existsSync(transcriptPath)) {
      log('No transcript found for trimming');
      return {};
    }

    trimSessionJsonl(transcriptPath);

    return {};
  };
}

/**
 * Check for _close sentinel.
 */
function shouldClose(): boolean {
  if (fs.existsSync(IPC_INPUT_CLOSE_SENTINEL)) {
    try {
      fs.unlinkSync(IPC_INPUT_CLOSE_SENTINEL);
    } catch {
      /* ignore */
    }
    return true;
  }
  return false;
}

const IPC_INPUT_DRAIN_SENTINEL = path.join(IPC_INPUT_DIR, '_drain');

const IPC_INPUT_INTERRUPT_SENTINEL = path.join(IPC_INPUT_DIR, '_interrupt');
const INTERRUPT_GRACE_WINDOW_MS = 10_000;
let lastInterruptRequestedAt = 0;

function markInterruptRequested(): void {
  lastInterruptRequestedAt = Date.now();
}

function clearInterruptRequested(): void {
  lastInterruptRequestedAt = 0;
}

function isWithinInterruptGraceWindow(): boolean {
  return (
    lastInterruptRequestedAt > 0 &&
    Date.now() - lastInterruptRequestedAt <= INTERRUPT_GRACE_WINDOW_MS
  );
}

function isInterruptRelatedError(err: unknown): boolean {
  const errno = err as NodeJS.ErrnoException;
  const message = err instanceof Error ? err.message : String(err ?? '');
  return (
    errno?.code === 'ABORT_ERR' ||
    /abort|aborted|interrupt|interrupted|cancelled|canceled/i.test(message)
  );
}

/**
 * Check for _interrupt sentinel (graceful query interruption).
 */
function shouldInterrupt(): boolean {
  if (fs.existsSync(IPC_INPUT_INTERRUPT_SENTINEL)) {
    try {
      fs.unlinkSync(IPC_INPUT_INTERRUPT_SENTINEL);
    } catch {
      /* ignore */
    }
    markInterruptRequested();
    return true;
  }
  return false;
}

function cleanupStartupInterruptSentinel(): void {
  try {
    const stat = fs.statSync(IPC_INPUT_INTERRUPT_SENTINEL);
    const ageMs = Date.now() - stat.mtimeMs;
    if (ageMs <= INTERRUPT_GRACE_WINDOW_MS) {
      log(
        `Preserving recent interrupt sentinel at startup (${Math.round(ageMs)}ms old)`,
      );
      return;
    }
    fs.unlinkSync(IPC_INPUT_INTERRUPT_SENTINEL);
    log(
      `Removed stale interrupt sentinel at startup (${Math.round(ageMs)}ms old)`,
    );
  } catch {
    /* ignore */
  }
}

/**
 * Check for _drain sentinel (finish current query then exit).
 * Unlike _close which exits from idle wait, _drain is checked after
 * a query completes to implement one-question-one-answer semantics.
 */
function shouldDrain(): boolean {
  if (fs.existsSync(IPC_INPUT_DRAIN_SENTINEL)) {
    try {
      fs.unlinkSync(IPC_INPUT_DRAIN_SENTINEL);
    } catch {
      /* ignore */
    }
    return true;
  }
  return false;
}

/**
 * Drain all pending IPC input messages.
 * Returns messages found (with optional images), or empty array.
 */
interface IpcDrainResult {
  messages: Array<{
    text: string;
    images?: Array<{ data: string; mimeType?: string }>;
  }>;
  cursor?: { timestamp: string; id?: string };
}

function normalizeIpcMessageCursor(
  value: unknown,
): { timestamp: string; id?: string } | null {
  if (!value || typeof value !== 'object') return null;
  const timestamp = (value as { timestamp?: unknown }).timestamp;
  if (typeof timestamp !== 'string' || !timestamp) return null;
  const id = (value as { id?: unknown }).id;
  return {
    timestamp,
    id: typeof id === 'string' ? id : undefined,
  };
}

function isIpcCursorAfter(
  candidate: { timestamp: string; id?: string },
  base: { timestamp: string; id?: string },
): boolean {
  if (candidate.timestamp > base.timestamp) return true;
  if (candidate.timestamp < base.timestamp) return false;
  return (candidate.id || '') > (base.id || '');
}

function drainIpcInput(): IpcDrainResult {
  const result: IpcDrainResult = { messages: [] };
  try {
    const files = fs
      .readdirSync(IPC_INPUT_DIR)
      .filter((f) => f.endsWith('.json'))
      .sort();

    for (const file of files) {
      const filePath = path.join(IPC_INPUT_DIR, file);
      try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        fs.unlinkSync(filePath);
        if (data.type === 'message' && data.text) {
          const cursor = normalizeIpcMessageCursor(data.cursor);
          if (
            cursor &&
            (!result.cursor || isIpcCursorAfter(cursor, result.cursor))
          ) {
            result.cursor = cursor;
          }
          result.messages.push({
            text: data.text,
            images: data.images,
          });
        }
      } catch (err) {
        log(
          `Failed to process input file ${file}: ${err instanceof Error ? err.message : String(err)}`,
        );
        try {
          fs.unlinkSync(filePath);
        } catch {
          /* ignore */
        }
      }
    }
  } catch (err) {
    log(`IPC drain error: ${err instanceof Error ? err.message : String(err)}`);
  }
  return result;
}

/**
 * Create a fs.watch() based IPC watcher for event-driven file detection.
 * Falls back to periodic polling every IPC_FALLBACK_POLL_MS.
 */
function createIpcWatcher(onFileDetected: () => void): { close: () => void } {
  let watcher: fs.FSWatcher | null = null;
  let fallbackTimer: ReturnType<typeof setInterval> | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  const debouncedDetect = () => {
    if (closed) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      if (!closed) onFileDetected();
    }, 50);
  };

  // Ensure IPC_INPUT_DIR exists
  try {
    fs.mkdirSync(IPC_INPUT_DIR, { recursive: true });
  } catch {}

  try {
    // Listen to all event types — 'rename' covers atomic writes on Linux,
    // but Docker bind mounts (macOS virtiofs) may emit 'change' instead.
    watcher = fs.watch(IPC_INPUT_DIR, () => {
      debouncedDetect();
    });
    watcher.on('error', (err) => {
      log(
        `IPC watcher error: ${err.message}, degrading to ${IPC_FALLBACK_POLL_MS}ms fallback polling`,
      );
      watcher?.close();
      watcher = null;
    });
  } catch (err) {
    log(
      `Failed to create IPC watcher: ${err instanceof Error ? err.message : String(err)}, using fallback polling`,
    );
  }

  // Fallback polling for reliability
  fallbackTimer = setInterval(() => {
    if (!closed) onFileDetected();
  }, IPC_FALLBACK_POLL_MS);
  fallbackTimer.unref(); // Don't prevent process from naturally exiting

  return {
    close() {
      closed = true;
      watcher?.close();
      watcher = null;
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      if (fallbackTimer) {
        clearInterval(fallbackTimer);
        fallbackTimer = null;
      }
    },
  };
}

/**
 * Wait for a new IPC message or _close sentinel.
 * Returns the messages (with optional images), or null if _close.
 */
function waitForIpcMessage(): Promise<{
  text: string;
  images?: Array<{ data: string; mimeType?: string }>;
  cursor?: { timestamp: string; id?: string };
} | null> {
  return new Promise((resolve) => {
    let resolved = false;
    const tryDrain = () => {
      if (resolved) return;

      if (shouldClose()) {
        resolved = true;
        ipcWatcher?.close();
        resolve(null);
        return;
      }

      if (shouldDrain()) {
        log('Drain sentinel received, exiting after completed query');
        resolved = true;
        ipcWatcher?.close();
        resolve(null);
        return;
      }

      if (shouldInterrupt()) {
        log('Interrupt sentinel received while idle, ignoring');
        clearInterruptRequested();
      }

      const { messages, cursor } = drainIpcInput();

      if (messages.length > 0) {
        const combinedText = messages.map((m) => m.text).join('\n');
        const allImages = messages.flatMap((m) => m.images || []);
        resolved = true;
        ipcWatcher?.close();
        resolve({
          text: combinedText,
          images: allImages.length > 0 ? allImages : undefined,
          cursor,
        });
        return;
      }
    };

    const ipcWatcher = createIpcWatcher(tryDrain);
    // Initial check in case files already exist
    tryDrain();
  });
}

function emitTurnInitEvent(
  sessionId: string | undefined,
  turnId: string | undefined,
  messageCursor?: { timestamp: string; id?: string },
): void {
  if (!messageCursor) return;
  writeOutput({
    status: 'stream',
    result: null,
    newSessionId: sessionId,
    streamEvent: {
      eventType: 'init',
      turnId,
      sessionId,
      messageCursor,
    },
  });
}

/** 从 settings.json 读取用户配置的 MCP servers（stdio/http/sse 类型） */
const CONTEXT_MCP_TEXT_PATTERN =
  /memory|recall|history|transcript|summary|(?:^|[^a-z0-9])context(?:[^a-z0-9]|$)/i;

function collectMcpTextFields(value: unknown, fields: string[]): void {
  if (typeof value === 'string') {
    fields.push(value);
    return;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    fields.push(String(value));
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectMcpTextFields(item, fields);
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      fields.push(key);
      collectMcpTextFields(item, fields);
    }
  }
}

function isContextLikeMcpServer(name: string, entry: unknown): boolean {
  const fields = [name];
  if (entry && typeof entry === 'object') {
    const server = entry as Record<string, unknown>;
    collectMcpTextFields(server.command, fields);
    collectMcpTextFields(server.url, fields);
    collectMcpTextFields(server.args, fields);
    collectMcpTextFields(server.env, fields);
  }
  return fields.some((field) => CONTEXT_MCP_TEXT_PATTERN.test(field));
}

function filterContextMcpServers(
  servers: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(servers).filter(([name, entry]) => {
      const allowed = !isContextLikeMcpServer(name, entry);
      if (!allowed) log(`Blocked context-like MCP server: ${name}`);
      return allowed;
    }),
  );
}

function loadUserMcpServers(): Record<string, unknown> {
  const configDir =
    process.env.CLAUDE_CONFIG_DIR ||
    path.join(process.env.HOME || '/home/node', '.claude');
  const settingsFile = path.join(configDir, 'settings.json');
  try {
    if (fs.existsSync(settingsFile)) {
      const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf-8'));
      if (settings.mcpServers && typeof settings.mcpServers === 'object') {
        return filterContextMcpServers(settings.mcpServers);
      }
    }
  } catch {
    /* ignore parse errors */
  }
  return {};
}

function createPreToolUseHook(chatJid: string): HookCallback {
  return async (input) => {
    const preTool = input as {
      hook_event_name: 'PreToolUse';
      tool_name: string;
      tool_input: unknown;
    };
    if (preTool.tool_name !== 'Bash') return {};

    const commandText = extractShellCommandText(preTool.tool_input);
    if (!commandText) return {};

    const blocked = detectAgentRunnerCliClawServiceControl(
      commandText,
      chatJid,
      buildServiceControlContext(chatJid),
    );
    if (!blocked) return {};

    log(
      `Blocked unsafe Bash tool use: ${blocked.reason}; command=${blocked.matchedText}`,
    );
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: blocked.message,
        additionalContext: blocked.reason,
      },
    };
  };
}

async function runQuery(
  prompt: string,
  sessionId: string | undefined,
  mcpServerConfig: ReturnType<typeof createSdkMcpServer>,
  containerInput: ContainerInput,
  resumeAt?: string,
  emitOutput = true,
  allowedTools: string[] = DEFAULT_ALLOWED_TOOLS,
  disallowedTools?: string[],
  images?: Array<{ data: string; mimeType?: string }>,
  sourceKindOverride?: ContainerOutput['sourceKind'],
): Promise<{
  newSessionId?: string;
  lastAssistantUuid?: string;
  closedDuringQuery: boolean;
  contextOverflow?: boolean;
  unrecoverableTranscriptError?: boolean;
  interruptedDuringQuery: boolean;
  sessionResumeFailed?: boolean;
}> {
  const stream = new MessageStream();
  let newSessionId: string | undefined;
  let lastAssistantUuid: string | undefined;
  let canonicalAssistantText: string | undefined;
  let canonicalAssistantUuid: string | undefined;
  const initialRejected = stream.push(prompt, images);
  const decorateStreamEvent = (event: StreamEvent): StreamEvent => ({
    ...event,
    turnId: containerInput.turnId,
    sessionId: newSessionId || sessionId,
  });
  const emit = (output: ContainerOutput): void => {
    if (output.streamEvent) {
      output = {
        ...output,
        streamEvent: decorateStreamEvent(output.streamEvent),
        turnId: containerInput.turnId,
        sessionId: newSessionId || sessionId,
      };
    } else if (output.status === 'success' || output.status === 'error') {
      output = {
        ...output,
        turnId: containerInput.turnId,
        sessionId: newSessionId || sessionId,
      };
    }
    if (emitOutput) writeOutput(output);
  };

  // 如果有图片被拒绝，立即通知用户
  for (const reason of initialRejected) {
    emit({
      status: 'success',
      result: `\u26a0\ufe0f ${reason}`,
      newSessionId: undefined,
    });
  }

  // Poll IPC for follow-up messages and _close/_interrupt sentinel during the query
  let ipcPolling = true;
  let closedDuringQuery = false;
  let interruptedDuringQuery = false;
  let suppressOutputAfterInterrupt = false;
  let visibleOutputStarted = false;
  // After a result is received, allow a short window for the host to write _drain
  // before force-closing the stream.
  let resultReceivedAt: number | null = null;
  const POST_RESULT_TIMEOUT_MS = 5_000;
  // queryRef is set just before the for-await loop so pollIpcDuringQuery can call interrupt()
  let queryRef: { interrupt(): Promise<void> } | null = null;
  let messageCount = 0;
  let resultCount = 0;

  const pollIpcDuringQuery = () => {
    if (!ipcPolling) return;

    if (shouldClose()) {
      log('Close sentinel detected during query, ending stream');
      closedDuringQuery = true;
      stream.end();
      ipcPolling = false;
      ipcQueryWatcher.close();
      return;
    }
    if (shouldInterrupt()) {
      log('Interrupt sentinel detected, interrupting current query');
      interruptedDuringQuery = true;
      if (!visibleOutputStarted && resultCount === 0) {
        suppressOutputAfterInterrupt = true;
        log(
          'Interrupt arrived before visible output, suppressing query output',
        );
      }
      lastInterruptRequestedAt = Date.now();
      queryRef
        ?.interrupt()
        .catch((err: unknown) => log(`Interrupt call failed: ${err}`));
      stream.end();
      ipcPolling = false;
      ipcQueryWatcher.close();
      return;
    }
    // _drain: finish current query then exit. Once a result has been received,
    // the query is logically done but the MessageStream keeps the SDK alive.
    // Treat drain as close at this point to release the container.
    if (resultCount > 0 && shouldDrain()) {
      log('Drain sentinel detected after query result, ending stream');
      closedDuringQuery = true;
      stream.end();
      ipcPolling = false;
      ipcQueryWatcher.close();
      return;
    }
    // ── 结果后超时：result 已收到，给 host 短暂时间写 _drain ──
    // 注意：不设置 closedDuringQuery — 这只是 stream 清理，不是退出信号。
    // 主循环会继续进入 waitForIpcMessage()，等待 _close/_drain 才退出。
    // 这保证了终端预热等场景下容器不会在查询完成后立即退出。
    if (
      resultReceivedAt &&
      Date.now() - resultReceivedAt > POST_RESULT_TIMEOUT_MS
    ) {
      log(
        `Post-result timeout (${POST_RESULT_TIMEOUT_MS / 1000}s), closing stream`,
      );
      stream.end();
      ipcPolling = false;
      ipcQueryWatcher.close();
      return;
    }
    // User IPC files are intentionally not drained during an active query.
    // waitForIpcMessage() consumes them after this query finishes, preserving a
    // hard turn boundary between card presentation states.
  };

  const ipcQueryWatcher = createIpcWatcher(() => {
    if (!ipcPolling) return;
    pollIpcDuringQuery();
  });
  // Initial drain to process any pre-existing files
  pollIpcDuringQuery();

  const processor = new StreamEventProcessor(emit, log);

  const systemPromptAppend = `<security>\n${SECURITY_RULES}\n</security>`;

  if (shouldInterrupt()) {
    log('Interrupt sentinel detected before query start, skipping query');
    interruptedDuringQuery = true;
    suppressOutputAfterInterrupt = true;
    ipcPolling = false;
    stream.end();
    return {
      newSessionId,
      lastAssistantUuid,
      closedDuringQuery,
      interruptedDuringQuery,
    };
  }

  try {
    const q = query({
      prompt: stream,
      options: {
        model: containerInput.model || CLAUDE_MODEL,
        cwd: WORKSPACE_GROUP,
        resume: sessionId,
        resumeSessionAt: resumeAt,
        systemPrompt: {
          type: 'preset' as const,
          preset: 'claude_code' as const,
          append: systemPromptAppend,
        },
        allowedTools,
        ...(disallowedTools && { disallowedTools }),
        thinking: { type: 'adaptive' as const },
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        agentProgressSummaries: true,
        settingSources: [],
        includePartialMessages: true,
        mcpServers: {
          ...loadUserMcpServers(), // 用户配置的 MCP（stdio/http/sse），SDK 原生支持
          'cli-claw': mcpServerConfig, // 内置 SDK MCP 放最后，确保不被同名覆盖
        },
        hooks: {
          PreToolUse: [
            {
              hooks: [createPreToolUseHook(containerInput.chatJid)],
            },
          ],
          PreCompact: [
            {
              hooks: [createPreCompactHook()],
            },
          ],
        },
        agents: PREDEFINED_AGENTS,
      },
    });
    queryRef = q;
    if (shouldInterrupt()) {
      log(
        'Interrupt sentinel already present when query started, interrupting immediately',
      );
      interruptedDuringQuery = true;
      if (!visibleOutputStarted && resultCount === 0) {
        suppressOutputAfterInterrupt = true;
      }
      queryRef
        .interrupt()
        .catch((err: unknown) =>
          log(`Immediate interrupt call failed: ${err}`),
        );
      stream.end();
      ipcPolling = false;
    }
    for await (const message of q) {
      // 流式事件处理
      if (message.type === 'stream_event') {
        if (!suppressOutputAfterInterrupt) {
          visibleOutputStarted = true;
        }
        if (suppressOutputAfterInterrupt) {
          continue;
        }
        processor.processStreamEvent(message as any);
        continue;
      }

      if (message.type === 'tool_progress') {
        if (!suppressOutputAfterInterrupt) {
          visibleOutputStarted = true;
        }
        if (suppressOutputAfterInterrupt) {
          continue;
        }
        processor.processToolProgress(message as any);
        continue;
      }

      if (message.type === 'tool_use_summary') {
        if (!suppressOutputAfterInterrupt) {
          visibleOutputStarted = true;
        }
        if (suppressOutputAfterInterrupt) {
          continue;
        }
        processor.processToolUseSummary(message as any);
        continue;
      }

      // Rate limit event — notify user and keep activity alive
      if (message.type === 'rate_limit_event') {
        const info = (message as any).rate_limit_info;
        if (info?.status === 'rejected') {
          const resetsAt = info.resetsAt
            ? new Date(info.resetsAt * 1000).toLocaleTimeString()
            : '未知';
          processor.emitStatus(`API 限流中，预计 ${resetsAt} 恢复`);
        } else if (info?.status === 'allowed_warning') {
          processor.emitStatus(`接近 API 限流阈值`);
        }
        continue;
      }

      // System messages
      if (message.type === 'system') {
        const sys = message as any;
        if (processor.processSystemMessage(sys)) {
          continue;
        }
      }

      messageCount++;
      const msgType =
        message.type === 'system'
          ? `system/${(message as { subtype?: string }).subtype}`
          : message.type;
      const msgParentToolUseId = (message as any).parent_tool_use_id ?? null;
      // 诊断：对所有 assistant/user 消息打印 parent_tool_use_id 和内容块类型
      if (message.type === 'assistant' || message.type === 'user') {
        const rawParent = (message as any).parent_tool_use_id;
        const contentTypes = Array.isArray((message as any).message?.content)
          ? ((message as any).message.content as Array<{ type: string }>)
              .map((b) => b.type)
              .join(',')
          : typeof (message as any).message?.content === 'string'
            ? 'string'
            : 'none';
        log(
          `[msg #${messageCount}] type=${msgType} parent_tool_use_id=${rawParent === undefined ? 'UNDEFINED' : rawParent === null ? 'NULL' : rawParent} content_types=[${contentTypes}] keys=[${Object.keys(message).join(',')}]`,
        );
      } else {
        log(
          `[msg #${messageCount}] type=${msgType}${msgParentToolUseId ? ` parent=${msgParentToolUseId.slice(0, 12)}` : ''}`,
        );
      }

      if (message.type !== 'system') {
        visibleOutputStarted = true;
      }
      if (suppressOutputAfterInterrupt && message.type !== 'system') {
        if (message.type === 'result') {
          resultCount++;
          resultReceivedAt = Date.now();
        }
        log(`[msg #${messageCount}] suppressed after early interrupt`);
        continue;
      }

      // ── 子 Agent 消息转 StreamEvent ──
      processor.processSubAgentMessage(message as any);

      if (message.type === 'assistant' && 'uuid' in message) {
        lastAssistantUuid = (message as { uuid: string }).uuid;
        const assistantMsg = message as Record<string, unknown>;
        if ((assistantMsg.parent_tool_use_id ?? null) === null) {
          const msgContent = (
            assistantMsg.message as Record<string, unknown> | undefined
          )?.content;
          const topLevelText = Array.isArray(msgContent)
            ? (msgContent as Array<{ type: string; text?: string }>)
                .filter(
                  (block) =>
                    block.type === 'text' && typeof block.text === 'string',
                )
                .map((block) => block.text!)
                .join('')
            : '';
          if (topLevelText) {
            canonicalAssistantText = topLevelText;
            canonicalAssistantUuid = assistantMsg.uuid as string;
          }
        }
        processor.processAssistantMessage(message as any);
      }

      if (message.type === 'system' && message.subtype === 'init') {
        newSessionId = message.session_id;
        log(`Session initialized: ${newSessionId}`);
      }

      if (
        message.type === 'system' &&
        (message as { subtype?: string }).subtype === 'task_notification'
      ) {
        const tn = message as unknown as {
          task_id: string;
          tool_use_id?: string;
          status: string;
          summary: string;
        };
        processor.processTaskNotification(tn);
      }

      if (message.type === 'result') {
        resultCount++;
        const textResult =
          'result' in message ? (message as { result?: string }).result : null;
        const resultSubtype = message.subtype;
        log(
          `Result #${resultCount}: subtype=${resultSubtype}${textResult ? ` text=${textResult.slice(0, 200)}` : ''}`,
        );

        // SDK 在某些失败场景会返回 error_* subtype 且不抛异常。
        // 不能把这类结果当 success(null)，否则前端会一直停留在"思考中"。
        // 匹配策略：显式枚举已知的 error subtype，并用 startsWith('error') 兜底未知的未来 error subtype。
        // 参考 SDK result subtype 约定：error_during_execution、error_max_turns 等均以 'error' 开头。
        if (
          typeof resultSubtype === 'string' &&
          (resultSubtype === 'error_during_execution' ||
            resultSubtype.startsWith('error'))
        ) {
          // If session never initialized (no system/init), resume itself failed — report it
          // so the caller can retry with a fresh session instead of crashing.
          if (!newSessionId) {
            log(`Session resume failed (no init): ${resultSubtype}`);
            return {
              newSessionId,
              lastAssistantUuid,
              closedDuringQuery,
              interruptedDuringQuery,
              sessionResumeFailed: true,
            };
          }
          const detail = textResult?.trim()
            ? textResult.trim()
            : `Claude Code execution failed (${resultSubtype})`;
          throw new Error(detail);
        }

        // SDK 将某些 API 错误包装为 subtype=success 的 result（不抛异常）
        if (textResult && isContextOverflowError(textResult)) {
          log(
            `Context overflow detected in result: ${textResult.slice(0, 100)}`,
          );
          const partialText = processor.getFullText();
          if (partialText.trim()) {
            log(`Dropping overflow_partial body (${partialText.length} chars)`);
            emit({
              status: 'success',
              result: null,
              newSessionId,
              sourceKind: 'overflow_partial',
              finalizationReason: 'error',
            });
          }
          processor.resetFullTextAccumulator();
          return {
            newSessionId,
            lastAssistantUuid,
            closedDuringQuery,
            contextOverflow: true,
            interruptedDuringQuery,
          };
        }
        if (textResult && isUnrecoverableTranscriptError(textResult)) {
          log(
            `Unrecoverable transcript error in result: ${textResult.slice(0, 200)}`,
          );
          processor.resetFullTextAccumulator();
          return {
            newSessionId,
            lastAssistantUuid,
            closedDuringQuery,
            unrecoverableTranscriptError: true,
            interruptedDuringQuery,
          };
        }

        const { effectiveResult } = processor.processResult(textResult);
        const finalText = canonicalAssistantText || effectiveResult;
        emit({
          status: 'success',
          result: finalText,
          newSessionId,
          sdkMessageUuid: canonicalAssistantUuid || lastAssistantUuid,
          sourceKind: sourceKindOverride ?? 'sdk_final',
          finalizationReason: 'completed',
        });
        // After emitting an sdk_final result, rotate turnId so that if the SDK
        // emits another result within the same query, it won't overwrite this one.
        containerInput.turnId = generateTurnId();

        // Emit usage stream event with token counts and cost
        const resultMsg = message as Record<string, unknown>;
        const sdkUsage = resultMsg.usage as Record<string, number> | undefined;
        const sdkModelUsage = resultMsg.modelUsage as
          | Record<string, Record<string, number>>
          | undefined;
        if (sdkUsage) {
          const modelUsageSummary: Record<
            string,
            { inputTokens: number; outputTokens: number; costUSD: number }
          > = {};
          if (sdkModelUsage && Object.keys(sdkModelUsage).length > 0) {
            for (const [model, mu] of Object.entries(sdkModelUsage)) {
              modelUsageSummary[model] = {
                inputTokens: mu.inputTokens || 0,
                outputTokens: mu.outputTokens || 0,
                costUSD: mu.costUSD || 0,
              };
            }
          } else {
            // Fallback: use session-level model name when SDK doesn't provide per-model breakdown
            modelUsageSummary[CLAUDE_MODEL] = {
              inputTokens: sdkUsage.input_tokens || 0,
              outputTokens: sdkUsage.output_tokens || 0,
              costUSD: (resultMsg.total_cost_usd as number) || 0,
            };
          }
          emit({
            status: 'stream',
            result: null,
            streamEvent: {
              eventType: 'usage',
              usage: {
                inputTokens: sdkUsage.input_tokens || 0,
                outputTokens: sdkUsage.output_tokens || 0,
                cacheReadInputTokens: sdkUsage.cache_read_input_tokens || 0,
                cacheCreationInputTokens:
                  sdkUsage.cache_creation_input_tokens || 0,
                costUSD: (resultMsg.total_cost_usd as number) || 0,
                durationMs: (resultMsg.duration_ms as number) || 0,
                numTurns: (resultMsg.num_turns as number) || 0,
                modelUsage:
                  Object.keys(modelUsageSummary).length > 0
                    ? modelUsageSummary
                    : undefined,
              },
            },
          });
          log(
            `Usage: input=${sdkUsage.input_tokens} output=${sdkUsage.output_tokens} cost=$${resultMsg.total_cost_usd} turns=${resultMsg.num_turns}`,
          );
        }

        // ── 标记结果已收到 ──
        // pollIpcDuringQuery 会在 POST_RESULT_TIMEOUT_MS 后关闭 stream，
        // 期间仍可检测 _drain/_close/_interrupt sentinel。
        resultReceivedAt = Date.now();
      }
    }

    // Cleanup residual state
    processor.cleanup();

    ipcPolling = false;
    ipcQueryWatcher.close();
    log(
      `Query done. Messages: ${messageCount}, results: ${resultCount}, lastAssistantUuid: ${lastAssistantUuid || 'none'}, closedDuringQuery: ${closedDuringQuery}, interruptedDuringQuery: ${interruptedDuringQuery}`,
    );
    return {
      newSessionId,
      lastAssistantUuid,
      closedDuringQuery,
      interruptedDuringQuery,
    };
  } catch (err) {
    ipcPolling = false;
    ipcQueryWatcher.close();
    const errorMessage = serializeErrorForOutput(err);

    // 检测上下文溢出错误
    if (isContextOverflowError(errorMessage)) {
      log(`Context overflow detected: ${errorMessage}`);
      const partialText = processor.getFullText();
      if (partialText.trim()) {
        log(
          `Dropping overflow_partial body (catch, ${partialText.length} chars)`,
        );
        emit({
          status: 'success',
          result: null,
          newSessionId,
          sourceKind: 'overflow_partial',
          finalizationReason: 'error',
        });
      }
      return {
        newSessionId,
        lastAssistantUuid,
        closedDuringQuery,
        contextOverflow: true,
        interruptedDuringQuery,
      };
    }

    // 检测不可恢复的转录错误
    if (isUnrecoverableTranscriptError(errorMessage)) {
      log(`Unrecoverable transcript error: ${errorMessage}`);
      return {
        newSessionId,
        lastAssistantUuid,
        closedDuringQuery,
        unrecoverableTranscriptError: true,
        interruptedDuringQuery,
      };
    }

    // 中断导致的 SDK 错误（error_during_execution 等）：正常返回，不抛出
    if (interruptedDuringQuery) {
      log(`runQuery error during interrupt (non-fatal): ${errorMessage}`);
      return {
        newSessionId,
        lastAssistantUuid,
        closedDuringQuery,
        interruptedDuringQuery,
      };
    }

    // SDK 在 yield result 后可能再抛异常（如检测到 result text 含错误内容），
    // 但此时 success 结果已通过 emit() 发送给调用方。再 re-throw 会导致
    // 外层 catch 额外发射一条 error output 并 exit(1)，引发无意义的重试。
    // 如果已成功发射过结果，将后续 SDK 异常降级为警告。
    if (resultCount > 0) {
      log(
        `runQuery post-result SDK error (non-fatal, ${resultCount} result(s) already emitted): ${errorMessage}`,
      );
      if (err instanceof Error && err.stack) {
        log(`runQuery post-result error stack:\n${err.stack}`);
      }
      return {
        newSessionId,
        lastAssistantUuid,
        closedDuringQuery,
        interruptedDuringQuery,
      };
    }

    // 其他错误：记录完整堆栈后继续抛出
    log(
      `runQuery error [${(err as NodeJS.ErrnoException).code ?? 'unknown'}]: ${errorMessage}`,
    );
    if (err instanceof Error && err.stack) {
      log(`runQuery error stack:\n${err.stack}`);
    }
    // 继续抛出
    throw err;
  }
}

/**
 * process.exit() with SIGKILL safety net.
 * When SDK has pending async resources (background Task tools, MCP connections),
 * process.exit() may hang indefinitely. Force SIGKILL after 5 seconds.
 * See GitHub issue #236.
 *
 * The timer must NOT use .unref() — if process.exit() silently fails to
 * terminate (observed with SDK MCP transports holding the event loop),
 * an unref'd timer won't keep the loop alive and the SIGKILL never fires.
 * Using a ref'd timer guarantees the safety net triggers.
 */
function forceExitWithSafetyNet(code: number): never {
  log(`Exiting with code ${code}, SIGKILL safety net in 5s`);
  setTimeout(() => {
    console.error(
      '[agent-runner] process.exit() did not terminate, forcing SIGKILL',
    );
    process.kill(process.pid, 'SIGKILL');
  }, 5000);
  process.exit(code);
}

function buildVisibleRuntimeErrorOutput(
  errorMessage: string,
  sessionId?: string,
): ContainerOutput {
  const friendlyError = formatOpenAiRuntimeError(errorMessage);
  return {
    status: 'error',
    result: friendlyError,
    error: friendlyError,
    alreadyStreamedError: true,
    finalizationReason: 'error',
    ...(sessionId ? { newSessionId: sessionId } : {}),
  };
}

async function main(): Promise<void> {
  let containerInput: ContainerInput;

  try {
    const stdinData = await readStdin();
    containerInput = JSON.parse(stdinData);
    const requestedAgentType = containerInput.agentType || 'openai';
    activeRuntimeIdentity = buildRuntimeIdentity(requestedAgentType, {
      model: containerInput.model ?? null,
      reasoningEffort: containerInput.reasoningEffort ?? null,
      speedTier: containerInput.speedTier ?? null,
    });
    log(
      `Received input for group: ${containerInput.groupFolder}, chatJid: ${containerInput.chatJid}, agentType: ${requestedAgentType}, session: ${containerInput.sessionId || 'new'}, runnerPid: ${process.pid}`,
    );
  } catch (err) {
    writeOutput(
      buildVisibleRuntimeErrorOutput(
        `Failed to parse input: ${serializeErrorForOutput(err)}`,
      ),
    );
    process.exit(1);
  }

  let sessionId = containerInput.sessionId;
  latestSessionId = sessionId;
  const { isHome, isAdminHome } = normalizeHomeFlags(containerInput);

  if ((containerInput.agentType || 'openai') === 'openai') {
    log(`Selected runner: openai, runnerPid: ${process.pid}`);
    await runOpenAiAgentLoop(containerInput, {
      workspaceGroup: WORKSPACE_GROUP,
      workspaceIpc: WORKSPACE_IPC,
      ipcInputDir: IPC_INPUT_DIR,
      ipcInputCloseSentinel: IPC_INPUT_CLOSE_SENTINEL,
      ipcInputInterruptSentinel: IPC_INPUT_INTERRUPT_SENTINEL,
      writeOutput,
      log,
      normalizeHomeFlags,
      cleanupStartupInterruptSentinel,
      clearInterruptRequested,
      shouldClose,
      shouldDrain,
      shouldInterrupt,
      drainIpcInput,
      waitForIpcMessage,
      generateTurnId,
      emitTurnInitEvent,
      setLatestSessionId: (nextSessionId) => {
        latestSessionId = nextSessionId;
      },
    });
    forceExitWithSafetyNet(0);
  }

  log(`Selected runner: claude, runnerPid: ${process.pid}`);

  // Create in-process SDK MCP server (replaces the stdio subprocess)
  const mcpToolsConfig = {
    chatJid: containerInput.chatJid,
    groupFolder: containerInput.groupFolder,
    isHome,
    isAdminHome,
    isScheduledTask: containerInput.isScheduledTask || false,
    workspaceIpc: WORKSPACE_IPC,
    workspaceGroup: WORKSPACE_GROUP,
  };
  const buildMcpServerConfig = () =>
    createSdkMcpServer({
      name: 'cli-claw',
      version: '1.0.0',
      tools: createMcpTools(mcpToolsConfig),
    });
  let mcpServerConfig = buildMcpServerConfig();
  fs.mkdirSync(IPC_INPUT_DIR, { recursive: true });

  // Clean up stale sentinels from previous container runs.
  // Note: _drain is NOT cleaned here — the host's cleanupIpcSentinels() in
  // runForGroup's finally block already removes stale sentinels between runs.
  // A _drain present at startup was written by registerProcess() for the
  // CURRENT run (indicating pending messages arrived during container boot).
  // Deleting it here causes those messages to be silently lost (#xxx).
  try {
    fs.unlinkSync(IPC_INPUT_CLOSE_SENTINEL);
  } catch {
    /* ignore */
  }
  cleanupStartupInterruptSentinel();

  // Build initial prompt (drain any pending IPC messages too)
  let prompt = containerInput.prompt;
  let promptImages = containerInput.images;
  if (containerInput.isScheduledTask) {
    const scheduledTaskPrefixLines = [
      '[定时任务 - 以下内容由系统自动发送，并非来自用户或群组的直接消息。]',
      '',
      '重要：你正在定时任务模式下运行。你的最终输出不会自动发送给用户。你必须使用 mcp__cli-claw__send_message 工具来发送消息，否则用户将收不到任何内容。',
      '',
      '注意：只在完成任务后调用一次 send_message 发送最终结果，不要发送中间状态或重复消息。',
    ];
    const scheduledTaskPrefix = scheduledTaskPrefixLines.join('\n');
    prompt = scheduledTaskPrefix + '\n\n' + prompt;
  }
  const pendingDrain = drainIpcInput();
  if (pendingDrain.messages.length > 0) {
    log(
      `Draining ${pendingDrain.messages.length} pending IPC messages into initial prompt`,
    );
    prompt += '\n' + pendingDrain.messages.map((m) => m.text).join('\n');
    const pendingImages = pendingDrain.messages.flatMap((m) => m.images || []);
    if (pendingImages.length > 0) {
      promptImages = [...(promptImages || []), ...pendingImages];
    }
  }

  // Query loop: run query -> wait for IPC message -> run new query -> repeat
  let resumeAt: string | undefined;
  let overflowRetryCount = 0;
  const MAX_OVERFLOW_RETRIES = 3;
  try {
    while (true) {
      // 清理残留的 _interrupt sentinel（空闲期间写入的中断信号不应影响下一次 query）。
      // 注意：_drain 不在此处清理 — 如果 _drain 存在，说明有待处理的消息，
      // pollIpcDuringQuery 会在查询结果后检测到并正确退出容器。
      try {
        fs.unlinkSync(IPC_INPUT_INTERRUPT_SENTINEL);
      } catch {
        /* ignore */
      }
      clearInterruptRequested();
      emitTurnInitEvent(
        sessionId,
        containerInput.turnId,
        containerInput.messageCursor,
      );
      containerInput.messageCursor = undefined;

      log(
        `Starting query (session: ${sessionId || 'new'}, resumeAt: ${resumeAt || 'latest'})...`,
      );

      const queryResult = await runQuery(
        prompt,
        sessionId,
        mcpServerConfig,
        containerInput,
        resumeAt,
        true,
        DEFAULT_ALLOWED_TOOLS,
        undefined,
        promptImages,
      );
      if (queryResult.newSessionId) {
        sessionId = queryResult.newSessionId;
        latestSessionId = sessionId;
      }
      if (queryResult.lastAssistantUuid) {
        resumeAt = queryResult.lastAssistantUuid;
      }

      // Session resume 失败（SDK 无法恢复旧会话）：清除 session，以新会话重试
      if (queryResult.sessionResumeFailed) {
        log(
          `Session resume failed, retrying with fresh session (old: ${sessionId})`,
        );
        sessionId = undefined;
        latestSessionId = undefined;
        resumeAt = undefined;
        // Rebuild MCP server to avoid "Already connected to a transport" error
        mcpServerConfig = buildMcpServerConfig();
        continue;
      }

      // 不可恢复的转录错误（如超大图片或 MIME 错配被固化在会话历史中）
      if (queryResult.unrecoverableTranscriptError) {
        const errorMsg =
          '会话历史中包含无法处理的数据（如超大图片或图片 MIME 错配），会话需要重置。';
        log(`Unrecoverable transcript error, signaling session reset`);
        writeOutput({
          status: 'error',
          result: null,
          error: `unrecoverable_transcript: ${errorMsg}`,
          newSessionId: sessionId,
        });
        process.exit(1);
      }

      // 检查上下文溢出
      if (queryResult.contextOverflow) {
        overflowRetryCount++;
        log(
          `Context overflow detected, retry ${overflowRetryCount}/${MAX_OVERFLOW_RETRIES}`,
        );

        if (overflowRetryCount >= MAX_OVERFLOW_RETRIES) {
          const errorMsg = `上下文溢出错误：已重试 ${MAX_OVERFLOW_RETRIES} 次仍失败。请联系管理员检查 AGENTS.md 大小或减少会话历史。`;
          log(errorMsg);
          writeOutput({
            status: 'error',
            result: null,
            error: `context_overflow: ${errorMsg}`,
            newSessionId: sessionId,
          });
          process.exit(1);
        }

        // 未超过重试次数，等待后继续下一轮循环（会触发自动压缩）
        log(
          'Retrying query after context overflow (will trigger auto-compaction)...',
        );
        await new Promise((r) => setTimeout(r, 3000));
        continue;
      }

      // 成功执行后重置溢出重试计数器
      overflowRetryCount = 0;

      // If _close was consumed during the query, exit immediately.
      // Don't emit a session-update marker (it would reset the host's
      // idle timer and cause a 30-min delay before the next _close).
      if (queryResult.closedDuringQuery) {
        log('Close sentinel consumed during query, exiting');
        // Notify host that this exit was due to _close, not a normal completion.
        // Without this marker the host treats the exit as silent success and
        // commits the message cursor, causing the in-flight IM message to be
        // consumed without a reply (the "swallowed message" bug).
        writeOutput({ status: 'closed', result: null });
        break;
      }

      // 中断后：跳过 session update，等待下一条消息
      if (queryResult.interruptedDuringQuery) {
        log('Query interrupted by user, waiting for next message');
        // 中断后清除 resumeAt：被中断的 assistant 消息可能未完整提交到 session 历史。
        // 使用 undefined 让 SDK 自行选择恢复点，避免因指向不完整消息的 UUID 导致 resume 失败。
        resumeAt = undefined;
        writeOutput({
          status: 'stream',
          result: null,
          streamEvent: { eventType: 'status', statusText: 'interrupted' },
          newSessionId: sessionId, // 确保主进程持久化 session ID
        });
        // 清理可能残留的 _interrupt 文件
        try {
          fs.unlinkSync(IPC_INPUT_INTERRUPT_SENTINEL);
        } catch {
          /* ignore */
        }
        // 不 break，等待下一条消息
        const nextMessage = await waitForIpcMessage();
        if (nextMessage === null) {
          log('Close sentinel received after interrupt, exiting');
          // 退出前发送 session 更新，确保主进程持久化最新 session ID
          writeOutput({
            status: 'success',
            result: null,
            newSessionId: sessionId,
          });
          break;
        }
        clearInterruptRequested();
        prompt = nextMessage.text;
        promptImages = nextMessage.images;
        containerInput.turnId = generateTurnId();
        containerInput.messageCursor = nextMessage.cursor;
        continue;
      }

      // Emit session update so host can track it
      writeOutput({ status: 'success', result: null, newSessionId: sessionId });

      log('Query ended, waiting for next IPC message...');

      // Wait for the next message or _close sentinel
      const nextMessage = await waitForIpcMessage();
      if (nextMessage === null) {
        log('Close sentinel received, exiting');
        break;
      }

      log(
        `Got new message (${nextMessage.text.length} chars, ${nextMessage.images?.length || 0} images), starting new query`,
      );
      prompt = nextMessage.text;
      promptImages = nextMessage.images;
      containerInput.turnId = generateTurnId();
      containerInput.messageCursor = nextMessage.cursor;
    }
  } catch (err) {
    const errorMessage = serializeErrorForOutput(err);
    log(`Agent error: ${errorMessage}`);
    if (err instanceof Error && err.stack) {
      log(`Agent error stack:\n${err.stack}`);
    }
    // Log cause chain for SDK-wrapped errors (e.g. EPIPE from internal claude CLI)
    const cause =
      err instanceof Error
        ? (err as NodeJS.ErrnoException & { cause?: unknown }).cause
        : undefined;
    if (cause) {
      const causeMsg =
        cause instanceof Error ? cause.stack || cause.message : String(cause);
      log(`Agent error cause:\n${causeMsg}`);
    }
    log(
      `Agent error errno: ${(err as NodeJS.ErrnoException).code ?? 'none'} exitCode: ${process.exitCode ?? 'none'}`,
    );
    // 不在 error output 中携带 sessionId：
    // 流式输出已通过 onOutput 回调传递了有效的 session 更新。
    // 如果这里携带的是 throw 前的旧 sessionId，会覆盖中间成功产生的新 session。
    writeOutput(buildVisibleRuntimeErrorOutput(errorMessage));
    forceExitWithSafetyNet(1);
  }

  // main() 正常结束后必须显式退出。
  // SDK 内部可能留有未关闭的异步资源（MCP 连接、定时器等），
  // 如果不调用 process.exit()，Node.js 事件循环不会自动退出，
  // 导致 agent-runner 进程以 0% CPU 挂起，阻塞队列。
  //
  // Safety net: 当 SDK 的后台 Task (run_in_background) 持有异步资源时，
  // process.exit() 可能无法终止进程。5 秒后强制 SIGKILL。
  // 参考 GitHub issue #236。
  forceExitWithSafetyNet(0);
}

// 处理管道断开（EPIPE）：父进程关闭管道后仍有写入时，静默退出避免 code 1 错误输出
(process.stdout as NodeJS.WriteStream & NodeJS.EventEmitter).on(
  'error',
  (err: NodeJS.ErrnoException) => {
    if (err.code === 'EPIPE') process.exit(0);
  },
);
(process.stderr as NodeJS.WriteStream & NodeJS.EventEmitter).on(
  'error',
  (err: NodeJS.ErrnoException) => {
    if (err.code === 'EPIPE') process.exit(0);
  },
);

/**
 * 某些 SDK/底层 socket 会在管道断开后触发未捕获 EPIPE。
 * 这类错误通常发生在结果已输出之后，属于"收尾写入失败"，
 * 不应把整个 host query 标记为启动失败（code 1）。
 */
process.on('SIGTERM', () => {
  log('Received SIGTERM, exiting gracefully');
  // Emit latest session ID so the host can persist it before we exit.
  // Without this, the host starts a fresh session on restart, losing context.
  if (latestSessionId) {
    try {
      writeOutput({
        status: 'success',
        result: null,
        newSessionId: latestSessionId,
      });
    } catch {
      /* stdout may be closed */
    }
  }
  forceExitWithSafetyNet(0);
});

process.on('SIGINT', () => {
  log('Received SIGINT, exiting gracefully');
  forceExitWithSafetyNet(0);
});

process.on('uncaughtException', (err: unknown) => {
  const errno = err as NodeJS.ErrnoException;
  if (errno?.code === 'EPIPE') {
    process.exit(0);
  }
  if (isWithinInterruptGraceWindow() && isInterruptRelatedError(err)) {
    console.error('Suppressing interrupt-related uncaught exception:', err);
    process.exit(0);
  }
  console.error('Uncaught exception:', err);
  // 尝试输出结构化错误，让主进程能收到错误信息而非仅看到 exit code 1
  try {
    writeOutput(
      buildVisibleRuntimeErrorOutput(
        serializeErrorForOutput(err),
        latestSessionId,
      ),
    );
  } catch {
    /* ignore */
  }
  process.exit(1);
});

process.on('unhandledRejection', (reason: unknown) => {
  const errno = reason as NodeJS.ErrnoException;
  if (errno?.code === 'EPIPE') {
    process.exit(0);
  }
  if (isWithinInterruptGraceWindow()) {
    console.error('Unhandled rejection during interrupt (non-fatal):', reason);
    return;
  }
  console.error('Unhandled rejection:', reason);
  try {
    writeOutput(
      buildVisibleRuntimeErrorOutput(
        serializeErrorForOutput(reason),
        latestSessionId,
      ),
    );
  } catch {
    /* ignore */
  }
  process.exit(1);
});
main().catch((err) => {
  console.error('Fatal error in main():', err);
  try {
    writeOutput(
      buildVisibleRuntimeErrorOutput(
        serializeErrorForOutput(err),
        latestSessionId,
      ),
    );
  } catch {
    /* ignore */
  }
  process.exit(1);
});
