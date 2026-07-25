import { expect, test } from "bun:test";
import { getExplorerContainerToolbarVisibility } from "./explorerContainerToolbarVisibility";

const allowedActions = {
  canCreateChild: true,
  canCreateContact: true,
  canCreateDocument: true,
  canUpload: true,
};

test("system containers omit forbidden standard actions", () => {
  expect(
    getExplorerContainerToolbarVisibility({
      ...allowedActions,
      activeContainerHasRules: true,
      canCreateChild: false,
      canCreateDocument: false,
      canUpload: false,
      showContactsToolbar: false,
      showStandardToolbar: true,
    }),
  ).toEqual({
    createChild: false,
    createContact: false,
    createDocument: false,
    upload: false,
  });
});

test("system contact containers hide contact creation when not allowed", () => {
  expect(
    getExplorerContainerToolbarVisibility({
      ...allowedActions,
      activeContainerHasRules: true,
      canCreateContact: false,
      showContactsToolbar: true,
      showStandardToolbar: false,
    }),
  ).toEqual({
    createChild: false,
    createContact: false,
    createDocument: false,
    upload: false,
  });
});

test("system contact containers show allowed contact creation", () => {
  expect(
    getExplorerContainerToolbarVisibility({
      ...allowedActions,
      activeContainerHasRules: true,
      showContactsToolbar: true,
      showStandardToolbar: false,
    }),
  ).toEqual({
    createChild: false,
    createContact: true,
    createDocument: false,
    upload: false,
  });
});

test("ordinary containers retain unavailable actions for disabled rendering", () => {
  expect(
    getExplorerContainerToolbarVisibility({
      activeContainerHasRules: false,
      canCreateChild: false,
      canCreateContact: false,
      canCreateDocument: false,
      canUpload: false,
      showContactsToolbar: false,
      showStandardToolbar: true,
    }),
  ).toEqual({
    createChild: true,
    createContact: false,
    createDocument: true,
    upload: true,
  });
});
