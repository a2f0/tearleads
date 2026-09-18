// Electrobun's streaming tar reader closes its descriptor asynchronously under
// Bun. Keep it in its own process so a delayed close cannot affect later reads.
const updaterPath = process.argv[2];
const archive = process.argv[3];
if (!updaterPath || !archive)
  throw new Error("Expected SDK path and update tar");
const updater = await import(updaterPath);
console.log(await updater.readUpdateHashFromTar(archive));

export {};
