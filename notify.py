#!/usr/bin/env python3
"""Agent Pager: push notifications to my phone via Firebase Cloud Messaging (FCM HTTP v1).

Tapping a notification opens the Pager web app with the FULL message (carried in the URL
fragment, which never reaches the server), so messages aren't limited to lock-screen length.

Setup: see README.md (Firebase project, ./install.sh, deploy web/, register the phone).

Usage:
  notify.py send TITLE [BODY] [--link HTTPS_URL] [--device NAME]
  notify.py register TOKEN [--name NAME]
  notify.py hook            # VS Code agent hook entrypoint (JSON on stdin)
"""
import argparse
import base64
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

HOME = Path(os.environ.get("AGENT_NOTIFY_HOME", "~/.config/agent-notify")).expanduser()
# Private key lives next to this file (gitignored). Override with AGENT_NOTIFY_KEY.
SA_KEY = Path(os.environ.get("AGENT_NOTIFY_KEY", Path(__file__).resolve().parent / "service-account.json"))
TOKENS = HOME / "tokens.json"
PENDING = HOME / "pending"
LOG = HOME / "agent-notify.log"
WAIT_SECS = int(os.environ.get("AGENT_NOTIFY_WAIT_SECS", "60"))
NOTIFICATION_BODY_CHARS = 180
MAX_OPEN_URL_CHARS = 3000  # FCM web push payloads are capped at ~4 KB

# The hook only arms tools that finish in about a second. If one of these is still pending
# after WAIT_SECS, it is waiting on a confirmation (or on my answer). Terminal commands, MCP
# tools and subagents can run for minutes, so the agent pages for those itself (see skill/).
ARM_TOOLS = {
    "read_file", "create_file", "replace_string_in_file", "multi_replace_string_in_file",
    "list_dir", "file_search", "grep_search", "semantic_search", "get_errors", "view_image",
    "create_directory", "edit_notebook_file", "vscode_listCodeUsages", "vscode_renameSymbol",
    "fetch_webpage", "memory", "get_terminal_output", "kill_terminal", "vscode_askQuestions",
}


def _ensure_home():
    HOME.mkdir(parents=True, exist_ok=True)
    HOME.chmod(0o700)
    PENDING.mkdir(exist_ok=True)


def _load_tokens():
    return json.loads(TOKENS.read_text()) if TOKENS.exists() else {}


def register(token, name):
    _ensure_home()
    tokens = _load_tokens()
    tokens[name] = token.strip()
    TOKENS.write_text(json.dumps(tokens, indent=2))
    TOKENS.chmod(0o600)
    print(f"registered '{name}' ({len(tokens)} device(s) total)")


def _open_url(site, title, body, link):
    """Pager web app URL that renders the full message from the fragment."""
    def encode(b):
        payload = {"t": title, "b": b, "l": link, "ts": int(time.time())}
        raw = json.dumps(payload, separators=(",", ":")).encode()
        return f"{site}#m=" + base64.urlsafe_b64encode(raw).decode().rstrip("=")

    url = encode(body)
    while len(url) > MAX_OPEN_URL_CHARS and body:
        body = body[: int(len(body) * 0.9)]
        url = encode(body + "\n[truncated]")
    return url


def send(title, body="", link=None, device=None):
    from google.auth.transport.requests import AuthorizedSession
    from google.oauth2 import service_account

    if link and not link.startswith("https://"):
        sys.exit("--link must be an https:// URL")
    tokens = _load_tokens()
    if device:
        if device not in tokens:
            sys.exit(f"unknown device '{device}'; known: {sorted(tokens)}")
        tokens = {device: tokens[device]}
    if not tokens:
        sys.exit("no devices registered; run: notify.py register <token>")
    if not SA_KEY.exists():
        sys.exit(f"missing service account key at {SA_KEY}")

    creds = service_account.Credentials.from_service_account_file(
        str(SA_KEY), scopes=["https://www.googleapis.com/auth/firebase.messaging"]
    )
    session = AuthorizedSession(creds)
    url = f"https://fcm.googleapis.com/v1/projects/{creds.project_id}/messages:send"
    short = body if len(body) <= NOTIFICATION_BODY_CHARS else body[:NOTIFICATION_BODY_CHARS] + "... (tap for more)"
    open_url = _open_url(f"https://{creds.project_id}.web.app/", title, body, link)

    sent = 0
    for name, token in tokens.items():
        message = {
            "token": token,
            "webpush": {
                "headers": {"Urgency": "high", "TTL": "3600"},
                "notification": {"title": title, "body": short},
                "fcm_options": {"link": open_url},
            },
        }
        resp = session.post(url, json={"message": message}, timeout=15)
        if resp.ok:
            sent += 1
            print(f"sent -> {name}")
        else:
            hint = " (token expired: reopen Pager on the phone and re-register)" if resp.status_code == 404 else ""
            print(f"FAILED -> {name}: {resp.status_code} {resp.text[:300]}{hint}", file=sys.stderr)
    return sent


# ---------------------------------------------------------------------------
# VS Code agent hook: 60s countdown for quick tools stuck waiting on me.
# PreToolUse arms a marker + detached watchdog; PostToolUse / Stop / UserPromptSubmit disarm it.
# ---------------------------------------------------------------------------

def _marker(tool_use_id):
    return PENDING / re.sub(r"[^A-Za-z0-9_.-]", "_", tool_use_id)


def _clear_session(session_id, older_than=0.0):
    now = time.time()
    for m in PENDING.glob("*"):
        try:
            info = json.loads(m.read_text())
            if info.get("session") == session_id and now - info.get("armed", 0) >= older_than:
                m.unlink(missing_ok=True)
        except (OSError, ValueError):
            m.unlink(missing_ok=True)


def hook():
    event = json.load(sys.stdin)
    _ensure_home()
    kind = event.get("hook_event_name")
    tool_use_id = event.get("tool_use_id")
    session = event.get("session_id")

    if kind == "PreToolUse":
        # A later tool call means earlier ones already finished (PostToolUse never fires for
        # failed or denied tools). Keep markers from the last few seconds: parallel calls.
        _clear_session(session, older_than=5)
        if tool_use_id and event.get("tool_name") in ARM_TOOLS:
            marker = _marker(tool_use_id)
            marker.write_text(json.dumps({
                "tool": event.get("tool_name"),
                "input": event.get("tool_input") or {},
                "cwd": event.get("cwd"),
                "session": session,
                "armed": time.time(),
            }))
            with open(LOG, "a") as log:
                subprocess.Popen(
                    [sys.executable, os.path.abspath(__file__), "_watchdog", marker.name],
                    stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True,
                )
    elif kind == "PostToolUse" and tool_use_id:
        _marker(tool_use_id).unlink(missing_ok=True)
    elif kind in ("Stop", "UserPromptSubmit"):
        _clear_session(session)


def _describe(info):
    tool, args = info.get("tool"), info.get("input", {})
    if tool == "vscode_askQuestions":
        detail = "\n".join(q.get("question", "") for q in args.get("questions", []))
    else:
        detail = args.get("filePath") or args.get("path") or args.get("urls") or args.get("query") or ""
    where = Path(info["cwd"]).name if info.get("cwd") else "?"
    return f"[{where}] {tool}: {detail}", json.dumps(args, indent=2)


def watchdog(marker_name):
    marker = PENDING / marker_name
    time.sleep(WAIT_SECS)
    try:
        info = json.loads(marker.read_text())
    except (OSError, ValueError):
        return  # disarmed in time
    marker.unlink(missing_ok=True)
    summary, args = _describe(info)
    title = "Question for you" if info.get("tool") == "vscode_askQuestions" else "Approve in VS Code"
    print(time.strftime("%F %T"), "paging:", summary, flush=True)
    send(title, f"{summary}\n\nWaiting {WAIT_SECS}s+.\n\nTool input:\n{args}")


def main():
    p = argparse.ArgumentParser(description="Push notifications to my phone via FCM.")
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("send")
    s.add_argument("title")
    s.add_argument("body", nargs="?", default="")
    s.add_argument("--link", help="HTTPS URL shown as a button on the message page")
    s.add_argument("--device")
    r = sub.add_parser("register")
    r.add_argument("token")
    r.add_argument("--name", default="iphone")
    sub.add_parser("hook")
    w = sub.add_parser("_watchdog")
    w.add_argument("marker")
    a = p.parse_args()

    if a.cmd == "send":
        sys.exit(0 if send(a.title, a.body, a.link, a.device) else 1)
    elif a.cmd == "register":
        register(a.token, a.name)
    elif a.cmd == "hook":
        hook()
    elif a.cmd == "_watchdog":
        watchdog(a.marker)


if __name__ == "__main__":
    main()
