/**
 * Workspace-level MCP Servers store.
 * Manages project-level runtime configs under the workspace config directory.
 */
import { create } from 'zustand';
import { api } from '../api/client';
import { extractErrorMessage } from '../utils/error';

// --- MCP Servers ---

export interface WorkspaceMcpServer {
  id: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  type?: 'http' | 'sse';
  url?: string;
  headers?: Record<string, string>;
  enabled: boolean;
  description?: string;
  addedAt: string;
}

// --- Store ---

interface WorkspaceConfigState {
  // MCP Servers
  mcpServers: WorkspaceMcpServer[];
  mcpLoading: boolean;
  mcpError: string | null;

  loadWorkspaceMcp: (jid: string) => Promise<void>;
  addWorkspaceMcp: (jid: string, server: {
    id: string;
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    type?: 'http' | 'sse';
    url?: string;
    headers?: Record<string, string>;
    description?: string;
  }) => Promise<void>;
  updateWorkspaceMcp: (jid: string, id: string, updates: Partial<WorkspaceMcpServer>) => Promise<void>;
  toggleWorkspaceMcp: (jid: string, id: string, enabled: boolean) => Promise<void>;
  deleteWorkspaceMcp: (jid: string, id: string) => Promise<void>;
}

function groupBase(jid: string): string {
  return `/api/groups/${encodeURIComponent(jid)}/workspace-config`;
}

export const useWorkspaceConfigStore = create<WorkspaceConfigState>((set, get) => ({
  // --- MCP Servers state ---
  mcpServers: [],
  mcpLoading: false,
  mcpError: null,

  loadWorkspaceMcp: async (jid) => {
    set({ mcpServers: [], mcpLoading: true, mcpError: null });
    try {
      const data = await api.get<{ servers: WorkspaceMcpServer[] }>(`${groupBase(jid)}/mcp-servers`);
      set({ mcpServers: data.servers, mcpLoading: false, mcpError: null });
    } catch (err) {
      set({ mcpLoading: false, mcpError: extractErrorMessage(err) });
    }
  },

  addWorkspaceMcp: async (jid, server) => {
    try {
      await api.post(`${groupBase(jid)}/mcp-servers`, server);
      set({ mcpError: null });
      await get().loadWorkspaceMcp(jid);
    } catch (err) {
      set({ mcpError: extractErrorMessage(err) });
      throw err;
    }
  },

  updateWorkspaceMcp: async (jid, id, updates) => {
    try {
      await api.patch(`${groupBase(jid)}/mcp-servers/${encodeURIComponent(id)}`, updates);
      set({ mcpError: null });
      await get().loadWorkspaceMcp(jid);
    } catch (err) {
      set({ mcpError: extractErrorMessage(err) });
      throw err;
    }
  },

  toggleWorkspaceMcp: async (jid, id, enabled) => {
    try {
      await api.patch(`${groupBase(jid)}/mcp-servers/${encodeURIComponent(id)}`, { enabled });
      set({ mcpError: null });
      await get().loadWorkspaceMcp(jid);
    } catch (err) {
      set({ mcpError: extractErrorMessage(err) });
    }
  },

  deleteWorkspaceMcp: async (jid, id) => {
    try {
      await api.delete(`${groupBase(jid)}/mcp-servers/${encodeURIComponent(id)}`);
      set({ mcpError: null });
      await get().loadWorkspaceMcp(jid);
    } catch (err) {
      set({ mcpError: extractErrorMessage(err) });
      throw err;
    }
  },
}));
