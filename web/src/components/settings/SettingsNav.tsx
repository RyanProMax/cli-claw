import {
  Shield,
  Layers,
  Info,
  Palette,
  MessageSquare,
  SlidersHorizontal,
  Link2,
} from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import type { SettingsTab } from './types';

interface NavItem {
  key: SettingsTab;
  label: string;
  icon: React.ReactNode;
}

const sections: Array<{ group: string; items: NavItem[] }> = [
  {
    group: '实例',
    items: [
      {
        key: 'appearance',
        label: '外观',
        icon: <Palette className="w-4 h-4" />,
      },
      {
        key: 'system',
        label: '系统参数',
        icon: <SlidersHorizontal className="w-4 h-4" />,
      },
      {
        key: 'security',
        label: '访问密码',
        icon: <Shield className="w-4 h-4" />,
      },
    ],
  },
  {
    group: '能力',
    items: [
      {
        key: 'channels',
        label: '消息通道',
        icon: <MessageSquare className="w-4 h-4" />,
      },
      {
        key: 'groups',
        label: '工作区',
        icon: <Layers className="w-4 h-4" />,
      },
      {
        key: 'bindings',
        label: 'IM 绑定',
        icon: <Link2 className="w-4 h-4" />,
      },
      {
        key: 'about',
        label: '关于',
        icon: <Info className="w-4 h-4" />,
      },
    ],
  },
];

interface SettingsNavProps {
  activeTab: SettingsTab;
  onTabChange: (tab: SettingsTab) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

function NavButton({
  item,
  active,
  onClick,
}: {
  item: NavItem;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-2 text-sm rounded-lg transition-colors cursor-pointer ${
        active
          ? 'bg-brand-50 text-primary font-medium'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground'
      }`}
    >
      {item.icon}
      {item.label}
    </button>
  );
}

export function SettingsNav({
  activeTab,
  onTabChange,
  open,
  onOpenChange,
}: SettingsNavProps) {
  return (
    <>
      <nav className="hidden lg:block w-56 shrink-0 bg-background border-r border-border py-6 px-3 overflow-y-auto">
        {sections.map((section, si) => (
          <div key={section.group} className={si > 0 ? 'mt-6' : ''}>
            <div className="px-3 mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              {section.group}
            </div>
            <div className="space-y-1">
              {section.items.map((item) => (
                <NavButton
                  key={item.key}
                  item={item}
                  active={activeTab === item.key}
                  onClick={() => onTabChange(item.key)}
                />
              ))}
            </div>
          </div>
        ))}
      </nav>

      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="left" className="w-64 p-0" showCloseButton={false}>
          <SheetHeader className="px-4 pt-5 pb-2">
            <SheetTitle className="text-base">设置</SheetTitle>
          </SheetHeader>
          <nav className="px-3 pb-4 overflow-y-auto">
            {sections.map((section, si) => (
              <div key={section.group} className={si > 0 ? 'mt-5' : ''}>
                <div className="px-3 mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  {section.group}
                </div>
                <div className="space-y-1">
                  {section.items.map((item) => (
                    <NavButton
                      key={item.key}
                      item={item}
                      active={activeTab === item.key}
                      onClick={() => {
                        onTabChange(item.key);
                        onOpenChange?.(false);
                      }}
                    />
                  ))}
                </div>
              </div>
            ))}
          </nav>
        </SheetContent>
      </Sheet>
    </>
  );
}
