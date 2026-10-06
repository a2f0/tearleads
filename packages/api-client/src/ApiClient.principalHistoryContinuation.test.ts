import { expect } from "bun:test";
import { SESSION_ERROR_CODES } from "@tearleads/validators/response";
import { HttpResponse, http } from "msw";
import {
  createPrincipalPolicyBundleResponse,
  createPrincipalPolicyRequest,
} from "../test/helpers/apiClientTestFactories";
import {
  apiBaseUrl,
  server,
  testApiClient,
} from "../test/helpers/apiClientTestHarness";
import {
  principalPolicyBundleResponseFor,
  principalPolicyPageResponse,
} from "../test/helpers/principalPolicyPage";
import { ApiClient } from "./ApiClient";

const organizationId = "11111111-1111-4111-8111-111111111111";
const groupId = "22222222-2222-4222-8222-222222222222";
const path = `${apiBaseUrl}/organizations/:organizationId/groups/:groupId/policy-commit`;
const pending = {
  code: "principal_history_preparation_pending",
  committed: false,
  progressToken: "a".repeat(64),
};

testApiClient(
  "unchanged preparation progress stops without a lifetime attempt cap",
  async () => {
    let calls = 0;
    server.use(
      http.put(path, () => {
        calls += 1;
        return calls <= 3
          ? HttpResponse.json(pending, { status: 202 })
          : HttpResponse.json(response());
      }),
    );
    const client = new ApiClient(apiBaseUrl);
    expect(
      await client.commitOrganizationGroupPolicyResult(
        organizationId,
        groupId,
        request(),
        { reportErrors: false },
      ),
    ).toMatchObject({
      ok: false,
      code: "principal_history_preparation_stalled",
    });
    expect(calls).toBe(3);
  },
);

testApiClient(
  "an expired preparation session renews without replaying its mutation",
  async () => {
    const client = new ApiClient(apiBaseUrl);
    client.setAuthToken("expired-session");
    let renewals = 0;
    let calls = 0;
    let failures = 0;
    client.setOnError(() => {
      failures += 1;
    });
    client.setOnSessionExpired(() => {
      renewals += 1;
      client.setAuthToken("renewed-session");
      return true;
    });
    server.use(
      http.put(path, () => {
        calls += 1;
        return HttpResponse.json(
          {
            code: SESSION_ERROR_CODES.refreshRequired,
            error: "Expired session",
          },
          { status: 401 },
        );
      }),
    );
    expect(
      await client.commitOrganizationGroupPolicyResult(
        organizationId,
        groupId,
        request(),
      ),
    ).toMatchObject({
      ok: false,
      kind: "http",
      status: 401,
      code: SESSION_ERROR_CODES.refreshRequired,
    });
    expect(renewals).toBe(1);
    expect(calls).toBe(1);
    expect(failures).toBe(1);
  },
);
const request = () => ({
  groupPolicy: createPrincipalPolicyRequest(),
  organizationPolicy: createPrincipalPolicyRequest(),
});
const response = () => ({
  groupPolicy: {
    ...createPrincipalPolicyBundleResponse(),
    containerMutations: [],
  },
  organizationPolicy: {
    ...createPrincipalPolicyBundleResponse(),
    containerMutations: [],
  },
});

testApiClient(
  "principal preparation retries preserve the original request bytes",
  async () => {
    const client = new ApiClient(apiBaseUrl);
    client.setAuthToken("same-session");
    const input = request();
    const expected = JSON.stringify(input);
    const bodies: string[] = [];
    const committed = response();
    server.use(
      http.put(path, async ({ request }) => {
        bodies.push(await request.text());
        expect(request.headers.get("authorization")).toBe(
          "Bearer same-session",
        );
        input.groupPolicy.state.version += 1;
        return bodies.length < 3
          ? HttpResponse.json(pending, { status: 202 })
          : HttpResponse.json(committed);
      }),
    );
    await expect(
      client.commitOrganizationGroupPolicyResult(
        organizationId,
        groupId,
        input,
      ),
    ).resolves.toEqual({ ok: true, data: committed });
    expect(bodies).toEqual([expected, expected, expected]);
  },
);

for (const status of [200, 202]) {
  testApiClient(
    `malformed preparation response at ${status} never retries`,
    async () => {
      let calls = 0;
      server.use(
        http.put(path, () => {
          calls += 1;
          return calls === 1
            ? HttpResponse.json({ ...pending, committed: true }, { status })
            : HttpResponse.json(response());
        }),
      );
      const client = new ApiClient(apiBaseUrl);
      expect(
        await client.commitOrganizationGroupPolicyResult(
          organizationId,
          groupId,
          request(),
          { reportErrors: false },
        ),
      ).toMatchObject({ ok: false, kind: "shape", status });
      expect(calls).toBe(1);
    },
  );
}

testApiClient(
  "transport failure after preparation never assumes rollback",
  async () => {
    let calls = 0;
    server.use(
      http.put(path, () => {
        calls += 1;
        return calls === 1
          ? HttpResponse.json(pending, { status: 202 })
          : HttpResponse.error();
      }),
    );
    const client = new ApiClient(apiBaseUrl);
    expect(
      await client.commitOrganizationGroupPolicyResult(
        organizationId,
        groupId,
        request(),
        { reportErrors: false },
      ),
    ).toMatchObject({ ok: false, kind: "network", status: null });
    expect(calls).toBe(2);
  },
);

for (const stop of ["abort", "identity"] as const) {
  testApiClient(
    `${stop} changes stop preparation before another request`,
    async () => {
      const client = new ApiClient(apiBaseUrl);
      const controller = new AbortController();
      let networkFailures = 0;
      client.setOnNetworkError(() => {
        networkFailures += 1;
      });
      let calls = 0;
      server.use(
        http.put(path, () => {
          calls += 1;
          if (stop === "abort") controller.abort();
          else client.setAuthToken("different-session");
          return HttpResponse.json(pending, { status: 202 });
        }),
      );
      expect(
        await client.commitOrganizationGroupPolicyResult(
          organizationId,
          groupId,
          request(),
          {
            reportErrors: false,
            signal: controller.signal,
          },
        ),
      ).toMatchObject({ ok: false, kind: "outcome-unknown", status: null });
      expect(calls).toBe(1);
      expect(networkFailures).toBe(0);
    },
  );
}

testApiClient(
  "a preparation request never replays under a replacement session",
  async () => {
    const client = new ApiClient(apiBaseUrl);
    client.setAuthToken("original-session");
    let calls = 0;
    server.use(
      http.put(path, () => {
        calls += 1;
        if (calls === 1) return HttpResponse.json(pending, { status: 202 });
        if (calls === 2) {
          client.setAuthToken("replacement-session");
          return HttpResponse.json(
            {
              code: SESSION_ERROR_CODES.refreshRequired,
              error: "Session expired",
            },
            { status: 401 },
          );
        }
        return HttpResponse.json(response());
      }),
    );
    expect(
      await client.commitOrganizationGroupPolicyResult(
        organizationId,
        groupId,
        request(),
        { reportErrors: false },
      ),
    ).toMatchObject({ ok: false });
    expect(calls).toBe(2);
  },
);

testApiClient(
  "a final response cannot escape after the request's identity changed",
  async () => {
    const client = new ApiClient(apiBaseUrl);
    client.setAuthToken("original-session");
    server.use(
      http.put(path, () => {
        client.setAuthToken("replacement-session");
        return HttpResponse.json(response());
      }),
    );
    expect(
      await client.commitOrganizationGroupPolicyResult(
        organizationId,
        groupId,
        request(),
        { reportErrors: false },
      ),
    ).toMatchObject({ ok: false, kind: "outcome-unknown" });
  },
);

testApiClient(
  "policy reads and organization writes handle preparation",
  async () => {
    const client = new ApiClient(apiBaseUrl);
    let reads = 0;
    let writes = 0;
    const bundle = principalPolicyBundleResponseFor(
      "organization",
      organizationId,
    );
    const committed = { ...bundle, containerMutations: [] };
    server.use(
      http.get(
        `${apiBaseUrl}/principals/organization/:principalId/policy`,
        () => {
          reads += 1;
          return reads === 1
            ? HttpResponse.json(pending, { status: 202 })
            : HttpResponse.json(principalPolicyPageResponse(bundle));
        },
      ),
      http.put(
        `${apiBaseUrl}/principals/organization/:principalId/policy`,
        () => {
          writes += 1;
          return writes === 1
            ? HttpResponse.json(pending, { status: 202 })
            : HttpResponse.json(committed);
        },
      ),
    );
    expect(
      await client.getCurrentPrincipalPolicy("organization", organizationId),
    ).toEqual(bundle);
    expect(
      await client.putPrincipalPolicy(
        "organization",
        organizationId,
        createPrincipalPolicyRequest(),
      ),
    ).toEqual(committed);
    expect([reads, writes]).toEqual([2, 2]);
  },
);
