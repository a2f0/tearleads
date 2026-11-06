import { afterEach, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import {
  ExplorerDocumentInfoBlameSection,
  ExplorerDocumentInfoCharacterBlameSection,
  ExplorerDocumentInfoFieldBlameSection,
} from "./ExplorerDocumentInfoGeneralSections";
import {
  createDocumentInfo,
  createRemoteInfo,
} from "./ExplorerDocumentInfoSections.testFixtures";

afterEach(() => cleanup());

test("character blame section lists live-character counts per writer", () => {
  const documentInfo = createDocumentInfo({
    attachments: [],
    remoteInfo: createRemoteInfo([], [], {
      writers: [
        {
          writerUserId: "writer-1",
          writerKeyFingerprint: "fingerprint-1",
          characterCount: 8,
          directCharacterCount: 8,
          baselineCharacterCount: 0,
          hasDirectAuthority: true,
          hasBaselineAuthority: false,
        },
        {
          writerUserId: "writer-2",
          writerKeyFingerprint: "fingerprint-2",
          characterCount: 3,
          directCharacterCount: 0,
          baselineCharacterCount: 3,
          hasDirectAuthority: false,
          hasBaselineAuthority: true,
        },
      ],
      totalCharacterCount: 13,
      unattributedCharacterCount: 2,
    }),
  });

  const view = render(
    createElement(ExplorerDocumentInfoCharacterBlameSection, { documentInfo }),
  );

  expect(view.getByText("8 characters")).toBeTruthy();
  // A baseline-only writer is flagged re-asserted.
  expect(view.getByText("3 characters (re-asserted)")).toBeTruthy();
  // Characters no segment covers get their own row.
  expect(view.getByText("Unattributed")).toBeTruthy();
  expect(view.getByText("2 characters")).toBeTruthy();
});

test("character blame section is hidden when blame is unavailable", () => {
  const documentInfo = createDocumentInfo({
    attachments: [],
    remoteInfo: createRemoteInfo([], [], null),
  });

  const view = render(
    createElement(ExplorerDocumentInfoCharacterBlameSection, { documentInfo }),
  );

  expect(view.container.querySelector("table")).toBeNull();
});

test("character blame section is hidden for an empty document", () => {
  const documentInfo = createDocumentInfo({
    attachments: [],
    remoteInfo: createRemoteInfo([], [], {
      writers: [],
      totalCharacterCount: 0,
      unattributedCharacterCount: 0,
    }),
  });

  const view = render(
    createElement(ExplorerDocumentInfoCharacterBlameSection, { documentInfo }),
  );

  expect(view.container.querySelector("table")).toBeNull();
});

test("character blame section shows unattributed-only text", () => {
  // The document has characters but the attribution feed covers none of them yet
  // — surface the unattributed count rather than hiding the section.
  const documentInfo = createDocumentInfo({
    attachments: [],
    remoteInfo: createRemoteInfo([], [], {
      writers: [],
      totalCharacterCount: 4,
      unattributedCharacterCount: 4,
    }),
  });

  const view = render(
    createElement(ExplorerDocumentInfoCharacterBlameSection, { documentInfo }),
  );

  expect(view.getByText("Unattributed")).toBeTruthy();
  expect(view.getByText("4 characters")).toBeTruthy();
});

test("blame section renders prose runs tinted per writer with a legend", () => {
  const documentInfo = createDocumentInfo({
    attachments: [],
    remoteInfo: createRemoteInfo([], [], undefined, [
      {
        startIndex: 0,
        endIndex: 2,
        text: "Hi",
        writerUserId: "alice",
        writerKeyFingerprint: "fp-alice",
        authorityKind: "direct",
      },
      {
        startIndex: 2,
        endIndex: 8,
        text: " there",
        writerUserId: "bob",
        writerKeyFingerprint: "fp-bob",
        authorityKind: "direct",
      },
    ]),
  });

  const view = render(
    createElement(ExplorerDocumentInfoBlameSection, { documentInfo }),
  );

  expect(view.container.querySelector(".explorer-blame-prose")).toBeTruthy();
  expect(view.getByText("Hi")).toBeTruthy();
  expect(view.getByText("there")).toBeTruthy();
  // The writer's signing identity is carried on each run's tooltip; the legend
  // repeats it, so the identity appears more than once.
  expect(view.getAllByTitle("alice · fp-alice").length).toBeGreaterThan(0);
  expect(view.getAllByTitle("bob · fp-bob").length).toBeGreaterThan(0);
});

test("blame section flags a re-asserted run on its tooltip", () => {
  const documentInfo = createDocumentInfo({
    attachments: [],
    remoteInfo: createRemoteInfo([], [], undefined, [
      {
        startIndex: 0,
        endIndex: 4,
        text: "base",
        writerUserId: "alice",
        writerKeyFingerprint: "fp-alice",
        authorityKind: "baseline",
      },
    ]),
  });

  const view = render(
    createElement(ExplorerDocumentInfoBlameSection, { documentInfo }),
  );

  expect(view.getByText("base").getAttribute("title")).toBe(
    "alice · fp-alice (re-asserted)",
  );
});

test("blame section renders an unattributed run with its legend entry", () => {
  const documentInfo = createDocumentInfo({
    attachments: [],
    remoteInfo: createRemoteInfo([], [], undefined, [
      {
        startIndex: 0,
        endIndex: 5,
        text: "draft",
        writerUserId: null,
        writerKeyFingerprint: null,
        authorityKind: null,
      },
    ]),
  });

  const view = render(
    createElement(ExplorerDocumentInfoBlameSection, { documentInfo }),
  );

  expect(view.getByText("draft")).toBeTruthy();
  expect(view.getByText("Unattributed")).toBeTruthy();
});

test("blame section is hidden when ranges are unavailable", () => {
  const documentInfo = createDocumentInfo({
    attachments: [],
    remoteInfo: createRemoteInfo([], [], undefined, null),
  });

  const view = render(
    createElement(ExplorerDocumentInfoBlameSection, { documentInfo }),
  );

  expect(view.container.querySelector(".explorer-blame-prose")).toBeNull();
});

test("blame section is hidden for an empty document", () => {
  const documentInfo = createDocumentInfo({
    attachments: [],
    remoteInfo: createRemoteInfo([], [], undefined, []),
  });

  const view = render(
    createElement(ExplorerDocumentInfoBlameSection, { documentInfo }),
  );

  expect(view.container.querySelector(".explorer-blame-prose")).toBeNull();
});

test("field blame section renders each field's writer with an unattributed row", () => {
  const documentInfo = createDocumentInfo({
    attachments: [],
    remoteInfo: createRemoteInfo(
      [],
      [],
      undefined,
      [],
      [
        {
          fieldKey: "firstName",
          writerUserId: "alice",
          writerKeyFingerprint: "fp-alice",
        },
        {
          fieldKey: "lastName",
          writerUserId: null,
          writerKeyFingerprint: null,
        },
      ],
    ),
  });

  const view = render(
    createElement(ExplorerDocumentInfoFieldBlameSection, { documentInfo }),
  );

  // Field keys are humanized for display; the writer identity is on the value
  // cell's tooltip, and an unresolved field shows the Unattributed label.
  expect(view.getByText("First Name")).toBeTruthy();
  expect(view.getByText("Last Name")).toBeTruthy();
  expect(view.getByTitle("alice · fp-alice")).toBeTruthy();
  expect(view.getByText("Unattributed")).toBeTruthy();
});

test("field blame section is hidden when field blame is unavailable", () => {
  const documentInfo = createDocumentInfo({
    attachments: [],
    remoteInfo: createRemoteInfo([], [], undefined, [], null),
  });

  const view = render(
    createElement(ExplorerDocumentInfoFieldBlameSection, { documentInfo }),
  );

  expect(view.container.querySelector("table")).toBeNull();
});

test("field blame section is hidden for a document with no fields", () => {
  const documentInfo = createDocumentInfo({
    attachments: [],
    remoteInfo: createRemoteInfo([], [], undefined, [], []),
  });

  const view = render(
    createElement(ExplorerDocumentInfoFieldBlameSection, { documentInfo }),
  );

  expect(view.container.querySelector("table")).toBeNull();
});
