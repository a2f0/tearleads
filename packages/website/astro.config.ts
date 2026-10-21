import react from "@astrojs/react";
import { defineConfig } from "astro/config";

// Build tests point this at a staged fixture gallery, leaving public/ alone.
const { WEBSITE_PUBLIC_DIR } = process.env;

export default defineConfig({
  output: "static",
  publicDir: WEBSITE_PUBLIC_DIR ?? "./public",
  integrations: [react()],
  server: {
    port: 4322,
  },
});
