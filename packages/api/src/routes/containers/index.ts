import { Hono } from "hono";
import { createContainerRoute } from "./createContainer";
import { listContainersRoute } from "./listContainers";
import { shareContainerRoute } from "./shareContainer";

export const containersRouter = new Hono();

containersRouter.route("/", createContainerRoute);
containersRouter.route("/", listContainersRoute);
containersRouter.route("/", shareContainerRoute);
