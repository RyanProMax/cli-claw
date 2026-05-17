import { useState } from 'react';
import { AlertTriangle, Loader2, Settings2 } from 'lucide-react';
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
import { useChatStore } from '../../stores/chat';
import type { GroupRuntimeAgentType } from '../../types';

interface WorkspaceRuntimeDialogProps {
  open: boolean;
  jid: string;
  name: string;
  currentAgentType?: GroupRuntimeAgentType;
  onClose: () => void;
}

export function WorkspaceRuntimeDialog({
  open,
  jid,
  name,
  currentAgentType = 'openai',
  onClose,
}: WorkspaceRuntimeDialogProps) {
  const updateGroupRuntime = useChatStore((s) => s.updateGroupRuntime);
  const [loading, setLoading] = useState(false);

  const handleConfirm = async () => {
    setLoading(true);
    try {
      await updateGroupRuntime(jid, {
        agent_type: currentAgentType || 'openai',
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
            查看「{name}」的 Agent 基座配置。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">Agent 类型</label>
            <div className="rounded-lg border p-3">
              <div className="text-sm font-medium">Codex/OpenAI</div>
              <p className="text-xs text-muted-foreground mt-0.5">
                使用本地 Codex/OpenAI runner 进程，复用服务端登录态
              </p>
            </div>
          </div>

          <div className="flex items-start gap-2 p-2 bg-sky-50 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-800 rounded-lg">
            <AlertTriangle className="w-4 h-4 text-sky-500 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-sky-700 dark:text-sky-300">
              模型、推理强度和速度档位请通过 <code>/openai</code> 调整。
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={loading}>
            关闭
          </Button>
          <Button onClick={handleConfirm} disabled={loading}>
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
