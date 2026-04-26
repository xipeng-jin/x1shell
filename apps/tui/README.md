# X1Shell TUI

Phase 1 wires the `@x1shell/tui` workspace package and `x1shell` binary without starting an OpenTUI renderer or connecting to the backend.

The TUI is currently a Bun-hosted CLI. In repo/dev mode and packaged mode, the `x1shell` launcher re-execs Bun when invoked through Node. If Bun is unavailable, it fails with a Bun-required error instead of pretending to support Node-only execution.

Package-scoped validation:

```sh
bun run --filter @x1shell/tui typecheck
```
