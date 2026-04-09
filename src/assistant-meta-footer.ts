import {
  formatAssistantCardFooter,
  formatAssistantMetaFooter,
  formatCompactNumber,
  getAssistantCardFooterParts,
  getAssistantMetaFooterParts,
  parseAssistantTokenUsage,
} from '../shared/dist/assistant-meta-footer.js';

export {
  formatAssistantCardFooter,
  formatAssistantMetaFooter,
  formatCompactNumber,
  getAssistantCardFooterParts,
  getAssistantMetaFooterParts,
  parseAssistantTokenUsage,
};

export type {
  AssistantFooterRuntimeIdentity,
  AssistantFooterTokenUsage,
  AssistantMetaFooterInput,
} from '../shared/dist/assistant-meta-footer.js';

import type { AssistantMetaFooterInput } from '../shared/dist/assistant-meta-footer.js';

export function appendAssistantMetaFooter(
  text: string,
  input: AssistantMetaFooterInput,
): string {
  const footer = formatAssistantMetaFooter(input);
  if (!footer) return text;

  const base = text.trimEnd();
  if (!base) return footer;
  return `${base}\n\n${footer}`;
}
