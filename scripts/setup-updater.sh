#!/usr/bin/env bash
# One-time setup for in-app updates. Run on your Mac from anywhere:
#   bash ~/iClaude/Projects/ramify/scripts/setup-updater.sh
#
# It will:
#   1. create the update-signing key in ~/.tauri/ramify.key (on this Mac only)
#   2. put the PUBLIC key into src-tauri/tauri.conf.json (the app uses it to verify updates)
#   3. store the PRIVATE key (+ password) as GitHub secrets so releases are signed
#   4. move the CI workflows from ci/workflows into .github/workflows
#
# Keep a backup of ~/.tauri/ramify.key and its password (e.g. in your password
# manager). Without them you cannot ship updates to people who already installed Ramify.
set -euo pipefail

REPO="ALMAZY/ramify"
KEY="$HOME/.tauri/ramify.key"

cd "$(dirname "$0")/.."
say() { printf "\n\033[1m==> %s\033[0m\n" "$*"; }

say "GitHub CLI"
command -v gh >/dev/null || brew install gh
gh auth status >/dev/null 2>&1 || gh auth login --web --git-protocol https -s workflow

say "Signing key"
mkdir -p "$HOME/.tauri"
if [ -f "$KEY" ]; then
  echo "Using the existing key: $KEY"
else
  echo "Choose a password for the key (you can leave it empty, then press Enter twice)."
  npx tauri signer generate -w "$KEY"
fi
[ -f "$KEY.pub" ] || { echo "Public key $KEY.pub not found"; exit 1; }

say "Public key -> src-tauri/tauri.conf.json"
node -e '
  const fs = require("fs");
  const p = "src-tauri/tauri.conf.json";
  const c = JSON.parse(fs.readFileSync(p, "utf8"));
  c.plugins.updater.pubkey = fs.readFileSync(process.argv[1], "utf8").trim();
  fs.writeFileSync(p, JSON.stringify(c, null, 2) + "\n");
' "$KEY.pub"
echo "Done."

say "Private key -> GitHub secret TAURI_SIGNING_PRIVATE_KEY"
gh secret set TAURI_SIGNING_PRIVATE_KEY -R "$REPO" < "$KEY"
read -r -s -p "Type the key password again (just Enter if you left it empty): " PW; echo
if [ -n "$PW" ]; then
  printf %s "$PW" | gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD -R "$REPO"
else
  gh secret delete TAURI_SIGNING_PRIVATE_KEY_PASSWORD -R "$REPO" >/dev/null 2>&1 || true
fi
echo "Saved."

say "Workflows"
if [ -d ci/workflows ]; then
  mkdir -p .github/workflows
  mv -f ci/workflows/*.yml .github/workflows/
  rmdir ci/workflows ci 2>/dev/null || true
  echo "Moved into .github/workflows."
else
  echo "Already in place."
fi

echo
echo "All set. Now commit, tag and push a release, e.g.:"
echo "  git add -A && git commit -m \"Ramify $(node -p "require('./package.json').version")\""
echo "  git tag v$(node -p "require('./package.json').version") && git push && git push --tags"
echo
echo "Back up $KEY and its password now."
