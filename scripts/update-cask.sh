#!/usr/bin/env bash
# Writes Casks/ramify.rb in the Homebrew tap for a published release.
# Used by the release workflow; you can also run it by hand:
#   scripts/update-cask.sh v0.1.0
# Needs: gh (logged in, with push access to the tap), curl, git.
set -euo pipefail

TAG="${1:?usage: scripts/update-cask.sh vX.Y.Z}"
REPO="${REPO:-ALMAZY/ramify}"
TAP="${TAP:-ALMAZY/homebrew-tap}"
VERSION="${TAG#v}"

ASSET=$(gh release view "$TAG" -R "$REPO" --json assets -q '.assets[].name | select(endswith("_universal.dmg"))' | head -n1)
if [ -z "$ASSET" ]; then
  echo "No *_universal.dmg on release $TAG yet. Wait for the macOS build to finish." >&2
  exit 1
fi
URL="https://github.com/$REPO/releases/download/$TAG/$ASSET"

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
curl -fsSL "$URL" -o "$WORK/app.dmg"
if command -v sha256sum >/dev/null; then SHA=$(sha256sum "$WORK/app.dmg" | cut -d' ' -f1)
else SHA=$(shasum -a 256 "$WORK/app.dmg" | cut -d' ' -f1); fi

gh repo clone "$TAP" "$WORK/tap" -- -q
mkdir -p "$WORK/tap/Casks"
# Asset names repeat the version; let Homebrew fill it in so `brew bump` style edits stay simple.
URL_TEMPLATE="${URL//$VERSION/#\{version\}}"

cat > "$WORK/tap/Casks/ramify.rb" <<EOF
cask "ramify" do
  version "$VERSION"
  sha256 "$SHA"

  url "$URL_TEMPLATE"
  name "Ramify"
  desc "Keyboard-first mind map for fast notes"
  homepage "https://github.com/$REPO"

  livecheck do
    url :url
    strategy :github_latest
  end

  depends_on macos: ">= :big_sur"

  # Ramify updates itself from inside the app.
  auto_updates true

  app "Ramify.app"

  # The app is ad-hoc signed, not notarized (no paid Apple Developer ID yet).
  # Removing the quarantine flag lets it open without the "Open Anyway" step.
  postflight do
    system_command "/usr/bin/xattr",
                   args: ["-dr", "com.apple.quarantine", "#{appdir}/Ramify.app"],
                   sudo: false
  end

  zap trash: [
    "~/Library/Application Support/io.github.almazy.ramify",
    "~/Library/Caches/io.github.almazy.ramify",
    "~/Library/WebKit/io.github.almazy.ramify",
    "~/Library/Saved Application State/io.github.almazy.ramify.savedState",
  ]
end
EOF

cd "$WORK/tap"
if git diff --quiet && [ -z "$(git status --porcelain)" ]; then
  echo "Cask already at $VERSION."
  exit 0
fi
git add Casks/ramify.rb
git commit -qm "ramify $VERSION"
git push -q origin HEAD
echo "Updated $TAP: ramify $VERSION ($SHA)"
