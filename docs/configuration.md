# Configuration

## Settings

`cc-cost config` prints them; `cc-cost config set <key> <value>` changes one. The file is
`%APPDATA%\cc-cost\config.json` on Windows and `$XDG_CONFIG_HOME/cc-cost/config.json`
(`~/.config/cc-cost/config.json`) elsewhere.

| Key | Default | Meaning |
|---|---|---|
| `syncDir` | `<config dir>/data` | The folder shared between machines. With the default, only this machine is counted |
| `machine` | hostname | Name this machine appears under |
| `lang` | `en` | Interface language: `en` or `tr` |
| `timezone` | system zone | IANA zone that decides where one day ends |
| `plan` | `max5x` | `pro`, `max5x` or `max20x`; the dashboard's plan multiple and `plan` use it |
| `anonymizeProjects` | `false` | `true` stores a hash of each project name instead of the name |
| `pricing` | | Price overrides, below. Edit the file for this one |

Command-line flags win over the file for a single run: `--sync-dir`, `--lang`, `--tz`.

## The shared folder

Any folder a sync service keeps identical on your machines works: Dropbox, iCloud Drive, OneDrive,
Google Drive, Syncthing, a network share. `setup` looks for Dropbox (including business folders),
OneDrive, iCloud Drive and Google Drive and proposes a `cc-cost` folder inside the first one found, or an
existing `cc-cost` or `claude-cost` folder there.

Each machine writes only `machines/<machine>.json`, so the sync service never sees two writers on one
file. `dashboard.html` is the exception: every machine rewrites it. If two do so at the same moment your
sync service may keep a "conflicted copy"; delete it.

Machine names come from the hostname. If a hostname changes, a new file appears and the old one keeps
counting; delete the old file if that machine is gone, or set `machine` to keep the old name.

## Price overrides

Prices come from Anthropic's pricing page (see [how-it-works.md](how-it-works.md#prices)). To use your
own, for a negotiated rate or a model the page doesn't list yet, add them in $ per million tokens:

```json
{
  "pricing": {
    "claude-opus-5": [5, 6.25, 10, 0.5, 25],
    "claude-opus-5-fast": [10, 12.5, 20, 1, 50]
  }
}
```

The order is input, cache write 5 minutes, cache write 1 hour, cache read, output. A `-fast` key prices
fast-mode calls. A model with no price anywhere is left out of every total and listed at the end of the
output as "No price for".

## Environment

| Variable | Effect |
|---|---|
| `CLAUDE_CONFIG_DIR` | Where Claude Code keeps its data; a comma-separated list is read in full |
| `CC_COST_DIR` | Shared folder for this run, like `--sync-dir` |
| `NO_COLOR` | No colors |
| `XDG_CONFIG_HOME` | Base of the config folder outside Windows |

Without `CLAUDE_CONFIG_DIR`, cc-cost reads `~/.claude` and `~/.config/claude`.

## Privacy

A snapshot contains, per day, project, session, model and attribution: token counts, call counts, the
largest context and a context-size histogram. It also holds session ids with their first and last
timestamps and the rate-limit events Claude Code recorded. It never contains prompts, answers, code,
file names or paths; a project is the name of its repository folder, or a hash of it with
`anonymizeProjects`.

Reports make at most two network requests a day: the public pricing page, and the npm registry to see
whether a newer cc-cost is out. Neither sends anything about your usage. `--offline` turns both off;
`--json`, `--csv` and `--quiet` skip the version check.
