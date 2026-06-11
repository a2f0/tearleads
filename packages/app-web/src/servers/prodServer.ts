import { serve } from "bun";
import { serverConfig } from "./serverConfig";

const server = serve({
  ...serverConfig,
  development: false,
});

console.log(`Server running at ${server.url}`);
