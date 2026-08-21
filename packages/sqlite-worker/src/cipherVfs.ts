import type { Sqlite3Static } from "@symcrypt/sqlite-instance";

/**
 * Invokes the untyped `sqlite3mc_vfs_create` SQLite3MultipleCiphers C export,
 * which is not part of the typed wasm CAPI. It wraps an already-registered VFS
 * with the multiple-ciphers codec and returns SQLITE_OK (0) on success.
 */
function callCreateCipherVfs(
  sqlite3: Sqlite3Static,
  underlyingVfsName: string,
): number | null {
  const fn = Reflect.get(sqlite3.capi, "sqlite3mc_vfs_create");
  if (typeof fn !== "function") {
    return null;
  }

  const result = Reflect.apply(fn, sqlite3.capi, [underlyingVfsName, 0]);
  return typeof result === "number" ? result : null;
}

/**
 * Wraps an existing VFS with SQLite3MultipleCiphers and returns the registered
 * wrapper name. The wrapper must be reused while it remains registered: trying
 * to create a second wrapper for the same underlying VFS returns SQLITE_NOTFOUND.
 */
export function createCipherVfs(
  sqlite3: Sqlite3Static,
  underlyingVfsName: string,
): string {
  const before = new Set(sqlite3.capi.sqlite3_js_vfs_list());
  const rc = callCreateCipherVfs(sqlite3, underlyingVfsName);
  if (rc === null) {
    throw new Error(
      "Persistent storage requested but the SQLite build does not provide sqlite3mc_vfs_create.",
    );
  }
  if (rc !== 0) {
    throw new Error(
      `Failed to create the multiple-ciphers VFS over ${underlyingVfsName} (rc=${rc}).`,
    );
  }

  const created = sqlite3.capi
    .sqlite3_js_vfs_list()
    .filter((name) => !before.has(name));
  const cipherVfsName =
    created.find((name) => name.includes(underlyingVfsName)) ?? created[0];
  if (!cipherVfsName) {
    throw new Error(
      "The multiple-ciphers VFS was created but could not be located in the VFS list.",
    );
  }

  return cipherVfsName;
}

/**
 * Unregisters and frees a wrapper previously created by sqlite3mc_vfs_create.
 * Call only after its database connections have closed and before removing the
 * underlying VFS, otherwise the wrapper retains a dangling underlying pointer.
 */
export function destroyCipherVfs(
  sqlite3: Sqlite3Static,
  cipherVfsName: string,
): void {
  const fn = Reflect.get(sqlite3.capi, "sqlite3mc_vfs_destroy");
  if (typeof fn !== "function") {
    throw new Error("The SQLite build does not provide sqlite3mc_vfs_destroy.");
  }

  Reflect.apply(fn, sqlite3.capi, [cipherVfsName]);
}
