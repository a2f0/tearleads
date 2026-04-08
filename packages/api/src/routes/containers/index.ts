import { Hono } from "hono";
import { createContainerRoute } from "./createContainer";
import { listContainerDocumentsRoute } from "./listContainerDocuments";
import { listContainersRoute } from "./listContainers";
import { moveContainerRoute } from "./moveContainer";
import { shareContainerRoute } from "./shareContainer";

export const containersRouter = new Hono();

containersRouter.route("/", createContainerRoute);
containersRouter.route("/", listContainerDocumentsRoute);
containersRouter.route("/", listContainersRoute);
containersRouter.route("/", moveContainerRoute);
containersRouter.route("/", shareContainerRoute);
