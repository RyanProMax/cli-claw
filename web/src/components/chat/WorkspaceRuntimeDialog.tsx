import { useEffect, useState } from 'react';
import { AlertTriangle, Box, Loader2, Monitor, Settings2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '../../stores/auth';
import { useChatStore } from '../../stores/chat';
import {
  normalizeWorkspaceRuntimeSelection,
  type WorkspaceAgentType,
  type WorkspaceExecutionMode,
} from '../../lib/workspace-runtime';

interface WorkspaceRuntimeDialogProps {
  open: boolean;
  jid: string;
  name: string;
  isHome?: boolean;
  currentAgentType?: WorkspaceAgentType;
  currentExecutionMode?: WorkspaceExecutionMode;
  onClose: () => void;
}

export function WorkspaceRuntimeDialog({
  open,
  jid,
  name,
  isHome = false,
  currentAgentType = 'claude',
  currentExecutionMode = 'container',
  onClose,
}: WorkspaceRuntimeDialogProps) {
  const updateGroupRuntime = useChatStore((s) => s.updateGroupRuntime);
  const canHostExec = useAuthStore((s) => s.user?.role === 'admin');
  const [agentType, setAgentType] = useState<WorkspaceAgentType>(currentAgentType);
  const [executionMode, setExecutionMode] = useState<WorkspaceExecutionMode>(currentExecutionMode);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setAgentType(currentAgentType);
    setExecutionMode(currentExecutionMode);
  }, [open, currentAgentType, currentExecutionMode]);

  const normalized = normalizeWorkspaceRuntimeSelection({
    agentType,
    executionMode,
  });
  const executionModeLocked = isHome;

  const handleConfirm = async () => {
    setLoading(true);
    try {
      await updateGroupRuntime(jid, {
        agent_type: normalized.agentType,
        execution_mode: normalized.executionMode,
      });
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '更新运行时设置失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="w-4 h-4" />
            运行时设置
          </DialogTitle>
          <DialogDescription>
            调整「{name}」的 Agent 基座与执行模式。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">Agent 类型</label>
            <div className="space-y-2">
              <label className="flex items-start gap-3 p-3 rounded-lg border cursor-pointer hover:bg-accent/50 transition-colors">
                <input
                  type="radio"
                  name="runtime_agent_type"
                  value="claude"
                  checked={agentType === 'claude'}
                  onChange={() => setAgentType('claude')}
                  className="mt-0.5 accent-primary"
                />
                <div>
                  <div className="text-sm font-medium">Claude</div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    支持 Docker 与宿主机两种执行模式
                  </p>
                </div>
              </label>
              <label className={`flex items-start gap-3 p-3 rounded-lg border transition-colors ${canHostExec ? 'cursor-pointer hover:bg-accent/50' : 'opacity-50 cursor-not-allowed'}`}>
                <input
                  type="radio"
                  name="runtime_agent_type"
                  value="codex"
                  checked={agentType === 'codex'}
                  onChange={() => {
                    if (!canHostExec) return;
                    setAgentType('codex');
                    setExecutionMode('host');
                  }}
                  disabled={!canHostExec}
                  className="mt-0.5 accent-primary"
                />
                <div>
                  <div className="text-sm font-medium">Codex</div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {canHostExec ? '仅支持宿主机模式，并复用服务器上的 codex 登录态' : '仅管理员可用，且仅支持宿主机模式'}
                  </p>
                </div>
              </label>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">执行模式</label>
            <div className="space-y-2">
              <label className={`flex items-start gap-3 p-3 rounded-lg border transition-colors ${executionModeLocked || agentType === 'codex' ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-accent/50'}`}>
                <input
                  type="radio"
                  name="runtime_execution_mode"
                  value="container"
                  checked={normalized.executionMode === 'container'}
                  onChange={() => setExecutionMode('container')}
                  disabled={executionModeLocked || agentType === 'codex'}
                  className="mt-0.5 accent-primary"
                />
                <div>
                  <div className="flex items-center gap-1.5">
                    <Box className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm font-medium">Docker 模式</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {executionModeLocked ? '主工作区执行模式由系统按用户角色固定' : '在隔离容器中运行'}
                  </p>
                </div>
              </label>
              <label className={`flex items-start gap-3 p-3 rounded-lg border transition-colors ${executionModeLocked || !canHostExec ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-accent/50'}`}>
                <input
                  type="radio"
                  name="runtime_execution_mode"
                  value="host"
                  checked={normalized.executionMode === 'host'}
                  onChange={() => {
                    if (executionModeLocked || !canHostExec) return;
                    setExecutionMode('host');
                  }}
                  disabled={executionModeLocked || !canHostExec}
                  className="mt-0.5 accent-primary"
                />
                <div>
                  <div className="flex items-center gap-1.5">
                    <Monitor className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm font-medium">宿主机模式</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {executionModeLocked
                      ? '主工作区执行模式由系统按用户角色固定'
                      : canHostExec
                        ? '直接在服务器上执行'
                        : '需要管理员权限'}
                  </p>
                </div>
              </label>
            </div>
          </div>

          {isHome && (
            <div className="flex items-start gap-2 p-2 bg-muted/60 border border-border rounded-lg">
              <AlertTriangle className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-0.5" />
              <p className="text-xs text-muted-foreground">
                主工作区允许切换 Agent 基座，但执行模式由系统按用户角色固定。
              </p>
            </div>
          )}

          {normalized.agentType === 'codex' && (
            <div className="flex items-start gap-2 p-2 bg-sky-50 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-800 rounded-lg">
              <AlertTriangle className="w-4 h-4 text-sky-500 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-sky-700 dark:text-sky-300">
                Codex 直接使用宿主机当前用户的全局 CLI 登录态。若未登录，请先在服务器执行 <code>codex login</code>。
              </p>
            </div>
          )}

          {normalized.executionMode === 'host' && (
            <div className="flex items-start gap-2 p-2 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg">
              <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-amber-700 dark:text-amber-300">
                宿主机模式下 Agent 可访问完整文件系统和工具链，请谨慎使用。
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={loading}>
            取消
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={
              loading ||
              (normalized.agentType === currentAgentType &&
                normalized.executionMode === currentExecutionMode)
            }
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
