import {
  type ContainerKekKeyringEntry,
  verifyContainerKekKeyringEntry,
} from "@tearleads/crypto";

/** Bound outstanding key derivations and yield between batches on cold histories. */
export async function verifyContainerKekEntries(
  containerId: string,
  entries: readonly ContainerKekKeyringEntry[],
): Promise<void> {
  const batchSize = 16;
  for (let start = 0; start < entries.length; start += batchSize) {
    await Promise.all(
      entries.slice(start, start + batchSize).map((entry, ordinal) =>
        verifyContainerKekKeyringEntry({
          containerId,
          entry,
          keyEpoch: start + ordinal + 1,
        }),
      ),
    );
    if (start + batchSize < entries.length)
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}
