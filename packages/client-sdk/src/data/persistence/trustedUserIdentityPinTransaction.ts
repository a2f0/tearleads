const MAX_CONTENTION_ATTEMPTS = 8;

export class TrustedUserIdentityPinContentionError extends Error {
  readonly code = "trusted_user_identity_pin_contention";

  constructor() {
    super("Trusted identity pin transaction remained busy after retry");
    this.name = "TrustedUserIdentityPinContentionError";
  }
}

function errorChainMessages(error: unknown): string[] {
  const messages: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 4; depth += 1) {
    if (typeof current !== "object" || current === null) {
      break;
    }
    const message = Reflect.get(current, "message");
    if (typeof message === "string") {
      messages.push(message);
    }
    current = Reflect.get(current, "cause");
  }
  return messages;
}

function isImmediateTransactionContention(error: unknown): boolean {
  return errorChainMessages(error).some((message) =>
    /SQLITE_(?:BUSY|LOCKED)|database(?: table)? is locked|cannot start a transaction within a transaction/iu.test(
      message,
    ),
  );
}

function contentionDelay(attempt: number): Promise<void> {
  const delayMs = Math.min(2 ** attempt, 32);
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

/** Retry only acquisition contention; transaction/body errors pass through. */
export async function runTrustedUserIdentityPinTransaction<T>(
  operation: () => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < MAX_CONTENTION_ATTEMPTS; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isImmediateTransactionContention(error)) {
        throw error;
      }
      if (attempt + 1 === MAX_CONTENTION_ATTEMPTS) {
        throw new TrustedUserIdentityPinContentionError();
      }
      await contentionDelay(attempt);
    }
  }
  throw new TrustedUserIdentityPinContentionError();
}
