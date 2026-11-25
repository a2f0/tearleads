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
  let next = 0;
  let failed = false;
  const worker = async () => {
    while (!failed && next < lanes.length) {
      const index = next;
      next += 1;
      try {
        // The index is below the length, so the lane exists.
        results[index] = await work(lanes[index] as Lane);
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
