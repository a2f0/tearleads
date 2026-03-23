import { serve } from "bun";
import { serverConfig } from "./serverConfig";

const server = serve({
	port: 3100,
	...serverConfig,
});

console.log(`E2E server running at ${server.url}`);
