/** Runs work for a key after the work already queued for it; idle keys hold nothing. */
export function createKeyedQueue() {
  const tails = new Map<string, Promise<void>>();
  return <T>(key: string, work: () => Promise<T>): Promise<T> => {
    const operation = (tails.get(key) ?? Promise.resolve()).then(work);
    const settled = operation.then(
      () => undefined,
      () => undefined,
    );
    tails.set(key, settled);
    void settled.then(() => {
      if (tails.get(key) === settled) tails.delete(key);
    });
    return operation;
  };
}
