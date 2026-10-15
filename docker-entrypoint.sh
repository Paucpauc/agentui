#!/bin/bash
set -euo pipefail

agy_bin="$HOME/.local/bin/agy"
mkdir -p "$HOME/.local/bin" "$HOME/.gemini"

workspace_base="${WORKSPACE_BASE:-/workspaces}"
mkdir -p "$workspace_base"
# Seed new volumes without replacing user-maintained workspace rules.
if [[ ! -e "$workspace_base/AGENTS.md" && ! -L "$workspace_base/AGENTS.md" ]]; then
    cp -n /usr/local/share/agent-webui/AGENTS.md "$workspace_base/AGENTS.md"
fi

if [[ ! -x "$agy_bin" ]]; then
    echo "Installing Antigravity CLI..."
    installer=$(mktemp)
    trap 'rm -f "$installer"' EXIT
    curl --fail --show-error --silent --location --retry 3 \
        --connect-timeout 15 --max-time 120 \
        https://antigravity.google/cli/install.sh -o "$installer"
    bash "$installer" --dir "$HOME/.local/bin"
    rm -f "$installer"
    trap - EXIT
    if [[ ! -x "$agy_bin" ]]; then
        echo "Antigravity CLI installer did not create $agy_bin" >&2
        exit 1
    fi
elif [[ "${AGY_AUTO_UPDATE:-1}" == "1" ]]; then
    echo "Checking for Antigravity CLI updates..."
    if ! timeout 120 "$agy_bin" update; then
        echo "Warning: agy update failed; continuing with the installed version." >&2
    fi
fi

exec "$@"
