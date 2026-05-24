import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  Activity,
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDashed,
  Clock4,
  ListChecks,
  Loader2,
  Pencil,
  PlayCircle,
  RefreshCw,
  TimerReset,
  Trash2,
  Workflow as WorkflowIcon,
  X,
  XCircle,
} from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { EmptyState } from '@/components/common/EmptyState';
import { SkeletonStatCards } from '@/components/common/Skeletons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { formatInterval } from '@/utils/task-utils';
import { api } from '../api/client';
import {
  useWorkflowsStore,
  type WorkflowDashboardRun,
  type WorkflowDashboardRunStep,
  type WorkflowDashboardScheduledTask,
  type WorkflowDashboardStockStrategy,
  type WorkflowDashboardStockStrategyMarket,
  type WorkflowDashboardStockStrategyState,
  type WorkflowRunStatus,
  type WorkflowStepStatus,
} from '../stores/workflows';
import { extractErrorMessage } from '../utils/error';
import { showToast } from '../utils/toast';

function localDateValue(date = new Date()): string {
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 10);
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return '-';
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remSeconds = seconds % 60;
  if (minutes < 60)
    return remSeconds ? `${minutes}min${remSeconds}s` : `${minutes}min`;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  return remMinutes ? `${hours}h${remMinutes}min` : `${hours}h`;
}

function formatStepDuration(step: WorkflowDashboardRunStep): string {
  if (step.durationMs != null) return formatDuration(step.durationMs);
  if (step.status === 'running') return '进行中';
  if (step.status === 'pending') return '等待开始';
  if (step.status === 'skipped') return '已跳过';
  return '未记录耗时';
}

function formatStepStart(step: WorkflowDashboardRunStep): string {
  if (step.startedAt) return formatDateTime(step.startedAt);
  if (step.status === 'pending') return '未开始';
  if (step.status === 'skipped') return '未执行';
  return '无开始时间';
}

function scheduleLabel(task: WorkflowDashboardScheduledTask): string {
  if (task.scheduleType === 'cron') return task.scheduleValue;
  if (task.scheduleType === 'interval')
    return `每 ${formatInterval(task.scheduleValue)}`;
  return '单次';
}

function runStatusMeta(status: WorkflowRunStatus): {
  label: string;
  variant: 'secondary' | 'success' | 'error' | 'warning' | 'info' | 'neutral';
  Icon: typeof Activity;
} {
  switch (status) {
    case 'queued':
      return { label: '排队', variant: 'neutral', Icon: CircleDashed };
    case 'running':
      return { label: '运行中', variant: 'info', Icon: PlayCircle };
    case 'success':
      return { label: '成功', variant: 'success', Icon: CheckCircle2 };
    case 'error':
      return { label: '失败', variant: 'error', Icon: XCircle };
    case 'cancelled':
      return { label: '已取消', variant: 'warning', Icon: AlertCircle };
  }
}

function stepStatusClass(status: WorkflowStepStatus): string {
  switch (status) {
    case 'pending':
      return 'bg-muted-foreground/40';
    case 'running':
      return 'bg-primary animate-pulse';
    case 'success':
      return 'bg-success';
    case 'error':
      return 'bg-error';
    case 'skipped':
      return 'bg-warning';
  }
}

function taskStatusVariant(
  status: WorkflowDashboardScheduledTask['status'],
): 'success' | 'warning' | 'neutral' | 'info' {
  switch (status) {
    case 'active':
      return 'success';
    case 'paused':
      return 'warning';
    case 'parsing':
      return 'info';
    case 'completed':
      return 'neutral';
  }
}

function taskStatusLabel(
  status: WorkflowDashboardScheduledTask['status'],
): string {
  switch (status) {
    case 'active':
      return '活跃';
    case 'paused':
      return '暂停';
    case 'parsing':
      return '解析中';
    case 'completed':
      return '完成';
  }
}

function stockStateMeta(state: WorkflowDashboardStockStrategyState): {
  label: string;
  variant: 'success' | 'warning' | 'error' | 'info' | 'neutral';
  Icon: typeof Activity;
} {
  switch (state) {
    case 'discovering':
      return { label: '发现', variant: 'info', Icon: Activity };
    case 'validating':
      return { label: '验证', variant: 'info', Icon: ListChecks };
    case 'blocked':
      return { label: '阻塞', variant: 'warning', Icon: AlertCircle };
    case 'cooldown':
      return { label: '冷却', variant: 'neutral', Icon: TimerReset };
    case 'human_review_ready':
      return { label: '待人工', variant: 'warning', Icon: Clock4 };
    case 'approved':
      return { label: '已批准', variant: 'success', Icon: CheckCircle2 };
    case 'rejected':
      return { label: '已拒绝', variant: 'error', Icon: XCircle };
  }
}

function stockSourceLabel(
  source: WorkflowDashboardStockStrategyMarket['source'],
): string {
  switch (source) {
    case 'planner_decision':
      return 'planner';
    case 'local_artifact':
      return 'artifact';
    case 'scheduled_task':
      return 'schedule';
  }
}

function formatStockCadence(value: string | null | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) return '-';
  const numeric = Number(trimmed);
  if (Number.isFinite(numeric) && numeric > 0) return formatInterval(trimmed);
  return trimmed;
}

type WorkflowTaskPatch = {
  prompt: string;
  execution_type: 'workflow';
  script_command: string;
  schedule_type: WorkflowDashboardScheduledTask['scheduleType'];
  schedule_value: string;
  status: 'active' | 'paused';
};

type WorkflowTaskFormState = {
  prompt: string;
  workflowId: string;
  scheduleType: WorkflowDashboardScheduledTask['scheduleType'];
  scheduleValue: string;
  status: 'active' | 'paused';
};

type DeletableWorkflowTask = {
  id: string;
  prompt: string;
  running?: boolean;
};

function taskFormState(
  task: WorkflowDashboardScheduledTask,
): WorkflowTaskFormState {
  return {
    prompt: task.prompt,
    workflowId: task.workflowId,
    scheduleType: task.scheduleType,
    scheduleValue: task.scheduleValue,
    status: task.status === 'paused' ? 'paused' : 'active',
  };
}

function StatCard({
  title,
  value,
  hint,
  icon: Icon,
}: {
  title: string;
  value: string | number;
  hint: string;
  icon: typeof Activity;
}) {
  return (
    <Card size="sm" className="rounded-lg">
      <CardContent className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground">{title}</div>
          <div className="mt-1 text-2xl font-semibold text-foreground">
            {value}
          </div>
          <div className="mt-1 truncate text-xs text-muted-foreground">
            {hint}
          </div>
        </div>
        <div className="flex size-9 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <Icon className="size-4" />
        </div>
      </CardContent>
    </Card>
  );
}

function StockStrategyMarketBlock({
  market,
}: {
  market: WorkflowDashboardStockStrategyMarket;
}) {
  const meta = stockStateMeta(market.state);
  return (
    <div className="min-w-0 rounded-md border border-border bg-background px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-foreground">
              {market.market}
            </span>
            <Badge variant={meta.variant}>
              <meta.Icon className="size-3" />
              {meta.label}
            </Badge>
          </div>
          <div className="mt-1 truncate text-xs text-muted-foreground">
            {market.workflowId || '-'}
          </div>
        </div>
        {market.requiresHuman && <Badge variant="warning">人工</Badge>}
      </div>

      <div className="mt-3 grid gap-2 text-xs">
        <div className="min-w-0">
          <div className="text-muted-foreground">证据签名</div>
          <div className="truncate font-mono text-foreground">
            {market.evidenceSignature || '-'}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="min-w-0">
            <div className="text-muted-foreground">下游</div>
            <div className="truncate text-foreground">
              {market.nextWorkflow || '-'}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">节奏</div>
            <div className="text-foreground">
              {formatStockCadence(market.cadence)}
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-muted-foreground">
            {market.reason || '-'}
          </span>
          <span className="shrink-0 text-muted-foreground">
            {stockSourceLabel(market.source)}
          </span>
        </div>
      </div>
    </div>
  );
}

function StockStrategyPanel({
  stockStrategy,
}: {
  stockStrategy: WorkflowDashboardStockStrategy;
}) {
  const decision = stockStrategy.globalDecision;
  return (
    <Card className="rounded-lg">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
          <WorkflowIcon className="size-4 text-muted-foreground" />
          股票策略状态
          {decision && (
            <Badge variant={decision.requiresHuman ? 'warning' : 'neutral'}>
              {decision.action}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {decision && (
          <div className="grid gap-2 rounded-md bg-muted px-3 py-2 text-xs md:grid-cols-[1fr_auto_auto]">
            <div className="min-w-0 truncate text-foreground">
              {decision.reason || decision.workflowId}
            </div>
            <div className="text-muted-foreground">
              {formatStockCadence(decision.cadence)}
            </div>
            <div className="max-w-full truncate font-mono text-muted-foreground md:max-w-72">
              {decision.evidenceSignature || '-'}
            </div>
          </div>
        )}
        <div className="grid gap-3 lg:grid-cols-3">
          {stockStrategy.markets.map((market) => (
            <StockStrategyMarketBlock key={market.market} market={market} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function RunStatusBadge({ status }: { status: WorkflowRunStatus }) {
  const meta = runStatusMeta(status);
  return (
    <Badge variant={meta.variant}>
      <meta.Icon className="size-3" />
      {meta.label}
    </Badge>
  );
}

function StepSummary({ run }: { run: WorkflowDashboardRun }) {
  const { stepSummary } = run;
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <span>{stepSummary.total} steps</span>
      {stepSummary.running > 0 && (
        <span className="text-primary">{stepSummary.running} 运行</span>
      )}
      {stepSummary.error > 0 && (
        <span className="text-error">{stepSummary.error} 失败</span>
      )}
      {stepSummary.success > 0 && (
        <span className="text-success">{stepSummary.success} 成功</span>
      )}
      {stepSummary.pending > 0 && <span>{stepSummary.pending} 等待</span>}
      {stepSummary.skipped > 0 && (
        <span className="text-warning">{stepSummary.skipped} 跳过</span>
      )}
    </div>
  );
}

function RunningRunCard({
  run,
  onDeleteTask,
  deletingTaskId,
}: {
  run: WorkflowDashboardRun;
  onDeleteTask?: (task: DeletableWorkflowTask) => void;
  deletingTaskId?: string | null;
}) {
  const sourceTask = run.sourceTask;
  const deleting = !!sourceTask && deletingTaskId === sourceTask.id;
  return (
    <Card size="sm" className="rounded-lg">
      <CardContent className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-foreground">
              {run.workflowId}
            </div>
            <div className="mt-1 truncate text-xs text-muted-foreground">
              {run.sourceTask?.prompt || run.prompt}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <RunStatusBadge status={run.status} />
            {sourceTask && onDeleteTask && (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() =>
                  onDeleteTask({
                    id: sourceTask.id,
                    prompt: sourceTask.prompt,
                    running: true,
                  })
                }
                disabled={deleting}
                title="删除定时 workflow 任务"
                aria-label="删除定时 workflow 任务"
              >
                {deleting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Trash2 className="size-4" />
                )}
              </Button>
            )}
          </div>
        </div>
        {run.status === 'queued' && (
          <div className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
            已创建 run，正在等待 workflow 调度器接手；还没有进入实际执行。
          </div>
        )}
        <StepSummary run={run} />
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <div className="text-muted-foreground">开始</div>
            <div className="text-foreground">
              {formatDateTime(run.startedAt || run.createdAt)}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">已运行</div>
            <div className="text-foreground">
              {formatDuration(run.durationMs)}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ScheduledTaskRow({
  task,
  onEdit,
  onDelete,
  busyTaskId,
}: {
  task: WorkflowDashboardScheduledTask;
  onEdit: (task: WorkflowDashboardScheduledTask) => void;
  onDelete: (task: WorkflowDashboardScheduledTask) => void;
  busyTaskId: string | null;
}) {
  const busy = busyTaskId === task.id;
  return (
    <tr className="border-b border-border last:border-b-0">
      <td className="px-4 py-3">
        <div className="flex min-w-0 items-start gap-2">
          <span
            className={cn(
              'mt-1.5 size-2 shrink-0 rounded-full',
              task.running
                ? 'bg-primary animate-pulse'
                : 'bg-muted-foreground/40',
            )}
          />
          <div className="min-w-0">
            <div className="break-all text-sm font-medium leading-5 text-foreground">
              {task.workflowId}
            </div>
            <div className="mt-1 line-clamp-2 whitespace-normal break-words text-xs leading-5 text-muted-foreground">
              {task.prompt}
            </div>
          </div>
        </div>
      </td>
      <td className="px-4 py-3 text-sm text-foreground">
        {scheduleLabel(task)}
      </td>
      <td className="px-4 py-3 text-sm text-foreground">
        {formatDateTime(task.nextRun)}
      </td>
      <td className="px-4 py-3">
        <Badge variant={taskStatusVariant(task.status)}>
          {taskStatusLabel(task.status)}
        </Badge>
      </td>
      <td className="px-4 py-3 text-sm text-foreground">
        {task.todayRunCount} 次
        {task.todayErrorCount > 0 && (
          <span className="ml-2 text-error">{task.todayErrorCount} 失败</span>
        )}
      </td>
      <td className="px-4 py-3 text-sm text-muted-foreground">
        {formatDateTime(task.todayLastLogAt)}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center justify-end gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => onEdit(task)}
            disabled={busy}
            title="编辑定时 workflow"
            aria-label="编辑定时 workflow"
          >
            <Pencil className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => onDelete(task)}
            disabled={busy}
            title="删除定时 workflow"
            aria-label="删除定时 workflow"
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Trash2 className="size-4" />
            )}
          </Button>
        </div>
      </td>
    </tr>
  );
}

function RunSteps({ steps }: { steps: WorkflowDashboardRunStep[] }) {
  if (steps.length === 0) {
    return (
      <div className="px-4 pb-4 text-xs text-muted-foreground">
        暂无 step 记录
      </div>
    );
  }
  return (
    <div className="px-4 pb-4">
      <div className="overflow-hidden rounded-lg border border-border">
        {steps.map((step) => (
          <div
            key={step.id}
            className="grid grid-cols-[1fr_auto] items-center gap-3 border-b border-border px-3 py-2 text-xs last:border-b-0"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    'size-2 rounded-full',
                    stepStatusClass(step.status),
                  )}
                />
                <span className="truncate font-medium text-foreground">
                  {step.nodeId}
                </span>
              </div>
              <div className="mt-0.5 truncate text-muted-foreground">
                {step.roleId || `attempt ${step.attempt}`}
                {step.error ? ` · ${step.error}` : ''}
              </div>
            </div>
            <div className="text-right text-muted-foreground">
              <div className="whitespace-nowrap text-foreground">
                {formatStepDuration(step)}
              </div>
              <div className="mt-0.5 whitespace-nowrap">
                {formatStepStart(step)}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function RunRow({
  run,
  expanded,
  onToggle,
}: {
  run: WorkflowDashboardRun;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="border-b border-border last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        className="grid w-full grid-cols-[auto_1fr_auto] items-center gap-3 px-4 py-3 text-left hover:bg-muted/50"
      >
        {expanded ? (
          <ChevronDown className="size-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-4 text-muted-foreground" />
        )}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium text-foreground">
              {run.workflowId}
            </span>
            <RunStatusBadge status={run.status} />
            {run.sourceTask && <Badge variant="outline">定时任务</Badge>}
          </div>
          <div className="mt-1 truncate text-xs text-muted-foreground">
            {run.prompt}
          </div>
          <div className="mt-1">
            <StepSummary run={run} />
          </div>
        </div>
        <div className="hidden text-right text-xs text-muted-foreground sm:block">
          <div>{formatDateTime(run.createdAt)}</div>
          <div>{formatDuration(run.durationMs)}</div>
        </div>
      </button>
      {run.error && (
        <div className="mx-4 mb-3 rounded-md bg-error-bg px-3 py-2 text-xs text-error">
          {run.error}
        </div>
      )}
      {expanded && <RunSteps steps={run.steps} />}
    </div>
  );
}

function EditWorkflowTaskDialog({
  task,
  saving,
  onCancel,
  onSave,
}: {
  task: WorkflowDashboardScheduledTask;
  saving: boolean;
  onCancel: () => void;
  onSave: (id: string, patch: WorkflowTaskPatch) => Promise<void>;
}) {
  const [form, setForm] = useState<WorkflowTaskFormState>(() =>
    taskFormState(task),
  );

  useEffect(() => {
    setForm(taskFormState(task));
  }, [task]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const workflowId = form.workflowId.trim();
    const prompt = form.prompt.trim();
    const scheduleValue = form.scheduleValue.trim();
    if (!workflowId || !scheduleValue) {
      showToast('保存失败', 'Workflow ID 和调度值不能为空');
      return;
    }
    let normalizedScheduleValue = scheduleValue;
    if (form.scheduleType === 'once') {
      const onceDate = new Date(scheduleValue);
      if (Number.isNaN(onceDate.getTime())) {
        showToast('保存失败', '单次执行时间必须是有效时间');
        return;
      }
      normalizedScheduleValue = onceDate.toISOString();
    }
    await onSave(task.id, {
      prompt,
      execution_type: 'workflow',
      script_command: workflowId,
      schedule_type: form.scheduleType,
      schedule_value: normalizedScheduleValue,
      status: form.status,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <form
        onSubmit={submit}
        className="w-full max-w-xl overflow-hidden rounded-lg bg-card shadow-xl ring-1 ring-border"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">
              编辑定时 workflow
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              修改的是调度任务；不会改写 workflow 定义文件。
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onCancel}
            disabled={saving}
            aria-label="关闭"
          >
            <X className="size-4" />
          </Button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Workflow ID
            </label>
            <Input
              value={form.workflowId}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  workflowId: event.target.value,
                }))
              }
              placeholder="hkipo"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Prompt
            </label>
            <Textarea
              value={form.prompt}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  prompt: event.target.value,
                }))
              }
              className="min-h-24"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                调度类型
              </label>
              <Select
                value={form.scheduleType}
                onValueChange={(value) =>
                  setForm((current) => ({
                    ...current,
                    scheduleType:
                      value as WorkflowDashboardScheduledTask['scheduleType'],
                  }))
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cron">Cron</SelectItem>
                  <SelectItem value="interval">Interval</SelectItem>
                  <SelectItem value="once">Once</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                调度值
              </label>
              <Input
                value={form.scheduleValue}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    scheduleValue: event.target.value,
                  }))
                }
                placeholder={
                  form.scheduleType === 'interval'
                    ? '毫秒，例如 1800000'
                    : form.scheduleType === 'cron'
                      ? 'Cron 表达式'
                      : 'ISO 时间'
                }
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              状态
            </label>
            <Select
              value={form.status}
              onValueChange={(value) =>
                setForm((current) => ({
                  ...current,
                  status: value as 'active' | 'paused',
                }))
              }
            >
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">活跃</SelectItem>
                <SelectItem value="paused">暂停</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={saving}
          >
            取消
          </Button>
          <Button type="submit" disabled={saving}>
            {saving && <Loader2 className="size-4 animate-spin" />}
            保存
          </Button>
        </div>
      </form>
    </div>
  );
}

type WorkflowsPageMode = 'all' | 'runs' | 'workflows';

export function WorkflowsPage({
  embedded = false,
  mode = 'all',
}: {
  embedded?: boolean;
  mode?: WorkflowsPageMode;
}) {
  const { dashboard, loading, error, loadDashboard } = useWorkflowsStore();
  const [selectedDate, setSelectedDate] = useState(localDateValue());
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [editingTask, setEditingTask] =
    useState<WorkflowDashboardScheduledTask | null>(null);
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);

  useEffect(() => {
    loadDashboard(selectedDate);
    const interval = setInterval(() => {
      loadDashboard(selectedDate);
    }, 10_000);
    return () => clearInterval(interval);
  }, [loadDashboard, selectedDate]);

  const subtitle = useMemo(() => {
    if (!dashboard) return '当天 workflow 运行、定时任务和 step 进度';
    return `${dashboard.date} · ${formatDateTime(dashboard.generatedAt)} 刷新`;
  }, [dashboard]);

  const runningRuns = useMemo(
    () =>
      dashboard?.runningRuns.filter((run) => run.status === 'running') ?? [],
    [dashboard],
  );
  const queuedRuns = useMemo(
    () => dashboard?.runningRuns.filter((run) => run.status === 'queued') ?? [],
    [dashboard],
  );
  const showRunningSection = mode !== 'workflows';
  const showScheduledSection = mode !== 'runs';
  const showStockStrategySection =
    mode !== 'runs' && (dashboard?.stockStrategy?.markets.length ?? 0) > 0;
  const headerTitle =
    mode === 'runs'
      ? 'Workflow 运行'
      : mode === 'workflows'
        ? '工作流'
        : '工作流看板';

  const handleDeleteWorkflowTask = async (task: DeletableWorkflowTask) => {
    const runningNotice = task.running
      ? '该任务当前有执行中的 run；删除只会移除后续调度，已经启动的运行记录会继续保留。'
      : '删除后不会再按该计划触发新的 workflow。';
    if (!confirm(`确定删除这个定时 workflow 吗？\n\n${runningNotice}`)) return;
    setBusyTaskId(task.id);
    try {
      await api.delete(`/api/tasks/${task.id}`);
      showToast('已删除定时 workflow', '已移除后续调度，既有运行审计保留');
      if (editingTask?.id === task.id) setEditingTask(null);
      await loadDashboard(selectedDate);
    } catch (err) {
      showToast('删除失败', extractErrorMessage(err));
    } finally {
      setBusyTaskId(null);
    }
  };

  const handleSaveWorkflowTask = async (
    id: string,
    patch: WorkflowTaskPatch,
  ) => {
    setBusyTaskId(id);
    try {
      await api.patch(`/api/tasks/${id}`, patch);
      showToast('保存成功', '定时 workflow 已更新');
      setEditingTask(null);
      await loadDashboard(selectedDate);
    } catch (err) {
      showToast('保存失败', extractErrorMessage(err));
    } finally {
      setBusyTaskId(null);
    }
  };

  return (
    <div
      className={cn(
        !embedded && 'min-h-full bg-background p-4 lg:p-8',
        embedded && 'bg-transparent',
      )}
    >
      <div className={cn('mx-auto', embedded ? 'max-w-none' : 'max-w-7xl')}>
        <PageHeader
          title={headerTitle}
          subtitle={subtitle}
          className="mb-6"
          actions={
            <>
              <Input
                type="date"
                value={selectedDate}
                onChange={(event) =>
                  setSelectedDate(event.target.value || localDateValue())
                }
                className="h-9 w-[9.5rem]"
              />
              <Button
                variant="outline"
                onClick={() => loadDashboard(selectedDate)}
                disabled={loading}
              >
                <RefreshCw
                  className={cn('size-4', loading && 'animate-spin')}
                />
                刷新
              </Button>
            </>
          }
        />

        {error && (
          <div className="mb-4 rounded-lg border border-error/20 bg-error-bg px-3 py-2 text-sm text-error">
            {error}
          </div>
        )}

        {loading && !dashboard ? (
          <SkeletonStatCards />
        ) : !dashboard ? (
          <EmptyState icon={WorkflowIcon} title="暂无工作流运行数据" />
        ) : (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatCard
                title="今日运行"
                value={dashboard.summary.totalRuns}
                hint={`${dashboard.summary.successRuns} 成功 · ${dashboard.summary.errorRuns} 失败`}
                icon={Activity}
              />
              <StatCard
                title="正在运行"
                value={dashboard.summary.runningRuns}
                hint={`${dashboard.summary.queuedRuns} 个排队 · ${dashboard.summary.runningScheduledTasks} 个定时任务执行中`}
                icon={PlayCircle}
              />
              <StatCard
                title="定时工作流"
                value={dashboard.summary.scheduledWorkflowTasks}
                hint={`${dashboard.summary.completedTaskRuns} 次任务完成`}
                icon={TimerReset}
              />
              <StatCard
                title="任务失败"
                value={dashboard.summary.failedTaskRuns}
                hint={`${dashboard.summary.cancelledRuns} 个 workflow 已取消`}
                icon={AlertCircle}
              />
            </div>

            {showStockStrategySection && dashboard.stockStrategy && (
              <StockStrategyPanel stockStrategy={dashboard.stockStrategy} />
            )}

            {showRunningSection && (
              <section>
                <div className="mb-3 flex items-center gap-2">
                  <PlayCircle className="size-4 text-primary" />
                  <h2 className="text-sm font-semibold text-foreground">
                    正在运行
                  </h2>
                </div>
                {dashboard.runningRuns.length === 0 ? (
                  <div className="rounded-lg border border-border bg-card px-4 py-5 text-sm text-muted-foreground">
                    当前没有运行中的工作流
                  </div>
                ) : (
                  <div className="space-y-4">
                    {runningRuns.length > 0 && (
                      <div className="grid gap-3 lg:grid-cols-2">
                        {runningRuns.map((run) => (
                          <RunningRunCard
                            key={run.id}
                            run={run}
                            onDeleteTask={handleDeleteWorkflowTask}
                            deletingTaskId={busyTaskId}
                          />
                        ))}
                      </div>
                    )}
                    {queuedRuns.length > 0 && (
                      <div>
                        <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                          <CircleDashed className="size-3.5" />
                          排队中：run 已创建，等待调度器进入执行
                        </div>
                        <div className="grid gap-3 lg:grid-cols-2">
                          {queuedRuns.map((run) => (
                            <RunningRunCard
                              key={run.id}
                              run={run}
                              onDeleteTask={handleDeleteWorkflowTask}
                              deletingTaskId={busyTaskId}
                            />
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </section>
            )}

            {showScheduledSection && (
              <Card className="rounded-lg">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <CalendarDays className="size-4 text-muted-foreground" />
                    定时工作流
                  </CardTitle>
                </CardHeader>
                <CardContent className="overflow-x-auto px-0">
                  {dashboard.scheduledTasks.length === 0 ? (
                    <div className="px-4 pb-4 text-sm text-muted-foreground">
                      暂无定时 workflow 任务
                    </div>
                  ) : (
                    <table className="min-w-[960px] table-fixed text-left">
                      <colgroup>
                        <col className="w-[32%]" />
                        <col className="w-[13%]" />
                        <col className="w-[16%]" />
                        <col className="w-[10%]" />
                        <col className="w-[10%]" />
                        <col className="w-[12%]" />
                        <col className="w-[7%]" />
                      </colgroup>
                      <thead>
                        <tr className="border-b border-border text-xs text-muted-foreground">
                          <th className="px-4 py-2 font-medium">Workflow</th>
                          <th className="px-4 py-2 font-medium">频率</th>
                          <th className="px-4 py-2 font-medium">下次运行</th>
                          <th className="px-4 py-2 font-medium">状态</th>
                          <th className="px-4 py-2 font-medium">今日</th>
                          <th className="px-4 py-2 font-medium">最近日志</th>
                          <th className="px-4 py-2 text-right font-medium">
                            操作
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {dashboard.scheduledTasks.map((task) => (
                          <ScheduledTaskRow
                            key={task.id}
                            task={task}
                            onEdit={setEditingTask}
                            onDelete={handleDeleteWorkflowTask}
                            busyTaskId={busyTaskId}
                          />
                        ))}
                      </tbody>
                    </table>
                  )}
                </CardContent>
              </Card>
            )}

            <Card className="rounded-lg">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-sm">
                  <ListChecks className="size-4 text-muted-foreground" />
                  今日运行记录
                </CardTitle>
              </CardHeader>
              <CardContent className="px-0">
                {dashboard.todayRuns.length === 0 ? (
                  <div className="px-4 pb-4 text-sm text-muted-foreground">
                    当天没有 workflow run
                  </div>
                ) : (
                  dashboard.todayRuns.map((run) => (
                    <RunRow
                      key={run.id}
                      run={run}
                      expanded={expandedRunId === run.id}
                      onToggle={() =>
                        setExpandedRunId((current) =>
                          current === run.id ? null : run.id,
                        )
                      }
                    />
                  ))
                )}
              </CardContent>
            </Card>

            <div className="grid gap-3 text-xs text-muted-foreground md:grid-cols-3">
              <div className="flex items-center gap-2">
                <Clock4 className="size-3.5" />
                窗口：{formatDateTime(dashboard.dayStart)} -{' '}
                {formatDateTime(dashboard.dayEnd)}
              </div>
              <div>刷新：{formatDateTime(dashboard.generatedAt)}</div>
              <div>时区偏移：{dashboard.timezoneOffsetMinutes} 分钟</div>
            </div>
          </div>
        )}
      </div>
      {editingTask && (
        <EditWorkflowTaskDialog
          task={editingTask}
          saving={busyTaskId === editingTask.id}
          onCancel={() => setEditingTask(null)}
          onSave={handleSaveWorkflowTask}
        />
      )}
    </div>
  );
}
