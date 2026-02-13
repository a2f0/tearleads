import path from 'node:path';

export const SQLITE_NATIVE_BINDING_RELATIVE_PATH = path.join(
  '.generated',
  'electron-native',
  'better_sqlite3.node'
);

interface ResolveSqliteNativeBindingPathOptions {
  devBasePath: string;
  envOverride: string | undefined;
  isPackaged: boolean;
  resourcesPath: string;
}

export function resolveSqliteNativeBindingPath(
  options: ResolveSqliteNativeBindingPathOptions
): string {
  if (options.envOverride) {
    return options.envOverride;
  }

  if (options.isPackaged) {
    return path.join(
      options.resourcesPath,
      'app.asar.unpacked',
      SQLITE_NATIVE_BINDING_RELATIVE_PATH
    );
  }

  return path.join(options.devBasePath, SQLITE_NATIVE_BINDING_RELATIVE_PATH);
}
