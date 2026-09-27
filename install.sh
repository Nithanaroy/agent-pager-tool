#!/bin/bash
# Installs Agent Pager for the current user. Safe to re-run.
#  - creates .venv with the sender's two dependencies
#  - links ~/.config/agent-notify/page -> ./page       (what agents call)
#  - links ~/.claude/skills/agent-pager -> ./skill     (agent-driven paging)
#  - writes ~/.copilot/hooks/agent-pager.json          (60s countdown hook, absolute paths)
set -euo pipefail

REPO=$(cd "$(dirname "$0")" && pwd)
case "$REPO" in *" "*) echo "Repo path contains a space; clone it somewhere without spaces." >&2; exit 1;; esac

CFG="$HOME/.config/agent-notify"
mkdir -p "$CFG" "$HOME/.claude/skills" "$HOME/.copilot/hooks"
chmod 700 "$CFG"

if [ ! -x "$REPO/.venv/bin/python" ]; then
  python3 -m venv "$REPO/.venv"
  "$REPO/.venv/bin/pip" install -q google-auth requests
fi

chmod 755 "$REPO/page"
ln -sfn "$REPO/page" "$CFG/page"
ln -sfn "$REPO/skill" "$HOME/.claude/skills/agent-pager"

HOOK_FILE="$HOME/.copilot/hooks/agent-pager.json"
rm -f "$HOOK_FILE"
"$REPO/.venv/bin/python" -c '
import json, sys
cmd = f"{sys.argv[1]}/.venv/bin/python {sys.argv[1]}/notify.py hook"
entry = [{"type": "command", "command": cmd, "timeout": 10}]
events = ["PreToolUse", "PostToolUse", "Stop", "UserPromptSubmit"]
json.dump({"hooks": {e: entry for e in events}}, open(sys.argv[2], "w"), indent=2)
' "$REPO" "$HOOK_FILE"

echo "Installed:"
echo "  $CFG/page -> $REPO/page"
echo "  $HOME/.claude/skills/agent-pager -> $REPO/skill"
echo "  $HOOK_FILE"
[ -f "$REPO/service-account.json" ] || echo "Next: put your Firebase service-account key at $REPO/service-account.json (chmod 600)."
[ -f "$CFG/tokens.json" ] || echo "Next: register your phone: $REPO/.venv/bin/python $REPO/notify.py register <token>"
