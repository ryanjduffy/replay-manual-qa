const { program } = require("commander");
const fs = require("fs");
const uuid = require("uuid");
const path = require("path");
const { spawnSync } = require("child_process");
const replay = require("@replayio/replay");
const { getDirectory } = require("@replayio/replay/src/utils");
const { getExecutablePath } = require("@replayio/playwright");
const tmp = require("tmp");

console.log("");

const home = getDirectory();
const pwHome = path.join(home, "playwright");

const FIREFOX_VERSIONED_HOME = path.join(pwHome, "firefox-1316");
const CHROMIUM_VERSIONED_HOME = path.join(pwHome, "chromium-965416");

let hasFirefoxInstalled = fs.existsSync(getExecutablePath("firefox"));
let hasChromiumInstalled = fs.existsSync(getExecutablePath("chromium"));

if (!hasFirefoxInstalled && !hasChromiumInstalled) {
  console.log("  🌎 Installing Replay Browsers");
  spawnSync("npx", ["-y", "@replayio/playwright", "install"]);

  hasFirefoxInstalled = fs.existsSync(getExecutablePath("firefox"));
  hasChromiumInstalled = fs.existsSync(getExecutablePath("chromium"));
}

if (hasFirefoxInstalled && !fs.existsSync(FIREFOX_VERSIONED_HOME)) {
  fs.mkdirSync(FIREFOX_VERSIONED_HOME);
  fs.symlinkSync(
    path.join(pwHome, "firefox"),
    path.join(FIREFOX_VERSIONED_HOME, "firefox"),
    "dir"
  );
}

if (hasChromiumInstalled && !fs.existsSync(CHROMIUM_VERSIONED_HOME)) {
  fs.mkdirSync(CHROMIUM_VERSIONED_HOME);
  fs.symlinkSync(
    path.join(pwHome, "chrome-linux"),
    path.join(CHROMIUM_VERSIONED_HOME, "chrome-linux"),
    "dir"
  );
}

if (!hasChromiumInstalled && !hasFirefoxInstalled) {
  console.error("Cannot continue without Replay browsers installed.");
  console.error(
    "Try running `npx @replayio/playwright install` manually first."
  );

  process.exit(1);
}

const id = uuid.v4();

program
  .option(
    "-b, --browser <browser>",
    "browser to use",
    hasChromiumInstalled ? "chromium" : "firefox"
  )
  .option(
    "-k, --api-key <apiKey>",
    "API Key for uploading",
    process.env.RECORD_REPLAY_API_KEY
  )
  .option("-o, --out <out>", "output filename for playwright script");

program.parse();

const { apiKey, out = tmp.fileSync().name, browser } = program.opts();

console.log("  🚀 Launching", browser, "with playwright inspector");
spawnSync(
  "npx",
  [
    "-y",
    "playwright@1.19",
    "codegen",
    "-o",
    out,
    "-b",
    browser,
    ...program.args,
  ],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: 1,
      PLAYWRIGHT_BROWSERS_PATH: pwHome,
      RECORD_ALL_CONTENT: 1,
      RECORD_REPLAY_METADATA: JSON.stringify({
        "x-replay-qa": { id },
      }),
    },
  }
);

console.log("  🎭 Reading playwright script");
const script = fs.readFileSync(out).toString("utf-8");
fs.unlinkSync(out);

const filter = `function($v) { $v.metadata.\`x-replay-qa\`.id = "${id}" }`;
const replays = replay.listAllRecordings({
  filter,
});

if (replays.length === 0) {
  console.error("  ❌ Failed to find a recording with x-replay-qa id of " + id);
  console.error(JSON.stringify(replays, undefined, 2));
  return;
}

replays.forEach((r) => {
  const recordingId = r.id;
  console.log(
    "  ✍️  Adding playwright script to metadata for replay",
    recordingId
  );
  replay.addLocalRecordingMetadata(recordingId, {
    "x-replay-qa": {
      id,
      script,
    },
  });
});

if (apiKey) {
  console.log("  ☁️  Uploading replays");
  replay
    .uploadAllRecordings({
      apiKey,
      filter,
    })
    .then((r) => {
      if (r) {
        console.log("  ▶︎  Recordings uploaded");
        replays.forEach((r) => {
          console.log(`      https://app.replay.io/recording/${r.id}`);
        });
      } else {
        console.error("Failed to upload recordings");
      }
      console.log("");
    });
} else {
  console.log(
    "  ⏭  Skipping upload because apiKey was not provided and RECORD_REPLAY_API_KEY is not set. Upload manually with @replayio/replay."
  );
  console.log("");
}
