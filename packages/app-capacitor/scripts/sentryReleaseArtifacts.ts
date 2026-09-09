import { unlink } from "node:fs/promises";
import { resolve } from "node:path";

export async function uploadNativeSentryMaps(
  directory: string,
  upload: () => Promise<number>,
): Promise<void> {
  try {
    if ((await upload()) !== 0)
      throw new Error(
        "Native source map upload failed; release must not be packaged",
      );
  } finally {
    // Keep source out of a later manual cap sync, including after upload failure.
    for await (const path of new Bun.Glob("**/*.map").scan(directory)) {
      await unlink(resolve(directory, path));
    }
  }
}
