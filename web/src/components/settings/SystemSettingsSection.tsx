import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Label } from '@/components/ui/label';
import { api } from '../../api/client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import type { SystemSettings } from './types';
import { getErrorMessage } from './types';

interface FieldConfig {
  key: keyof SystemSettings;
  label: string;
  description: string;
  unit: string;
  /** Convert stored value to display value */
  toDisplay: (v: number) => number;
  /** Convert display value to stored value */
  toStored: (v: number) => number;
  min: number;
  max: number;
  step: number;
}

const fields: FieldConfig[] = [
  {
    key: 'processTimeout',
    label: '进程最大运行时间',
    description: '单个 Agent 进程的最长运行时间',
    unit: '分钟',
    toDisplay: (v) => Math.round(v / 60000),
    toStored: (v) => v * 60000,
    min: 1,
    max: 1440,
    step: 1,
  },
  {
    key: 'idleTimeout',
    label: '进程空闲超时',
    description: '最后一次输出后无新消息则关闭进程',
    unit: '分钟',
    toDisplay: (v) => Math.round(v / 60000),
    toStored: (v) => v * 60000,
    min: 1,
    max: 1440,
    step: 1,
  },
  {
    key: 'processMaxOutputSize',
    label: '单次输出上限',
    description: '单次 Agent 进程的最大输出大小',
    unit: 'MB',
    toDisplay: (v) => Math.round(v / 1048576),
    toStored: (v) => v * 1048576,
    min: 1,
    max: 100,
    step: 1,
  },
  {
    key: 'maxConcurrentProcesses',
    label: '最大并发进程数',
    description: '同时运行的 Agent 进程数量上限',
    unit: '个',
    toDisplay: (v) => v,
    toStored: (v) => v,
    min: 1,
    max: 50,
    step: 1,
  },
  {
    key: 'maxLoginAttempts',
    label: '登录失败锁定次数',
    description: '连续失败该次数后锁定实例登录',
    unit: '次',
    toDisplay: (v) => v,
    toStored: (v) => v,
    min: 1,
    max: 100,
    step: 1,
  },
  {
    key: 'loginLockoutMinutes',
    label: '锁定时间',
    description: '账户被锁定后的等待时间',
    unit: '分钟',
    toDisplay: (v) => v,
    toStored: (v) => v,
    min: 1,
    max: 1440,
    step: 1,
  },
];

export function SystemSettingsSection() {
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [displayValues, setDisplayValues] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const data = await api.get<SystemSettings>('/api/config/system');
        setSettings(data);
        const display: Record<string, number> = {};
        for (const f of fields) {
          display[f.key] = f.toDisplay(data[f.key] as number);
        }
        setDisplayValues(display);
      } catch (err) {
        toast.error(getErrorMessage(err, '加载系统参数失败'));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload: Partial<SystemSettings> = {};
      for (const f of fields) {
        const val = displayValues[f.key];
        if (val !== undefined) {
          (payload as Record<string, number>)[f.key] = f.toStored(val);
        }
      }
      const data = await api.put<SystemSettings>('/api/config/system', payload);
      setSettings(data);
      const display: Record<string, number> = {};
      for (const f of fields) {
        display[f.key] = f.toDisplay(data[f.key] as number);
      }
      setDisplayValues(display);
      toast.success('系统参数已保存，新参数将对后续启动的进程生效');
    } catch (err) {
      toast.error(getErrorMessage(err, '保存系统参数失败'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!settings) return null;

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        调整 Agent 进程运行参数和安全限制。修改后无需重启，新参数对后续创建的进程立即生效。
      </p>

      <div className="space-y-5">
        {fields.map((f) => (
          <div key={f.key}>
            <Label className="mb-1">
              {f.label}
            </Label>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                value={displayValues[f.key] ?? ''}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  setDisplayValues((prev) => ({
                    ...prev,
                    [f.key]: Number.isFinite(val) ? val : 0,
                  }));
                }}
                min={f.min}
                max={f.max}
                step={f.step}
                className="max-w-32"
              />
              <span className="text-sm text-muted-foreground">{f.unit}</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {f.description}（范围：{f.min} - {f.max} {f.unit}）
            </p>
          </div>
        ))}
      </div>

      <div>
        <Button onClick={handleSave} disabled={saving}>
          {saving && <Loader2 className="size-4 animate-spin" />}
          保存系统参数
        </Button>
      </div>
    </div>
  );
}
