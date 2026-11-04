import { beforeAll, expect, test } from "bun:test";
import { setUpAdminGroupRoot } from "../../../test/helpers/adminGroupRoot";
import { missingPrincipalRecoveryFixture } from "../../../test/helpers/missingPrincipalRecovery";
import { ProjectionDependencyUnavailableError } from "../../data/keyingProjectionVerification/dependencyUnavailable";
import type { ContainerContents } from "../containerContents";
import type { OrganizationReadModelCoordinator } from "./organizationReadModels";
import { revokeOrganizationGrant } from "./principalMutations";

let signed: Awaited<ReturnType<typeof setUpAdminGroupRoot>>;
beforeAll(async () => {
  signed = await setUpAdminGroupRoot();
});

for (const missing of ["custody", "pages"] as const) {
  test(`user grant revocation refuses missing ${missing} before full reads or writes`, async () => {
    const f = await missingPrincipalRecoveryFixture(
      missing,
      signed.author.organizationId,
    );
    const identity = await signed.resolveUserIdentity(
      signed.author.signerUserId,
    );
    if (!identity) throw new Error("Missing signed fixture identity");
    const apiClient = new Proxy(f.runtime.apiClient, {
      get(target, property) {
        if (
          missing === "pages" &&
          property === "getProjectionPolicyHistoryPages"
        )
          return undefined;
        if (
          property === "evictContainerWriterProjection" ||
          property === "evictWriterProjectionsCiting"
        ) {
          return () => {
            f.calls.push(`api:${property}`);
          };
        }
        if (property === "getContainerWriterProjection") {
          return async () => {
            f.calls.push("api:getContainerWriterProjection");
            return signed.initialProjection;
          };
        }
        return Reflect.get(target, property, target);
      },
    });
    try {
      const outcome = await revokeOrganizationGrant({
        runtime: {
          ...f.runtime,
          apiClient,
          resolveTrustedUserIdentity: signed.resolveUserIdentity,
          crypto: {
            encapsulationKeyPair: signed.memberKem,
            signingFingerprint: signed.author.signerKeyFingerprint,
            signingKeyPair: {
              signingPrivateKey: signed.author.signerPrivateKey,
              signingPublicKey: identity.signingPublicKey,
            },
          },
        },
        containerId: signed.initialProjection.containerId,
        subjectId: signed.author.signerUserId,
        subjectType: "user",
        stillCurrent: () => true,
        containerContents: {} as ContainerContents,
        readModelCoordinator: {
          reconcileAfterMutation: async () => {
            f.calls.push("host:reconcileAfterMutation");
          },
        } as OrganizationReadModelCoordinator,
      }).catch((error: unknown) => error);
      // A missing dependency gets the revoke's one bounded refresh (evict and
      // refetch the projection) and then fails the same way, still before any
      // full read or write.
      expect(f.calls.filter((call) => !call.startsWith("sql:"))).toEqual([
        "api:getContainerWriterProjection",
        "api:evictContainerWriterProjection",
        "api:evictWriterProjectionsCiting",
        "api:getContainerWriterProjection",
      ]);
      expect(
        f.calls.filter(
          (call) =>
            call.startsWith("sql:") &&
            /\b(INSERT|UPDATE|DELETE|REPLACE)\b/i.test(call),
        ),
      ).toEqual([]);
      expect(outcome).toBeInstanceOf(ProjectionDependencyUnavailableError);
    } finally {
      f.close();
    }
  });
}
