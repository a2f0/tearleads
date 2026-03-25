import { expect, mock, test } from "bun:test";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { MockWorker } from "../../../test/helpers/mockWorker";
import { CryptoSessionProvider } from "../../crypto/CryptoSessionProvider";
import { DatabaseProvider } from "../../db/DatabaseProvider";
import { createAppDatabaseWorker } from "../../db/sqliteWorker";
import { Pane } from "./Pane";

const FAKE_USER_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

mock.module("../../api/routes/register", () => ({
  postPublicKey: mock(() =>
    Promise.resolve({ message: "ok", userId: FAKE_USER_ID }),
  ),
}));

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
  const view = renderPane();

  expect(view.getByText(/userId: none/)).toBeTruthy();

  await waitFor(() => {
    expect(view.getByText(/worker: ready/)).toBeTruthy();
  });

  fireEvent.click(view.getByText("Menu"));
  fireEvent.click(view.getByText("Generate Key Pair"));
  fireEvent.click(view.getByText("Menu"));
  fireEvent.click(view.getByText("Upload Public Key"));
  await waitFor(() => {
    expect(view.getByText(new RegExp(`userId: ${FAKE_USER_ID}`))).toBeTruthy();
  });
  view.unmount();
});

test("userId resets to none when key pair is destroyed", async () => {
  const view = renderPane();

  await waitFor(() => {
    expect(view.getByText(/worker: ready/)).toBeTruthy();
  });

  fireEvent.click(view.getByText("Menu"));
  fireEvent.click(view.getByText("Generate Key Pair"));
  fireEvent.click(view.getByText("Menu"));
  fireEvent.click(view.getByText("Upload Public Key"));

  await waitFor(() => {
    expect(view.getByText(new RegExp(`userId: ${FAKE_USER_ID}`))).toBeTruthy();
  });

  fireEvent.click(view.getByText("Menu"));
  fireEvent.click(view.getByText("Destroy Key Pair"));

  await waitFor(() => {
    expect(view.getByText(/userId: none/)).toBeTruthy();
  });

  view.unmount();
});
