async function openDestination(
  directory: FileSystemDirectoryHandle,
  name: string,
  assertCurrent?: () => void,
) {
  try {
    return { handle: await directory.getFileHandle(name), created: false };
  } catch (error) {
    if (!(error instanceof DOMException && error.name === "NotFoundError"))
      throw error;
  }
  assertCurrent?.();
  return {
    handle: await directory.getFileHandle(name, { create: true }),
    created: true,
  };
}

/** The caller holds the destination's write lock until rollback finishes. */
export async function commitOpfsFile(
  directory: FileSystemDirectoryHandle,
  name: string,
  assertCurrent: (() => void) | undefined,
  stage: (writable: FileSystemWritableFileStream) => Promise<void>,
): Promise<void> {
  assertCurrent?.();
  const { handle, created } = await openDestination(
    directory,
    name,
    assertCurrent,
  );
  let writable: FileSystemWritableFileStream | undefined;
  try {
    assertCurrent?.();
    writable = await handle.createWritable();
    await stage(writable);
    assertCurrent?.();
    await writable.close();
  } catch (error) {
    await writable?.abort(error).catch(() => {});
    // Aborting discards staged bytes, but OPFS created the directory entry
    // eagerly. Undo only this write's creation; an existing file is intact.
    if (created) await directory.removeEntry(name);
    throw error;
  }
}
