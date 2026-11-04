import { waitFor } from "@testing-library/react";

/**
 * A failure message, or a function that builds one when the wait times out.
 * Pass a function when the message reports live state (requests, pane text):
 * a template literal is evaluated before the wait starts, so it would describe
 * the moment the wait began rather than the moment it gave up.
 */
type ConditionMessage = string | (() => string);

function describe(message: ConditionMessage): string {
  return typeof message === "function" ? message() : message;
}

async function waitForConditionWithoutDom(
  predicate: () => boolean | Promise<boolean>,
  message: ConditionMessage,
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

  throw new Error(describe(message));
}

export async function waitForCondition(
  predicate: () => boolean | Promise<boolean>,
  message: ConditionMessage,
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
          throw new Error("Condition not met yet.");
        }
      },
      {
        timeout: timeoutMs,
        interval: intervalMs,
      },
    );
  } catch (error) {
    throw new Error(describe(message), {
      cause: error,
    });
  }
}
