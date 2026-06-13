import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuthStore } from '../stores/auth';
import { LogoLoading } from '../components/common/LogoLoading';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';

export function LoginPage() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const login = useAuthStore((state) => state.login);
  const initialized = useAuthStore((state) => state.initialized);
  const checkStatus = useAuthStore((state) => state.checkStatus);

  useEffect(() => {
    if (initialized === null) {
      checkStatus();
    } else if (initialized === false) {
      navigate('/setup', { replace: true });
    }
  }, [initialized, checkStatus, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await login(password);
      navigate('/chat');
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : typeof err === 'object' && err !== null && 'message' in err
            ? String((err as { message: unknown }).message)
            : '登录失败',
      );
    } finally {
      setLoading(false);
    }
  };

  if (initialized !== true) return <LogoLoading full />;

  return (
    <div className="h-screen bg-background overflow-y-auto flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <Card>
          <CardContent>
            <div className="flex justify-center mb-6">
              <div className="w-16 h-16 rounded-2xl overflow-hidden mx-auto">
                <img
                  src={`${import.meta.env.BASE_URL}icons/icon-192.png`}
                  alt="agent-fabric"
                  className="w-full h-full object-cover"
                />
              </div>
            </div>

            <h1 className="text-2xl font-bold text-foreground text-center mb-2">
              agent-fabric
            </h1>
            <p className="text-muted-foreground text-center mb-6">
              输入实例访问密码
            </p>

            {error && (
              <div className="mb-4 p-3 bg-error-bg border border-error/30 rounded-md">
                <p className="text-sm text-error">{error}</p>
              </div>
            )}

            <form onSubmit={handleSubmit}>
              <div className="mb-6">
                <Label htmlFor="password" className="mb-1">
                  访问密码
                </Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoFocus
                />
              </div>

              <Button type="submit" disabled={loading} className="w-full">
                {loading && <Loader2 className="size-4 animate-spin" />}
                {loading ? '登录中...' : '登录'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
