/** IM channel type → JID prefix mapping. Shared between main server and agent-runner. */
export const CHANNEL_PREFIXES: Record<string, string> = {
  web: 'web:',
  feishu: 'feishu:',
  wechat: 'wechat:',
};

/** Determine the channel type from a JID string. Returns 'web' for unrecognized prefixes. */
export function getChannelFromJid(jid: string): string {
  for (const [type, prefix] of Object.entries(CHANNEL_PREFIXES)) {
    if (jid.startsWith(prefix)) return type;
  }
  return 'web';
}
