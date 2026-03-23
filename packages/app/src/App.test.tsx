import { test, expect } from "bun:test";
import { render, screen } from "@testing-library/react";
import { App } from "./App";

test("renders App", async () => {
  render(<App />);
  expect(await screen.findByText(/App worker: (ready|unavailable)/)).toBeDefined();
});
