import { create } from 'zustand';
import { api } from '../api/client';
import type { GroupInfo } from '../types';

export type { GroupInfo };

interface GroupsState {
  groups: Record<string, GroupInfo>;
  loading: boolean;
  error: string | null;
  runnerStates: Record<string, 'idle' | 'running'>;
  loadGroups: () => Promise<void>;
  setRunnerState: (chatJid: string, state: 'idle' | 'running') => void;
}

export const useGroupsStore = create<GroupsState>((set) => ({
  groups: {},
  loading: false,
  error: null,
  runnerStates: {},

  loadGroups: async () => {
    set({ loading: true });
    try {
      const data = await api.get<{ groups: Record<string, GroupInfo> }>('/api/groups');
      set({ groups: data.groups, loading: false, error: null });
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : String(err) });
    }
  },

  setRunnerState: (chatJid: string, state: 'idle' | 'running') => {
    set((s) => {
      if (state === 'idle') {
        const { [chatJid]: _, ...rest } = s.runnerStates;
        return { runnerStates: rest };
      }
      return { runnerStates: { ...s.runnerStates, [chatJid]: state } };
    });
  },
}));
