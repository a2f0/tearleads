import { Hono } from "hono";
import { getItemRoute } from "./getItem";
import { setItemRoute } from "./setItem";

export const itemsRouter = new Hono();

itemsRouter.route("/", getItemRoute);
itemsRouter.route("/", setItemRoute);
