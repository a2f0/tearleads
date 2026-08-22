interface FairBlobWorkCandidate {
  readonly blobId: string;
  readonly queuedAt: Date;
}

function compareQueued(
  left: FairBlobWorkCandidate,
  right: FairBlobWorkCandidate,
): number {
  return (
    left.queuedAt.getTime() - right.queuedAt.getTime() ||
    left.blobId.localeCompare(right.blobId)
  );
}

/**
 * Selects bounded work from new and retry queues without starving either class.
 * Inputs must be oldest-first. For a one-slot sweep, the oldest comparable
 * queue time wins; larger sweeps reserve capacity for both non-empty classes.
 */
export function selectFairBlobWorkCandidates<
  Candidate extends FairBlobWorkCandidate,
>(
  newWork: readonly Candidate[],
  retries: readonly Candidate[],
  limit: number,
): Candidate[] {
  const retryBlobIds = new Set(retries.map((candidate) => candidate.blobId));
  const disjointNewWork = newWork.filter(
    (candidate) => !retryBlobIds.has(candidate.blobId),
  );
  if (disjointNewWork.length === 0 || retries.length === 0) {
    return [...disjointNewWork, ...retries].slice(0, limit);
  }
  const oldestNew = disjointNewWork[0];
  const oldestRetry = retries[0];
  if (!oldestNew || !oldestRetry) {
    throw new Error("Fair blob work selection lost a candidate");
  }
  if (limit === 1) {
    return [
      oldestRetry.queuedAt.getTime() < oldestNew.queuedAt.getTime()
        ? oldestRetry
        : oldestNew,
    ];
  }

  const newQuota = Math.ceil(limit / 2);
  const retryQuota = Math.floor(limit / 2);
  const selected = [
    ...disjointNewWork.slice(0, newQuota),
    ...retries.slice(0, retryQuota),
  ];
  selected.push(
    ...[...disjointNewWork.slice(newQuota), ...retries.slice(retryQuota)]
      .sort(compareQueued)
      .slice(0, limit - selected.length),
  );
  return selected;
}
