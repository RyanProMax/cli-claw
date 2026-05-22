import { useEffect, useState } from 'react';
import { useTasksStore } from '../stores/tasks';
import { useAuthStore } from '../stores/auth';
import { useGroupsStore } from '../stores/groups';
import { TaskCard } from '../components/tasks/TaskCard';
import { CreateTaskForm } from '../components/tasks/CreateTaskForm';
import { Plus, RefreshCw, Clock, X } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { SkeletonCardList } from '@/components/common/Skeletons';
import { EmptyState } from '@/components/common/EmptyState';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function TasksPage({ embedded = false }: { embedded?: boolean }) {
  const {
    tasks,
    loading,
    error,
    loadTasks,
    createTask,
    updateTaskStatus,
    deleteTask,
    runTaskNow,
  } = useTasksStore();
  const { user } = useAuthStore();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const isAdmin = user?.role === 'admin';

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  // Poll while any task is in 'parsing' state so UI updates when done
  const hasParsing = tasks.some((t) => t.status === 'parsing');
  useEffect(() => {
    if (!hasParsing) return;
    const interval = setInterval(loadTasks, 3000);
    return () => clearInterval(interval);
  }, [hasParsing, loadTasks]);

  const handleCreateTask = async (data: {
    prompt: string;
    scheduleType: 'cron' | 'interval' | 'once';
    scheduleValue: string;
    executionType: 'agent' | 'script';
    scriptCommand: string;
    notifyChannels: string[] | null;
  }) => {
    await createTask(
      data.prompt,
      data.scheduleType,
      data.scheduleValue,
      data.executionType,
      data.scriptCommand,
      data.notifyChannels,
    );
    setShowCreateForm(false);
  };

  const handlePause = async (id: string) => {
    if (confirm('确定要暂停此任务吗？')) {
      await updateTaskStatus(id, 'paused');
    }
  };

  const handleResume = async (id: string) => {
    if (confirm('确定要恢复此任务吗？')) {
      await updateTaskStatus(id, 'active');
    }
  };

  const handleDelete = async (id: string) => {
    if (
      confirm('确定要删除此任务吗？关联的工作区也会被删除，此操作不可撤销。')
    ) {
      await deleteTask(id);
      // Refresh sidebar — workspace was deleted along with the task
      useGroupsStore.getState().loadGroups();
    }
  };

  const activeTasks = tasks.filter((t) => t.status === 'active');
  const pausedTasks = tasks.filter((t) => t.status === 'paused');
  const otherTasks = tasks.filter(
    (t) => t.status !== 'active' && t.status !== 'paused',
  );
  const headerActions = (
    <div className="flex items-center gap-3">
      <Button variant="outline" onClick={loadTasks} disabled={loading}>
        <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
        刷新
      </Button>
      <Button onClick={() => setShowCreateForm(true)}>
        <Plus size={18} />
        创建计划
      </Button>
    </div>
  );

  return (
    <div className={cn(!embedded && 'min-h-full bg-background')}>
      <div className={cn('mx-auto', embedded ? 'max-w-none' : 'max-w-6xl p-6')}>
        <PageHeader
          title={embedded ? '计划' : '定时任务管理'}
          subtitle={`共 ${tasks.length} 个计划 · ${activeTasks.length} 个活跃 · ${pausedTasks.length} 个已暂停`}
          className="mb-6"
          actions={headerActions}
        />

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-error-bg border border-error/20 flex items-center justify-between">
            <span className="text-sm text-error">{error}</span>
            <button
              onClick={() => useTasksStore.setState({ error: null })}
              className="p-1 text-error hover:text-error rounded transition-colors"
            >
              <X size={16} />
            </button>
          </div>
        )}

        {loading && tasks.length === 0 ? (
          <SkeletonCardList count={4} />
        ) : tasks.length === 0 ? (
          <EmptyState
            icon={Clock}
            title="还没有创建任何定时任务"
            action={
              <Button onClick={() => setShowCreateForm(true)}>
                <Plus size={18} />
                创建第一个任务
              </Button>
            }
          />
        ) : (
          <div className="space-y-6">
            {activeTasks.length > 0 && (
              <div>
                <h2 className="text-sm font-semibold text-foreground mb-3">
                  活跃计划
                </h2>
                <div className="space-y-3">
                  {activeTasks.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      onPause={handlePause}
                      onResume={handleResume}
                      onDelete={handleDelete}
                      onRunNow={runTaskNow}
                    />
                  ))}
                </div>
              </div>
            )}

            {pausedTasks.length > 0 && (
              <div>
                <h2 className="text-sm font-semibold text-foreground mb-3">
                  已暂停
                </h2>
                <div className="space-y-3">
                  {pausedTasks.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      onPause={handlePause}
                      onResume={handleResume}
                      onDelete={handleDelete}
                      onRunNow={runTaskNow}
                    />
                  ))}
                </div>
              </div>
            )}

            {otherTasks.length > 0 && (
              <div>
                <h2 className="text-sm font-semibold text-foreground mb-3">
                  其他
                </h2>
                <div className="space-y-3">
                  {otherTasks.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      onPause={handlePause}
                      onResume={handleResume}
                      onDelete={handleDelete}
                      onRunNow={runTaskNow}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {showCreateForm && (
        <CreateTaskForm
          onSubmit={handleCreateTask}
          onClose={() => {
            setShowCreateForm(false);
            loadTasks();
          }}
          isAdmin={isAdmin}
        />
      )}
    </div>
  );
}
