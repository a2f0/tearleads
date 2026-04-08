import { Hono } from "hono";
import { principalPolicyRoute } from "./policy";

export const principalsRouter = new Hono();

principalsRouter.route("/", principalPolicyRoute);
