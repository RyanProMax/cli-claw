import { formatToolStepLine } from '../../lib/toolStepDisplay';

interface ToolInfo {
  toolName: string;
  toolUseId: string;
  startTime: number;
  elapsedSeconds?: number;
  parentToolUseId?: string | null;
  isNested?: boolean;
  skillName?: string;
  toolInputSummary?: string;
  toolInput?: Record<string, unknown>;
}

interface ToolActivityCardProps {
  tool: ToolInfo;
  localElapsed?: number;
}

export function ToolActivityCard({ tool }: ToolActivityCardProps) {
  const isNested = tool.isNested === true;
  const summary = tool.toolName === 'Skill'
    ? tool.skillName
    : tool.toolInputSummary;

  return (
    <div className={`${isNested ? 'ml-4 border-l-2 border-brand-200 pl-2' : ''}`}>
      <div className="rounded-lg border border-brand-200 bg-brand-50/40 px-2.5 py-1.5 text-[13px] text-primary break-all">
        {formatToolStepLine(tool.toolName, summary)}
      </div>
    </div>
  );
}
