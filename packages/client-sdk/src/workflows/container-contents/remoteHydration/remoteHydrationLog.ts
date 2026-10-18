// Phrases the container-hydration result so the log distinguishes a genuine
// first-time download from a device-first re-pull.
//
// `changedCount` counts every container reconciled in a pass (upserts +
// tombstone removals); `insertedCount` is the subset that did not exist locally
// before this pass. On a fresh bootstrap the system containers are recreated
// locally first, so the server re-pull reconciles already-local containers
// (insertedCount 0) rather than downloading new ones — and the log should not
// read as the server having sent new data.
export function describeRemoteContainerHydration(input: {
  changedCount: number;
  insertedCount: number;
}): string {
  const reconciledCount = input.changedCount - input.insertedCount;
  if (input.insertedCount === 0) {
    return `Container contents: reconciled ${reconciledCount} already-local container(s) with the server`;
  }
  if (reconciledCount === 0) {
    return `Container contents: hydrated ${input.insertedCount} new remote container(s) from the server`;
  }
  return `Container contents: hydrated ${input.insertedCount} new remote container(s) from the server (${reconciledCount} already local)`;
}
