import {
  formatUnknownRuntimeCommandReply,
  parseSlashCommandCandidate,
} from '../core/runtime/command-registry.js';
import type { MessageSourceKind } from '../domain/types.js';

export type IMCommandHandler = (
  chatJid: string,
  command: string,
) => Promise<string | null>;

const IM_SLASH_REWRITE_PREFIX = '__CLI_CLAW_REWRITE__\n';

export interface ResolvedImSlashCommand {
  kind: 'reply' | 'rewrite_message';
  content: string;
  sourceKind?: MessageSourceKind;
}

export function encodeImSlashRewriteMessage(message: string): string {
  return `${IM_SLASH_REWRITE_PREFIX}${message}`;
}

function decodeImSlashRewriteMessage(reply: string): string | null {
  if (!reply.startsWith(IM_SLASH_REWRITE_PREFIX)) return null;
  const content = reply.slice(IM_SLASH_REWRITE_PREFIX.length).trim();
  return content || null;
}

export async function resolveImSlashCommandReply(
  chatJid: string,
  cmdBody: string,
  onCommand: IMCommandHandler,
): Promise<ResolvedImSlashCommand> {
  const trimmed = cmdBody.trim();
  const reply = await onCommand(chatJid, trimmed);
  if (reply !== null) {
    const rewritten = decodeImSlashRewriteMessage(reply);
    if (rewritten) {
      return {
        kind: 'rewrite_message',
        content: rewritten,
        sourceKind: 'assistant_prompt',
      };
    }
    return { kind: 'reply', content: reply };
  }

  const parsed = parseSlashCommandCandidate(trimmed, { allowBare: true });
  const fallbackName =
    parsed?.rawName ?? trimmed.split(/\s+/, 1)[0]?.replace(/^\/+/, '') ?? '';
  return {
    kind: 'reply',
    content: formatUnknownRuntimeCommandReply(fallbackName),
  };
}
