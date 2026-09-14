import { publishDesktopRelease } from "./publishDesktopRelease";

const [bucket, channel, appName, installer, update, archive] =
  process.argv.slice(2);
if (
  !bucket ||
  !channel ||
  !appName ||
  !installer ||
  !update ||
  !archive ||
  process.argv.length !== 8
)
  throw new Error(
    "Expected bucket, channel, app name, installer, update manifest, and archive",
  );

await publishDesktopRelease({
  bucket,
  channel,
  appName,
  installer,
  update,
  archive,
  target: "linux-x64",
});
