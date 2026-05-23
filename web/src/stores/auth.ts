import { create } from 'zustand';
import { api } from '../api/client';

export interface InstanceProfile {
  id: string;
  username: string;
  display_name: string;
  avatar_emoji: string | null;
  avatar_color: string | null;
  avatar_url: string | null;
  ai_name: string | null;
  ai_avatar_emoji: string | null;
  ai_avatar_color: string | null;
  ai_avatar_url: string | null;
}

export interface AppearanceConfig {
  appName: string;
  aiName: string;
  aiAvatarEmoji: string;
  aiAvatarColor: string;
}

export interface SetupStatus {
  needsSetup: boolean;
  codexConfigured: boolean;
  feishuConfigured: boolean;
}

interface AuthState {
  authenticated: boolean;
  user: InstanceProfile | null;
  setupStatus: SetupStatus | null;
  appearance: AppearanceConfig | null;
  initialized: boolean | null;
  checking: boolean;
  login: (password: string) => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
  checkStatus: () => Promise<void>;
  setupPassword: (password: string) => Promise<void>;
  changePassword: (
    currentPassword: string,
    newPassword: string,
  ) => Promise<void>;
  fetchAppearance: () => Promise<void>;
}

let checkAuthInFlight: Promise<void> | null = null;

function buildInstanceProfile(): InstanceProfile {
  return {
    id: 'web',
    username: 'instance',
    display_name: '实例',
    avatar_emoji: null,
    avatar_color: null,
    avatar_url: null,
    ai_name: null,
    ai_avatar_emoji: null,
    ai_avatar_color: null,
    ai_avatar_url: null,
  };
}

function applyAuthPayload(
  set: (partial: Partial<AuthState>) => void,
  data: { setupStatus?: SetupStatus; appearance?: AppearanceConfig },
): void {
  set({
    authenticated: true,
    user: buildInstanceProfile(),
    setupStatus: data.setupStatus ?? null,
    appearance: data.appearance ?? null,
    initialized: true,
    checking: false,
  });
}

export const useAuthStore = create<AuthState>((set, get) => ({
  authenticated: false,
  user: null,
  setupStatus: null,
  appearance: null,
  initialized: null,
  checking: true,

  login: async (password: string) => {
    const data = await api.post<{
      success: boolean;
      setupStatus?: SetupStatus;
      appearance?: AppearanceConfig;
    }>('/api/auth/login', { password });
    applyAuthPayload(set, data);
  },

  logout: async () => {
    await api.post('/api/auth/logout');
    set({
      authenticated: false,
      user: null,
      setupStatus: null,
      appearance: null,
      initialized: true,
    });
  },

  checkStatus: async () => {
    try {
      const data = await api.get<{ initialized: boolean }>('/api/auth/status');
      set({ initialized: data.initialized });
    } catch {
      set({ initialized: true });
    }
  },

  setupPassword: async (password: string) => {
    const data = await api.post<{
      success: boolean;
      setupStatus?: SetupStatus;
      appearance?: AppearanceConfig;
    }>('/api/auth/setup', { password });
    applyAuthPayload(set, data);
  },

  checkAuth: async () => {
    if (checkAuthInFlight) return checkAuthInFlight;

    checkAuthInFlight = (async () => {
      set({ checking: true });
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const data = await api.get<{
            authenticated: boolean;
            setupStatus?: SetupStatus;
            appearance?: AppearanceConfig;
          }>('/api/auth/me');
          if (data.authenticated) {
            applyAuthPayload(set, data);
            return;
          }
        } catch (err) {
          const status =
            typeof err === 'object' && err !== null && 'status' in err
              ? Number((err as { status?: unknown }).status)
              : NaN;
          const retryable = status === 0 || status === 408;
          if (retryable && attempt < 2) {
            await new Promise((resolve) => setTimeout(resolve, 1200));
            continue;
          }
        }
        await get().checkStatus();
        set({
          authenticated: false,
          user: null,
          setupStatus: null,
          checking: false,
        });
        return;
      }
    })().finally(() => {
      checkAuthInFlight = null;
    });

    return checkAuthInFlight;
  },

  changePassword: async (currentPassword: string, newPassword: string) => {
    await api.put('/api/auth/password', {
      current_password: currentPassword,
      new_password: newPassword,
    });
  },

  fetchAppearance: async () => {
    try {
      const data = await api.get<AppearanceConfig>(
        '/api/config/appearance/public',
      );
      set({ appearance: data });
    } catch {
      // keep current appearance
    }
  },
}));
