export interface UsageProviderResult {
  provider: 'openai' | 'claude';
  available: boolean;
  source: string;
  primaryUsagePct?: number;
  secondaryUsagePct?: number;
  primaryRemainingPct?: number;
  secondaryRemainingPct?: number;
  primaryResetAt?: unknown;
  secondaryResetAt?: unknown;
  reason?: string;
}

export interface ExecuteUsageCommandOptions {
  getClaudeUsage: () => Promise<UsageProviderResult>;
  getOpenAiUsage?: () => Promise<UsageProviderResult>;
}

const RESET_PLACEHOLDER = 'unknown';
const UNKNOWN_ERROR_MESSAGE = 'unknown error';

function messageFromObject(error: object): string | undefined {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(error, 'message');
    if (descriptor && 'value' in descriptor) {
      const value = descriptor.value;
      if (typeof value === 'string' && value.length > 0) return value;
    }
    const maybeMessage = (error as { message?: unknown }).message;
    if (typeof maybeMessage === 'string' && maybeMessage.length > 0) {
      return maybeMessage;
    }
  } catch {
    // getter threw; fall back to generic reason
  }
  return undefined;
}

function stringifyErrorMessage(error: unknown): string {
  if (typeof error === 'string') return error;
  if (typeof error === 'object' && error !== null) {
    return messageFromObject(error) ?? UNKNOWN_ERROR_MESSAGE;
  }
  if (error === undefined || error === null) return UNKNOWN_ERROR_MESSAGE;
  try {
    const coerced = String(error);
    return coerced || UNKNOWN_ERROR_MESSAGE;
  } catch {
    return UNKNOWN_ERROR_MESSAGE;
  }
}

function formatUsageSection(result: UsageProviderResult): string {
  const label = result.provider === 'openai' ? 'OpenAI' : 'Claude';
  return [
    label,
    '- 5h 剩余: unavailable',
    '- 7d 剩余: unavailable',
    `- 5h 重置时间: ${RESET_PLACEHOLDER}`,
    `- 7d 重置时间: ${RESET_PLACEHOLDER}`,
    `- 原因: ${result.reason ?? 'usage unavailable'}`,
    `- 数据源: ${result.source}`,
  ].join('\n');
}

export async function executeUsageCommand(
  options: ExecuteUsageCommandOptions,
): Promise<string> {
  let openai: UsageProviderResult;
  try {
    openai = options.getOpenAiUsage
      ? await options.getOpenAiUsage()
      : {
          provider: 'openai',
          available: false,
          source: 'OpenAI API',
          reason: 'OpenAI usage snapshot unavailable',
        };
  } catch (error) {
    openai = {
      provider: 'openai',
      available: false,
      source: 'OpenAI API',
      reason: `OpenAI usage fetch failed: ${stringifyErrorMessage(error)}`,
    };
  }

  let claude: UsageProviderResult;
  try {
    claude = await options.getClaudeUsage();
  } catch (error) {
    claude = {
      provider: 'claude',
      available: false,
      source: 'Claude OAuth API',
      reason: `Claude usage fetch failed: ${stringifyErrorMessage(error)}`,
    };
  }

  return [
    '📈 用量查询',
    '━━━━━━━━━━',
    formatUsageSection(openai),
    '',
    formatUsageSection(claude),
  ].join('\n');
}
