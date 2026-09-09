import type { Plugin } from "vite";

// This packaged manifest is the exact allowlist of generated JavaScript paths.
// A filename pattern alone could mistake an entity ID in a URL for a code asset.
export function sentryAssetsPlugin(): Plugin {
  return {
    name: "sentry-assets",
    generateBundle(_options, bundle) {
      const {
        VITE_SENTRY_DSN,
        VITE_SENTRY_COMMIT,
        VITE_SENTRY_PLATFORM,
        VITE_SENTRY_ENVIRONMENT,
      } = process.env;
      if (!VITE_SENTRY_DSN) return;
      const paths = Object.values(bundle)
        .filter((output) => output.type === "chunk")
        .map((output) => `/${output.fileName}`);
      this.emitFile({
        type: "asset",
        fileName: "sentry-assets.json",
        source: JSON.stringify({
          commit: VITE_SENTRY_COMMIT,
          platform: VITE_SENTRY_PLATFORM,
          environment: VITE_SENTRY_ENVIRONMENT,
          paths,
        }),
      });
    },
  };
}
