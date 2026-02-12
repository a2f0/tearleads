#!/usr/bin/env -S pnpm exec tsx
import { pathToFileURL } from "node:url";
import { runMakeAdminFromArgv } from "../src/cli/makeAdmin.ts";

async function main(): Promise<void> {
	await runMakeAdminFromArgv(process.argv.slice(2));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
	main().catch((error) => {
		console.error("Failed to grant admin privileges:", error);
		process.exitCode = 1;
	});
}
