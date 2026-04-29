# X1Shell TUI

`@x1shell/tui` is the Bun-hosted OpenTUI client for X1Shell. It can run headless for smoke captures, attach to an existing server, or start a local-managed `t3` server when explicitly configured.

The package is intentionally Codex/server-contract first: UI actions dispatch orchestration commands through the current RPC boundary, and the TUI does not call provider adapters directly.

## Run

```sh
bun run --filter @x1shell/tui dev
```

Useful modes:

```sh
# Capture one CI-safe frame without starting a server.
bun run --filter @x1shell/tui dev -- --headless --headless-frame=/tmp/x1shell-frame.txt

# Attach with a bearer token read from stdin.
printf '%s\n' "$T3_BEARER_TOKEN" | bun run --filter @x1shell/tui dev -- --attach=http://127.0.0.1:3773 --attach-bearer-stdin

# Attach with a bootstrap/pairing credential read from stdin.
printf '%s\n' "$T3_BOOTSTRAP_TOKEN" | bun run --filter @x1shell/tui dev -- --attach=http://127.0.0.1:3773 --attach-credential-stdin
```

The `x1shell` launcher re-execs Bun when invoked through Node. If Bun is unavailable it fails clearly; the TUI does not currently promise a Node-only runtime because OpenTUI is Bun-oriented.

## Validation

Package-level checks:

```sh
bun run --filter @x1shell/tui typecheck
bun run --filter @x1shell/tui test
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
