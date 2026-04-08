import { waitFor } from "@testing-library/react";

export async function waitForCondition(
  predicate: () => boolean | Promise<boolean>,
  message: string,
  timeoutMs = 10_000,
  intervalMs = 50,
): Promise<void> {
  try {
    await waitFor(
      async () => {
        const matched = await predicate();
        if (!matched) {
          throw new Error(message);
        }
      },
      {
        timeout: timeoutMs,
        interval: intervalMs,
      },
    );
  } catch (error) {
    throw new Error(message, {
      cause: error,
    });
  }
}
