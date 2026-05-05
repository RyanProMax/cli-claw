/**
 * Feishu Markdown Style Optimizer
 *
 * Pre-processes standard Markdown text for optimal rendering in Feishu cards.
 * Adapted from openclaw-lark (MIT license).
 *
 * Key transformations:
 * - Heading demotion: H1 → H4, H2~H6 → H5 (card headings are visually too large)
 * - Code block protection: preserved untouched during processing
 * - Table spacing: <br> padding around tables
 * - Consecutive heading spacing: <br> between adjacent headings
 * - Blank line compression: 3+ → 2
 * - Invalid image cleanup: strip non-img_ image references
 */

type StreamingBlockKind = 'heading' | 'list' | 'rule' | 'fence' | 'text';

/**
 * Normalize streaming Markdown for Feishu card updates.
 *
 * Feishu's streaming renderer is sensitive to adjacent block markers. Adding
 * blank lines around major blocks keeps headings/lists/rules readable without
 * rewriting fenced code content.
 */
export function normalizeStreamingMarkdown(text: string): string {
  try {
    return _normalizeStreamingMarkdown(text);
  } catch {
    return text;
  }
}

function _normalizeStreamingMarkdown(text: string): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const output: string[] = [];
  let inCodeBlock = false;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    const trimmed = line.trim();
    const isFence = /^```/.test(trimmed);

    if (inCodeBlock) {
      output.push(line);
      if (isFence) inCodeBlock = false;
      continue;
    }

    if (trimmed === '') {
      pushBlankLine(output);
      continue;
    }

    const currentKind = getStreamingBlockKind(line, isFence);
    if (shouldInsertBlankBefore(output, currentKind)) {
      pushBlankLine(output);
    }

    output.push(line);

    if (isFence) {
      inCodeBlock = true;
      continue;
    }

    if (shouldInsertBlankAfter(lines, i, currentKind)) {
      pushBlankLine(output);
    }
  }

  return output.join('\n');
}

function pushBlankLine(output: string[]): void {
  if (output.length === 0) return;
  if (output[output.length - 1] === '') return;
  output.push('');
}

function getStreamingBlockKind(
  line: string,
  isFence = /^```/.test(line.trim()),
): StreamingBlockKind {
  const trimmed = line.trim();
  if (isFence) return 'fence';
  if (/^#{1,6}\s+\S/.test(trimmed)) return 'heading';
  if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(trimmed)) return 'rule';
  if (/^(?:[-*+]\s+\S|\d+[.)]\s+\S)/.test(trimmed)) return 'list';
  return 'text';
}

function lastNonBlankLine(lines: string[]): string | undefined {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (line !== '') return line;
  }
  return undefined;
}

function shouldInsertBlankBefore(
  output: string[],
  currentKind: StreamingBlockKind,
): boolean {
  if (!['heading', 'list', 'rule', 'fence'].includes(currentKind)) {
    return false;
  }
  if (output.length === 0 || output[output.length - 1] === '') return false;

  const previousLine = lastNonBlankLine(output);
  if (!previousLine) return false;

  const previousKind = getStreamingBlockKind(previousLine);
  return !(currentKind === 'list' && previousKind === 'list');
}

function shouldInsertBlankAfter(
  lines: string[],
  index: number,
  currentKind: StreamingBlockKind,
): boolean {
  if (
    currentKind !== 'heading' &&
    currentKind !== 'rule' &&
    currentKind !== 'list'
  ) {
    return false;
  }
  const nextLine = lines[index + 1];
  if (nextLine === undefined || nextLine.trim() === '') return false;
  if (currentKind === 'list') {
    return getStreamingBlockKind(nextLine) !== 'list';
  }
  return true;
}

/**
 * Optimize Markdown style for Feishu card rendering.
 *
 * @param text - Raw Markdown text
 * @param cardVersion - Card schema version (1 = no <br>, 2 = with <br> spacing)
 */
export function optimizeMarkdownStyle(text: string, cardVersion = 2): string {
  try {
    let r = _optimizeMarkdownStyle(text, cardVersion);
    r = stripInvalidImageKeys(r);
    return r;
  } catch {
    return text;
  }
}

function _optimizeMarkdownStyle(text: string, cardVersion = 2): string {
  // ── 1. Extract code blocks, protect with placeholders ──────────
  const MARK = '___CB_';
  const codeBlocks: string[] = [];
  let r = text.replace(/```[\s\S]*?```/g, (m) => {
    return `${MARK}${codeBlocks.push(m) - 1}___`;
  });

  // ── 2. Heading demotion ────────────────────────────────────────
  // Only demote when the original text contains H1~H3
  // Process H2~H6 first, then H1 (order matters to avoid double-matching)
  const hasH1toH3 = /^#{1,3} /m.test(text);
  if (hasH1toH3) {
    r = r.replace(/^#{2,6} (.+)$/gm, '##### $1'); // H2~H6 → H5
    r = r.replace(/^# (.+)$/gm, '#### $1'); // H1 → H4
  }

  if (cardVersion >= 2) {
    // ── 3. Consecutive heading spacing ─────────────────────────────
    r = r.replace(/^(#{4,5} .+)\n{1,2}(#{4,5} )/gm, '$1\n<br>\n$2');

    // ── 4. Table spacing ───────────────────────────────────────────
    // 4a. Non-table line followed by table line → add blank line
    r = r.replace(/^([^|\n].*)\n(\|.+\|)/gm, '$1\n\n$2');
    // 4b. Table block preceded by blank line → insert <br>
    r = r.replace(/\n\n((?:\|.+\|[^\S\n]*\n?)+)/g, '\n\n<br>\n\n$1');
    // 4c. Table block trailing → append <br>
    r = r.replace(/((?:^\|.+\|[^\S\n]*\n?)+)/gm, '$1\n<br>\n');
    // 4d. Plain text before table: collapse extra blank lines
    r = r.replace(/^((?!#{4,5} )(?!\*\*).+)\n\n(<br>)\n\n(\|)/gm, '$1\n$2\n$3');
    // 4d2. Bold text before table
    r = r.replace(/^(\*\*.+)\n\n(<br>)\n\n(\|)/gm, '$1\n$2\n\n$3');
    // 4e. Plain text after table: collapse extra blank lines
    r = r.replace(/(\|[^\n]*\n)\n(<br>\n)((?!#{4,5} )(?!\*\*))/gm, '$1$2$3');

    // ── 5. Restore code blocks with <br> wrapping ──────────────────
    codeBlocks.forEach((block, i) => {
      r = r.replace(`${MARK}${i}___`, `\n<br>\n${block}\n<br>\n`);
    });
  } else {
    // ── 5. Restore code blocks (no <br>) ───────────────────────────
    codeBlocks.forEach((block, i) => {
      r = r.replace(`${MARK}${i}___`, block);
    });
  }

  // ── 6. Preserve compact report field lines in Schema 2 cards ─────
  if (cardVersion >= 2) {
    r = preserveCompactReportLineBreaks(r);
  }

  // ── 7. Compress excessive blank lines (3+ → 2) ────────────────
  r = r.replace(/\n{3,}/g, '\n\n');

  return r;
}

function preserveCompactReportLineBreaks(text: string): string {
  const lines = text.split('\n');
  const output: string[] = [];
  let inCodeBlock = false;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    const trimmed = line.trim();
    const next = lines[i + 1];
    const nextTrimmed = next?.trim() ?? '';
    const isFence = /^```/.test(trimmed);

    output.push(line);

    if (inCodeBlock) {
      if (isFence) inCodeBlock = false;
      continue;
    }

    if (isFence) {
      inCodeBlock = true;
      continue;
    }

    if (shouldHardBreakCompactLine(trimmed, nextTrimmed, line)) {
      output[output.length - 1] = line.replace(/\s*$/, '') + '<br>';
    }
  }

  return output.join('\n');
}

function shouldHardBreakCompactLine(
  current: string,
  next: string,
  rawCurrent: string,
): boolean {
  if (!current || !next) return false;
  if (/<br\s*\/?>$/i.test(current) || /\s{2}$/.test(rawCurrent)) return false;
  if (isMarkdownBlockBoundary(current) || isMarkdownBlockBoundary(next)) {
    return false;
  }
  if (isMarkdownListLine(current) || isMarkdownListLine(next)) return false;

  return isCompactReportLine(current) || isCompactReportLine(next);
}

function isMarkdownBlockBoundary(line: string): boolean {
  return (
    /^#{1,6}\s+\S/.test(line) ||
    /^(?:-{3,}|\*{3,}|_{3,})$/.test(line) ||
    /^<br\s*\/?>$/i.test(line) ||
    isMarkdownTableLine(line) ||
    /^>/.test(line)
  );
}

function isMarkdownListLine(line: string): boolean {
  return /^(?:[-*+]\s+\S|\d+[.)]\s+\S)/.test(line);
}

function isMarkdownTableLine(line: string): boolean {
  return /^\|.*\|$/.test(line);
}

function isCompactReportLine(line: string): boolean {
  return (
    /^\*\*[^*\n]+\*\*$/.test(line) || /^(?:📍|💰|🛡️?|📈|⚠️?|🔗)\s/u.test(line)
  );
}

// ---------------------------------------------------------------------------
// stripInvalidImageKeys
// ---------------------------------------------------------------------------

/** Matches complete markdown image syntax: `![alt](value)` */
const IMAGE_RE = /!\[([^\]]*)\]\(([^)\s]+)\)/g;

/**
 * Strip `![alt](value)` where value is not a valid Feishu image key
 * (`img_xxx`). Prevents CardKit error 200570.
 *
 * HTTP URLs and local paths are stripped — only `img_xxx` keys are valid
 * in Feishu card markdown elements.
 */
function stripInvalidImageKeys(text: string): string {
  if (!text.includes('![')) return text;
  return text.replace(IMAGE_RE, (fullMatch, _alt, value) => {
    if (value.startsWith('img_')) return fullMatch;
    return ''; // strip all non-img_ image references
  });
}
