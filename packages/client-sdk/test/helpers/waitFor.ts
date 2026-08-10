/** Poll until the predicate holds, failing with the given message on timeout. */
export async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  message: string,
  timeoutMs = 1_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(message);
}
