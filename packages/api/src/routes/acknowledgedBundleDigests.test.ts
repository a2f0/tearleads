import { expect, test } from "bun:test";
import {
  computeAccessManifestBundleDigest,
  toFingerprint,
} from "@tearleads/crypto";
import { createTestUser } from "@tearleads/test-utils";
import {
  ContainerWriterProjectionWireResponseSchema,
  DocumentWriterProjectionWireResponseSchema,
  isRegistrationResponse,
} from "@tearleads/validators/response";
import { submitRegistration } from "../../test/helpers/api";
import { authenticate } from "../../test/helpers/authenticate";
import { createChildContainer } from "../../test/helpers/keyingWriterProjectionChild";
import {
  bootstrapRoot,
  createDocument,
} from "../../test/helpers/keyingWriterProjectionKit";
import { registerUser } from "../../test/helpers/registerUser";
import { routeApp } from "../routeApp";

async function served(path: string, token: string): Promise<unknown> {
  const response = await routeApp.request(path, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(response.status, await response.clone().text()).toBe(200);
  return response.json();
}

async function digestOf(bundle: unknown): Promise<string> {
  if (bundle === null || typeof bundle !== "object")
    throw new Error("Expected a served bundle");
  // The served wire bundle, as the projection sent it (its state included).
  const digest = await computeAccessManifestBundleDigest({
    event: Reflect.get(bundle, "event"),
    manifest: Reflect.get(bundle, "manifest"),
    manifestHash: String(Reflect.get(bundle, "manifestHash")),
    state: Reflect.get(bundle, "state"),
  });
  if (digest === null) throw new Error("Served bundle is not canonical");
  return digest;
}

test("acknowledgements name the digest of the bundle a projection serves", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const child = await createChildContainer({ parent: root, signer: owner });
  const created = await createDocument({ owner, root });

  const container = ContainerWriterProjectionWireResponseSchema.parse(
    await served(
      `/containers/${child.containerId}/writer-projection`,
      owner.token,
    ),
  );
  const childHash = child.accessManifest.manifestHash;
  expect(child.bundleDigest).toBe(await digestOf(container.bundles[childHash]));

  const document = DocumentWriterProjectionWireResponseSchema.parse(
    await served(`/documents/${created.id}/writer-projection`, owner.token),
  );
  expect(created.bundleDigest).toBe(
    await digestOf(document.bundles[created.manifestHash]),
  );
});

test("registration names the digest of the root bundle a projection serves", async () => {
  const owner = createTestUser();
  owner.fingerprint = await toFingerprint(owner.signing.signingPublicKey);
  const registered = await submitRegistration(
    owner.signing.signingPublicKey,
    owner.signing.signingPrivateKey,
    owner.kem.publicKey,
  );
  expect(registered.status).toBe(200);
  const registration = await registered.json();
  if (!isRegistrationResponse(registration))
    throw new Error("Expected a registration response");
  owner.userId = registration.userId;
  owner.rootContainerId = registration.rootContainerId;
  await authenticate(owner);

  const root = ContainerWriterProjectionWireResponseSchema.parse(
    await served(
      `/containers/${registration.rootContainerId}/writer-projection`,
      owner.token,
    ),
  );
  const [rootHash] = root.path;
  expect(registration.rootBundleDigest).toBe(
    await digestOf(rootHash ? root.bundles[rootHash] : undefined),
  );
});
