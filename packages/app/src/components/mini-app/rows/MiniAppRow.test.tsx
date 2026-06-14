import { afterEach, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { createRef } from "react";
import { MiniAppRow, MiniAppRowButton, MiniAppRowText } from "./MiniAppRow";

afterEach(() => cleanup());

test("mini app row preserves classes and forwards refs for div and li rows", () => {
  const divRef = createRef<HTMLElement>();
  const listItemRef = createRef<HTMLElement>();
  const view = render(
    <>
      <MiniAppRow
        ref={divRef}
        className="custom-row"
        density="compact"
        selected
        variant="framed"
      >
        Div row
      </MiniAppRow>
      <ul>
        <MiniAppRow as="li" ref={listItemRef} header>
          List row
        </MiniAppRow>
      </ul>
    </>,
  );

  expect(divRef.current).toBe(view.getByText("Div row"));
  expect(divRef.current?.tagName).toBe("DIV");
  expect(divRef.current?.className).toBe(
    "mini-app-row mini-app-row--compact mini-app-row--framed mini-app-row--selected custom-row",
  );
  expect(listItemRef.current).toBe(view.getByText("List row"));
  expect(listItemRef.current?.tagName).toBe("LI");
  expect(listItemRef.current?.className).toBe(
    "mini-app-row mini-app-row--header",
  );
});

test("mini app row button and text preserve class modifiers", () => {
  const view = render(
    <MiniAppRowButton density="roomy" selected variant="framed">
      <MiniAppRowText muted truncate={false}>
        Row action
      </MiniAppRowText>
    </MiniAppRowButton>,
  );

  const button = view.getByRole("button", { name: "Row action" });
  const text = view.getByText("Row action");

  expect(button.getAttribute("type")).toBe("button");
  expect(button.className).toBe(
    "mini-app-row mini-app-row--roomy mini-app-row--framed mini-app-row--button mini-app-row--selected",
  );
  expect(text.className).toBe("mini-app-row-text mini-app-row-text--muted");
});
