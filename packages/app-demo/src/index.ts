import {
  type AppHostConfigOptions,
  createAppHostConfig,
  DEMO_APP_HOST_PROFILE,
} from "app/host/AppHostConfig";

export type DemoAppHostConfigOptions = Omit<AppHostConfigOptions, "profile">;

export function createDemoAppHostConfig(options: DemoAppHostConfigOptions) {
  return createAppHostConfig({
    ...options,
    profile: DEMO_APP_HOST_PROFILE,
  });
}
