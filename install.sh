#!/usr/bin/env bash
set -e

echo "=== Memasang pi-next ==="

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 1. Periksa Node.js
if ! command -v node >/dev/null 2>&1; then
    echo "❌ Error: Node.js belum terpasang."
    echo "Silakan install Node.js (v22 atau lebih baru):"
    echo "  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -"
    echo "  sudo apt install -y nodejs"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 22 ]; then
    echo "⚠️  Catatan: Disarankan Node.js versi 22+ (versi saat ini: $(node -v))."
fi

# 2. Tentukan direktori binary
BIN_DIR="/usr/local/bin"
if [ ! -w "$BIN_DIR" ] && [ "$(id -u)" -ne 0 ]; then
    BIN_DIR="$HOME/.local/bin"
    mkdir -p "$BIN_DIR"
    case ":$PATH:" in
        *":$BIN_DIR:"*) ;;
        *)
            echo "Menambahkan $BIN_DIR ke PATH..."
            export PATH="$BIN_DIR:$PATH"
            if [ -n "$BASH_VERSION" ]; then
                echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$HOME/.bashrc"
            fi
            ;;
    esac
fi

WRAPPER="$BIN_DIR/pi"
echo "Membuat binary executable di: $WRAPPER..."

cat << 'EOF' > "$WRAPPER"
#!/usr/bin/env bash
SCRIPT_DIR="__SCRIPT_DIR__"

if [ -f "$SCRIPT_DIR/packages/coding-agent/dist/bundle/cli.js" ]; then
    exec node "$SCRIPT_DIR/packages/coding-agent/dist/bundle/cli.js" "$@"
elif [ -f "$SCRIPT_DIR/pi-test.sh" ]; then
    exec "$SCRIPT_DIR/pi-test.sh" "$@"
else
    RESOLVER_URL="$(node -p 'require("node:url").pathToFileURL(process.argv[1]).href' "$SCRIPT_DIR/packages/coding-agent/src/experimental/source-resolver.ts")"
    exec node --import "$RESOLVER_URL" "$SCRIPT_DIR/packages/coding-agent/src/cli.ts" "$@"
fi
EOF

sed -i "s|__SCRIPT_DIR__|$SCRIPT_DIR|g" "$WRAPPER"
chmod +x "$WRAPPER"

# 3. Pastikan permission executable di file pendukung
chmod +x "$SCRIPT_DIR/pi-test.sh" 2>/dev/null || true
if [ -f "$SCRIPT_DIR/packages/coding-agent/dist/bundle/cli.js" ]; then
    chmod +x "$SCRIPT_DIR/packages/coding-agent/dist/bundle/cli.js" 2>/dev/null || true
fi

echo "============================================="
echo "✅ Instalasi pi-next berhasil!"
echo "Sekarang kamu bisa langsung menjalankan: pi"
echo "============================================="
