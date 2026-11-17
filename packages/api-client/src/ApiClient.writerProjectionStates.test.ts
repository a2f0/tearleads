import { expect } from "bun:test";
import {
  type ContainerAccessManifestState,
  computeAccessManifestHash,
  deriveContainerAccessManifest,
  generateSigningSeedAndKeyPair,
  type VerifiedAccessEvent,
} from "@tearleads/crypto";
import { createVerifiedContainerAccessEvent } from "@tearleads/crypto/access-event-test-fixtures";
import { createContainerManifestFixture } from "@tearleads/crypto/container-access-test-fixtures";
import { encodeContainerWriterProjection } from "@tearleads/validators/response";
import { HttpResponse, http } from "msw";
import { createContainerWriterProjectionResponse } from "../test/helpers/apiClientTestFactories";
import {
  apiBaseUrl,
  server,
  testApiClient,
} from "../test/helpers/apiClientTestHarness";
import { ApiClient } from "./ApiClient";

const CONTAINER_ID = "container-1";
const ADMIN = {
  accessLevel: "admin",
  subjectId: "user-1",
  subjectType: "user",
} as const;
const READER = {
  accessLevel: "read",
  subjectId: "user-2",
  subjectType: "user",
} as const;

async function storedBundle(
  event: VerifiedAccessEvent,
  state: ContainerAccessManifestState,
) {
  const manifest = await deriveContainerAccessManifest(state);
  return {
    event: {
      body: event.body,
      event: { ...event.event },
      eventHash: event.eventHash,
    },
    manifest: { ...manifest },
    manifestHash: await computeAccessManifestHash(manifest),
    state: { ...state },
  };
}

/** A container create and a grant on it, as the API stores them. */
async function storedChain() {
  const signer = generateSigningSeedAndKeyPair();
  const created = await createContainerManifestFixture({
    containerId: CONTAINER_ID,
    containerKeyEpochId: "epoch-1",
    directGrants: [ADMIN],
    signer,
    signerUserId: "user-1",
  });
  const genesis = await storedBundle(created.event, created.state);
  const grant = await createVerifiedContainerAccessEvent({
    body: {
      eventType: "container.grant",
      containerKeyEpochId: created.state.containerKeyEpochId,
      containerKeyPublicKey: created.state.containerKeyPublicKey,
      grant: READER,
      referencedPrincipalHead: null,
    },
    objectId: CONTAINER_ID,
    organizationId: created.state.organizationId,
    previousManifestHash: genesis.manifestHash,
    signer,
    signerUserId: "user-1",
  });
  const head = await storedBundle(grant, {
    ...created.state,
    epoch: 2,
    previousManifestHash: genesis.manifestHash,
    eventHash: grant.eventHash,
    directGrants: [ADMIN, READER],
  });
  return { genesis, head };
}

testApiClient(
  "decoding rebuilds the state the API stores from the signed chain",
  async () => {
    const { genesis, head } = await storedChain();
    const fixture = createContainerWriterProjectionResponse();
    const [kek] = fixture.containerKeks;
    if (!kek) throw new Error("fixture KEK missing");
    const projection = {
      ...fixture,
      path: [head],
      containerKeks: [
        {
          ...kek,
          accessManifestHash: head.manifestHash,
          containerManifestHistory: [genesis],
        },
      ],
    };
    const wire = encodeContainerWriterProjection(projection);
    for (const bundle of Object.values(wire.bundles))
      expect(bundle).not.toHaveProperty("state");
    server.use(
      http.get(`${apiBaseUrl}/containers/:containerId/writer-projection`, () =>
        HttpResponse.json(wire),
      ),
    );

    const decoded = await new ApiClient(
      apiBaseUrl,
    ).getContainerWriterProjection(CONTAINER_ID);
    expect(decoded?.path[0]?.state).toEqual(head.state);
    expect(
      decoded?.containerKeks[0]?.containerManifestHistory[0]?.state,
    ).toEqual(genesis.state);
  },
);
