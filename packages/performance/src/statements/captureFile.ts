import { openSync, writeSync } from "node:fs";
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

/**
 * Appends text to a capture file, owner-only. It opens the file once, at the
 * first write, so a run that records nothing leaves no file and the process
 * being measured does not reopen it for each of up to a million records. The
 * descriptor closes when the process exits.
 */
export function createCaptureWriter(path: string): (text: string) => void {
  let descriptor: number | undefined;
  return (text) => {
    descriptor ??= openSync(path, "a", 0o600);
    const bytes = Buffer.from(text);
    for (let offset = 0; offset < bytes.length; )
      offset += writeSync(descriptor, bytes, offset);
  };
}
