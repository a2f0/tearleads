import type { ElectrobunConfig } from "electrobun";

export default {
  app: {
    name: "Tearleads",
    identifier: "com.tearleads.app",
    version: "0.0.1",
  },
  runtime: {
    exitOnLastWindowClosed: true,
  },
  build: {
    mainProcess: "bun",
    bun: {
      entrypoint: "src/bun/index.ts",
    },
    views: {
      mainview: {
        entrypoint: "src/renderer/index.html",
        // Hutch's bundler uses explicit defines for the existing public build
        // environment supplied by scripts/withBuildInfoEnv.sh.
        define: Object.fromEntries(
          Object.entries(process.env)
            .filter(
              ([name, value]) =>
                name.startsWith("BUN_PUBLIC_") && value !== undefined,
            )
            .map(([name, value]) => [
              `process.env.${name}`,
              JSON.stringify(value),
            ]),
        ),
      },
    },
  },
} satisfies ElectrobunConfig;
