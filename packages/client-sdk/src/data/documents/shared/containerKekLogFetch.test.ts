import { expect, spyOn, test } from "bun:test";
import { ApiClient } from "@tearleads/api-client";
import { CONTAINER_KEK_LOG_PAGE_LIMIT } from "@tearleads/validators/util";
import { fetchContainerKekLog } from "./containerKekLogFetch";

test("KEK recovery uses the real API client with an omitted initial cursor and positive continuation", async () => {
  const containerId = crypto.randomUUID();
  const requests: URL[] = [];
  const baseUrl = "https://kek-log-recovery.test";
  const originalFetch = globalThis.fetch;
  const fetchHandler: typeof fetch = Object.assign(
    async (
      input: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1],
    ) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.origin !== baseUrl) return originalFetch(input, init);
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
    { preconnect: originalFetch.preconnect },
  );
  const fetchMock = spyOn(globalThis, "fetch").mockImplementation(fetchHandler);
  try {
    const log = await fetchContainerKekLog({
      apiClient: new ApiClient(baseUrl),
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
    fetchMock.mockRestore();
  }
});
