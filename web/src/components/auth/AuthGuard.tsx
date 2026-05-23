import { useEffect, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { useAuthStore } from '../../stores/auth';
import { LogoLoading } from '../common/LogoLoading';

interface AuthGuardProps {
  children: React.ReactNode;
}

export function AuthGuard({ children }: AuthGuardProps) {
  const { authenticated, checking, checkAuth, initialized } = useAuthStore();
  const location = useLocation();
  const navigate = useNavigate();
  const checkedRef = useRef(false);
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    if (checkedRef.current) return;
    checkedRef.current = true;
    void checkAuth();
  }, [checkAuth]);

  useEffect(() => {
    if (!checking) {
      setTimedOut(false);
      return;
    }
    const timer = window.setTimeout(() => setTimedOut(true), 12000);
    return () => window.clearTimeout(timer);
  }, [checking]);

  if (checking) {
    if (timedOut) {
      return (
        <div className="min-h-screen bg-background flex items-center justify-center p-6">
          <Card className="max-w-md text-center">
            <CardContent>
              <h2 className="text-lg font-semibold text-foreground mb-2">
                页面初始化超时
              </h2>
              <p className="text-sm text-muted-foreground mb-4">
                后端可能刚启动或浏览器缓存异常，请先刷新页面；若仍失败，重新登录。
              </p>
              <div className="flex items-center justify-center gap-3">
                <button
                  onClick={() => window.location.reload()}
                  className="px-4 py-2 text-sm rounded-lg bg-primary text-white hover:bg-primary/90"
                >
                  刷新页面
                </button>
                <button
                  onClick={() => navigate('/login', { replace: true })}
                  className="px-4 py-2 text-sm rounded-lg border border-border text-foreground hover:bg-muted"
                >
                  去登录页
                </button>
              </div>
            </CardContent>
          </Card>
        </div>
      );
    }
    return <LogoLoading full />;
  }

  if (initialized === false) return <Navigate to="/setup" replace />;
  if (!authenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}
