// ─── 通用类型 ────────────────────────────────────────────────

export interface EnvRow {
  key: string;
  value: string;
}

export interface SessionInfo {
  id: string;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
  last_active_at: string;
  is_current: boolean;
}

export interface SystemSettings {
  processTimeout: number;
  idleTimeout: number;
  processMaxOutputSize: number;
  maxConcurrentProcesses: number;
  maxLoginAttempts: number;
  loginLockoutMinutes: number;
  maxConcurrentScripts: number;
  scriptTimeout: number;
  billingEnabled: boolean;
  billingMode: 'wallet_first';
  billingMinStartBalanceUsd: number;
  billingCurrency: string;
  billingCurrencyRate: number;
}

export type SettingsTab =
  | 'registration'
  | 'appearance'
  | 'system'
  | 'profile'
  | 'my-channels'
  | 'security'
  | 'groups'
  | 'mcp-servers'
  | 'agent-definitions'
  | 'users'
  | 'about'
  | 'bindings'
  | 'usage'
  | 'monitor';

export function getErrorMessage(err: unknown, fallback: string): string {
  if (typeof err === 'object' && err !== null && 'message' in err) {
    const msg = (err as { message?: unknown }).message;
    if (typeof msg === 'string' && msg.trim()) return msg;
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}
