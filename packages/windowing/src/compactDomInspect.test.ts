import { expect, test } from "bun:test";

test("a failed DOM assertion prints the node's markup, not its object graph", () => {
  const dialog = document.createElement("div");
  dialog.setAttribute("role", "dialog");
  for (let index = 0; index < 200; index++) {
    const paragraph = document.createElement("p");
    paragraph.textContent = `Paragraph ${index}`;
    dialog.append(paragraph);
  }
  document.body.append(dialog);
  let message = "";
  try {
    expect(dialog).toBeNull();
  } catch (error) {
    message = String(error);
  }
  dialog.remove();
  expect(message).toContain('<div role="dialog"><p>Paragraph 0</p>');
  expect(message.length).toBeLessThan(5_000);
});
