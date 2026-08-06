import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { IdentityManagerView } from "../routes";
import { IdentityManagerMenu } from "./IdentityManagerMenu";

afterEach(cleanup);

test("identity manager menu lists every section", () => {
  const view = render(<IdentityManagerMenu setView={() => undefined} />);

  expect(view.getByText("General")).toBeTruthy();
  expect(view.getByText("Recovery Key")).toBeTruthy();
  expect(view.getByText("PIN Lock")).toBeTruthy();
  expect(view.getByText("Active Sessions")).toBeTruthy();
});

test("identity manager menu drills into the selected section", () => {
  const navigated: IdentityManagerView[] = [];
  const view = render(
    <IdentityManagerMenu setView={(next) => navigated.push(next)} />,
  );

  fireEvent.click(view.getByText("Recovery Key"));
  fireEvent.click(view.getByText("Active Sessions"));

  expect(navigated).toEqual(["recovery-key", "active-sessions"]);
});
