const DEFAULT_ACCESS_TOKEN_TTL_SECONDS = 60 * 60;

export const getAccessTokenTtlSeconds = (): number => {
  const configuredTtl = Number(process.env['ACCESS_TOKEN_TTL_SECONDS']);
  if (Number.isFinite(configuredTtl) && configuredTtl > 0) {
    return configuredTtl;
  }
  return DEFAULT_ACCESS_TOKEN_TTL_SECONDS;
};
