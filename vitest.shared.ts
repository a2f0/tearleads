export const sharedTestConfig = {
  test: {
    pool: 'threads' as const,
    deps: {
      optimizer: {
        client: { enabled: true },
        ssr: { enabled: true },
      },
    },
  },
};
