import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { useAuthStore } from '../../stores/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getErrorMessage } from './types';

export function SecuritySection() {
  const { logout, changePassword } = useAuthStore();
  const [currentPwd, setCurrentPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [saving, setSaving] = useState(false);

  const handleChangePassword = async () => {
    if (!currentPwd || !newPwd) {
      toast.error('请填写当前密码和新密码');
      return;
    }
    if (newPwd.length < 8) {
      toast.error('新密码至少 8 位');
      return;
    }
    if (newPwd !== confirmPwd) {
      toast.error('两次输入的新密码不一致');
      return;
    }
    setSaving(true);
    try {
      await changePassword(currentPwd, newPwd);
      setCurrentPwd('');
      setNewPwd('');
      setConfirmPwd('');
      toast.success('访问密码已修改');
    } catch (err) {
      toast.error(getErrorMessage(err, '修改访问密码失败'));
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = () => {
    if (confirm('确定要退出登录吗？')) logout();
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold text-foreground mb-4">
          修改访问密码
        </h3>
        <div className="space-y-3">
          <div>
            <Label className="mb-1">当前密码</Label>
            <Input
              type="password"
              value={currentPwd}
              onChange={(e) => setCurrentPwd(e.target.value)}
            />
          </div>
          <div>
            <Label className="mb-1">新密码</Label>
            <Input
              type="password"
              value={newPwd}
              onChange={(e) => setNewPwd(e.target.value)}
              placeholder="至少 8 位"
            />
          </div>
          <div>
            <Label className="mb-1">确认新密码</Label>
            <Input
              type="password"
              value={confirmPwd}
              onChange={(e) => setConfirmPwd(e.target.value)}
            />
          </div>
          <Button onClick={handleChangePassword} disabled={saving}>
            {saving && <Loader2 className="size-4 animate-spin" />}
            保存新密码
          </Button>
        </div>
      </div>

      <div className="border-t border-border" />

      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-medium text-foreground">退出登录</div>
          <div className="text-xs text-muted-foreground mt-0.5">
            退出当前浏览器会话，返回登录页面
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="px-4 py-2 text-error hover:bg-error-bg rounded-lg border border-error transition-colors font-medium cursor-pointer"
        >
          退出登录
        </button>
      </div>
    </div>
  );
}
