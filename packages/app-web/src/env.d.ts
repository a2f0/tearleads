declare namespace NodeJS {
  interface ProcessEnv {
    BUN_PUBLIC_API_BASE_URL?: string;
    /** Build identity, stamped by scripts/withBuildInfoEnv.sh. */
    BUN_PUBLIC_APP_VERSION?: string;
    BUN_PUBLIC_APP_VARIANT?: string;
    BUN_PUBLIC_GIT_SHA?: string;
    /** Stripe publishable key for the direct checkout Payment Element. */
    BUN_PUBLIC_STRIPE_PUBLISHABLE_KEY?: string;
    BUN_PUBLIC_WS_URL?: string;
  }
}
