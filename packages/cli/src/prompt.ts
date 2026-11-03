/**
 * Reads one secret line: from the terminal without echoing it, or, when input
 * is piped, the whole of stdin.
 */
export async function readSecret(prompt: string): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    return Bun.stdin.text();
  }

  process.stderr.write(prompt);
  stdin.setRawMode(true);
  stdin.setEncoding("utf8");
  stdin.resume();
  return new Promise((resolve, reject) => {
    let value = "";
    const finish = () => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stderr.write("\n");
    };
    const onData = (chunk: string) => {
      for (const character of chunk) {
        if (character === "\r" || character === "\n") {
          finish();
          resolve(value);
          return;
        }
        if (character === "\u0003") {
          finish();
          reject(new Error("Cancelled."));
          return;
        }
        value =
          character === "\u007f" || character === "\b"
            ? value.slice(0, -1)
            : value + character;
      }
    };
    stdin.on("data", onData);
  });
}
