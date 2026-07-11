import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { ORG_MANAGER_LABELS } from "./labels";
import { OrgManagerMenu } from "./OrgManagerMenu";
import type { OrgManagerView } from "./routes";

afterEach(() => cleanup());

test("org manager menu lists every section", () => {
  const view = render(<OrgManagerMenu setView={() => undefined} />);

  expect(view.getByText(ORG_MANAGER_LABELS.directory)).toBeTruthy();
  expect(view.getByText(ORG_MANAGER_LABELS.groups)).toBeTruthy();
  expect(view.getByText(ORG_MANAGER_LABELS.grants)).toBeTruthy();
  expect(view.getByText(ORG_MANAGER_LABELS.organization)).toBeTruthy();
  expect(view.getByText(ORG_MANAGER_LABELS.usage)).toBeTruthy();
  expect(view.getByText(ORG_MANAGER_LABELS.billing)).toBeTruthy();
});

test("org manager menu drills into the tapped section", () => {
  const navigated: OrgManagerView[] = [];
  const view = render(
    <OrgManagerMenu setView={(next) => navigated.push(next)} />,
  );

  fireEvent.click(view.getByText(ORG_MANAGER_LABELS.grants));
  fireEvent.click(view.getByText(ORG_MANAGER_LABELS.billing));

  expect(navigated).toEqual(["grants", "billing"]);
});
