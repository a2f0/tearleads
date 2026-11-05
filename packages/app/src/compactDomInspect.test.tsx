import { expect, test } from "bun:test";
import { render } from "@testing-library/react";

test("a failed DOM assertion prints the node's markup, not its object graph", () => {
  const view = render(
    <div role="dialog">
      {Array.from({ length: 200 }, (_, index) => (
        <p key={index}>Paragraph {index}</p>
      ))}
    </div>,
  );
  let message = "";
  try {
    expect(view.getByRole("dialog")).toBeNull();
  } catch (error) {
    message = String(error);
  }
  expect(message).toContain('<div role="dialog"><p>Paragraph 0</p>');
  expect(message).toContain("chars)");
  // Bun's default dump of this node runs to millions of characters.
  expect(message.length).toBeLessThan(5_000);
  expect(Bun.inspect(document.createTextNode("hi"))).toBe('#text "hi"');
  view.unmount();
});
