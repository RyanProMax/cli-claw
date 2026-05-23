import { useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { INTERVAL_UNITS, CHANNEL_OPTIONS, toggleNotifyChannel } from '../../utils/task-utils';
import { useConnectedChannels } from '../../hooks/useConnectedChannels';

interface CreateTaskFormProps {
  onSubmit: (data: {
    workflowId: string;
    prompt: string;
    scheduleType: 'cron' | 'interval' | 'once';
    scheduleValue: string;
    notifyChannels: string[] | null;
  }) => Promise<void>;
  onClose: () => void;
}

export function CreateTaskForm({ onSubmit, onClose }: CreateTaskFormProps) {
  const [workflowId, setWorkflowId] = useState('');
  const [prompt, setPrompt] = useState('');
  const [scheduleType, setScheduleType] = useState<'cron' | 'interval' | 'once'>('cron');
  const [scheduleValue, setScheduleValue] = useState('');
  const [intervalNumber, setIntervalNumber] = useState('');
  const [intervalUnit, setIntervalUnit] = useState('60000');
  const [onceDateTime, setOnceDateTime] = useState('');
  const [notifyChannels, setNotifyChannels] = useState<string[] | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const connectedChannels = useConnectedChannels();
  const connectedKeys = CHANNEL_OPTIONS.filter((c) => connectedChannels[c.key]).map((c) => c.key);

  const isChannelSelected = (key: string) =>
    notifyChannels === null || notifyChannels.includes(key);

  const toggleChannel = (key: string) => {
    setNotifyChannels((prev) => toggleNotifyChannel(prev, key, connectedKeys));
  };

  const validateForm = () => {
    const next: Record<string, string> = {};
    if (!workflowId.trim()) next.workflowId = '请输入 Workflow ID';
    if (scheduleType === 'cron') {
      if (!scheduleValue.trim()) {
        next.scheduleValue = '请输入 Cron 表达式';
      } else if (
        !scheduleValue.trim().startsWith('@') &&
        scheduleValue.trim().split(/\s+/).length < 5
      ) {
        next.scheduleValue = 'Cron 表达式格式错误';
      }
    } else if (scheduleType === 'interval') {
      const num = parseInt(intervalNumber, 10);
      if (!Number.isFinite(num) || num <= 0) next.scheduleValue = '间隔必须是正整数';
    } else if (!onceDateTime || Date.parse(onceDateTime) <= Date.now()) {
      next.scheduleValue = '请选择未来时间';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) return;
    let finalScheduleValue = scheduleValue.trim();
    if (scheduleType === 'interval') {
      finalScheduleValue = String(parseInt(intervalNumber, 10) * parseInt(intervalUnit, 10));
    } else if (scheduleType === 'once') {
      finalScheduleValue = new Date(onceDateTime).toISOString();
    }
    setSubmitting(true);
    try {
      await onSubmit({
        workflowId: workflowId.trim(),
        prompt,
        scheduleType,
        scheduleValue: finalScheduleValue,
        notifyChannels,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const connectedOptions = CHANNEL_OPTIONS.filter((ch) => connectedChannels[ch.key]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-card rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-border">
          <h2 className="text-xl font-bold text-foreground">创建 Workflow 计划</h2>
          <button
            onClick={onClose}
            className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              Workflow ID <span className="text-red-500">*</span>
            </label>
            <Input
              value={workflowId}
              onChange={(e) => setWorkflowId(e.target.value)}
              className={cn(errors.workflowId && 'border-red-500')}
              placeholder="例如: hkipo"
            />
            {errors.workflowId && (
              <p className="mt-1 text-sm text-red-600 dark:text-red-400">
                {errors.workflowId}
              </p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              Prompt
            </label>
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
              className="resize-none"
              placeholder="传给 workflow 的输入说明，可留空"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              调度类型 <span className="text-red-500">*</span>
            </label>
            <Select
              value={scheduleType}
              onValueChange={(value) => {
                setIntervalNumber('');
                setOnceDateTime('');
                setScheduleValue('');
                setScheduleType(value as 'cron' | 'interval' | 'once');
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cron">Cron 表达式</SelectItem>
                <SelectItem value="interval">间隔执行</SelectItem>
                <SelectItem value="once">单次执行</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              调度值 <span className="text-red-500">*</span>
            </label>
            {scheduleType === 'cron' && (
              <>
                <Input
                  value={scheduleValue}
                  onChange={(e) => setScheduleValue(e.target.value)}
                  className={cn(errors.scheduleValue && 'border-red-500')}
                  placeholder="例如: 0 9 * * *"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  支持标准 Cron 和 @daily 等别名。
                </p>
              </>
            )}
            {scheduleType === 'interval' && (
              <div className="flex gap-2">
                <Input
                  type="number"
                  min="1"
                  value={intervalNumber}
                  onChange={(e) => setIntervalNumber(e.target.value)}
                  className={cn('flex-1', errors.scheduleValue && 'border-red-500')}
                  placeholder="数值"
                />
                <Select value={intervalUnit} onValueChange={setIntervalUnit}>
                  <SelectTrigger className="w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {INTERVAL_UNITS.map((u) => (
                      <SelectItem key={u.ms} value={String(u.ms)}>
                        {u.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {scheduleType === 'once' && (
              <Input
                type="datetime-local"
                value={onceDateTime}
                onChange={(e) => setOnceDateTime(e.target.value)}
                className={cn(errors.scheduleValue && 'border-red-500')}
              />
            )}
            {errors.scheduleValue && (
              <p className="mt-1 text-sm text-red-600 dark:text-red-400">
                {errors.scheduleValue}
              </p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              通知渠道
            </label>
            <div className="flex flex-wrap gap-3">
              <label className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                <input type="checkbox" checked disabled className="rounded" />
                Web（始终）
              </label>
              {connectedOptions.map((ch) => (
                <label key={ch.key} className="inline-flex items-center gap-1.5 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isChannelSelected(ch.key)}
                    onChange={() => toggleChannel(ch.key)}
                    className="rounded"
                  />
                  {ch.label}
                </label>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-border">
            <Button type="button" variant="outline" onClick={onClose}>
              取消
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2 className="size-4 animate-spin" />}
              {submitting ? '创建中...' : '创建计划'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
