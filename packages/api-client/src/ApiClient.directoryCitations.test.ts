import { expect } from "bun:test";
import {
  buildPrincipalStateSigningInput,
  computePrincipalStateHash,
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  signPrincipalState,
  toFingerprint,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import {
  type ContainerWriterProjectionResponse,
  encodeContainerWriterProjection,
  type HeldDirectoryCitation,
  type PrincipalStatePayloadResponse,
  type PrincipalStateResponse,
} from "@tearleads/validators/response";
import { parseKnownManifestHints } from "@tearleads/validators/util";
import { HttpResponse, http } from "msw";
import { createContainerWriterProjectionResponse } from "../test/helpers/apiClientTestFactories";
import {
  apiBaseUrl,
  server,
  testApiClient,
} from "../test/helpers/apiClientTestHarness";
import { ApiClient } from "./ApiClient";

const ORGANIZATION_ID = "organization-1";
const SIGNED_AT = "2026-11-17T00:00:00.000Z";

async function signedDirectory(ciphertext: string): Promise<{
  readonly state: PrincipalStateResponse;
  readonly payload: PrincipalStatePayloadResponse;
}> {
  const signing = generateSigningSeedAndKeyPair();
  const { publicKey } = generateKemSeedAndKeyPair();
  const signed = await signPrincipalState(
    await buildPrincipalStateSigningInput({
      principalType: "organization",
      principalId: ORGANIZATION_ID,
      version: 1,
      prevStateHash: null,
      keyEpoch: 1,
      encapsulationPublicKey: bytesToBase64(publicKey),
      keyFingerprint: await toFingerprint(publicKey),
      members: [{ userId: "user-1" }],
      memberEnvelopes: [],
      projection: [],
      grants: [],
      payloadCiphertext: ciphertext,
      externalAuthority: null,
      signedAt: SIGNED_AT,
      signerUserId: "user-1",
      signerUserKeyFingerprint: "e".repeat(64),
    }),
    signing.signingPrivateKey,
  );
  const stateHash = await computePrincipalStateHash(signed);
  return {
    state: { ...signed, stateHash, createdAt: SIGNED_AT },
    payload: { ciphertext },
  };
}

function projectionWith(
  directory: Awaited<ReturnType<typeof signedDirectory>>,
): ContainerWriterProjectionResponse {
  return {
    ...createContainerWriterProjectionResponse(),
    policyEvidence: {
      organization: null,
      organizationPayloads: [
        {
          reference: {
            keyEpoch: directory.state.keyEpoch,
            keyFingerprint: directory.state.keyFingerprint,
            principalId: ORGANIZATION_ID,
            principalType: "organization",
            stateHash: directory.state.stateHash,
            version: directory.state.version,
          },
          payload: directory.payload,
        },
      ],
      groups: [],
    },
  };
}

/** Serves `projection`, omitting the payloads `omit` names. */
function serve(
  projection: ContainerWriterProjectionResponse,
  omit: (cited: ReadonlySet<string>) => ReadonlySet<string>,
) {
  const hints: (string | null)[] = [];
  server.use(
    http.get(
      `${apiBaseUrl}/containers/:containerId/writer-projection`,
      ({ request }) => {
        const header = request.headers.get("x-known-manifests");
        hints.push(header);
        const cited = new Set(
          parseKnownManifestHints(header ?? "")?.directories,
        );
        return HttpResponse.json(
          encodeContainerWriterProjection(
            projection,
            new Set(),
            undefined,
            omit(cited),
          ),
        );
      },
    ),
  );
  return hints;
}

function holding(...citations: HeldDirectoryCitation[]) {
  return { cite: async () => citations };
}

testApiClient(
  "a read cites a held directory payload and refills the one omitted",
  async () => {
    const directory = await signedDirectory("directory-v1");
    const projection = projectionWith(directory);
    const hints = serve(projection, (cited) => cited);
    const client = new ApiClient(apiBaseUrl);
    client.setVerifiedManifestCitations(
      holding({
        directoryState: directory.state,
        directoryPayload: directory.payload,
      }),
    );
    expect(
      await client.getContainerWriterProjection(projection.containerId),
    ).toEqual(projection);
    expect(hints).toEqual([`d:${directory.state.stateHash}`]);
  },
);

testApiClient(
  "a held payload that does not hash to its signed state is never cited",
  async () => {
    const directory = await signedDirectory("directory-v1");
    const forged = "forged";
    const projection = projectionWith(directory);
    const hints = serve(projection, (cited) => cited);
    const client = new ApiClient(apiBaseUrl);
    client.setVerifiedManifestCitations(
      holding(
        // Other bytes under the state's hash: the signed state's payload
        // hash refuses them.
        {
          directoryState: directory.state,
          directoryPayload: { ciphertext: forged },
        },
        // A state whose own hash does not recompute.
        {
          directoryState: { ...directory.state, version: 2 },
          directoryPayload: directory.payload,
        },
      ),
    );
    expect(
      await client.getContainerWriterProjection(projection.containerId),
    ).toEqual(projection);
    expect(hints).toEqual([null]);
  },
);

testApiClient(
  "a payload omitted without a citation refetches once, complete",
  async () => {
    const directory = await signedDirectory("directory-v1");
    const other = await signedDirectory("directory-v2");
    const projection = projectionWith(directory);
    // A server that omits the payload of a state the request did not cite.
    const hints = serve(projection, (cited) =>
      cited.size > 0 ? new Set([directory.state.stateHash]) : cited,
    );
    const client = new ApiClient(apiBaseUrl);
    const reported: string[] = [];
    client.setOnError((message) => reported.push(message));
    client.setVerifiedManifestCitations(
      holding({
        directoryState: other.state,
        directoryPayload: other.payload,
      }),
    );
    expect(
      await client.getContainerWriterProjection(projection.containerId),
    ).toEqual(projection);
    expect(hints).toEqual([`d:${other.state.stateHash}`, null]);
    expect(reported).toEqual([]);
  },
);
