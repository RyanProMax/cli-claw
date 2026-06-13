import { describe, expect, test } from 'vitest';

import { isInstalledNodeModulesPackageRoot } from '../../../src/core/app-root.ts';

describe('app root helpers', () => {
  test('detects installed agent-fabric package roots inside node_modules', () => {
    expect(
      isInstalledNodeModulesPackageRoot(
        '/Users/ryan/.nvm/versions/node/v24.14.0/lib/node_modules/agent-fabric',
      ),
    ).toBe(true);
    expect(
      isInstalledNodeModulesPackageRoot(
        '/opt/homebrew/lib/node_modules/agent-fabric',
      ),
    ).toBe(true);
  });

  test('does not treat local checkouts as installed package roots', () => {
    expect(
      isInstalledNodeModulesPackageRoot('/Users/ryan/projects/agent-fabric'),
    ).toBe(false);
    expect(isInstalledNodeModulesPackageRoot('/tmp/agent-fabric')).toBe(false);
  });
});
