import fs from 'node:fs';
import path from 'node:path';

import { LAUNCH_CWD } from './app-root.js';
import { findAllowedRoot, loadMountAllowlist } from './mount-security.js';
import type { MountAllowlist, RegisteredGroup } from './types.js';

export interface HostWorkspaceCwdValidationOptions {
  allowlist?: MountAllowlist | null;
  fieldLabel?: string;
}

export type HostWorkspaceCwdValidationResult =
  | { cwd: string }
  | { error: string };

export interface HostWorkspaceDefaultMaterializationResult {
  group: RegisteredGroup;
  materialized: boolean;
}

export interface HostWorkspaceDefaultMaterializationError {
  error: string;
}

export function validateHostWorkspaceCwd(
  cwd: string,
  options: HostWorkspaceCwdValidationOptions = {},
): HostWorkspaceCwdValidationResult {
  const fieldLabel = options.fieldLabel ?? 'custom_cwd';

  if (!path.isAbsolute(cwd)) {
    return { error: `${fieldLabel} must be an absolute path` };
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(cwd);
  } catch {
    return { error: `${fieldLabel} directory does not exist` };
  }

  if (!stat.isDirectory()) {
    return { error: `${fieldLabel} must be an existing directory` };
  }

  const normalizedCwd = fs.realpathSync(cwd);
  const allowlist =
    options.allowlist !== undefined ? options.allowlist : loadMountAllowlist();
  if (allowlist?.allowedRoots?.length) {
    const allowedRoot = findAllowedRoot(normalizedCwd, allowlist.allowedRoots);
    if (!allowedRoot) {
      const allowedPaths = allowlist.allowedRoots
        .map((root) => root.path)
        .join(', ');
      return {
        error: `${fieldLabel} must be under an allowed root. Allowed roots: ${allowedPaths}. Check config/mount-allowlist.json`,
      };
    }
  }

  return { cwd: normalizedCwd };
}

export function materializeHostWorkspaceDefaultCwd(
  group: RegisteredGroup,
  launchCwdOrOptions:
    | string
    | {
        launchCwd?: string;
        allowlist?: MountAllowlist | null;
        fieldLabel?: string;
      } = {},
  maybeOptions: {
    allowlist?: MountAllowlist | null;
    fieldLabel?: string;
  } = {},
):
  | HostWorkspaceDefaultMaterializationResult
  | HostWorkspaceDefaultMaterializationError {
  const options =
    typeof launchCwdOrOptions === 'string'
      ? {
          ...maybeOptions,
          launchCwd: launchCwdOrOptions,
        }
      : launchCwdOrOptions;

  if ((group.executionMode ?? 'container') !== 'host') {
    return { group, materialized: false };
  }

  if (group.customCwd) {
    const validation = validateHostWorkspaceCwd(group.customCwd, {
      allowlist: options.allowlist,
      fieldLabel: options.fieldLabel ?? 'custom_cwd',
    });
    if ('error' in validation) {
      return validation;
    }
    return {
      group: {
        ...group,
        customCwd: validation.cwd,
      },
      materialized: false,
    };
  }

  const launchCwd = options.launchCwd ?? LAUNCH_CWD;
  const validation = validateHostWorkspaceCwd(launchCwd, {
    allowlist: options.allowlist,
    fieldLabel: options.fieldLabel ?? 'launch cwd',
  });
  if ('error' in validation) {
    return validation;
  }

  return {
    group: {
      ...group,
      customCwd: validation.cwd,
    },
    materialized: true,
  };
}

export function resolveEffectiveHostWorkspaceCwd(
  group: RegisteredGroup,
  homeGroup?: RegisteredGroup | null,
): string | undefined {
  const effectiveExecutionMode = group.is_home
    ? group.executionMode
    : (homeGroup?.executionMode ?? group.executionMode);

  if ((effectiveExecutionMode ?? 'container') !== 'host') {
    return undefined;
  }

  return homeGroup?.customCwd || group.customCwd;
}
