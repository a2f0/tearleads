import os from 'node:os';

// Cap vitest worker threads per project. In workspace mode each of the ~48
// packages gets its own thread pool, so even a small per-project limit adds
// up quickly. Using cpus/4 keeps total CPU usage reasonable.
const cpus = (os.availableParallelism?.() ?? os.cpus().length) || 1;
const maxThreads = Math.max(1, Math.floor(cpus / 4));

export const sharedTestConfig = {
  test: {
    pool: 'threads' as const,
    poolOptions: {
      threads: {
        maxThreads,
        minThreads: 1,
      },
    },
    deps: {
      optimizer: {
        client: { enabled: true },
        ssr: { enabled: true },
      },
    },
  },
};
