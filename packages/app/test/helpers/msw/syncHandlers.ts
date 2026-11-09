import type {
  ListContainerDocumentLanesResponse,
  ListContainerParentLanesResponse,
} from "@tearleads/validators/response";
import { HttpResponse, http } from "msw";

/** Answers every requested lane of a batched listing with an empty page. */
async function emptyLaneResults(request: Request) {
  const input = (await request.json()) as {
    lanes?: Array<{ laneId?: unknown }> | undefined;
  };
  const lanes = Array.isArray(input.lanes) ? input.lanes : [];
  return lanes.flatMap((lane) =>
    typeof lane.laneId === "string"
      ? [
          {
            laneId: lane.laneId,
            page: {
              hasMore: false,
              items: [],
              nextWatermark: null,
              tombstones: [],
            },
          },
        ]
      : [],
  );
}

// Background sync reads that tests without useTestApiAppHandlers still send.
export const syncHandlers = [
  http.post(
    "http://localhost:3001/containers/parent-lanes/query",
    async ({ request }) =>
      HttpResponse.json<ListContainerParentLanesResponse>({
        results: await emptyLaneResults(request),
      }),
  ),
  http.post(
    "http://localhost:3001/containers/documents/query",
    async ({ request }) =>
      HttpResponse.json<ListContainerDocumentLanesResponse>({
        results: await emptyLaneResults(request),
      }),
  ),

  http.get(
    "http://localhost:3001/containers/:containerId/writer-projection",
    () => {
      return HttpResponse.json({ error: "Not Found" }, { status: 404 });
    },
  ),
  http.post("http://localhost:3001/documents", () => {
    return HttpResponse.json({ error: "Unauthorized" }, { status: 401 });
  }),
  // Background sync fires from any test that establishes an identity, including
  // the ones that never opt into useTestApiAppHandlers. A success response is not
  // constructible here: a shape-valid fake would fail write-header signature
  // verification against the document's synced content-key state.
  // 401 is the one failure the SDK handles cleanly — it is not refreshable (so no
  // session-refresh replay), and unlike 402/404 it triggers no onPaymentRequired
  // or onRemoteDocumentDeleted side effect. The lane reports and stops.
  http.post("http://localhost:3001/documents/:documentId/sync", () => {
    return HttpResponse.json({ error: "Unauthorized" }, { status: 401 });
  }),
  http.get(
    "http://localhost:3001/documents/:documentId/writer-projection",
    () => {
      return HttpResponse.json({ error: "Not Found" }, { status: 404 });
    },
  ),
  // A group policy read from background sync can outlive the test that proxied
  // it to the API, landing after resetHandlers; it then failed the whole run as
  // unhandled. 404 is a plain request failure to the client, with no session
  // refresh, so the straggler reports and stops like the reads above.
  http.get("http://localhost:3001/principals/group/:groupId/policy", () => {
    return HttpResponse.json({ error: "Not Found" }, { status: 404 });
  }),
];
