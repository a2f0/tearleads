import { afterEach, expect, test } from "bun:test";
import { WrenchIcon } from "@phosphor-icons/react/dist/csr/Wrench";
import { cleanup, render } from "@testing-library/react";
import { DocumentAvatarImage } from "./DocumentAvatarImage";

afterEach(cleanup);

test("renders a decorative fallback glyph without an image", () => {
  const view = render(<DocumentAvatarImage />);
  const avatar = view.container.querySelector(".document-avatar");

  expect(avatar?.getAttribute("aria-hidden")).toBe("true");
  expect(avatar?.querySelector(".document-avatar-fallback")).toBeTruthy();
  expect(avatar?.querySelector("img")).toBeNull();
});

test("renders the kind's fallback glyph in place of the silhouette", () => {
  const silhouette = render(<DocumentAvatarImage />);
  const silhouettePath = silhouette.container.querySelector("svg")?.innerHTML;
  silhouette.unmount();

  const view = render(<DocumentAvatarImage fallbackIcon={WrenchIcon} />);
  const glyph = view.container.querySelector(".document-avatar-fallback");

  expect(glyph).toBeTruthy();
  expect(glyph?.innerHTML).not.toBe(silhouettePath);
});

test("renders the avatar image with its accessible name", () => {
  const view = render(
    <DocumentAvatarImage
      alt="Avatar for Ada"
      imageUrl="blob:avatar"
      size="large"
    />,
  );

  const image = view.getByAltText("Avatar for Ada");
  expect(image.getAttribute("src")).toBe("blob:avatar");
  expect(view.container.querySelector(".document-avatar--large")).toBeTruthy();
  expect(
    view.container
      .querySelector(".document-avatar")
      ?.getAttribute("aria-hidden"),
  ).toBeNull();
});
