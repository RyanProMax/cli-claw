import { cn } from '@/lib/utils';

import type { RuntimeIdentity } from '../../types';
import { formatAssistantMetaFooter } from '../../lib/assistantMetaFooter';

interface AssistantMetaFooterProps {
  runtimeIdentity?: RuntimeIdentity | null;
  tokenUsage?: string | null;
  className?: string;
}

export function AssistantMetaFooter({
  runtimeIdentity,
  tokenUsage,
  className,
}: AssistantMetaFooterProps) {
  const footer = formatAssistantMetaFooter({
    runtimeIdentity,
    tokenUsage,
  });
  if (!footer) return null;

  return (
    <div className={cn('mt-1.5 text-xs text-muted-foreground', className)}>
      {footer}
    </div>
  );
}
