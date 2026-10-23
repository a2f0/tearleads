import react from "@astrojs/react";
import { defineConfig } from "astro/config";
import { seoIntegration } from "./src/seoIntegration";

// PUBLIC_ENVIRONMENT (production or staging) selects the crawler files. Build
// tests point WEBSITE_PUBLIC_DIR at a staged fixture gallery, leaving public/
// alone.
const { PUBLIC_ENVIRONMENT, WEBSITE_PUBLIC_DIR } = process.env;

export default defineConfig({
  output: "static",
  publicDir: WEBSITE_PUBLIC_DIR ?? "./public",
  integrations: [react(), seoIntegration(PUBLIC_ENVIRONMENT)],
  server: {
    port: 4322,
  },
});
