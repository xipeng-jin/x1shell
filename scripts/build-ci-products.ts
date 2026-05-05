import { spawnSync } from "node:child_process";

const args = [
  "turbo",
  "run",
  "build",
  "--filter=@t3tools/web",
  "--filter=@t3tools/marketing",
  "--filter=t3",
  "--filter=@t3tools/desktop",
  "--filter=@x1shell/tui",
];

const result = spawnSync("bun", args, {
  env: {
    ...process.env,
    ASTRO_TELEMETRY_DISABLED: "1",
    TELEMETRY_DISABLED: "1",
  },
  shell: process.platform === "win32",
  stdio: "inherit",
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
