import { MessageCircle, User, Workflow } from 'lucide-react';

export const baseNavItems = [
  { path: '/chat', icon: MessageCircle, label: '工作台' },
  { path: '/automations', icon: Workflow, label: '自动化' },
  { path: '/settings', icon: User, label: '设置' },
];

export function filterNavItems() {
  return baseNavItems;
}
