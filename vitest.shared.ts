import os from 'node:os';

// Cap workers to avoid oversubscribing CPU on high-core machines while still
// allowing useful parallelism.
const availableCpus = os.availableParallelism();
export const vitestMaxWorkers = Math.max(1, Math.floor(availableCpus / 4));

export const sharedTestConfig = {
  test: {
    pool: 'threads' as const,
    maxWorkers: vitestMaxWorkers,
    deps: {
      optimizer: {
        client: { enabled: true },
        ssr: { enabled: true },
      },
    },
  },
};
