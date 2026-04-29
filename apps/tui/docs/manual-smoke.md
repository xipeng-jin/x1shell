# X1Shell TUI Manual Smoke Checklist

Run these checks before treating a live TUI release as ready. They are intentionally manual because they depend on local terminal behavior, real server binaries, and optional provider CLIs.

## Local-Managed Mode

1. Start the TUI with a clean temp base dir and an explicit server entry:

   ```sh
   X1SHELL_CONFIG_HOME=/tmp/x1shell-smoke/config \
   X1SHELL_DATA_HOME=/tmp/x1shell-smoke/data \
   X1SHELL_CACHE_HOME=/tmp/x1shell-smoke/cache \
   X1SHELL_STATE_HOME=/tmp/x1shell-smoke/state \
   bun run --filter @x1shell/tui dev -- --server-entry="$(pwd)/apps/server/dist/bin.mjs" --new-server
   ```

2. Confirm the status line moves from startup to connected.
3. Confirm the server starts with no browser and the current working directory is bootstrapped.
4. Exit with `q` or `Ctrl+C` while idle and confirm the owned server stops.

## Attach Mode

1. Start a server separately.
2. Attach with a bearer token through stdin:

   ```sh
   printf '%s\n' "$T3_BEARER_TOKEN" | bun run --filter @x1shell/tui dev -- --attach=http://127.0.0.1:3773 --attach-bearer-stdin
   ```

3. Repeat with a bootstrap credential and `--attach-credential-stdin`.
4. Confirm reconnect with `R` refreshes snapshots without duplicating visible threads.

## Headless Frame Capture

```sh
bun run --filter @x1shell/tui dev -- --headless --headless-width=120 --headless-height=28 --headless-frame=/tmp/x1shell-frame.txt
```

Confirm the frame contains `X1Shell`, dimensions, and no raw secrets or OSC 8 hyperlink escapes.

## Provider Missing States

1. Run without provider CLIs configured.
2. Confirm the UI shows provider/config warnings without crashing.
3. Press `p` to refresh providers and confirm the error state remains readable.

## Resize

1. Start the interactive TUI in a normal terminal.
2. Resize below and above the compact breakpoint.
3. Confirm sidebar/content layout changes without overlapping status, panels, or composer text.

## Restart/Reconnect Messaging

1. Start in local-managed mode.
2. Kill the owned server process externally.
3. Confirm the TUI reports reconnect/restart state and returns to an authoritative snapshot after restart.

## Panels

1. Open command palette with `Ctrl+P`; type and paste text containing terminal controls and long data URLs.
2. Confirm the palette remains responsive and does not render terminal controls or secrets.
3. Open settings with `,`, help with `?`, debug with `Ctrl+D`, and diff with `d`.
4. Confirm duplicate diff lines render normally and panel content remains bounded.

## Clean Exit

1. Exit while idle with `q`.
2. Exit with `Ctrl+C` while no turn is running.
3. Interrupt a running turn with `Ctrl+C`.
4. Confirm renderer cleanup restores the terminal and no local-managed child process remains after idle exits.
