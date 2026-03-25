import { afterAll, afterEach, beforeAll, expect, spyOn, test } from "bun:test";
import { isPublicKeyResponse } from "@tearleads/validators/response";
import { fireEvent, render, waitFor } from "@testing-library/react";
import invariant from "invariant";
import * as register from "../../../src/api/routes/register";
import { MockWorker } from "../../../test/helpers/mockWorker";
import { server } from "../../../test/helpers/mswServer";
import { CryptoSessionProvider } from "../../crypto/CryptoSessionProvider";
import { DatabaseProvider } from "../../db/DatabaseProvider";
import { createAppDatabaseWorker } from "../../db/sqliteWorker";
import { Pane } from "./Pane";

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function renderPane() {
  return render(
    <DatabaseProvider
      createWorker={() => {
        const appWorker = createAppDatabaseWorker(MockWorker);
        return appWorker;
      }}
    >
      <CryptoSessionProvider>
        <Pane className="pane" />
      </CryptoSessionProvider>
    </DatabaseProvider>,
  );
}

test("displays userId after uploading public key", async () => {
  const spy = spyOn(register, "postPublicKey");
  const view = renderPane();

  expect(view.getByText(/userId: none/)).toBeTruthy();

  await waitFor(() => {
    expect(view.getByText(/worker: ready/)).toBeTruthy();
  });

  fireEvent.click(view.getByText("Menu"));
  fireEvent.click(view.getByText("Generate Key Pair"));
  fireEvent.click(view.getByText("Menu"));
  fireEvent.click(view.getByText("Upload Public Key"));

  expect(spy.mock.results).toHaveLength(1);
  const spyResult = spy.mock.results[0];
  invariant(spyResult, "spy has no results");
  const result = await spyResult.value;
  if (!isPublicKeyResponse(result)) throw new Error("invalid response");
  const { userId } = result;

  await waitFor(() => {
    expect(view.getByText(new RegExp(`userId: ${userId}`))).toBeTruthy();
  });

  fireEvent.click(view.getByText("Menu"));
  expect(view.queryByText("Upload Public Key")).toBeNull();

  spy.mockRestore();
  view.unmount();
});

test("userId resets to none when key pair is destroyed", async () => {
  const spy = spyOn(register, "postPublicKey");
  const view = renderPane();

  await waitFor(() => {
    expect(view.getByText(/worker: ready/)).toBeTruthy();
  });

  fireEvent.click(view.getByText("Menu"));
  fireEvent.click(view.getByText("Generate Key Pair"));
  fireEvent.click(view.getByText("Menu"));
  fireEvent.click(view.getByText("Upload Public Key"));

  expect(spy.mock.results).toHaveLength(1);
  const spyResult = spy.mock.results[0];
  invariant(spyResult, "spy has no results");
  const result = await spyResult.value;
  if (!isPublicKeyResponse(result)) throw new Error("invalid response");
  const { userId } = result;

  await waitFor(() => {
    expect(view.getByText(new RegExp(`userId: ${userId}`))).toBeTruthy();
  });

  fireEvent.click(view.getByText("Menu"));
  fireEvent.click(view.getByText("Destroy Key Pair"));

  await waitFor(() => {
    expect(view.getByText(/userId: none/)).toBeTruthy();
  });

  spy.mockRestore();
  view.unmount();
});
