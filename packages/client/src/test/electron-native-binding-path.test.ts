import path from 'node:path';
import {describe, expect, it} from 'vitest';
import {
  resolveSqliteNativeBindingPath,
  SQLITE_NATIVE_BINDING_RELATIVE_PATH,
} from '../../electron/sqlite/nativeBinding';

describe('resolveSqliteNativeBindingPath', () => {
  it('uses env override when provided', () => {
    expect(
      resolveSqliteNativeBindingPath({
        devBasePath: '/tmp/app',
        envOverride: '/custom/better_sqlite3.node',
        isPackaged: false,
        resourcesPath: '/tmp/resources',
      })
    ).toBe('/custom/better_sqlite3.node');
  });

  it('returns unpacked app path for packaged builds', () => {
    expect(
      resolveSqliteNativeBindingPath({
        devBasePath: '/tmp/app',
        envOverride: undefined,
        isPackaged: true,
        resourcesPath: '/tmp/resources',
      })
    ).toBe(
      path.join(
        '/tmp/resources',
        'app.asar.unpacked',
        SQLITE_NATIVE_BINDING_RELATIVE_PATH
      )
    );
  });

  it('returns client-relative generated path for dev builds', () => {
    expect(
      resolveSqliteNativeBindingPath({
        devBasePath: '/tmp/client',
        envOverride: undefined,
        isPackaged: false,
        resourcesPath: '/tmp/resources',
      })
    ).toBe(path.join('/tmp/client', SQLITE_NATIVE_BINDING_RELATIVE_PATH));
  });
});
