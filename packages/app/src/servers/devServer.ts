import { serve } from "bun";
import { serverConfig } from "./serverConfig";

const server = serve({
	...serverConfig,
	development: process.env.NODE_ENV !== "production" && {
		hmr: true,
		console: true,
	},
});

console.log(`Server running at ${server.url}`);
