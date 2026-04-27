import { waitFor } from "@testing-library/react";

async function waitForConditionWithoutDom(
  predicate: () => boolean | Promise<boolean>,
  message: string,
  timeoutMs: number,
  intervalMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() <= deadline) {
    if (await predicate()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(message);
}

export async function waitForCondition(
  predicate: () => boolean | Promise<boolean>,
  message: string,
  timeoutMs = 10_000,
  intervalMs = 50,
): Promise<void> {
  if (typeof window === "undefined") {
    await waitForConditionWithoutDom(predicate, message, timeoutMs, intervalMs);
    return;
  }

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
