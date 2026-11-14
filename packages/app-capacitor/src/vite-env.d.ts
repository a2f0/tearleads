/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SENTRY_DSN?: string;
  readonly VITE_SENTRY_ENVIRONMENT?: string;
  readonly VITE_SENTRY_COMMIT?: string;
  readonly VITE_SENTRY_PLATFORM?: string;
  readonly VITE_API_BASE_URL?: string;
  /** Build identity, resolved and inlined by vite.config.ts. */
  readonly VITE_APP_VERSION?: string;
  readonly VITE_GIT_SHA?: string;
  readonly VITE_PACKAGE_VERSIONS?: string;
  readonly VITE_REVENUECAT_ANDROID_API_KEY?: string;
  readonly VITE_REVENUECAT_IOS_API_KEY?: string;
  readonly VITE_REVENUECAT_SYNC_ENTITLEMENT?: string;
  readonly VITE_WS_URL?: string;
}
