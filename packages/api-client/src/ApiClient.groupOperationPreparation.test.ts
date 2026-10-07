import { expect } from "bun:test";
import { HttpResponse, http } from "msw";
import {
  createOrganizationGroupRequest,
  createPrincipalPolicyRequest,
} from "../test/helpers/apiClientTestFactories";
import {
  apiBaseUrl,
  server,
  testApiClient,
} from "../test/helpers/apiClientTestHarness";
import { principalPolicyBundleResponseFor } from "../test/helpers/principalPolicyPage";
import { ApiClient } from "./ApiClient";
import type { RequestResultOptions } from "./types";

const organizationId = "11111111-1111-4111-8111-111111111111";
const pending = {
  code: "principal_history_preparation_pending",
  committed: false,
  progressToken: "a".repeat(64),
};

function fixture(operation: "create" | "delete") {
  const client = new ApiClient(apiBaseUrl);
  const input = {
    ...createOrganizationGroupRequest(),
    organizationPolicy: createPrincipalPolicyRequest(),
  };
  const organizationPolicy = {
    ...principalPolicyBundleResponseFor("organization", organizationId),
    containerMutations: [],
  };
  const deletion = { organizationPolicy: input.organizationPolicy };
  const response =
    operation === "create"
      ? {
          group: {
            createdAt: "2026-05-12T12:00:00.000Z",
            currentState: {
              keyEpoch: 1,
              keyFingerprint: "key-fingerprint",
              memberCount: 1,
              stateHash: "group-state-hash",
              version: 1,
            },
            groupId: input.groupId,
            isBuiltin: false,
            name: "Operators",
            organizationId,
          },
          organizationPolicy,
        }
      : {
          deleted: true as const,
          groupId: input.groupId,
          organizationId,
          organizationPolicy,
        };
  return {
    client,
    input,
    response,
    requestBody: JSON.stringify(operation === "create" ? input : deletion),
    handler: operation === "create" ? http.post : http.delete,
    path: `${apiBaseUrl}/organizations/${organizationId}/groups${operation === "create" ? "" : `/${input.groupId}`}`,
    submit(options: RequestResultOptions = {}) {
      return operation === "create"
        ? client.createOrganizationGroupResult(organizationId, input, options)
        : client.deleteOrganizationGroupResult(
            organizationId,
            input.groupId,
            deletion,
            options,
          );
    },
  };
}

for (const operation of ["create", "delete"] as const) {
  testApiClient(
    `group ${operation} retries only preparation with identical bytes`,
    async () => {
      const f = fixture(operation);
      f.client.setAuthToken("original-session");
      const bodies: string[] = [];
      server.use(
        f.handler(f.path, async ({ request }) => {
          bodies.push(await request.text());
          expect(request.headers.get("authorization")).toBe(
            "Bearer original-session",
          );
          f.input.organizationPolicy.state.version += 1;
          return bodies.length < 3
            ? HttpResponse.json(pending, { status: 202 })
            : HttpResponse.json(f.response);
        }),
      );
      const result = await f.submit();
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.message);
      expect(result.data).toEqual(f.response);
      expect(bodies).toEqual([f.requestBody, f.requestBody, f.requestBody]);
    },
  );

  for (const failure of [
    "network",
    "malformed",
    "busy",
    "uncertain503",
    "abort",
    "identity",
  ] as const) {
    testApiClient(
      `group ${operation} classifies ${failure} without replay`,
      async () => {
        const f = fixture(operation);
        const controller = new AbortController();
        let calls = 0;
        server.use(
          f.handler(f.path, () => {
            calls++;
            if (failure === "network") return HttpResponse.error();
            if (failure === "busy" || failure === "uncertain503")
              return HttpResponse.json(
                {
                  error: "Busy",
                  code: "principal_history_preparation_unavailable",
                  ...(failure === "busy" ? { committed: false } : {}),
                },
                { status: 503 },
              );
            if (failure === "abort") controller.abort();
            if (failure === "identity")
              f.client.setAuthToken("replacement-session");
            return HttpResponse.json(
              { ...pending, committed: failure === "malformed" },
              { status: 202 },
            );
          }),
        );
        expect(
          await f.submit({ signal: controller.signal, reportErrors: false }),
        ).toMatchObject({
          ok: false,
          kind: failure === "busy" ? "http" : "outcome-unknown",
        });
        expect(calls).toBe(1);
      },
    );
  }
}
