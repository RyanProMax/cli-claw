import { useSearchParams } from 'react-router-dom';
import { Activity, CalendarClock, Workflow } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
          <TabsList className="!grid w-full grid-cols-3 justify-start sm:!inline-flex sm:w-fit">
            {AUTOMATION_TABS.map(({ value, label, Icon }) => (
              <TabsTrigger
                key={value}
                value={value}
                className="min-w-0 px-3 sm:min-w-24 sm:px-1.5"
              >
                <Icon className="size-4" />
                {label}
              </TabsTrigger>
            ))}
          </TabsList>

          <div className="text-sm outline-none">
            {activeTab === 'plans' && <TasksPage embedded />}
            {activeTab === 'runs' && <WorkflowsPage embedded mode="runs" />}
            {activeTab === 'workflows' && (
              <WorkflowsPage embedded mode="workflows" />
            )}
          </div>
        </Tabs>
      </div>
    </div>
  );
}
