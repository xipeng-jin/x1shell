# Build from source of ZMX

## Build Steps

### 1. Clone the repository with submodules

```bash
git clone https://github.com/user/zmx.git   # replace with the actual repo URL
cd zmx
git submodule update --init --recursive
```

The project depends on `vendors/ghostty` (the Ghostty terminal emulator source) which provides the `ghostty-vt` library used for terminal state restoration.

### 2. Install Zig 0.15.2

**Option A: Direct download**
```bash
# Linux x86_64 example:
curl -L https://ziglang.org/download/0.15.2/zig-x86_64-linux-0.15.2.tar.xz | tar -xJ
export PATH="$(pwd)/zig-x86_64-linux-0.15.2:$PATH"
```

**Option B: Using mise**
```bash
# In the project directory, mise will pick up mise.toml automatically
mise install
```

**Option C: Using Nix**
```bash
nix develop
```

### 3. Build the project

```bash
# Debug build (installs to ./zig-out by default):
zig build

# Release build (recommended, installs to ~/.local):
zig build -Doptimize=ReleaseSafe --prefix ~/.local

# Just check compilation (no binary produced, useful for IDEs/LSP):
zig build check
```

The compiled binary will be named `zmx`.

### 4. (Optional) Add to PATH

If you installed with `--prefix ~/.local`:
```bash
export PATH="$HOME/.local/bin:$PATH"
```

### 5. (Optional) Run tests

```bash
# Unit tests:
zig build test

# Integration tests (requires bats):
zig build test-integration
```

### 6. (Optional) Cross-compile release binaries

```bash
# On macOS: builds Linux (musl) + macOS binaries
# On Linux: builds Linux (musl) binaries only
zig build release
```

This produces tarballs in `zig-out/dist/`.

---

## Summary

| Dependency | Required? | Version |
|---|---|---|
| Zig | **Yes** | 0.15.2 |
| Git | **Yes** | any |
| C library (libc headers) | **Yes** | system default |
| bats | No (integration tests only) | 1.13.0 |
| mise or Nix | No (alt install methods) | — |

The core build command is simply:

```bash
zig build -Doptimize=ReleaseSafe --prefix ~/.local
```

