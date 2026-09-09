import type { Plugin } from "vite";
import { isNativeSentryAssetPath } from "../src/diagnostics/sentryConfig";

// This packaged manifest is the exact allowlist of generated JavaScript paths.
// A filename pattern alone could mistake an entity ID in a URL for a code asset.
export function sentryAssetsPlugin(config: {
  dsn?: string | undefined;
  commit?: string | undefined;
  platform?: string | undefined;
  environment?: string | undefined;
}): Plugin {
  return {
    name: "sentry-assets",
    generateBundle(_options, bundle) {
      if (!config.dsn) return;
      const paths = Object.values(bundle)
        .filter((output) => output.type === "chunk")
        .map((output) => `/${output.fileName}`);
      if (!paths.length || !paths.every(isNativeSentryAssetPath)) {
        this.error(
          "Native Sentry assets must use the packaged /assets/*.js layout",
        );
      }
      this.emitFile({
        type: "asset",
        fileName: "sentry-assets.json",
        source: JSON.stringify({
          commit: config.commit,
          platform: config.platform,
          environment: config.environment,
          paths,
        }),
      });
    },
  };
}
