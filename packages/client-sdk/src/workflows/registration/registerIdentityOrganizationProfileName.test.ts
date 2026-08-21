import { expect, test } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
} from "@symcrypt/crypto";
import { createTestExecSql } from "@symcrypt/test-utils";
import { execSqlClientFromExecSql } from "../../../test/helpers/execSqlClient";
import { respondToRegistration } from "../../../test/helpers/organizationProvisioningResponder";
import { readStoredDocumentState } from "../../data/documents/documentKinds";
import { sqlDocumentsPersistence } from "../../data/persistence/documents/documentsPersistence";
import { loadPersistedDocumentContent } from "../documents/historyContent";
import { readOrganizationProfileName } from "../organizations/organizationProfile";
import { getRosterProfileDocumentLocalId } from "../organizations/rosterProfileContainer";
import { type RegistrationApi, registerIdentity } from "./registerIdentity";

// Registration API stub that echoes a well-formed response so registerIdentity
// proceeds to persist the organization profile document locally, where the test
// can read back the seeded org name.
const registrationApi = {
  registerUser: async (...args: Parameters<RegistrationApi["registerUser"]>) =>
    respondToRegistration(args),
};

async function registerAndReadOrganizationName(
  label: string,
  organizationProfileName?: string,
): Promise<string | null> {
  const { close, execSql } = await createTestExecSql(label);
  try {
    const response = await registerIdentity({
      apiClient: registrationApi,
      containerId: crypto.randomUUID(),
      dbClient: execSqlClientFromExecSql(execSql),
      encapsulationKeyPair: generateKemSeedAndKeyPair(),
      ...(organizationProfileName ? { organizationProfileName } : {}),
      pinLocalUserIdentity: async () => undefined,
      signingKeyPair: generateSigningSeedAndKeyPair(),
    });
    if (!response) {
      throw new Error("Expected a registration response");
    }
    // Content is persisted only in the durable history (checkpoint + tail).
    const doc = await loadPersistedDocumentContent({
      execSql,
      localId: `org-profile:${response.organizationId}`,
      persistence: sqlDocumentsPersistence,
    });
    if (!doc) {
      throw new Error("Expected persisted organization profile document");
    }
    return readOrganizationProfileName(
      readStoredDocumentState(doc).structuredFields,
    );
  } finally {
    close();
  }
}

test("registerIdentity defaults the personal org name when none is given", async () => {
  expect(
    await registerAndReadOrganizationName("registration-org-name-default"),
  ).toBe("Personal Org");
});

test("registerIdentity names the personal org from organizationProfileName", async () => {
  expect(
    await registerAndReadOrganizationName(
      "registration-org-name-override",
      "Peer 2's Org",
    ),
  ).toBe("Peer 2's Org");
});

async function registerAndReadRosterNickname(
  label: string,
  rosterProfileNickname?: string,
): Promise<string | null> {
  const { close, execSql } = await createTestExecSql(label);
  try {
    const response = await registerIdentity({
      apiClient: registrationApi,
      containerId: crypto.randomUUID(),
      dbClient: execSqlClientFromExecSql(execSql),
      encapsulationKeyPair: generateKemSeedAndKeyPair(),
      ...(rosterProfileNickname ? { rosterProfileNickname } : {}),
      pinLocalUserIdentity: async () => undefined,
      signingKeyPair: generateSigningSeedAndKeyPair(),
    });
    if (!response) {
      throw new Error("Expected a registration response");
    }
    // Content is persisted only in the durable history (checkpoint + tail).
    const doc = await loadPersistedDocumentContent({
      execSql,
      localId: getRosterProfileDocumentLocalId({
        organizationId: response.organizationId,
        userId: response.userId,
      }),
      persistence: sqlDocumentsPersistence,
    });
    if (!doc) {
      throw new Error("Expected persisted roster profile document");
    }
    const { nickname } = readStoredDocumentState(doc).structuredFields;
    return typeof nickname === "string" ? nickname : null;
  } finally {
    close();
  }
}

test('registerIdentity defaults the self roster nickname to "You"', async () => {
  expect(
    await registerAndReadRosterNickname("registration-roster-nickname-default"),
  ).toBe("You");
});

test("registerIdentity names the self roster entry from rosterProfileNickname", async () => {
  expect(
    await registerAndReadRosterNickname(
      "registration-roster-nickname-override",
      "Peer 1 (You)",
    ),
  ).toBe("Peer 1 (You)");
});
