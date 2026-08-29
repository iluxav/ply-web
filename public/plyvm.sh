#!/bin/sh
# plyvm installer — compiles from source on your machine, so the resulting
# binary is signed ad-hoc with the hypervisor entitlement and never carries
# Gatekeeper quarantine. No Apple Developer account, no notarization.
#
#   curl -fsSL https://plybox.sh/plyvm.sh | sh
set -eu

REPO="${PLYVM_REPO:-https://github.com/iluxav/plyvm}"
KERNEL_URL="${PLYVM_KERNEL_URL:-https://registry.plybox.sh/ply/microvm-kernel/microvm-kernel-6.12.0-linux-arm64.img}"
DATA="$HOME/.local/share/plyvm"
BIN="$HOME/.local/bin"

say() { printf '\033[1;33m>>>\033[0m %s\n' "$1"; }
die() { printf '\033[1;31mplyvm:\033[0m %s\n' "$1" >&2; exit 1; }

# --- preflight ---------------------------------------------------------------
[ "$(uname -s)" = "Darwin" ] || die "plyvm runs only on macOS (Apple Silicon)."
[ "$(uname -m)" = "arm64" ] || die "plyvm needs an Apple Silicon Mac (M1+)."
case "$(sw_vers -productVersion)" in
  1[0-4].*) die "plyvm needs macOS 15 or newer (for the hardware GIC API).";;
esac
xcode-select -p >/dev/null 2>&1 || die "run 'xcode-select --install' first (needed for clang/codesign)."

if ! command -v cargo >/dev/null 2>&1; then
  say "Rust not found. Installing rustup (or Ctrl-C and install it yourself)…"
  curl --proto '=https' --tlsv1.2 -fsSL https://sh.rustup.rs | sh -s -- -y
  . "$HOME/.cargo/env"
fi
rustup target add aarch64-unknown-linux-musl >/dev/null 2>&1 || true

# --- fetch source ------------------------------------------------------------
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
say "Fetching plyvm source…"
git clone --depth 1 "$REPO" "$WORK/plyvm" >/dev/null 2>&1 || die "git clone $REPO failed."
cd "$WORK/plyvm"

# --- build (locally: the binary is born un-quarantined) ----------------------
say "Building the guest init (static arm64)…"
( cd guest-init && cargo build --release --target aarch64-unknown-linux-musl )
python3 mkinitramfs.py \
  guest-init/target/aarch64-unknown-linux-musl/release/guest-init initramfs.cpio

say "Building the VMM…"
cargo build --release

say "Signing with the hypervisor entitlement (ad-hoc)…"
codesign --entitlements hv.entitlements -s - -f target/release/plyvm

# --- fetch the microVM kernel keg (pure data, no signing) --------------------
mkdir -p "$DATA" "$BIN"
say "Fetching the microVM kernel…"
curl -fsSL "$KERNEL_URL" -o "$DATA/microvm-kernel.img" || die "could not fetch the kernel keg."

# --- install ------------------------------------------------------------------
cp target/release/plyvm "$BIN/plyvm"
cp initramfs.cpio "$DATA/initramfs.cpio"

say "Installed:"
echo "    $BIN/plyvm"
echo "    $DATA/microvm-kernel.img  ($(wc -c < "$DATA/microvm-kernel.img" | tr -d ' ') bytes)"
echo "    $DATA/initramfs.cpio"
case ":$PATH:" in
  *":$BIN:"*) ;;
  *) echo; echo "    add ~/.local/bin to your PATH:  export PATH=\"\$HOME/.local/bin:\$PATH\"";;
esac
echo
say "Try it:  plyvm run <some-ply-image>-linux-arm64.img"
