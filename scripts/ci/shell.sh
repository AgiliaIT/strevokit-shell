#!/usr/bin/env bash
# CI stage entrypoints for @strevokit/shell (packages/meeting-shell).
# The meeting SDK is bundled into the builds, not declared as a dependency: it is installed after `npm ci` without
# touching the lockfile, from the sibling source package when it is present, otherwise from npm for the
# `strevokitSdk` range in package.json.
set -euo pipefail

STAGE="${1:?usage: $0 <lint|static-analysis|unit|integration|build|security>}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
PACKAGE="$ROOT/packages/meeting-shell"

# Installs the package and the meeting SDK, then runs each named npm script in order.
shell() {
  (
    cd "$PACKAGE"
    npm ci --no-audit --no-fund
    if [ -f "$ROOT/packages/meeting-sdk/package.json" ]; then
      npm run sdk:link
    else
      npm run sdk:install
    fi
    for script in "$@"; do
      npm run "$script"
    done
  )
}

case "$STAGE" in
  lint)
    shell lint
    ;;
  static-analysis)
    shell typecheck
    ;;
  unit)
    shell test
    ;;
  integration)
    shell build api:check check:surface check:docs check:css pack:smoke check:publish-hygiene
    ;;
  build)
    shell build check:size check:release
    ;;
  security)
    (cd "$PACKAGE" && npm ci --no-audit --no-fund && npm audit --omit=dev)
    ;;
  *)
    echo "unknown stage: $STAGE" >&2
    exit 1
    ;;
esac
