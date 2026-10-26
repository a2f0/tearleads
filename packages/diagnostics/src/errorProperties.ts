/** Do not invoke getters while inspecting an untrusted error or its causes. */
export function errorDataProperty(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  return Object.getOwnPropertyDescriptor(value, key)?.value;
}

// V8 exposes lazy Error stacks through one shared native accessor. Capture its
// identity from an error we own; never execute a getter supplied by a caller.
const nativeStackGetter = Object.getOwnPropertyDescriptor(
  new Error(),
  "stack",
)?.get;

export function diagnosticErrorStack(error: Error): string | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(error, "stack");
  if (typeof descriptor?.value === "string") return descriptor.value;
  if (!nativeStackGetter || descriptor?.get !== nativeStackGetter)
    return undefined;
  try {
    const stack: unknown = nativeStackGetter.call(error);
    return typeof stack === "string" ? stack : undefined;
  } catch {
    return undefined;
  }
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
