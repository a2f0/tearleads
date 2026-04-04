import { Hono } from "hono";
import { createContainerRoute } from "./createContainer";
import { listContainersRoute } from "./listContainers";

export const containersRouter = new Hono();

containersRouter.route("/", createContainerRoute);
containersRouter.route("/", listContainersRoute);
