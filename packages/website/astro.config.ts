import react from "@astrojs/react";
import { defineConfig } from "astro/config";

export default defineConfig({
  output: "static",
  integrations: [react()],
  server: {
    port: 4322,
  },
});
