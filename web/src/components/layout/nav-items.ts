import { MessageCircle, Wallet, User, Workflow } from 'lucide-react';

export const baseNavItems = [
  { path: '/chat', icon: MessageCircle, label: '工作台' },
  { path: '/automations', icon: Workflow, label: '自动化' },
  { path: '/billing', icon: Wallet, label: '账单', requiresBilling: true },
  { path: '/settings', icon: User, label: '设置' },
];

export function filterNavItems(billingEnabled: boolean) {
  return baseNavItems.filter((item) => {
    if (item.requiresBilling && !billingEnabled) return false;
    return true;
  });
}
