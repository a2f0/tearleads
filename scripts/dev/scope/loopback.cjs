const net = require("node:net");
const originalListen = net.Server.prototype.listen;
const loopbackHost = (host) => (host === "::1" ? "::1" : "127.0.0.1");
net.Server.prototype.listen = function (...args) {
  if (typeof args[0] === "function")
    args.unshift({ port: 0, host: "127.0.0.1" });
  else if (args[0] === undefined) args[0] = { port: 0, host: "127.0.0.1" };
  if (
    typeof args[0] === "number" ||
    (typeof args[0] === "string" && /^\d+$/.test(args[0]))
  ) {
    if (typeof args[1] !== "string") args.splice(1, 0, "127.0.0.1");
    else args[1] = loopbackHost(args[1]);
  } else if (args[0] && typeof args[0] === "object" && !("path" in args[0])) {
    args[0] = {
      ...args[0],
      port: args[0].port ?? 0,
      host: loopbackHost(args[0].host),
    };
  }
  return originalListen.apply(this, args);
};
