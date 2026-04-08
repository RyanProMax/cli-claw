import {
  formatUnknownRuntimeCommandReply,
  parseSlashCommandCandidate,
} from './runtime-command-registry.js';

export type IMCommandHandler = (
  chatJid: string,
  command: string,
) => Promise<string | null>;

export async function resolveImSlashCommandReply(
  chatJid: string,
  cmdBody: string,
  onCommand: IMCommandHandler,
): Promise<string> {
  const trimmed = cmdBody.trim();
  const reply = await onCommand(chatJid, trimmed);
  if (reply !== null) return reply;

  const parsed = parseSlashCommandCandidate(trimmed, { allowBare: true });
  const fallbackName =
    parsed?.rawName ?? trimmed.split(/\s+/, 1)[0]?.replace(/^\/+/, '') ?? '';
  return formatUnknownRuntimeCommandReply(fallbackName);
}
