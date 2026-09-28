export type StoredManifestVerificationStep<T> =
  | { readonly value: T }
  | {
      readonly dependencies: readonly string[];
      readonly verify: (dependency: (hash: string) => T) => Promise<T>;
    };

interface PendingManifest<T> {
  readonly hash: string;
  readonly step: Exclude<StoredManifestVerificationStep<T>, { value: T }>;
  nextDependency: number;
}

/** Verify a dependency DAG bottom-up without a lifetime history-depth limit. */
export async function verifyStoredManifestGraph<T>(input: {
  readonly rootHash: string;
  readonly prepare: (
    hash: string,
  ) => Promise<StoredManifestVerificationStep<T>>;
  readonly error: (message: string) => Error;
}): Promise<T> {
  const verified = new Map<string, T>();
  const visiting = new Set<string>();
  const stack: PendingManifest<T>[] = [];
  const dependency = (hash: string): T => {
    const value = verified.get(hash);
    if (value === undefined)
      throw input.error("manifest dependency is unverified");
    return value;
  };
  const enqueue = async (hash: string): Promise<void> => {
    if (verified.has(hash)) return;
    if (visiting.has(hash))
      throw input.error("manifest history contains a cycle");
    const step = await input.prepare(hash);
    if ("value" in step) {
      verified.set(hash, step.value);
      return;
    }
    visiting.add(hash);
    stack.push({ hash, step, nextDependency: 0 });
  };
  await enqueue(input.rootHash);
  while (stack.length > 0) {
    const frame = stack.at(-1);
    if (!frame) throw input.error("manifest verification frame is missing");
    const next = frame.step.dependencies[frame.nextDependency];
    if (next !== undefined) {
      frame.nextDependency += 1;
      await enqueue(next);
      continue;
    }
    verified.set(frame.hash, await frame.step.verify(dependency));
    visiting.delete(frame.hash);
    stack.pop();
  }
  return dependency(input.rootHash);
}
