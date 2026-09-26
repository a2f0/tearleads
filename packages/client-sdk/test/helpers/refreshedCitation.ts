import { signWriteHeader, type WriteHeader } from "@tearleads/crypto";
import { createContainerWriterProjectionFixture } from "@tearleads/test-utils";
import type { ExecSql } from "../../src/data/sqlite/sqlSchema";
import { buildMaterializedContainerRekeyPlan } from "../../src/workflows/containers/child/rekey";
import type { createMaterializedSyncFixture } from "./documentResponseFixtures";

type Fixture = Pick<
  Awaited<ReturnType<typeof createMaterializedSyncFixture>>,
  | "author"
  | "parentProjection"
  | "publicKey"
  | "resolveProjectionUserKey"
  | "secretKey"
  | "writerProjection"
>;

/** An advanced ancestor is valid write evidence even while the leaf keeps its original KEK. */
export async function refreshedCitation(
  fixture: Fixture,
  execSql: ExecSql,
  header: WriteHeader,
  inScope: boolean,
) {
  const parent = fixture.parentProjection;
  if (inScope && !parent) throw new Error("Expected a nested citation fixture");
  const extra =
    parent && inScope
      ? (
          await buildMaterializedContainerRekeyPlan({
            author: fixture.author,
            execSql,
            previousProjection: parent,
            resolveProjectionUserKey: fixture.resolveProjectionUserKey,
            targetSecretKey: fixture.secretKey,
            persistVerificationCheckpoints: false,
          })
        ).writerProjection
      : await createContainerWriterProjectionFixture({
          containerId: "unrelated-citation-root",
          encapsulationPublicKey: fixture.publicKey,
          organizationId: fixture.author.organizationId,
          signerKeyFingerprint: fixture.author.signerKeyFingerprint,
          signerPrivateKey: fixture.author.signerPrivateKey,
          userId: fixture.author.signerUserId,
        });
  const oldParentHash = parent?.path.at(-1)?.manifestHash;
  const { signature: _signature, ...unsigned } = header;
  return {
    extra,
    header: await signWriteHeader(
      {
        ...unsigned,
        dependencyManifestHashes: [
          ...unsigned.dependencyManifestHashes.filter(
            (hash) => !inScope || hash !== oldParentHash,
          ),
          ...extra.path.map((head) => head.manifestHash),
        ].sort(),
      },
      fixture.author.signerPrivateKey,
    ),
    projection: {
      ...fixture.writerProjection,
      ...(inScope
        ? {
            authorizingContainerPaths:
              fixture.writerProjection.authorizingContainerPaths.map(
                (projection) => ({
                  ...projection,
                  path: [...extra.path, ...projection.path.slice(1)],
                  containerKeks: [
                    ...extra.containerKeks,
                    ...projection.containerKeks.slice(1),
                  ],
                }),
              ),
          }
        : {}),
      documentManifestContainerPaths: [
        ...fixture.writerProjection.documentManifestContainerPaths,
        extra.path,
      ],
    },
  };
}
