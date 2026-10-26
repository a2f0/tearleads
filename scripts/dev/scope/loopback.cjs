const net = require("node:net");
const originalListen = net.Server.prototype.listen;
net.Server.prototype.listen = function (...args) {
  if (
    typeof args[0] === "number" ||
    (typeof args[0] === "string" && /^\d+$/.test(args[0]))
  ) {
    if (typeof args[1] !== "string") args.splice(1, 0, "127.0.0.1");
  } else if (
    args[0] &&
    typeof args[0] === "object" &&
    "port" in args[0] &&
    !args[0].host
  ) {
    args[0] = { ...args[0], host: "127.0.0.1" };
  }
  return originalListen.apply(this, args);
};
