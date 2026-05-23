import type { GroupInfo } from '../types';
import { isWorkspaceListGroup } from './group-utils';

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function toWorkspaceChatPath(jid: string): string {
  return `/chat/${encodeURIComponent(jid)}`;
}

export function resolveWorkspaceRouteParam(
  routeParam: string | undefined,
  groups: Record<string, GroupInfo>,
): string | null {
  if (!routeParam) return null;
  const refs = Array.from(new Set([routeParam, safeDecode(routeParam)]));

  for (const ref of refs) {
    const group = groups[ref];
    if (group && isWorkspaceListGroup(ref, group)) return ref;
  }

  const folderMatches = Object.entries(groups).filter(([jid, group]) =>
    refs.includes(group.folder) && isWorkspaceListGroup(jid, group),
  );
  if (folderMatches.length === 1) return folderMatches[0]?.[0] ?? null;

  return null;
}
