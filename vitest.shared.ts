import type { UserConfig } from 'vitest/config';

export const sharedTestConfig: UserConfig = {
  test: {
    pool: 'threads',
    deps: {
      optimizer: {
        client: { enabled: true },
        ssr: { enabled: true },
      },
    },
  },
};
