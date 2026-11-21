#!/usr/bin/env bash
# One-time setup: puts Ramify on GitHub and makes the first release.
# Run on your Mac from anywhere:  bash ~/iClaude/Projects/ramify/scripts/publish.sh
#
# It will:
#   1. install the GitHub CLI and log you in (if needed)
#   2. move the CI workflows into .github/workflows
#   3. make the first commit and create the PUBLIC repo ALMAZY/ramify
#   4. create the PUBLIC tap repo ALMAZY/homebrew-tap
#   5. optionally store a TAP_TOKEN secret so releases update the Homebrew cask
#   6. tag v0.1.0, which starts the build for macOS, Windows and Linux
set -euo pipefail

OWNER="ALMAZY"
APP="ramify"

cd "$(dirname "$0")/.."
VERSION="$(node -p "require('./package.json').version")"
TAG="v$VERSION"

say() { printf "\n\033[1m==> %s\033[0m\n" "$*"; }

say "GitHub CLI"
command -v gh >/dev/null || brew install gh
# "workflow" scope is needed to push files in .github/workflows.
if gh auth status >/dev/null 2>&1; then gh auth refresh -h github.com -s workflow
else gh auth login --web --git-protocol https -s workflow; fi
gh auth setup-git

say "Workflows"
rm -f .git/tC2U2Dr 2>/dev/null || true
if [ -d ci/workflows ]; then
  mkdir -p .github/workflows
  mv ci/workflows/*.yml .github/workflows/
  rmdir ci/workflows ci 2>/dev/null || true
fi
[ -d .git ] || git init -q -b main

say "First commit"
git add -A
git -c commit.gpgsign=false commit -qm "Ramify $VERSION" || echo "(nothing new to commit)"

say "Repo $OWNER/$APP (public)"
if gh repo view "$OWNER/$APP" >/dev/null 2>&1; then
  git remote get-url origin >/dev/null 2>&1 || git remote add origin "https://github.com/$OWNER/$APP.git"
  git push -u origin HEAD:main
else
  gh repo create "$OWNER/$APP" --public --source=. --remote=origin --push \
    --description "Keyboard-first mind map for fast notes. Plain Markdown files. macOS, Windows, Linux."
fi
gh repo edit "$OWNER/$APP" --homepage "https://github.com/$OWNER/$APP" \
  --add-topic mind-map --add-topic mindmap --add-topic markdown --add-topic note-taking \
  --add-topic outliner --add-topic keyboard-shortcuts --add-topic tauri --add-topic obsidian >/dev/null

say "Tap $OWNER/homebrew-tap (public)"
if ! gh repo view "$OWNER/homebrew-tap" >/dev/null 2>&1; then
  gh repo create "$OWNER/homebrew-tap" --public --description "Homebrew tap: brew tap almazy/tap"
  TMP="$(mktemp -d)"
  cp packaging/homebrew-tap/README.md "$TMP/README.md"
  (cd "$TMP" && git init -q -b main && git add -A && git -c commit.gpgsign=false commit -qm "Tap README" \
    && git remote add origin "https://github.com/$OWNER/homebrew-tap.git" && git push -q -u origin main)
  rm -rf "$TMP"
fi

say "TAP_TOKEN (lets each release update the Homebrew cask)"
if gh secret list -R "$OWNER/$APP" 2>/dev/null | grep -q '^TAP_TOKEN'; then
  echo "TAP_TOKEN already set."
else
  echo "Create a fine-grained token: https://github.com/settings/personal-access-tokens/new"
  echo "  Repository access: Only select repositories → $OWNER/homebrew-tap"
  echo "  Permissions: Contents → Read and write"
  read -r -s -p "Paste the token (or press Enter to skip): " T; echo
  if [ -n "${T:-}" ]; then printf %s "$T" | gh secret set TAP_TOKEN -R "$OWNER/$APP"; echo "Saved."; else
    echo "Skipped. After the release, run: scripts/update-cask.sh $TAG"; fi
fi

say "Release $TAG"
if git rev-parse "$TAG" >/dev/null 2>&1; then echo "Tag $TAG exists."; else git tag "$TAG"; fi
git push origin "$TAG"

echo
echo "Done. Builds take about 15 minutes:"
echo "  https://github.com/$OWNER/$APP/actions"
echo "Release page when finished:"
echo "  https://github.com/$OWNER/$APP/releases/tag/$TAG"
