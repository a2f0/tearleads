import { expect, test } from "bun:test";
import missingAssetWorker from "../src/worker/missingAssetWorker";

const shell = "<!doctype html><title>Tearleads</title>";

async function serve(path: string, headers: Record<string, string>) {
  const assetRequests: string[] = [];
  const response = await missingAssetWorker.fetch(
    new Request(`https://app.tearleads.com${path}`, { headers }),
    {
      ASSETS: {
        fetch: (request) => {
          assetRequests.push(new URL(request.url).pathname);
          return Promise.resolve(
            new Response(shell, { headers: { "content-type": "text/html" } }),
          );
        },
      },
    },
  );
  return { assetRequests, response };
}

test("a missing asset is a non-cacheable 404, never the app shell", async () => {
  for (const [path, headers] of [
    // The entry module script after a deploy.
    [
      "/chunk-vvvh3yfx.js",
      { accept: "*/*", "sec-fetch-dest": "script", "sec-fetch-mode": "cors" },
    ],
    // The service worker precaching the chunk.
    [
      "/chunk-vvvh3yfx.js",
      { accept: "*/*", "sec-fetch-dest": "empty", "sec-fetch-mode": "cors" },
    ],
    // A stylesheet, which accepts anything but does not ask for HTML.
    [
      "/chunk-p0hgvq9g.css",
      { accept: "text/css,*/*;q=0.1", "sec-fetch-dest": "style" },
    ],
  ] as const) {
    const { assetRequests, response } = await serve(path, headers);
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toBe("");
    expect(assetRequests).toEqual([]);
  }
});

test("a client route opens even when its request is not marked as a navigation", async () => {
  const accept = "text/html,application/xhtml+xml,*/*;q=0.8";
  for (const headers of [
    // Firefox forwarding a service worker's fetch(event.request).
    { accept, "sec-fetch-dest": "empty", "sec-fetch-mode": "same-origin" },
    // A browser without Fetch Metadata.
    { accept },
  ]) {
    const { assetRequests, response } = await serve(
      "/app/org-manager/billing",
      headers,
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(shell);
    expect(assetRequests).toEqual(["/app/org-manager/billing"]);
  }
});
