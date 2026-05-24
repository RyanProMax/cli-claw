import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Menu } from 'lucide-react';

import { SettingsNav } from '../components/settings/SettingsNav';
import { SecuritySection } from '../components/settings/SecuritySection';
import { AboutSection } from '../components/settings/AboutSection';
import { AppearanceSection } from '../components/settings/AppearanceSection';
import { SystemSettingsSection } from '../components/settings/SystemSettingsSection';
import { InstanceChannelsSection } from '../components/settings/InstanceChannelsSection';
import { GroupsPage } from './GroupsPage';
import { BindingsSection } from '../components/settings/BindingsSection';
import { Card, CardContent } from '@/components/ui/card';
import type { SettingsTab } from '../components/settings/types';

const VALID_TABS: SettingsTab[] = [
  'appearance',
  'system',
  'channels',
  'security',
  'groups',
  'about',
  'bindings',
];
const FULLPAGE_TABS: SettingsTab[] = ['groups', 'bindings'];

export function SettingsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [navOpen, setNavOpen] = useState(false);

  const activeTab = useMemo((): SettingsTab => {
    const raw = searchParams.get('tab') as SettingsTab | null;
    return raw && VALID_TABS.includes(raw) ? raw : 'system';
  }, [searchParams]);

  const handleTabChange = useCallback(
    (tab: SettingsTab) => {
      setNavOpen(false);
      setSearchParams({ tab }, { replace: true });
    },
    [setSearchParams],
  );

  const mobileTabs = useMemo(
    () => [
      { key: 'appearance' as SettingsTab, label: '外观' },
      { key: 'system' as SettingsTab, label: '系统' },
      { key: 'channels' as SettingsTab, label: '消息通道' },
      { key: 'security' as SettingsTab, label: '访问密码' },
      { key: 'groups' as SettingsTab, label: '工作区' },
      { key: 'bindings' as SettingsTab, label: '入口路由' },
      { key: 'about' as SettingsTab, label: '关于' },
    ],
    [],
  );

  const tabBarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = tabBarRef.current;
    if (!container) return;
    const activeEl = container.querySelector('[data-active="true"]');
    activeEl?.scrollIntoView({
      inline: 'center',
      block: 'nearest',
      behavior: 'smooth',
    });
  }, [activeTab]);

  const sectionTitle: Record<SettingsTab, string> = {
    appearance: '外观',
    system: '系统参数',
    channels: '消息通道',
    security: '访问密码',
    groups: '工作区',
    about: '关于',
    bindings: '入口路由',
  };

  return (
    <div className="h-full bg-background flex flex-col lg:flex-row overflow-hidden">
      <div className="lg:hidden sticky top-0 z-10 flex items-center bg-background border-b border-border px-4 h-12">
        <button
          onClick={() => setNavOpen(true)}
          className="p-1.5 -ml-1.5 rounded-lg hover:bg-muted transition-colors"
          aria-label="打开导航"
        >
          <Menu className="w-5 h-5 text-muted-foreground" />
        </button>
        <span className="ml-3 text-sm font-semibold text-foreground truncate">
          {sectionTitle[activeTab]}
        </span>
      </div>

      <div
        ref={tabBarRef}
        className="lg:hidden flex items-center gap-1 px-3 py-2 overflow-x-auto bg-background border-b border-border [touch-action:pan-x]"
        style={{ WebkitOverflowScrolling: 'touch' } as React.CSSProperties}
      >
        {mobileTabs.map((tab) => {
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              data-active={isActive}
              onClick={() => handleTabChange(tab.key)}
              className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                isActive
                  ? 'bg-primary text-white'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <SettingsNav
        activeTab={activeTab}
        onTabChange={handleTabChange}
        open={navOpen}
        onOpenChange={setNavOpen}
      />

      <div className="flex-1 min-w-0 overflow-y-auto">
        {FULLPAGE_TABS.includes(activeTab) ? (
          <>
            {activeTab === 'groups' && <GroupsPage />}
            {activeTab === 'bindings' && <BindingsSection />}
          </>
        ) : (
          <div className="p-4 lg:p-8">
            <div className="max-w-3xl mx-auto space-y-6">
              <div>
                <h1 className="text-2xl font-bold text-foreground">
                  {sectionTitle[activeTab]}
                </h1>
              </div>

              <Card>
                <CardContent>
                  {activeTab === 'appearance' && <AppearanceSection />}
                  {activeTab === 'system' && <SystemSettingsSection />}
                  {activeTab === 'channels' && <InstanceChannelsSection />}
                  {activeTab === 'security' && <SecuritySection />}
                  {activeTab === 'about' && <AboutSection />}
                </CardContent>
              </Card>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
