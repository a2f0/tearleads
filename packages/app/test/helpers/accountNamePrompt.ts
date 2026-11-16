import { fireEvent, within } from "@testing-library/react";
import invariant from "invariant";

/**
 * Answers the "What should we call you?" prompt that holds an autopilot
 * identity's first registration, once it shows anywhere in `container`.
 */
export async function answerAccountNamePrompt(
  container: HTMLElement,
  name = "Bob",
  timeout = 30_000,
): Promise<void> {
  const [prompt] = await within(container).findAllByRole(
    "textbox",
    { name: "What should we call you?" },
    { timeout },
  );
  invariant(prompt, "Expected the account name prompt");
  fireEvent.change(prompt, { target: { value: name } });
  const form = prompt.closest("form");
  invariant(form, "Expected the account name form");
  fireEvent.submit(form);
}
