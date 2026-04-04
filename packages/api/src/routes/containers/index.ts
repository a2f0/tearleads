import { Hono } from "hono";
import { createContainerRoute } from "./createContainer";

export const containersRouter = new Hono();

containersRouter.route("/", createContainerRoute);
