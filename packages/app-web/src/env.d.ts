declare namespace NodeJS {
  interface ProcessEnv {
    BUN_PUBLIC_API_BASE_URL?: string;
    /** Build identity, stamped by scripts/withBuildInfoEnv.sh. */
    BUN_PUBLIC_APP_VERSION?: string;
    BUN_PUBLIC_APP_VARIANT?: string;
    BUN_PUBLIC_GIT_SHA?: string;
    BUN_PUBLIC_REVENUECAT_SYNC_ENTITLEMENT?: string;
    BUN_PUBLIC_REVENUECAT_WEB_API_KEY?: string;
    BUN_PUBLIC_WS_URL?: string;
  }
}
