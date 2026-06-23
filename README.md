# pi-cmux-sidebar

Pi extension — live status panel in a cmux right-side split.

Shows TODOs, subagent status, LSP, MCP, and tool activity in a compact 30-column panel.

## Install

```bash
pi install git:github.com/fliu56/pi-cmux-sidebar
```

Or from npm (when published):

```bash
pi install npm:@fliu56/pi-cmux-sidebar
```

Reload pi after install:

```
/reload
```

## What it does

When pi starts inside a cmux workspace, the extension:

1. Creates a right-side split (30 chars wide)
2. Runs a lightweight TUI that shows:
   - ⚡ Agent status (running / waiting / tool / error)
   - 📝 TODOs (managed via `status_todo` tool)
   - 🤖 Subagent activity
   - 🔴/🟢 LSP & MCP status
   - 🛠️ Tool call count
3. Auto-installs the TUI script to `~/.cmuxterm/pi-status-tui.js`

## Tools

### `status_todo`

Manage TODOs from the agent session:

```
status_todo action=add text="fix the auth bug"
status_todo action=list
status_todo action=toggle id=abc123
status_todo action=remove id=abc123
```

### `status_query`

Get the current status JSON.

## Requirements

- Pi running inside cmux (checks `CMUX_WORKSPACE_ID`)
- No beta features or Dock needed — uses `cmux new-split` directly

## Files

| File | Location | Purpose |
|------|----------|---------|
| `extensions/index.ts` | Extension source | Main extension: sidebar creation + event listeners |
| `pi-status-tui.js` | `~/.cmuxterm/` | TUI script (auto-installed) |
| `pi-status.json` | `~/.cmuxterm/` | Status data (auto-created) |

## License

MIT
