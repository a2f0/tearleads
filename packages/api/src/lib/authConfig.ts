const DEFAULT_ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
const DEFAULT_REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

const createTtlGetter =
  (envVar: string, defaultValue: number) => (): number => {
    const configuredTtl = Number(process.env[envVar]);
    if (Number.isFinite(configuredTtl) && configuredTtl > 0) {
      return configuredTtl;
    }
    return defaultValue;
  };

export const getAccessTokenTtlSeconds = createTtlGetter(
  'ACCESS_TOKEN_TTL_SECONDS',
  DEFAULT_ACCESS_TOKEN_TTL_SECONDS
);

export const getRefreshTokenTtlSeconds = createTtlGetter(
  'REFRESH_TOKEN_TTL_SECONDS',
  DEFAULT_REFRESH_TOKEN_TTL_SECONDS
);
