import { expect, test } from "bun:test";
import { ApiClient } from "@tearleads/api-client";
import { CONTAINER_KEK_LOG_PAGE_LIMIT } from "@tearleads/validators/util";
import { fetchContainerKekLog } from "./containerKekLogFetch";

test("KEK recovery uses the real API client with an omitted initial cursor and positive continuation", async () => {
  const containerId = crypto.randomUUID();
  const requests: URL[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      requests.push(url);
      const after = Number(url.searchParams.get("afterKeyEpoch") ?? 0);
      const hasMore = after === 0;
      return Response.json({
        containerId,
        hasMore,
        // This tests transport and pagination, not cryptographic log opening.
        epochs: Array.from(
          { length: hasMore ? CONTAINER_KEK_LOG_PAGE_LIMIT : 1 },
          (_, index) => ({
            accessManifestHash: "manifest",
            bridge: null,
            containerKeyEpoch: after + index + 1,
            containerKeyEpochId: `epoch:${after + index + 1}`,
            keyring: null,
            parentContainerKeyEpochId: null,
            wraps: [],
          }),
        ),
      });
    },
  });
  try {
    const log = await fetchContainerKekLog({
      apiClient: new ApiClient(server.url.toString()),
      containerId,
      keyringForEpoch: 2,
    });
    expect(requests).toHaveLength(2);
    expect(requests.map((url) => url.pathname)).toEqual([
      `/containers/${containerId}/kek-log`,
      `/containers/${containerId}/kek-log`,
    ]);
    expect(requests[0]?.searchParams.has("afterKeyEpoch")).toBe(false);
    expect(requests[1]?.searchParams.get("afterKeyEpoch")).toBe(
      String(CONTAINER_KEK_LOG_PAGE_LIMIT),
    );
    expect(
      requests.map((url) => url.searchParams.get("keyringForEpoch")),
    ).toEqual(["2", "2"]);
    expect(log.epochs.map((epoch) => epoch.containerKeyEpoch)).toEqual(
      Array.from({ length: CONTAINER_KEK_LOG_PAGE_LIMIT + 1 }, (_, i) => i + 1),
    );
  } finally {
    await server.stop(true);
  }
});
