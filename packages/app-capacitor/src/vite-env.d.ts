/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_REVENUECAT_ANDROID_API_KEY?: string;
  readonly VITE_REVENUECAT_IOS_API_KEY?: string;
  readonly VITE_REVENUECAT_SYNC_ENTITLEMENT?: string;
  readonly VITE_WS_URL?: string;
}
