/**
 * Shared skill utility functions.
 * Used by repository-level skill command dispatch and workflow role parsing.
 */
import fs from 'fs';
import path from 'path';

// --- Functions ---

export function validateSkillPath(
  skillsRoot: string,
  skillDir: string,
): boolean {
  try {
    const realSkillsRoot = fs.realpathSync(skillsRoot);
    const realSkillDir = fs.realpathSync(skillDir);
    const relative = path.relative(realSkillsRoot, realSkillDir);
    return !relative.startsWith('..') && !path.isAbsolute(relative);
  } catch {
    return false;
  }
}

export function parseFrontmatter(content: string): Record<string, string> {
  const lines = content.split('\n');
  if (lines[0]?.trim() !== '---') return {};

  const endIndex = lines.slice(1).findIndex((line) => line.trim() === '---');
  if (endIndex === -1) return {};

  const frontmatterLines = lines.slice(1, endIndex + 1);
  const result: Record<string, string> = {};
  let currentKey: string | null = null;
  let currentValue: string[] = [];
  let multilineMode: 'folded' | 'literal' | null = null;

  for (const line of frontmatterLines) {
    const keyMatch = line.match(/^([\w\-]+):\s*(.*)$/);
    if (keyMatch) {
      // Save previous key if exists
      if (currentKey) {
        result[currentKey] = currentValue.join(
          multilineMode === 'literal' ? '\n' : ' ',
        );
      }

      currentKey = keyMatch[1];
      const value = keyMatch[2].trim();

      if (value === '>') {
        multilineMode = 'folded';
        currentValue = [];
      } else if (value === '|') {
        multilineMode = 'literal';
        currentValue = [];
      } else {
        result[currentKey] = value;
        currentKey = null;
        currentValue = [];
        multilineMode = null;
      }
    } else if (currentKey && multilineMode) {
      const trimmedLine = line.trimStart();
      if (trimmedLine) {
        currentValue.push(trimmedLine);
      }
    }
  }

  // Save last key
  if (currentKey) {
    result[currentKey] = currentValue.join(
      multilineMode === 'literal' ? '\n' : ' ',
    );
  }

  return result;
}
