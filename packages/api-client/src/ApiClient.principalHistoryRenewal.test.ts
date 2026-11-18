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
  principalPolicyAcknowledgementFor,
  principalPolicyBundleResponseFor,
  principalPolicyPageResponse,
} from "../test/helpers/principalPolicyPage";
import { ApiClient } from "./ApiClient";

const firstId = "11111111-1111-4111-8111-111111111111";
const secondId = "22222222-2222-4222-8222-222222222222";
const path = `${apiBaseUrl}/principals/organization/:principalId/policy`;
const expired = () =>
  HttpResponse.json(
    { code: SESSION_ERROR_CODES.refreshRequired, error: "Expired session" },
    { status: 401 },
  );

testApiClient(
  "policy reads reuse a concurrent verified session renewal",
  async () => {
    const client = new ApiClient(apiBaseUrl);
    client.setAuthToken("expired-session");
    let renewals = 0;
    let calls = 0;
    let errors = 0;
    client.setOnError(() => {
      errors += 1;
    });
    client.setOnSessionExpired(() => {
      renewals += 1;
      client.setAuthToken("renewed-session");
      return true;
    });
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const firstBundle = principalPolicyBundleResponseFor(
      "organization",
      firstId,
    );
    const secondBundle = principalPolicyBundleResponseFor(
      "organization",
      secondId,
    );
    server.use(
      http.get(path, async ({ request, params }) => {
        const { principalId } = params;
        calls += 1;
        if (request.headers.get("Authorization") === "Bearer renewed-session")
          return HttpResponse.json(
            principalPolicyPageResponse(
              principalId === firstId ? firstBundle : secondBundle,
            ),
          );
        if (principalId === firstId) {
          started.resolve();
          await release.promise;
        }
        return expired();
      }),
    );
    const first = client.getCurrentPrincipalPolicy("organization", firstId);
    await started.promise;
    try {
      expect(
        await client.getCurrentPrincipalPolicy("organization", secondId),
      ).toEqual(secondBundle);
    } finally {
      release.resolve();
    }
    expect(await first).toEqual(firstBundle);
    expect([calls, renewals, errors]).toEqual([4, 1, 0]);
  },
);

testApiClient(
  "an unrelated token replacement cannot restart an expired policy read",
  async () => {
    const client = new ApiClient(apiBaseUrl);
    client.setAuthToken("original-session");
    let calls = 0;
    server.use(
      http.get(path, () => {
        calls += 1;
        client.setAuthToken("different-identity-session");
        return expired();
      }),
    );
    expect(
      await client.getCurrentPrincipalPolicy("organization", firstId),
    ).toBeNull();
    expect(calls).toBe(1);
  },
);

testApiClient(
  "policy callers keep separate error reporting preferences",
  async () => {
    const client = new ApiClient(apiBaseUrl);
    let calls = 0;
    let errors = 0;
    client.setOnError(() => {
      errors += 1;
    });
    server.use(
      http.get(path, () => {
        calls += 1;
        return HttpResponse.json({ error: "Unavailable" }, { status: 500 });
      }),
    );
    expect(
      await Promise.all([
        client.getCurrentPrincipalPolicy("organization", firstId, {
          reportErrors: false,
        }),
        client.getCurrentPrincipalPolicy("organization", firstId),
      ]),
    ).toEqual([null, null]);
    expect([calls, errors]).toEqual([2, 1]);
  },
);

testApiClient(
  "an acknowledged write survives verified renewals by another request",
  async () => {
    const client = new ApiClient(apiBaseUrl);
    client.setAuthToken("original");
    let renewals = 0;
    const installed = Promise.withResolvers<void>();
    const verified = Promise.withResolvers<void>();
    client.setOnSessionExpired(async () => {
      client.setAuthToken(`renewed-${++renewals}`);
      if (renewals === 2) {
        installed.resolve();
        await verified.promise;
      }
      return true;
    });
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const committed = {
      groupPolicy: principalPolicyAcknowledgementFor(
        createPrincipalPolicyBundleResponse(),
      ),
      organizationPolicy: principalPolicyAcknowledgementFor(
        createPrincipalPolicyBundleResponse(),
      ),
    };
    let rejectNext = true;
    server.use(
      http.put(
        `${apiBaseUrl}/organizations/:organizationId/groups/:groupId/policy-commit`,
        async () => {
          started.resolve();
          await release.promise;
          return HttpResponse.json(committed);
        },
      ),
      http.delete(`${apiBaseUrl}/containers/target`, () => {
        if (!rejectNext)
          return HttpResponse.json({
            containerId: "target",
            deletedAt: "2026-10-10T00:00:00.000Z",
          });
        rejectNext = false;
        return HttpResponse.json(
          { code: SESSION_ERROR_CODES.refreshRequired, error: "Expired" },
          { status: 401 },
        );
      }),
    );
    const write = client.commitOrganizationGroupPolicyResult(
      firstId,
      secondId,
      {
        groupPolicy: createPrincipalPolicyRequest(),
        organizationPolicy: createPrincipalPolicyRequest(),
      },
    );
    try {
      await started.promise;
      expect((await client.deleteContainerResult("target")).ok).toBe(true);
      rejectNext = true;
      const renewal = client.deleteContainerResult("target");
      await installed.promise;
      release.resolve();
      // The response arrives while the trusted handler is still verifying.
      // Give the completed HTTP response one event-loop turn to deliver.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      verified.resolve();
      expect((await renewal).ok).toBe(true);
      expect(renewals).toBe(2);
    } finally {
      verified.resolve();
      release.resolve();
    }
    await expect(write).resolves.toEqual({ ok: true, data: committed });
  },
);

testApiClient(
  "a principal write captures the verified bearer before a provisional change",
  async () => {
    const client = new ApiClient(apiBaseUrl);
    client.setAuthToken("original");
    const sent = Promise.withResolvers<string | null>();
    const answer = Promise.withResolvers<void>();
    const committed = {
      groupPolicy: principalPolicyAcknowledgementFor(
        createPrincipalPolicyBundleResponse(),
      ),
      organizationPolicy: principalPolicyAcknowledgementFor(
        createPrincipalPolicyBundleResponse(),
      ),
    };
    let write: Promise<unknown> | undefined;
    client.setOnSessionExpired(async () => {
      write = client.commitOrganizationGroupPolicyResult(firstId, secondId, {
        groupPolicy: createPrincipalPolicyRequest(),
        organizationPolicy: createPrincipalPolicyRequest(),
      });
      client.setAuthToken("provisional");
      await answer.promise;
      return true;
    });
    let expiredOnce = false;
    server.use(
      http.put(
        `${apiBaseUrl}/organizations/:organizationId/groups/:groupId/policy-commit`,
        ({ request }) => {
          sent.resolve(request.headers.get("Authorization"));
          return HttpResponse.json(committed);
        },
      ),
      http.delete(`${apiBaseUrl}/containers/target`, () => {
        if (expiredOnce)
          return HttpResponse.json({
            containerId: "target",
            deletedAt: "2026-10-10T00:00:00.000Z",
          });
        expiredOnce = true;
        return expired();
      }),
    );
    const renewal = client.deleteContainerResult("target");
    try {
      expect(await sent.promise).toBe("Bearer original");
    } finally {
      answer.resolve();
      await renewal;
      await write;
    }
  },
);
