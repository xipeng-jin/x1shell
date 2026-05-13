# X1Shell TUI

`@x1shell/tui` is the Bun-hosted OpenTUI client for X1Shell. It can run headless for smoke captures, attach to an existing server, or start a local-managed `t3` server when explicitly configured.

The package is intentionally Codex/server-contract first: UI actions dispatch orchestration commands through the current RPC boundary, and the TUI does not call provider adapters directly.

## Run

From the source checkout, prefer the root script. It runs the TUI entry directly so Bun's workspace
runner output does not share the terminal session with OpenTUI:

```sh
bun dev:tui
```

Published package usage is through the `x1shell` bin:

```sh
bunx @x1shell/tui
bun add -g @x1shell/tui
x1shell
```

Useful modes:

```sh
# Capture one CI-safe frame without starting a server.
bun dev:tui -- --headless --headless-frame=/tmp/x1shell-frame.txt

# Attach with a bearer token read from stdin.
printf '%s\n' "$T3_BEARER_TOKEN" | bun dev:tui -- --attach=http://127.0.0.1:3773 --attach-bearer-stdin

# Attach with a bootstrap/pairing credential read from stdin.
printf '%s\n' "$T3_BOOTSTRAP_TOKEN" | bun dev:tui -- --attach=http://127.0.0.1:3773 --attach-credential-stdin
```

The `x1shell` launcher re-execs Bun when invoked through Node. If Bun is unavailable it fails clearly; the TUI does not currently promise a Node-only runtime because OpenTUI is Bun-oriented. In a source checkout the TUI resolves `apps/server/dist/bin.mjs` first and then `apps/server/src/bin.ts`; packaged builds include a copy of the built server under `dist/server`.

## Validation

Package-level checks:

```sh
bun run --filter @x1shell/tui typecheck
(cd apps/tui && bun run test)
bun run --filter @x1shell/tui build
```

Repository completion checks:

```sh
bun fmt
bun lint
bun typecheck
bun run test
```

Do not use `bun test`; use `bun run test`.

## Smoke Coverage

Automated tests cover:

- headless boot frame capture
- fixture-backed shell/thread/detail rendering
- safe Markdown and terminal-control stripping
- command palette query sanitization and size bounding
- duplicate diff-line rendering keys
- attach auth flow against mocked and loopback HTTP endpoints
- local-managed startup with mocked spawn and loopback readiness/auth endpoints

Manual checks for live providers and terminal behavior are in [docs/manual-smoke.md](docs/manual-smoke.md).
