import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function toModuleDirectory(moduleLocation: string): string {
  const resolvedLocation = moduleLocation.startsWith('file:')
    ? fileURLToPath(moduleLocation)
    : path.resolve(moduleLocation);

  try {
    if (fs.statSync(resolvedLocation).isDirectory()) {
      return resolvedLocation;
    }
  } catch {
    // Fall back to treating the input as a file path.
  }

  return path.dirname(resolvedLocation);
}

export function findPackageRoot(moduleLocation: string): string {
  let currentDir = toModuleDirectory(moduleLocation);

  while (true) {
    const packageJsonPath = path.join(currentDir, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      return currentDir;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      throw new Error(`Unable to locate package.json from ${moduleLocation}`);
    }
    currentDir = parentDir;
  }
}

export const PACKAGE_ROOT = findPackageRoot(import.meta.url);
export const APP_ROOT = PACKAGE_ROOT;
export const LAUNCH_CWD = (() => {
  try {
    return fs.realpathSync(process.cwd());
  } catch {
    return path.resolve(process.cwd());
  }
})();

export function resolveAppPath(...segments: string[]): string {
  return path.join(APP_ROOT, ...segments);
}

export function resolvePackagePath(...segments: string[]): string {
  return path.join(PACKAGE_ROOT, ...segments);
}

export function resolvePackageDependency(specifier: string): string {
  const packageRequire = createRequire(resolvePackagePath('package.json'));
  return packageRequire.resolve(specifier);
}

export function isInstalledNodeModulesPackageRoot(
  packageRoot: string = PACKAGE_ROOT,
  packageName = 'cli-claw-kit',
): boolean {
  const normalizedRoot = path.resolve(packageRoot);
  const expectedSuffix = path.join('node_modules', packageName);
  return (
    normalizedRoot === expectedSuffix ||
    normalizedRoot.endsWith(path.sep + expectedSuffix)
  );
}
