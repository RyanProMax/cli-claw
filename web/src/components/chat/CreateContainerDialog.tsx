import { useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  Monitor,
  Box,
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DirectoryBrowser } from '../shared/DirectoryBrowser';
import { useChatStore } from '../../stores/chat';
import { useAuthStore } from '../../stores/auth';
import { normalizeWorkspaceRuntimeSelection } from '../../lib/workspace-runtime';

interface CreateContainerDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: (jid: string, folder: string) => void;
}

export function CreateContainerDialog({
  open,
  onClose,
  onCreated,
}: CreateContainerDialogProps) {
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [executionMode, setExecutionMode] = useState<'container' | 'host'>('container');
  const [customCwd, setCustomCwd] = useState('');

  const createFlow = useChatStore((s) => s.createFlow);
  const canHostExec = useAuthStore((s) => s.user?.role === 'admin');

  const reset = () => {
    setName('');
    setAdvancedOpen(false);
    setExecutionMode('container');
    setCustomCwd('');
  };

  const handleClose = () => {
    onClose();
    reset();
  };

  const handleConfirm = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;

    setLoading(true);
    try {
      const runtime = normalizeWorkspaceRuntimeSelection({
        agentType: 'openai',
        executionMode,
      });
      const options: Record<string, string> = {};
      options.agent_type = runtime.agentType;
      if (runtime.executionMode === 'host') {
        options.execution_mode = 'host';
        if (customCwd.trim()) options.custom_cwd = customCwd.trim();
      }
      const created = await createFlow(trimmed, Object.keys(options).length ? options : undefined);
      if (created) {
        onCreated(created.jid, created.folder);
        handleClose();
      } else {
        toast.error('创建失败，请重试');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '创建失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>新建工作区</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">工作区名称</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleConfirm(); }}
              placeholder="输入工作区名称"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Agent 类型</label>
            <div className="rounded-lg border p-3">
              <div className="text-sm font-medium">Codex/OpenAI</div>
              <p className="text-xs text-muted-foreground mt-0.5">
                支持 Docker 与宿主机两种执行模式，复用 Codex CLI 登录态
              </p>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">执行模式</label>
            <div className="space-y-2">
              <label className="flex items-start gap-3 p-3 rounded-lg border transition-colors cursor-pointer hover:bg-accent/50">
                <input
                  type="radio"
                  name="execution_mode"
                  value="container"
                  checked={executionMode === 'container'}
                  onChange={() => {
                    setExecutionMode('container');
                    setCustomCwd('');
                    setAdvancedOpen(false);
                  }}
                  className="mt-0.5 accent-primary"
                />
                <div>
                  <div className="flex items-center gap-1.5">
                    <Box className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm font-medium">Docker 模式</span>
                    <span className="text-xs text-primary font-medium">推荐</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">在隔离的 Docker 环境中执行</p>
                </div>
              </label>
              <label className={`flex items-start gap-3 p-3 rounded-lg border transition-colors ${canHostExec ? 'cursor-pointer hover:bg-accent/50' : 'opacity-50 cursor-not-allowed'}`}>
                <input
                  type="radio"
                  name="execution_mode"
                  value="host"
                  checked={executionMode === 'host'}
                  onChange={() => {
                    if (!canHostExec) return;
                    setExecutionMode('host');
                  }}
                  disabled={!canHostExec}
                  className="mt-0.5 accent-primary"
                />
                <div>
                  <div className="flex items-center gap-1.5">
                    <Monitor className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm font-medium">宿主机模式</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {canHostExec ? '直接在服务器上执行' : '需要管理员权限'}
                  </p>
                </div>
              </label>
            </div>
          </div>

          <div className="flex items-start gap-2 p-2 bg-sky-50 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-800 rounded-lg">
            <AlertTriangle className="w-4 h-4 text-sky-500 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-sky-700 dark:text-sky-300">
              Codex/OpenAI runtime 需要服务端已完成 <code>codex login</code>。
            </p>
          </div>

          {executionMode === 'host' && (
            <div className="flex items-start gap-2 p-2 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg">
              <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-amber-700 dark:text-amber-300">
                宿主机模式下 Agent 可访问完整文件系统和工具链，请谨慎使用。
              </p>
            </div>
          )}

          {executionMode === 'host' && (
            <div className="border rounded-lg overflow-hidden">
              <button
                type="button"
                onClick={() => setAdvancedOpen(!advancedOpen)}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground hover:bg-accent transition-colors cursor-pointer"
              >
                {advancedOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                高级选项
              </button>
              {advancedOpen && (
                <div className="px-3 pb-3 space-y-3 border-t">
                  <div className="pt-3">
                    <DirectoryBrowser value={customCwd} onChange={setCustomCwd} placeholder="默认: ~/.cli-claw/groups/{folder}/" />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={loading}>
            取消
          </Button>
          <Button onClick={handleConfirm} disabled={loading || !name.trim()}>
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            {loading ? '正在创建...' : '创建'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
