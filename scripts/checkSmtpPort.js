import net from "node:net";

const host = process.env.SMTP_HOST || "127.0.0.1";
const port = Number.parseInt(process.env.SMTP_PORT || "25", 10);
const timeoutMs = Number.parseInt(process.env.SMTP_PORT_CHECK_TIMEOUT_MS || "500", 10);

let finished = false;
const finish = (code) => {
  if (finished) {
    return;
  }
  finished = true;
  process.exit(code);
};

const socket = net.connect({ host, port });

socket.setTimeout(timeoutMs);

socket.once("connect", () => {
  console.error(`Port ${port} already has a listener on ${host}.`);
  socket.end();
  finish(1);
});

socket.once("timeout", () => {
  socket.destroy();
  finish(0);
});

socket.once("error", () => {
  socket.destroy();
  finish(0);
});
