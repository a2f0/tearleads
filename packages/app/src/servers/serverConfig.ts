import index from "../index.html";

const workerBuild = await Bun.build({
	entrypoints: [
		new URL("../db/sqliteWorkerThread.ts", import.meta.url).pathname,
	],
	target: "browser",
	format: "esm",
});

const workerScript = workerBuild.outputs[0];

export const serverConfig = {
	routes: {
		"/worker.js": new Response(workerScript, {
			headers: { "Content-Type": "application/javascript" },
		}),
		"/*": index,
	},
};
