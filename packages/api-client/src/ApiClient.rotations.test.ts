import { expect } from "bun:test";
import { HttpResponse, http } from "msw";
import {
  createContainerMutationRequest,
  createContainerMutationResponse,
  createPrincipalPolicyRequest,
} from "../test/helpers/apiClientTestFactories";
import {
  apiBaseUrl,
  type CapturedHttpCall,
  captureHttpCall,
  server,
  testApiClient,
} from "../test/helpers/apiClientTestHarness";
import { ApiClient } from "./ApiClient";

// A rotation refused for stranding a level above a directly granted container
// names what it must carry; the three status-bearing calls surface that, and
// return the carried acknowledgements when the batch commits.

testApiClient(
  "status-bearing rotations surface the descendant rekeys they must carry",
  async () => {
    const onError: string[] = [];
    server.use(
      http.post(`${apiBaseUrl}/containers/container-1/:operation`, () =>
        HttpResponse.json(
          {
            code: "container_descendant_rekeys_required",
            error: "Container rotation must carry its descendant rekeys",
            requiredContainerIds: ["upper", "lower"],
          },
          { status: 409, statusText: "Conflict" },
        ),
      ),
    );
    const client = new ApiClient(apiBaseUrl);
    client.setOnError((message) => {
      onError.push(message);
    });
    const mutation = createContainerMutationRequest();
    for (const result of [
      await client.rekeyContainerResult("container-1", mutation, {
        reportErrors: false,
      }),
      await client.revokeContainerResult("container-1", mutation, {
        reportErrors: false,
      }),
      await client.moveContainerResult("container-1", mutation, {
        reportErrors: false,
      }),
    ]) {
      expect(result).toMatchObject({
        code: "container_descendant_rekeys_required",
        ok: false,
        requiredContainerIds: ["upper", "lower"],
        status: 409,
      });
    }
    // Answerable, so the caller asked for silence and gets it.
    expect(onError).toEqual([]);
  },
);

testApiClient(
  "a rotation sends its carried rekeys and returns their acknowledgements",
  async () => {
    const calls: CapturedHttpCall[] = [];
    const carried = createContainerMutationResponse();
    server.use(
      http.post(
        `${apiBaseUrl}/containers/container-1/rekey`,
        async ({ request }) => {
          calls.push(await captureHttpCall(request));
          return HttpResponse.json({
            ...createContainerMutationResponse(),
            containerRekeys: [carried],
          });
        },
      ),
    );
    const client = new ApiClient(apiBaseUrl);
    const mutation = createContainerMutationRequest();
    const result = await client.rekeyContainerResult("container-1", {
      ...mutation,
      containerRekeys: [mutation],
    });
    expect(result.ok && result.data.containerRekeys).toEqual([carried]);
    expect(JSON.parse(calls[0]?.body ?? "{}").containerRekeys).toEqual([
      mutation,
    ]);
  },
);

const ORGANIZATION_ID = "0f1a2b3c-4d5e-4f60-8172-839405a6b7c8";
const GROUP_ID = "1a2b3c4d-5e6f-4071-8293-a4b5c6d7e8f9";

// A group policy commit refused for stranding a granted path names the
// descendant rekeys the batch must carry, exactly as a container rotation does.

testApiClient(
  "a status-bearing group policy commit surfaces the rekeys it must carry",
  async () => {
    server.use(
      http.put(
        `${apiBaseUrl}/organizations/:organizationId/groups/:groupId/policy-commit`,
        () =>
          HttpResponse.json(
            {
              code: "container_descendant_rekeys_required",
              error: "Container rotation must carry its descendant rekeys",
              requiredContainerIds: ["upper"],
            },
            { status: 409, statusText: "Conflict" },
          ),
      ),
    );
    const client = new ApiClient(apiBaseUrl);
    const result = await client.commitOrganizationGroupPolicyResult(
      ORGANIZATION_ID,
      GROUP_ID,
      {
        groupPolicy: createPrincipalPolicyRequest(),
        organizationPolicy: createPrincipalPolicyRequest(),
      },
      { reportErrors: false },
    );
    expect(result).toMatchObject({
      code: "container_descendant_rekeys_required",
      ok: false,
      requiredContainerIds: ["upper"],
      status: 409,
    });
    // The plain method collapses the same refusal to null.
    expect(
      await client.commitOrganizationGroupPolicy(ORGANIZATION_ID, GROUP_ID, {
        groupPolicy: createPrincipalPolicyRequest(),
        organizationPolicy: createPrincipalPolicyRequest(),
      }),
    ).toBeNull();
  },
);
