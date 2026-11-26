import { readFile } from "node:fs/promises";

/**
 * A capture file's text, or null when none was written: the preload creates
 * it with its first record, so a run that sent no statement and ended no
 * phase leaves none. Any other read error is thrown.
 */
export async function readCaptureFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (Reflect.get(Object(error), "code") === "ENOENT") return null;
    throw error;
  }
}
