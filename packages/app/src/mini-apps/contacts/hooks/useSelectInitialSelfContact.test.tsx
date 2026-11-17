import { afterEach, expect, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { useLayoutEffect } from "react";
import type { ContactEntry } from "../../../document-types/contact/contactDocumentModel";
import type { SelfContactIdentityView } from "../../../stores/contacts/currentSelfContactIdentityState";
import { useContactsRouteState } from "./useContactsRouteState";
import { useSelectInitialSelfContact } from "./useSelectInitialSelfContact";

afterEach(cleanup);

function contactEntry(id: string): ContactEntry {
  return {
    canWrite: true,
    documentId: `${id}-document`,
    encapsulationPublicKey: null,
    firstName: "",
    id,
    isSelf: false,
    lastName: "",
    nickname: null,
    userId: `${id}-user`,
  };
}

const entries = [contactEntry("self"), contactEntry("picked")];
const selfContactIdentity: SelfContactIdentityView = {
  status: "ready",
  identity: {
    documentId: "self-document",
    localId: "self",
    localIds: new Set(["self"]),
  },
  isCurrent: () => true,
  runWhenCurrent: async (work) => work(),
};

function Harness(props: { pickWhenReady: boolean; ready: boolean }) {
  const routeState = useContactsRouteState(false);
  const { selectContactRoute } = routeState;
  useSelectInitialSelfContact({
    enabled: true,
    entries,
    hasRequestedRoute: routeState.hasRequestedRoute,
    ready: props.ready,
    route: routeState.route,
    selectedContactId: routeState.selectedContactId,
    selfContactIdentity,
    setSelectedContactId: (id) => selectContactRoute(id, { replace: true }),
  });
  // Layout effects run before passive ones in a commit, so this picks a
  // contact after the render that made the list ready but before that
  // render's self-select effect, as a click landing then does in the app.
  useLayoutEffect(() => {
    if (props.ready && props.pickWhenReady) selectContactRoute("picked");
  }, [props.pickWhenReady, props.ready, selectContactRoute]);
  return (
    <output aria-label="Selected contact">
      {routeState.selectedContactId ?? "none"}
    </output>
  );
}

function selectedContact() {
  return screen.getByRole("status", { name: "Selected contact" }).textContent;
}

test("Contacts opens on the self contact once the list is ready", () => {
  const view = render(<Harness pickWhenReady={false} ready={false} />);
  expect(selectedContact()).toBe("none");
  view.rerender(<Harness pickWhenReady={false} ready />);
  expect(selectedContact()).toBe("self");
});

test("a contact picked before the initial self-select runs stays selected", () => {
  const view = render(<Harness pickWhenReady ready={false} />);
  view.rerender(<Harness pickWhenReady ready />);
  expect(selectedContact()).toBe("picked");
});
