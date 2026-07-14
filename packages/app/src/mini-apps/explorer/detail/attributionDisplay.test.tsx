import { afterEach, expect, test } from "bun:test";
import type { DocumentInfo } from "@tearleads/client-sdk";
import { cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import {
  getExplorerAttributionUserLabel,
  getExplorerAttributionWriterLabel,
} from "./attributionDisplay";
import {
  ExplorerDocumentInfoBlameSection,
  ExplorerDocumentInfoFieldBlameSection,
} from "./document/ExplorerDocumentInfoGeneralSections";

afterEach(() => cleanup());

function createDocumentInfo(
  remoteInfo: Partial<NonNullable<DocumentInfo["remoteInfo"]>>,
): DocumentInfo {
  return {
    attachments: [],
    local: {} as DocumentInfo["local"],
    remoteInfo: {
      activeAttachmentBindings: [],
      attributionRevision: 1,
      attributionSegments: [],
      attributionStatus: "available",
      authorizingContainerPaths: [],
      blameRanges: [],
      characterBlame: {
        writers: [],
        totalCharacterCount: 0,
        unattributedCharacterCount: 0,
      },
      fieldBlame: [],
      contentKeyEpoch: 1,
      contentKeyTargetCount: 1,
      contentKeyTargetHash: "content-key-target-hash",
      contributors: [],
      currentManifestHash: "document-manifest-hash",
      documentContainerManifestHistoryCount: 0,
      documentKekTargetCount: 1,
      documentKeyTargetHash: "document-key-target-hash",
      documentManifestContainerPathCount: 0,
      documentManifestHistoryCount: 0,
      linkedContainerKeyEpochCount: 0,
      linkedContainerManifestCount: 0,
      linkSetManifestHash: "link-set-manifest-hash",
      manifestEpoch: 1,
      previousManifestHash: null,
      referencedPrincipalCount: 1,
      ...remoteInfo,
    },
  };
}

test("attribution labels prefer roster display names and fall back to You for self", () => {
  const displayNames = new Map([["writer-1", "Countess"]]);

  expect(
    getExplorerAttributionUserLabel({
      currentUserId: "self-user",
      profileDisplayNamesByUserId: displayNames,
      userId: "writer-1",
    }),
  ).toBe("Countess");
  expect(
    getExplorerAttributionUserLabel({
      currentUserId: "self-user",
      profileDisplayNamesByUserId: new Map(),
      userId: "self-user",
    }),
  ).toBe("You");
  expect(
    getExplorerAttributionWriterLabel(
      {
        writerUserId: "peer-user",
        writerKeyFingerprint: "peer-fingerprint",
      },
      () => null,
    ),
  ).toBe("peer-fingerprint");
});

test("note blame renders roster display names in prose tooltips and legend", () => {
  const documentInfo = createDocumentInfo({
    blameRanges: [
      {
        startIndex: 0,
        endIndex: 2,
        text: "Hi",
        writerUserId: "writer-1",
        writerKeyFingerprint: "fingerprint-1",
        authorityKind: "direct",
      },
    ],
  });
  const resolveUserLabel = (userId: string | null | undefined) =>
    userId === "writer-1" ? "Countess" : null;

  const view = render(
    createElement(ExplorerDocumentInfoBlameSection, {
      attributionUserLabelResolver: resolveUserLabel,
      documentInfo,
    }),
  );

  expect(view.getByText("Countess")).toBeTruthy();
  expect(view.getByText("Hi").getAttribute("title")).toBe(
    "Countess · writer-1 · fingerprint-1",
  );
});

test("field blame renders You for unresolved self and IDs for unresolved peers", () => {
  const documentInfo = createDocumentInfo({
    fieldBlame: [
      {
        fieldKey: "nickname",
        writerUserId: "self-user",
        writerKeyFingerprint: "self-fingerprint",
      },
      {
        fieldKey: "email",
        writerUserId: "peer-user",
        writerKeyFingerprint: "peer-fingerprint",
      },
    ],
  });
  const resolveUserLabel = (userId: string | null | undefined) =>
    userId === "self-user" ? "You" : null;

  const view = render(
    createElement(ExplorerDocumentInfoFieldBlameSection, {
      attributionUserLabelResolver: resolveUserLabel,
      documentInfo,
    }),
  );

  expect(view.getByText("You")).toBeTruthy();
  expect(view.getByText("peer-fingerprint")).toBeTruthy();
  expect(view.getByTitle("You · self-user · self-fingerprint")).toBeTruthy();
  expect(view.getByTitle("peer-user · peer-fingerprint")).toBeTruthy();
});
