import net from 'node:net';

export const parsePort = (rawValue: string): number | null => {
  const port = Number.parseInt(rawValue, 10);
  if (Number.isNaN(port) || port < 1 || port > 65535) {
    return null;
  }
  return port;
};

export const createExitOnce = (): ((code: number) => void) => {
  let finished = false;
  return (code: number): void => {
    if (finished) {
      return;
    }
    finished = true;
    process.exit(code);
  };
};

export const isPortInUse = async ({
  host,
  port,
  timeoutMs
}: {
  host: string;
  port: number;
  timeoutMs: number;
}): Promise<boolean> =>
  new Promise((resolve) => {
    const socket = net.connect({ host, port });
    let settled = false;

    const complete = (inUse: boolean, gracefulClose: boolean): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (gracefulClose) {
        socket.end();
      } else {
        socket.destroy();
      }
      resolve(inUse);
    };

    socket.setTimeout(timeoutMs);

    socket.once('connect', () => {
      complete(true, true);
    });

    socket.once('timeout', () => {
      complete(false, false);
    });

    socket.once('error', () => {
      complete(false, false);
    });
  });
