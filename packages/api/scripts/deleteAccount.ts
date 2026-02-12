#!/usr/bin/env -S pnpm exec tsx
import { pathToFileURL } from "node:url";
import { runDeleteAccountFromArgv } from "../src/cli/deleteAccount.ts";

async function main(): Promise<void> {
	await runDeleteAccountFromArgv(process.argv.slice(2));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
	main().catch((error) => {
		console.error("Failed to delete account:", error);
		process.exitCode = 1;
	});
}
