import { afterEach, expect, test } from "bun:test";
import type { MenuPosition } from "@tearleads/windowing";
import {
  cleanup,
  fireEvent,
  type RenderResult,
  render,
} from "@testing-library/react";
import { useGrantRowMenu } from "./useGrantRowMenu";

afterEach(() => cleanup());

interface TestGrant {
  id: string;
  isBuiltin: boolean;
}

const CUSTOM_GRANT: TestGrant = { id: "custom", isBuiltin: false };
const BUILTIN_GRANT: TestGrant = { id: "builtin", isBuiltin: true };

function GrantRows(props: {
  onOpen: (grant: TestGrant, position: MenuPosition) => void;
  revoke?: {
    canRevoke: (grant: TestGrant) => boolean;
    onRevoke: (grant: TestGrant) => void;
  };
}) {
  const { grantRowMenu, openGrantRowMenu } = useGrantRowMenu(props);
  return (
    <>
      {[CUSTOM_GRANT, BUILTIN_GRANT].map((grant) => (
        <button
          key={grant.id}
          onClick={(event) => openGrantRowMenu(event, grant)}
          type="button"
        >
          {`Actions for ${grant.id}`}
        </button>
      ))}
      {grantRowMenu}
    </>
  );
}

function openMenuFor(view: RenderResult, grant: TestGrant) {
  fireEvent.click(
    view.getByRole("button", { name: `Actions for ${grant.id}` }),
    { clientX: 30, clientY: 40 },
  );
}

test("Open hands the menu's grant and position to the caller and closes", () => {
  const opened: Array<{ grant: TestGrant; position: MenuPosition }> = [];
  const view = render(
    <GrantRows
      onOpen={(grant, position) => opened.push({ grant, position })}
    />,
  );

  openMenuFor(view, BUILTIN_GRANT);
  fireEvent.click(view.getByRole("button", { name: "Open" }));

  expect(opened).toEqual([
    { grant: BUILTIN_GRANT, position: { x: 30, y: 40 } },
  ]);
  expect(view.queryByRole("button", { name: "Open" })).toBeNull();
});

test("without a revoke action the menu offers Open alone", () => {
  const view = render(<GrantRows onOpen={() => undefined} />);

  openMenuFor(view, CUSTOM_GRANT);

  expect(view.getByRole("button", { name: "Open" })).toBeTruthy();
  expect(view.queryByRole("button", { name: "Revoke" })).toBeNull();
});

test("Revoke follows canRevoke per grant", () => {
  const revoked: TestGrant[] = [];
  const view = render(
    <GrantRows
      onOpen={() => undefined}
      revoke={{
        canRevoke: (grant) => !grant.isBuiltin,
        onRevoke: (grant) => revoked.push(grant),
      }}
    />,
  );

  openMenuFor(view, BUILTIN_GRANT);
  const builtinRevoke = view.getByRole("button", { name: "Revoke" });
  expect(builtinRevoke).toHaveProperty("disabled", true);
  fireEvent.click(builtinRevoke);
  expect(revoked).toEqual([]);
  fireEvent.keyDown(document.activeElement ?? document.body, {
    key: "Escape",
  });

  openMenuFor(view, CUSTOM_GRANT);
  fireEvent.click(view.getByRole("button", { name: "Revoke" }));

  expect(revoked).toEqual([CUSTOM_GRANT]);
  expect(view.queryByRole("button", { name: "Revoke" })).toBeNull();
});
