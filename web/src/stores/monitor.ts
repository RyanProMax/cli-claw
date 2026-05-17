import { create } from 'zustand';
import { api } from '../api/client';

export interface SystemStatus {
  activeProcesses: number;
  activeTotal?: number;
  maxConcurrentProcesses?: number;
  queueLength: number;
  uptime: number;
  groups: Array<{
    jid: string;
    active: boolean;
    pendingMessages: boolean;
    pendingTasks: number;
    processName: string | null;
    displayName: string | null;
  }>;
}

interface MonitorState {
  status: SystemStatus | null;
  loading: boolean;
  error: string | null;
  loadStatus: () => Promise<void>;
}

export const useMonitorStore = create<MonitorState>((set) => ({
  status: null,
  loading: false,
  error: null,

  loadStatus: async () => {
    set({ loading: true });
    try {
      const status = await api.get<SystemStatus>('/api/status');
      set({
        status,
        loading: false,
        error: null,
      });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
}));
