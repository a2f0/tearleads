import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { grantBy } from "../../../test/helpers/ancestorCitationScenario";
import {
  childWriterProjection,
  createGroupHistoricalSignerScenario,
  documentWriterProjection,
  type GroupHistoricalSignerScenario,
  linkDocument,
} from "../../../test/helpers/groupHistoricalSignerScenario";
import { verifyContainerWriterProjection } from "./containerProjectionVerification";
import {
  verifyDocumentWriterProjection,
  verifyDocumentWriterProjectionAuthorization,
} from "./documentProjectionVerification";
import { principalPolicyCacheForVerifiedPolicies } from "./principalPolicyCache";

/**
 * Pins the served-path entry points the sync workflows call: a head signed by
 * a group member before removal, delivered to a cold device after the root
 * adopted the successor policy, verifies at the membership its cited heads
 * referenced. Demanding membership at the served current policy would refuse
 * the honest API on every fresh login and brick the object for that device.
 */

function verificationInput(scenario: GroupHistoricalSignerScenario) {
  return {
    principalPolicyCache: principalPolicyCacheForVerifiedPolicies([
      scenario.policy,
    ]),
    resolveUserKey: scenario.resolveUserKey,
  };
}

test("the container writer projection accepts a head signed by a since-removed group admin", async () => {
  const scenario = await createGroupHistoricalSignerScenario();
  const { close, execSql } = await createTestExecSql(
    "historical-signer-container-projection",
  );
  try {
    const path = await verifyContainerWriterProjection({
      ...verificationInput(scenario),
      execSql,
      projection: await childWriterProjection(scenario),
    });
    expect(path.map((head) => head.manifestHash)).toEqual([
      scenario.root2.manifestHash,
      scenario.child2.manifestHash,
    ]);

    // Citing the head that removed her, Mallory's grant is a forgery.
    const forged = await grantBy({
      cited: [scenario.root2.manifestHash, scenario.child2.manifestHash],
      previous: scenario.child2,
      signer: scenario.mallory,
      subjectId: scenario.peer.userId,
    });
    await expect(
      verifyContainerWriterProjection({
        ...verificationInput(scenario),
        execSql,
        projection: await childWriterProjection(scenario, {
          head: forged,
          history: [scenario.child1, scenario.child2],
        }),
      }),
    ).rejects.toMatchObject({ code: "unauthorized" });
  } finally {
    close();
  }
});

test("a document head linked by a since-removed group admin verifies on a cold device", async () => {
  const scenario = await createGroupHistoricalSignerScenario();
  const link = await linkDocument({
    cited: [scenario.root1],
    previous: null,
    signer: scenario.mallory,
    target: scenario.root1,
  });
  const projection = await documentWriterProjection(scenario, [link]);
  const { close, execSql } = await createTestExecSql(
    "historical-signer-document-head",
  );
  try {
    const head = await verifyDocumentWriterProjection({
      ...verificationInput(scenario),
      execSql,
      projection,
    });
    expect(head.manifestHash).toBe(link.manifestHash);
    const authorization = await verifyDocumentWriterProjectionAuthorization({
      ...verificationInput(scenario),
      execSql,
      projection,
    });
    expect([...authorization.documentManifestByHash.keys()]).toEqual([
      link.manifestHash,
    ]);
  } finally {
    close();
  }
});

test("document history signed by a since-removed group admin verifies beneath a current head", async () => {
  const scenario = await createGroupHistoricalSignerScenario();
  const created = await linkDocument({
    cited: [scenario.root1],
    previous: null,
    signer: scenario.mallory,
    target: scenario.root1,
  });
  const linked = await linkDocument({
    cited: [scenario.root2, scenario.child2],
    previous: created,
    signer: scenario.alice,
    target: scenario.child2,
  });
  const honest = await createTestExecSql("historical-signer-document-history");
  // A separate device: the honest head is not this device's checkpoint, so
  // the forgery is refused on its signer alone, not as a fork.
  const cold = await createTestExecSql("historical-signer-document-forgery");
  try {
    const head = await verifyDocumentWriterProjection({
      ...verificationInput(scenario),
      execSql: honest.execSql,
      projection: await documentWriterProjection(scenario, [created, linked]),
    });
    expect(head.manifestHash).toBe(linked.manifestHash);
    expect(head.state.linkedContainerIds).toEqual(
      [scenario.root1, scenario.child2]
        .map((manifest) => manifest.state.containerId)
        .sort(),
    );

    // Mallory linking after her removal, citing the head that removed her,
    // has no write access through any linked container and is refused.
    const forged = await linkDocument({
      cited: [scenario.root2, scenario.child2],
      previous: created,
      signer: scenario.mallory,
      target: scenario.child2,
    });
    await expect(
      verifyDocumentWriterProjection({
        ...verificationInput(scenario),
        execSql: cold.execSql,
        projection: await documentWriterProjection(scenario, [created, forged]),
      }),
    ).rejects.toMatchObject({ code: "unauthorized" });
  } finally {
    honest.close();
    cold.close();
  }
});
