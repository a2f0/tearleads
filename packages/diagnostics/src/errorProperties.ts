/** Do not invoke getters while inspecting an untrusted error or its causes. */
export function errorDataProperty(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  return Object.getOwnPropertyDescriptor(value, key)?.value;
}

export function diagnosticErrorChain(error: unknown): Error[] {
  const chain: Error[] = [];
  let current = error;
  while (
    current instanceof Error &&
    chain.length < 5 &&
    !chain.includes(current)
  ) {
    chain.push(current);
    current = errorDataProperty(current, "cause");
  }
  return chain;
}
