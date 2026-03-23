import { request } from "../util/request";

export function getHealth() {
  return request("/");
}
