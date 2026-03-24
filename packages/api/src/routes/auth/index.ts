import { Hono } from "hono";
import { challenge } from "./challenge";
import { logoutRoute } from "./logout";
import { verifyRoute } from "./verify";

export const auth = new Hono();

auth.route("/", challenge);
auth.route("/", verifyRoute);
auth.route("/", logoutRoute);
