#!/bin/bash
# ─────────────────────────────────────────────────────────
# ChatMark — Build script for Chrome and Firefox packages
# Usage: bash build.sh
# Output: build/chatmark-chrome.zip, build/chatmark-firefox.zip
# ─────────────────────────────────────────────────────────

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BUILD_DIR="$SCRIPT_DIR/build"
STAGING_DIR="$BUILD_DIR/_staging"

# Files to include in the extension package
FILES=(
  "content.js"
  "background.js"
  "styles.css"
  "popup/popup.html"
  "popup/popup.css"
  "popup/popup.js"
)

echo "🔧 ChatMark Build Script"
echo "========================"

# Clean previous build
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"

# ── Chrome Build ─────────────────────────────────────────
echo ""
echo "📦 Building Chrome package..."
mkdir -p "$STAGING_DIR"

# Copy all extension files
for f in "${FILES[@]}"; do
  mkdir -p "$STAGING_DIR/$(dirname "$f")"
  cp "$SCRIPT_DIR/$f" "$STAGING_DIR/$f"
done

# Use Chrome manifest
cp "$SCRIPT_DIR/manifest.json" "$STAGING_DIR/manifest.json"

# Create zip
cd "$STAGING_DIR"
zip -r "$BUILD_DIR/chatmark-chrome.zip" . -q
cd "$SCRIPT_DIR"

echo "   ✅ build/chatmark-chrome.zip"

# Clean staging
rm -rf "$STAGING_DIR"

# ── Firefox Build ────────────────────────────────────────
echo ""
echo "📦 Building Firefox package..."
mkdir -p "$STAGING_DIR"

# Copy all extension files
for f in "${FILES[@]}"; do
  mkdir -p "$STAGING_DIR/$(dirname "$f")"
  cp "$SCRIPT_DIR/$f" "$STAGING_DIR/$f"
done

# Use Firefox manifest (renamed to manifest.json)
cp "$SCRIPT_DIR/manifest.firefox.json" "$STAGING_DIR/manifest.json"

# Create zip
cd "$STAGING_DIR"
zip -r "$BUILD_DIR/chatmark-firefox.zip" . -q
cd "$SCRIPT_DIR"

echo "   ✅ build/chatmark-firefox.zip"

# Clean staging
rm -rf "$STAGING_DIR"

echo ""
echo "🎉 Build complete!"
echo "   Chrome:  build/chatmark-chrome.zip"
echo "   Firefox: build/chatmark-firefox.zip"
