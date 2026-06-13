import { useState, useMemo, useEffect } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { Plus, PanelLeftClose, LogOut } from 'lucide-react';
import { useChatStore } from '../../stores/chat';
import { useAuthStore } from '../../stores/auth';
import { useGroupsStore } from '../../stores/groups';
import { useClearWorkspace } from '../../hooks/useClearWorkspace';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/common';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { ChatGroupItem } from '../chat/ChatGroupItem';
import { CreateWorkspaceDialog } from '../chat/CreateWorkspaceDialog';
import { RenameDialog } from '../chat/RenameDialog';
import { SkeletonCardList } from '@/components/common/Skeletons';
import { cn } from '@/lib/utils';
import { filterNavItems } from './nav-items';
import {
  type GroupEntry,
  type DateSection,
  groupByDate,
  compareByLastActivity,
  isWorkspaceListGroup,
} from '../../utils/group-utils';
import { toWorkspaceChatPath } from '../../utils/workspace-routing';

interface UnifiedSidebarProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export function UnifiedSidebar({
  collapsed,
  onToggleCollapse,
}: UnifiedSidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const isChatRoute = location.pathname.startsWith('/chat');
  const showWorkspaceList = isChatRoute && !collapsed;

  const navItems = useMemo(() => filterNavItems(), []);

  const [createOpen, setCreateOpen] = useState(false);
  const [renameState, setRenameState] = useState({
    open: false,
    jid: '',
    name: '',
  });
  const [deleteState, setDeleteState] = useState({
    open: false,
    jid: '',
    name: '',
  });
  const [deleteLoading, setDeleteLoading] = useState(false);
  const {
    clearState,
    clearLoading,
    openClear,
    closeClear,
    handleClearConfirm,
  } = useClearWorkspace();

  const {
    groups,
    currentGroup,
    selectGroup,
    loadGroups,
    loading,
    deleteFlow,
    togglePin,
  } = useChatStore();
  const runnerStates = useGroupsStore((s) => s.runnerStates);

  useEffect(() => {
    if (isChatRoute) loadGroups();
  }, [isChatRoute, loadGroups]);

  const { mainGroup, otherGroups } = useMemo(() => {
    let main: GroupEntry | null = null;
    const others: GroupEntry[] = [];
    for (const [jid, info] of Object.entries(groups)) {
      if (!isWorkspaceListGroup(jid, info)) continue;
      const entry = { jid, ...info };
      if (info.is_my_home) main = entry;
      else others.push(entry);
    }
    others.sort(compareByLastActivity);
    return { mainGroup: main, otherGroups: others };
  }, [groups]);

  const { pinnedGroups, mySections } = useMemo(() => {
    const pinned: GroupEntry[] = [];
    const my: GroupEntry[] = [];
    otherGroups.forEach((g) => {
      if (g.pinned_at) pinned.push(g);
      else my.push(g);
    });
    pinned.sort((a, b) => (a.pinned_at || '').localeCompare(b.pinned_at || ''));
    return { pinnedGroups: pinned, mySections: groupByDate(my) };
  }, [otherGroups]);

  const handleGroupSelect = (jid: string) => {
    selectGroup(jid);
    navigate(toWorkspaceChatPath(jid));
  };
  const handleCreated = (jid: string) => {
    selectGroup(jid);
    navigate(toWorkspaceChatPath(jid));
  };

  const handleDeleteConfirm = async () => {
    setDeleteLoading(true);
    try {
      await deleteFlow(deleteState.jid);
      setDeleteState({ open: false, jid: '', name: '' });
      const nextJid = useChatStore.getState().currentGroup;
      navigate(nextJid ? toWorkspaceChatPath(nextJid) : '/chat');
    } catch (err: unknown) {
      const typed = err as {
        boundAgents?: Array<{
          agentName: string;
          imGroups: Array<{ name: string }>;
        }>;
      };
      if (typed.boundAgents) {
        const details = typed.boundAgents
          .map(
            (a) =>
              `「${a.agentName}」→ ${a.imGroups.map((g) => g.name).join('、')}`,
          )
          .join('\n');
        alert(
          `该工作区下有任务线程设置了入口路由，请先恢复默认路由后再删除：\n${details}`,
        );
      } else {
        alert(
          `删除工作区失败：${err instanceof Error ? err.message : '未知错误'}`,
        );
      }
      setDeleteState({ open: false, jid: '', name: '' });
    } finally {
      setDeleteLoading(false);
    }
  };

  const renderSections = (sections: DateSection[]) =>
    sections.map((section) => (
      <div key={section.label} className="mb-1">
        <div className="px-2 pt-2 pb-1">
          <span className="text-[10px] text-muted-foreground/70 tracking-wide">
            {section.label}
          </span>
        </div>
        {section.items.map((g) => (
          <ChatGroupItem
            key={g.jid}
            jid={g.jid}
            name={g.name}
            folder={g.folder}
            lastMessage={g.lastMessage}
            isActive={currentGroup === g.jid}
            isHome={false}
            isRunning={runnerStates[g.jid] === 'running'}
            editable={g.editable}
            deletable={g.deletable}
            onSelect={handleGroupSelect}
            onRename={(jid, name) => setRenameState({ open: true, jid, name })}
            onClearHistory={openClear}
            onDelete={(jid, name) => setDeleteState({ open: true, jid, name })}
            onTogglePin={(jid) => togglePin(jid)}
          />
        ))}
      </div>
    ));

  const panelWidth = showWorkspaceList ? '16.5rem' : '0';

  return (
    <TooltipProvider delayDuration={200}>
      <div className="h-full flex flex-shrink-0">
        <nav className="w-[4.5rem] h-full bg-muted/30 flex flex-col items-center py-3 gap-1 flex-shrink-0">
          <div className="w-11 h-11 rounded-xl overflow-hidden mb-3 flex-shrink-0">
            <img
              src={`${import.meta.env.BASE_URL}icons/icon-192.png`}
              alt="agent-fabric"
              className="w-full h-full object-cover"
            />
          </div>

          {navItems.map(({ path, icon: Icon, label }) => {
            const isChatItem = path === '/chat';
            const isActive = location.pathname.startsWith(path);
            const baseClass =
              'w-12 h-12 rounded-xl flex flex-col items-center justify-center gap-0.5 transition-colors';
            const activeClass = isActive
              ? 'bg-brand-50 text-primary'
              : 'text-muted-foreground hover:bg-accent';

            return (
              <Tooltip key={path}>
                <TooltipTrigger asChild>
                  {isChatItem && isChatRoute ? (
                    <button
                      onClick={onToggleCollapse}
                      className={cn(baseClass, activeClass)}
                    >
                      <Icon
                        className="w-[20px] h-[20px]"
                        strokeWidth={isActive ? 2 : 1.75}
                      />
                      <span className="text-[10px] leading-tight">{label}</span>
                    </button>
                  ) : (
                    <NavLink to={path} className={cn(baseClass, activeClass)}>
                      <Icon
                        className="w-[20px] h-[20px]"
                        strokeWidth={isActive ? 2 : 1.75}
                      />
                      <span className="text-[10px] leading-tight">{label}</span>
                    </NavLink>
                  )}
                </TooltipTrigger>
                <TooltipContent side="right">
                  {isChatItem && isChatRoute
                    ? collapsed
                      ? '展开工作区'
                      : '收起工作区'
                    : label}
                </TooltipContent>
              </Tooltip>
            );
          })}

          {/* Spacer */}
          <div className="flex-1" />

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={async () => {
                  await useAuthStore.getState().logout();
                  navigate('/login');
                }}
                className="w-10 h-10 rounded-xl flex items-center justify-center text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors cursor-pointer mb-2"
                aria-label="退出访问"
              >
                <LogOut className="w-5 h-5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">退出访问</TooltipContent>
          </Tooltip>
        </nav>

        <div
          className="h-full overflow-hidden transition-[width] duration-200 ease-linear"
          style={{ width: panelWidth }}
        >
          <div className="w-[16.5rem] h-full flex flex-col bg-muted/30 py-4">
            {/* New workspace button */}
            <div className="px-3 py-2 flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start gap-2 text-xs flex-1"
                onClick={() => setCreateOpen(true)}
              >
                <Plus className="w-3.5 h-3.5" />
                新工作区
              </Button>
              <button
                onClick={onToggleCollapse}
                className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-accent text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              >
                <PanelLeftClose className="w-5 h-5" />
              </button>
            </div>

            {/* Workspace list */}
            <div className="flex-1 overflow-y-auto px-1.5">
              {loading && !mainGroup && otherGroups.length === 0 ? (
                <SkeletonCardList count={6} compact />
              ) : (
                <>
                  {mainGroup && (
                    <div className="mb-1">
                      <div className="px-2 pt-1 pb-1">
                        <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                          主工作区
                        </span>
                      </div>
                      <ChatGroupItem
                        jid={mainGroup.jid}
                        name={mainGroup.name}
                        folder={mainGroup.folder}
                        lastMessage={mainGroup.lastMessage}
                        isActive={currentGroup === mainGroup.jid}
                        isHome
                        isRunning={runnerStates[mainGroup.jid] === 'running'}
                        editable
                        onSelect={handleGroupSelect}
                        onRename={(jid, name) =>
                          setRenameState({ open: true, jid, name })
                        }
                        onClearHistory={openClear}
                      />
                    </div>
                  )}

                  {pinnedGroups.length > 0 && (
                    <div className="mb-1">
                      <div className="mt-1" />
                      <div className="px-2 pt-2 pb-1">
                        <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                          已固定
                        </span>
                      </div>
                      {pinnedGroups.map((g) => (
                        <ChatGroupItem
                          key={g.jid}
                          jid={g.jid}
                          name={g.name}
                          folder={g.folder}
                          lastMessage={g.lastMessage}
                          isActive={currentGroup === g.jid}
                          isHome={false}
                          isPinned
                          isRunning={runnerStates[g.jid] === 'running'}
                          editable={g.editable}
                          deletable={g.deletable}
                          onSelect={handleGroupSelect}
                          onRename={(jid, name) =>
                            setRenameState({ open: true, jid, name })
                          }
                          onClearHistory={openClear}
                          onDelete={(jid, name) =>
                            setDeleteState({ open: true, jid, name })
                          }
                          onTogglePin={(jid) => togglePin(jid)}
                        />
                      ))}
                    </div>
                  )}

                  {mySections.length === 0 &&
                  pinnedGroups.length === 0 &&
                  !mainGroup ? (
                    <div className="flex flex-col items-center justify-center h-32 px-4">
                      <p className="text-xs text-muted-foreground text-center">
                        暂无工作区
                      </p>
                    </div>
                  ) : (
                    <>
                      {mySections.length > 0 && (
                        <div>
                          <div className="mt-1" />
                          <div className="px-2 pt-2 pb-1">
                            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                              我的工作区
                            </span>
                          </div>
                          {renderSections(mySections)}
                        </div>
                      )}
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      <CreateWorkspaceDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={handleCreated}
      />
      <RenameDialog
        open={renameState.open}
        jid={renameState.jid}
        currentName={renameState.name}
        onClose={() => setRenameState({ open: false, jid: '', name: '' })}
      />
      <ConfirmDialog
        open={clearState.open}
        onClose={closeClear}
        onConfirm={handleClearConfirm}
        title="重建工作区"
        message={`确认重建「${clearState.name}」？不可撤销。`}
        confirmText="确认重建"
        confirmVariant="danger"
        loading={clearLoading}
      />
      <ConfirmDialog
        open={deleteState.open}
        onClose={() => setDeleteState({ open: false, jid: '', name: '' })}
        onConfirm={handleDeleteConfirm}
        title="删除工作区"
        message={`确认删除「${deleteState.name}」？不可撤销。`}
        confirmText="删除"
        confirmVariant="danger"
        loading={deleteLoading}
      />
    </TooltipProvider>
  );
}
