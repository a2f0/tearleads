export const isStaging = import.meta.env.PUBLIC_ENVIRONMENT === "staging";

export const appUrl = isStaging
  ? "https://app.tearleads.de"
  : "https://app.tearleads.com";
