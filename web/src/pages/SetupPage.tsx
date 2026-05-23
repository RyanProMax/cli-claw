import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { LogoLoading } from '../components/common/LogoLoading';
import { useAuthStore } from '../stores/auth';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';

function getErrorMessage(err: unknown, fallback: string): string {
  if (typeof err === 'object' && err !== null && 'message' in err) {
    const msg = (err as { message?: unknown }).message;
    if (typeof msg === 'string' && msg.trim()) return msg;
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

export function SetupPage() {
  const navigate = useNavigate();
  const { initialized, authenticated, setupPassword, checkStatus } =
    useAuthStore();
  const [password, setPassword] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialized === null) checkStatus();
  }, [initialized, checkStatus]);

  useEffect(() => {
    if (initialized === true && !authenticated) {
      navigate('/login', { replace: true });
    }
  }, [initialized, authenticated, navigate]);

  if (initialized === true && authenticated) {
    return <Navigate to="/chat" replace />;
  }

  if (initialized !== false) return <LogoLoading full />;

  const handleSubmit = async () => {
    if (!password) {
      setError('请填写访问密码');
      return;
    }
    if (password.length < 8) {
      setError('密码至少 8 位');
      return;
    }
    if (password !== confirmPwd) {
      setError('两次输入的密码不一致');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await setupPassword(password);
      navigate('/chat', { replace: true });
    } catch (err) {
      setError(getErrorMessage(err, '设置访问密码失败'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="h-screen bg-background overflow-y-auto p-4 flex flex-col items-center justify-center">
      <div className="w-full max-w-lg">
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <div className="w-16 h-16 rounded-2xl overflow-hidden">
              <img
                src={`${import.meta.env.BASE_URL}icons/icon-192.png`}
                alt="cli-claw"
                className="w-full h-full object-cover"
              />
            </div>
          </div>
          <h1 className="text-2xl font-bold text-foreground mb-1">
            cli-claw 初始设置
          </h1>
          <p className="text-sm text-muted-foreground">
            为当前自托管实例设置一个访问密码
          </p>
        </div>

        <Card className="shadow-sm">
          <CardContent>
            <div className="space-y-4">
              {error && (
                <div className="p-3 rounded-lg bg-error-bg border border-error/30 text-error text-sm">
                  {error}
                </div>
              )}
              <div>
                <Label className="mb-1">访问密码</Label>
                <div className="relative">
                  <Input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pr-10"
                    placeholder="至少 8 位"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showPassword ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>
              <div>
                <Label className="mb-1">确认密码</Label>
                <div className="relative">
                  <Input
                    type={showConfirm ? 'text' : 'password'}
                    value={confirmPwd}
                    onChange={(e) => setConfirmPwd(e.target.value)}
                    className="pr-10"
                    placeholder="再次输入密码"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirm(!showConfirm)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showConfirm ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>
              <Button onClick={handleSubmit} disabled={saving} className="w-full">
                {saving && <Loader2 className="size-4 animate-spin" />}
                {saving ? '保存中...' : '保存并进入'}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
