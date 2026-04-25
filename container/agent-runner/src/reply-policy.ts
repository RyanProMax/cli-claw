export const MINIMAL_NECESSARY_REPLY_POLICY = {
  title: '## 最小必要回复策略',
  defaultRule:
    '默认按“最小必要原则”回复：只输出影响用户决策、验收或下一步行动的信息。',
  include:
    '最终回复优先包含结论、关键变更、验证结果、真实阻塞/风险，以及必要的下一步。',
  exclude:
    '不要把过程性叙述、工具调用经过、搜索/读文件流水、内部实现细节、长日志或完整命令输出塞进最终回复。',
  exceptions:
    '用户明确要求详细解释、命令输出、日志、代码走读、review findings 或完整报告时，按请求提供足够细节。',
} as const;

export function buildMinimalNecessaryReplyGuidelines(): string {
  return [
    '',
    MINIMAL_NECESSARY_REPLY_POLICY.title,
    '',
    MINIMAL_NECESSARY_REPLY_POLICY.defaultRule,
    '',
    '- ' + MINIMAL_NECESSARY_REPLY_POLICY.include,
    '- ' + MINIMAL_NECESSARY_REPLY_POLICY.exclude,
    '- ' + MINIMAL_NECESSARY_REPLY_POLICY.exceptions,
  ].join('\n');
}
