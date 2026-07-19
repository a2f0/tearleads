import { afterEach, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { ContactAvatar } from "./ContactAvatar";

afterEach(cleanup);

test("renders a decorative silhouette without an image", () => {
  const view = render(<ContactAvatar />);
  const avatar = view.container.querySelector(".contact-avatar");

  expect(avatar?.getAttribute("aria-hidden")).toBe("true");
  expect(avatar?.querySelector("svg")).toBeTruthy();
  expect(avatar?.querySelector("img")).toBeNull();
});

test("renders the avatar image with its accessible name", () => {
  const view = render(
    <ContactAvatar alt="Avatar for Ada" imageUrl="blob:avatar" size="large" />,
  );

  const image = view.getByAltText("Avatar for Ada");
  expect(image.getAttribute("src")).toBe("blob:avatar");
  expect(view.container.querySelector(".contact-avatar--large")).toBeTruthy();
  expect(
    view.container
      .querySelector(".contact-avatar")
      ?.getAttribute("aria-hidden"),
  ).toBeNull();
});
