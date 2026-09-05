import { expect, test } from "bun:test";
import {
  ROOT_CONTAINER_ID,
  TEST_SYSTEM_SLOT,
  withReadyStore,
} from "../../../test/helpers/deviceFirstSystemContainer";
import { waitFor } from "../../../test/helpers/waitFor";
import { defaultContainerContentsPersistence } from "../../workflows/container-contents/containerPersistence";

test("a stalled explicit system-container probe cannot block ordinary local folder writes", async () => {
  let release = () => {};
  let started = false;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await withReadyStore(
    true,
    async () => {
      started = true;
      await gate;
      return null;
    },
    async (store, execSql) => {
      const probe = store.ensureSystemContainer(
        TEST_SYSTEM_SLOT,
        "Remote probe",
      );
      try {
        await waitFor(() => started, "Explicit probe did not start");
        let created: Awaited<ReturnType<typeof store.createChild>> = null;
        const create = store
          .createChild(ROOT_CONTAINER_ID, "Local during outage")
          .then((node) => {
            created = node;
          });
        await waitFor(
          () => created !== null,
          "A stalled remote probe blocked local folder creation",
        );
        await create;
        const child = store
          .getSnapshot()
          .nodes.find((node) => node.name === "Local during outage");
        if (!child) throw new Error("Missing locally created folder");
        await store.renameContainer(child.id, "Renamed during outage");
        const stored =
          await defaultContainerContentsPersistence.loadContainers(execSql);
        expect(
          stored.some(
            ({ container }) =>
              container.id === child.id &&
              container.name === "Renamed during outage",
          ),
        ).toBe(true);
        let deleted = false;
        const deletion = store.deleteContainer(child.id).then((result) => {
          deleted = result;
        });
        await waitFor(
          () => deleted,
          "A stalled probe blocked local-only folder deletion",
        );
        await deletion;
        expect(
          (
            await defaultContainerContentsPersistence.loadContainers(execSql)
          ).some(({ container }) => container.id === child.id),
        ).toBe(false);
      } finally {
        release();
        expect(await probe).not.toBeNull();
      }
    },
  );
});
