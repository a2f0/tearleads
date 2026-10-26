/** Polls `check` until it holds, failing with `label` after `timeoutMs`. */
export async function until(
  check: () => boolean | Promise<boolean>,
  label: string,
  timeoutMs = 20_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${label}`);
    }
    await Bun.sleep(25);
  }
}
