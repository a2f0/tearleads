/**
 * Runs `work` over every lane of a batched read with at most `concurrency`
 * in flight, and returns the results in lane order. The bound keeps a
 * request's database work to what a few singular reads would hold at once,
 * however many lanes it names. The first failure rejects, and no lane is
 * started after it.
 */
export async function mapLanesBounded<Lane, Result>(
  lanes: ReadonlyArray<Lane>,
  concurrency: number,
  work: (lane: Lane) => Promise<Result>,
): Promise<Result[]> {
  const results = new Array<Result>(lanes.length);
  // The workers share one iterator, so each lane is taken once.
  const pending = lanes.entries();
  let failed = false;
  const worker = async () => {
    for (const [index, lane] of pending) {
      if (failed) return;
      try {
        results[index] = await work(lane);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, lanes.length) }, worker),
  );
  return results;
}
