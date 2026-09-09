import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { MouseEventHandler } from "react";
import type { DiagnosticBreadcrumb } from "../../host/AppDiagnostics";
import {
  DiagnosticAreaContext,
  DiagnosticsProvider,
} from "../../providers/logging/DiagnosticsProvider";
import { MiniAppButton } from "../mini-app/controls/MiniAppButton";
import { MenuItem } from "./MenuItem";

afterEach(cleanup);

test.each(["menu", "button"])(
  "%s records only its explicit action and preserves click behavior",
  (kind) => {
    const calls: unknown[] = [];
    let reportingFails = false;
    const diagnostics = {
      addBreadcrumb: (breadcrumb: DiagnosticBreadcrumb) => {
        if (reportingFails) throw new Error("offline");
        calls.push(breadcrumb);
      },
      captureError: () => {},
    };
    const onClick: MouseEventHandler<HTMLButtonElement> = (event) =>
      calls.push(event.currentTarget.tagName);
    function View({ disabled = false }: { disabled?: boolean }) {
      const control =
        kind === "menu" ? (
          <MenuItem
            diagnosticAction="edit"
            label="Private document title"
            disabled={disabled}
            onClick={onClick}
          />
        ) : (
          <MiniAppButton
            diagnosticAction="edit"
            disabled={disabled}
            onClick={onClick}
          >
            Private document title
          </MiniAppButton>
        );
      return (
        <DiagnosticsProvider value={diagnostics}>
          <DiagnosticAreaContext.Provider value="explorer">
            {control}
          </DiagnosticAreaContext.Provider>
        </DiagnosticsProvider>
      );
    }
    const view = render(<View />);
    fireEvent.click(view.getByRole("button"));
    expect(calls).toEqual([{ area: "explorer", action: "edit" }, "BUTTON"]);
    calls.length = 0;
    view.rerender(<View disabled />);
    fireEvent.click(view.getByRole("button"));
    expect(calls).toEqual([]);
    reportingFails = true;
    view.rerender(<View />);
    fireEvent.click(view.getByRole("button"));
    expect(calls).toEqual(["BUTTON"]);
  },
);
