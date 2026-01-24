const DEFAULT_ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
const DEFAULT_REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

export const getAccessTokenTtlSeconds = (): number => {
  const configuredTtl = Number(process.env['ACCESS_TOKEN_TTL_SECONDS']);
  if (Number.isFinite(configuredTtl) && configuredTtl > 0) {
    return configuredTtl;
  }
  return DEFAULT_ACCESS_TOKEN_TTL_SECONDS;
};

export const getRefreshTokenTtlSeconds = (): number => {
  const configuredTtl = Number(process.env['REFRESH_TOKEN_TTL_SECONDS']);
  if (Number.isFinite(configuredTtl) && configuredTtl > 0) {
    return configuredTtl;
  }
  return DEFAULT_REFRESH_TOKEN_TTL_SECONDS;
};
