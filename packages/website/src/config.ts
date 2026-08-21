export const isStaging = import.meta.env.PUBLIC_ENVIRONMENT === "staging";

export const appUrl = isStaging
  ? "https://app-staging.symcrypt.com"
  : "https://app.symcrypt.com";
