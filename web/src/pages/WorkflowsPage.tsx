import { useEffect, useMemo, useState } from 'react';
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
  PlayCircle,
  RefreshCw,
  TimerReset,
  Workflow as WorkflowIcon,
  XCircle,
} from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { EmptyState } from '@/components/common/EmptyState';
import { SkeletonStatCards } from '@/components/common/Skeletons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { formatInterval } from '@/utils/task-utils';
import {
  useWorkflowsStore,
  type WorkflowDashboardRun,
  type WorkflowDashboardRunStep,
  type WorkflowDashboardScheduledTask,
  type WorkflowRunStatus,
  type WorkflowStepStatus,
} from '../stores/workflows';

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

function RunningRunCard({ run }: { run: WorkflowDashboardRun }) {
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
          <RunStatusBadge status={run.status} />
        </div>
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

function ScheduledTaskRow({ task }: { task: WorkflowDashboardScheduledTask }) {
  return (
    <tr className="border-b border-border last:border-b-0">
      <td className="px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              'size-2 rounded-full',
              task.running
                ? 'bg-primary animate-pulse'
                : 'bg-muted-foreground/40',
            )}
          />
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-foreground">
              {task.workflowId}
            </div>
            <div className="truncate text-xs text-muted-foreground">
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
            className="grid grid-cols-[1fr_auto_auto] items-center gap-3 border-b border-border px-3 py-2 text-xs last:border-b-0"
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
            <div className="whitespace-nowrap text-muted-foreground">
              {formatDuration(step.durationMs)}
            </div>
            <div className="whitespace-nowrap text-muted-foreground">
              {formatDateTime(step.startedAt)}
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

export function WorkflowsPage() {
  const { dashboard, loading, error, loadDashboard } = useWorkflowsStore();
  const [selectedDate, setSelectedDate] = useState(localDateValue());
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);

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

  return (
    <div className="min-h-full bg-background p-4 lg:p-8">
      <div className="mx-auto max-w-7xl">
        <PageHeader
          title="工作流看板"
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
                value={
                  dashboard.summary.runningRuns + dashboard.summary.queuedRuns
                }
                hint={`${dashboard.summary.runningScheduledTasks} 个定时任务执行中`}
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
                <div className="grid gap-3 lg:grid-cols-2">
                  {dashboard.runningRuns.map((run) => (
                    <RunningRunCard key={run.id} run={run} />
                  ))}
                </div>
              )}
            </section>

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
                  <table className="min-w-full text-left">
                    <thead>
                      <tr className="border-b border-border text-xs text-muted-foreground">
                        <th className="px-4 py-2 font-medium">Workflow</th>
                        <th className="px-4 py-2 font-medium">频率</th>
                        <th className="px-4 py-2 font-medium">下次运行</th>
                        <th className="px-4 py-2 font-medium">状态</th>
                        <th className="px-4 py-2 font-medium">今日</th>
                        <th className="px-4 py-2 font-medium">最近日志</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dashboard.scheduledTasks.map((task) => (
                        <ScheduledTaskRow key={task.id} task={task} />
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>

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
    </div>
  );
}
