import { Hono } from "hono";
import { challenge } from "./challenge";
import { logoutRoute } from "./logout";
import { registerRoute } from "./register";
import { verifyRoute } from "./verify";

export const auth = new Hono();

auth.route("/", challenge);
auth.route("/", registerRoute);
auth.route("/", verifyRoute);
auth.route("/", logoutRoute);
