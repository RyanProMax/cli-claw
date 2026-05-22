import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Activity, Bot, CalendarClock, Terminal, Workflow } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatInterval } from '@/utils/task-utils';
import { useTasksStore, type ScheduledTask } from '../stores/tasks';
import { TasksPage } from './TasksPage';
import { WorkflowsPage } from './WorkflowsPage';

type AutomationTab = 'plans' | 'runs' | 'workflows';

const AUTOMATION_TABS: Array<{
  value: AutomationTab;
  label: string;
  Icon: typeof Activity;
}> = [
  {
    value: 'plans',
    label: '计划',
    Icon: CalendarClock,
  },
  {
    value: 'runs',
    label: '运行',
    Icon: Activity,
  },
  {
    value: 'workflows',
    label: '工作流',
    Icon: Workflow,
  },
];

function normalizeTab(value: string | null): AutomationTab {
  if (value === 'runs' || value === 'workflows' || value === 'plans') {
    return value;
  }
  return 'plans';
}

function executionLabel(task: ScheduledTask): string {
  if (task.execution_type === 'script') return '脚本';
  if (task.execution_type === 'workflow') return 'Workflow';
  return 'Agent';
}

function scheduleText(task: ScheduledTask): string {
  if (task.schedule_type === 'cron') return task.schedule_value;
  if (task.schedule_type === 'interval')
    return `每 ${formatInterval(task.schedule_value)}`;
  return '单次';
}

function formatDateTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function RunningTasksPanel() {
  const { tasks, runningTaskIds, loadTasks, loading } = useTasksStore();

  useEffect(() => {
    loadTasks();
    const interval = setInterval(loadTasks, 10_000);
    return () => clearInterval(interval);
  }, [loadTasks]);

  const runningTasks = tasks.filter(
    (task) => runningTaskIds.has(task.id) && task.execution_type !== 'workflow',
  );

  return (
    <Card className="rounded-lg">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Bot className="size-4 text-muted-foreground" />
          Agent / 脚本运行
        </CardTitle>
      </CardHeader>
      <CardContent>
        {runningTasks.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            {loading ? '正在刷新运行状态' : '当前没有 agent 或脚本任务运行'}
          </div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {runningTasks.map((task) => (
              <div
                key={task.id}
                className="rounded-lg border border-border bg-background px-3 py-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-foreground">
                      {(task.prompt || task.script_command || task.id)
                        .split('\n')[0]
                        .trim()}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span>{scheduleText(task)}</span>
                      {task.last_run && (
                        <span>上次 {formatDateTime(task.last_run)}</span>
                      )}
                    </div>
                  </div>
                  <Badge variant="info" className="shrink-0">
                    {executionLabel(task)}
                  </Badge>
                </div>
                {task.execution_type === 'script' && task.script_command && (
                  <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Terminal className="size-3.5" />
                    <span className="truncate">{task.script_command}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function AutomationsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = normalizeTab(searchParams.get('tab'));

  const selectTab = (value: string) => {
    setSearchParams({ tab: normalizeTab(value) }, { replace: true });
  };

  return (
    <div className="min-h-full bg-background p-4 lg:p-8">
      <div className="mx-auto max-w-7xl">
        <PageHeader
          title="自动化"
          subtitle="计划、运行、工作流审计"
          className="mb-6"
        />

        <Tabs value={activeTab} onValueChange={selectTab} className="gap-5">
          <TabsList className="w-full justify-start overflow-x-auto sm:w-fit">
            {AUTOMATION_TABS.map(({ value, label, Icon }) => (
              <TabsTrigger key={value} value={value} className="min-w-24">
                <Icon className="size-4" />
                {label}
              </TabsTrigger>
            ))}
          </TabsList>

          <div className="text-sm outline-none">
            {activeTab === 'plans' && <TasksPage embedded />}
            {activeTab === 'runs' && (
              <div className="space-y-6">
                <RunningTasksPanel />
                <WorkflowsPage embedded mode="runs" />
              </div>
            )}
            {activeTab === 'workflows' && (
              <WorkflowsPage embedded mode="workflows" />
            )}
          </div>
        </Tabs>
      </div>
    </div>
  );
}
