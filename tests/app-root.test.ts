import { describe, expect, test } from 'vitest';

import { isInstalledNodeModulesPackageRoot } from '../src/app-root.ts';

describe('app root helpers', () => {
  test('detects installed cli-claw package roots inside node_modules', () => {
    expect(
      isInstalledNodeModulesPackageRoot(
        '/Users/ryan/.nvm/versions/node/v24.14.0/lib/node_modules/cli-claw-kit',
      ),
    ).toBe(true);
    expect(
      isInstalledNodeModulesPackageRoot(
        '/opt/homebrew/lib/node_modules/cli-claw-kit',
      ),
    ).toBe(true);
  });

  test('does not treat local checkouts as installed package roots', () => {
    expect(
      isInstalledNodeModulesPackageRoot('/Users/ryan/projects/cli-claw'),
    ).toBe(false);
    expect(isInstalledNodeModulesPackageRoot('/tmp/cli-claw-kit')).toBe(false);
  });
});
