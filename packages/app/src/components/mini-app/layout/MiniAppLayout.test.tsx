import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import {
  MiniAppActions,
  MiniAppFormPanel,
  MiniAppHeader,
  MiniAppHeaderCopy,
  MiniAppInfoSection,
  MiniAppPanel,
  MiniAppRoot,
  MiniAppSection,
  MiniAppSectionHeading,
  MiniAppSidebar,
  MiniAppToolbar,
} from "../MiniAppLayout";

afterEach(() => cleanup());

test("mini app root and sidebar preserve layout classes", () => {
  const view = render(
    <MiniAppRoot centered className="custom-root" padding="none">
      <MiniAppSidebar className="custom-sidebar" />
    </MiniAppRoot>,
  );

  const root = view.container.firstElementChild;
  const sidebar = view.container.querySelector(".mini-app-sidebar");

  expect(root?.className).toBe(
    "mini-app-root mini-app-root--padding-none mini-app-root--centered custom-root",
  );
  expect(sidebar?.className).toBe("mini-app-sidebar custom-sidebar");
});

test("mini app toolbar, actions, and header preserve composition classes", () => {
  const view = render(
    <MiniAppHeader className="custom-header">
      <MiniAppHeaderCopy className="custom-copy">
        <strong>Title</strong>
        <span>Subtitle</span>
      </MiniAppHeaderCopy>
      <MiniAppToolbar wrap className="custom-toolbar">
        <MiniAppActions className="custom-actions" />
      </MiniAppToolbar>
    </MiniAppHeader>,
  );

  expect(view.container.firstElementChild?.className).toBe(
    "mini-app-header custom-header",
  );
  expect(view.container.querySelector(".mini-app-header-copy")?.className).toBe(
    "mini-app-header-copy custom-copy",
  );
  expect(view.container.querySelector(".mini-app-toolbar")?.className).toBe(
    "mini-app-toolbar mini-app-toolbar--wrap custom-toolbar",
  );
  expect(view.container.querySelector(".mini-app-actions")?.className).toBe(
    "mini-app-actions custom-actions",
  );
});

test("mini app panels preserve framed, scroll, and form behavior", () => {
  let submitted = false;
  const view = render(
    <>
      <MiniAppPanel className="custom-panel" scroll variant="framed" />
      <MiniAppFormPanel
        aria-label="Create"
        className="custom-form-panel"
        scroll
        variant="framed"
        onSubmit={(event) => {
          event.preventDefault();
          submitted = true;
        }}
      >
        <button type="submit">Submit</button>
      </MiniAppFormPanel>
    </>,
  );

  const panel = view.container.querySelector(".custom-panel");
  const form = view.getByRole("form", { name: "Create" });

  expect(panel?.className).toBe(
    "mini-app-panel mini-app-panel--scroll mini-app-panel--framed custom-panel",
  );
  expect(form.className).toBe(
    "mini-app-panel mini-app-panel--scroll mini-app-panel--framed custom-form-panel",
  );

  fireEvent.submit(form);

  expect(submitted).toBe(true);
});

test("mini app sections render heading wrappers and optional info headings", () => {
  const view = render(
    <MiniAppSection className="custom-section">
      <MiniAppSectionHeading className="custom-section-heading">
        <h2>Section</h2>
      </MiniAppSectionHeading>
      <MiniAppInfoSection className="custom-info" heading="Info">
        Body
      </MiniAppInfoSection>
    </MiniAppSection>,
  );

  expect(view.container.firstElementChild?.className).toBe(
    "mini-app-section custom-section",
  );
  expect(
    view.container.querySelector(".mini-app-section-heading")?.className,
  ).toBe("mini-app-section-heading custom-section-heading");
  expect(view.getByRole("heading", { level: 3, name: "Info" }).className).toBe(
    "mini-app-info-section-heading",
  );
  expect(
    view.container.querySelector(".mini-app-info-section")?.className,
  ).toBe("mini-app-info-section custom-info");
});
