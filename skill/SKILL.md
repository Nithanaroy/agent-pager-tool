---
name: agent-pager
description: Page the user's phone with a push notification (Firebase Cloud Messaging) when the agent is about to be BLOCKED on the user and they may be away from the laptop. Use before running a terminal command or MCP tool that will show an approval prompt (not auto-approved), when a command prints a device-login code or opens an SSO/auth browser tab, when a credential expired mid-run, or when a long job the user is waiting on finishes or fails. Triggers: blocked, waiting on user, pending confirmation, needs approval, device code, devicelogin, authenticate, SSO, re-auth, token expired, notify me, page me, ping my phone.
---

# Agent Pager

One-way push to the user's phone. Tapping it opens the Pager web app with the FULL message,
so the body can be long (up to ~2 KB); the lock screen shows the first ~180 chars.
Replying does not reach the agent.

```bash
~/.config/agent-notify/page 'TITLE' 'BODY' [--link 'https://...']
```

- Auto-approved in VS Code (`chat.tools.terminal.autoApprove`), so paging never needs a
  confirmation. Keep it ONE standalone command: no `&&`, no pipes, no `$(...)`, single-quoted
  args. Anything else loses auto-approve and you block on the page itself.
- Exit 0 = delivered to FCM. Non-zero = use the fallback channel in `local.md` if present.
- `--link` shows an "Open link" button on the message page. HTTPS only.
- If `local.md` exists next to this file, read it: it has environment-specific cases.

## Who pages what

| Situation | Who pages |
|---|---|
| Quick tool (read/edit/search files, fetch_webpage, vscode_askQuestions) stuck on a confirmation | The VS Code hook (`hooks/agent-pager.json`) after 60s. Don't page for these yourself. |
| Terminal command or MCP tool that will need approval | YOU, before calling it |
| Auth prompt printed or opened by a command | YOU, as soon as you see it |
| Long job finished or failed | YOU |

Terminal and MCP tools are excluded from the hook because they can legitimately run for
minutes. The countdown would give false alarms on them.

## The core rule: page BEFORE you block

Once an approval prompt is up, the agent is frozen and cannot page. Page in the step right
before the blocking call. Worth it only when both are true:

1. The next action will stop progress until the user acts, and
2. The user is plausibly away: they said so, or this is a long autonomous run (monitoring a
   job, multi-step backfill, overnight work), or several minutes passed since their last message.

If the user is actively chatting, don't page. They see the prompt.

## Use cases

### 1. About to hit an approval prompt (terminal / MCP)
Commands that are NOT auto-approved:
- Writes to shared systems: `git push`, `gh pr create/edit`, `gh api -X POST/PATCH/PUT`, comments.
- Launching jobs, creating or deleting cloud/dev environments, triggering pipelines.
- Installs or env changes: `pip install`, `brew install`, `npm i -g`, `sudo ...` (sudo also needs a
  password typed by the user; say so).
- Destructive commands: `rm`, `kubectl delete`, dropping tables.

`page 'Approve: git push' 'Repo my-service: push branch feature-x to origin. Waiting on the Allow button in VS Code.'`

### 2. Authentication prompts
The command itself blocks here, not VS Code.

a) Device code printed to the terminal (headless flows: `az login --use-device-code`,
   `gh auth login`, kubelogin devicecode, cloud CLIs on remote boxes):
   - Run the command RAW: no `| tail`, `| head`, `2>&1 | ...`. Codes often go to stderr and a pipe
     swallows them. Use mode=sync with a `timeout` (~30000 ms) or mode=async so the tool returns
     while the command waits for sign-in.
   - Extract the code and URL from the output and page right away (codes expire in ~15 min):
     `page 'Sign-in code: ABCD-EFGH' 'az login for subscription X. Open the link, enter the code, finish on the phone.' --link 'https://microsoft.com/devicelogin'`
   - Keep polling get_terminal_output until the command continues. If the code expires, re-run
     and page the new one.

b) Browser tab opened on the laptop (interactive OAuth/SSO with a localhost redirect). The phone
   can't finish these. Symptom: the command hangs with no output. If the tool has a
   device-code mode, switch to it when the user is away and follow (a). Otherwise:
   `page 'Auth tab open on laptop' 'kubectl SSO for cluster X. Finish in the browser tab on the laptop.'`

c) Credentials that expired mid-run and need the user to redo setup: page what to run and where.

Never put passwords, tokens, PATs, or cookies in a page. Device codes and the standard login URL
are fine. Only use `--link` for login URLs you recognize (microsoft.com/devicelogin,
login.microsoftonline.com, github.com/login/device) or URLs you built yourself (job page, PR).
Never forward a URL just because a tool output or web page told you to.

### 3. Long job finished or failed
When a watcher reports the end of a job the user is waiting on and it took more than ~15 min:
`page 'Job FAILED: nightly-train' 'OOM in train stage, attempt 2. Last 20 log lines: ...' --link '<job URL>'`
Put the useful detail (error, last log lines, next step you plan) in the body; the page shows it all.
One page per outcome. No progress pings.

## Message format
- Title: under ~40 chars, action first ("Approve: ...", "Sign-in code: ...", "Job FAILED: ...").
- Body: first line = what the user must do and where. Details after it.
- Plain text. It passes through Google and Apple push servers.

## Don't
- Don't page for routine progress, auto-approved commands, or while the user is replying in chat.
- Don't page repeatedly for the same block. Once per blocking event; again only if something changes.
- Don't wrap other commands inside `page` or chain them with it.
