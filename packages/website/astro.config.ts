import react from "@astrojs/react";
import { defineConfig } from "astro/config";
import { freshDocsCache, rehypeDocLinks } from "./src/rehypeDocLinks";
import { seoIntegration } from "./src/seoIntegration";

// PUBLIC_ENVIRONMENT (production or staging) selects the crawler files. Build
// tests point WEBSITE_PUBLIC_DIR at a staged fixture gallery, leaving public/
// alone.
const { PUBLIC_ENVIRONMENT, WEBSITE_PUBLIC_DIR } = process.env;

export default defineConfig({
  output: "static",
  publicDir: WEBSITE_PUBLIC_DIR ?? "./public",
  integrations: [react(), seoIntegration(PUBLIC_ENVIRONMENT), freshDocsCache()],
  markdown: {
    // The site is grayscale; code blocks render as plain monospace text.
    syntaxHighlight: false,
    rehypePlugins: [rehypeDocLinks],
  },
  server: {
    port: 4322,
  },
});
