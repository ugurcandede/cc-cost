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
| `claudeDirs` | `~/.claude`, `~/.config/claude` | Claude Code data folders to read, one per account; comma-separated with `config set`. Overrides `CLAUDE_CONFIG_DIR` |

Command-line flags win over the file for a single run: `--sync-dir`, `--lang`, `--tz`.

## The shared folder

Any folder a sync service keeps identical on your machines works: Dropbox, iCloud Drive, OneDrive,
Google Drive, Syncthing, a network share. cc-cost only reads and writes files there; it never talks to
the service. `setup` looks for Syncthing folders, Dropbox (including business folders), OneDrive, iCloud
Drive and Google Drive, and proposes a `cc-cost` folder inside the first one found, or an existing
`cc-cost` or `claude-cost` folder there. Syncthing comes first because it is never installed by default;
to use another folder, answer `n` and type its path.

Each machine writes only `machines/<machine>.json`, so the sync service never sees two writers on one
file. `dashboard.html` is the exception: every machine rewrites it. If two do so at the same moment your
sync service may keep a "conflicted copy"; delete it.

Machine names come from the hostname. If a hostname changes, a new file appears and the old one keeps
counting; delete the old file if that machine is gone, or set `machine` to keep the old name.

### Your own server: Raspberry Pi, home server, VPS

To keep the data on a machine you own instead of a cloud service, sync the folder with
[Syncthing](https://syncthing.net). It copies folders directly between your devices, encrypted, with no
account. cc-cost does not run on the server; the server only holds a copy of the folder and is always on,
so your machines exchange their files through it even when they are never online at the same time.

1. **Server.** Install Syncthing (`sudo apt install syncthing` on Raspberry Pi OS and Debian) and run it
   as a service of your user: `systemctl --user enable --now syncthing` and
   `sudo loginctl enable-linger $USER`, so it keeps running after you log out. Its web interface listens
   on `127.0.0.1:8384`; from another machine reach it through `ssh -L 8384:127.0.0.1:8384 pi@<server>`.
2. **Each machine.** Install Syncthing from [syncthing.net/downloads](https://syncthing.net/downloads/),
   add the server as a remote device on both sides using the device IDs (Actions > Show ID), and share
   one folder, for example `~/Sync`, between the server and every machine. Let it finish its first sync.
3. **cc-cost.** Run `cc-cost setup` on each machine. It finds the Syncthing folder and proposes
   `~/Sync/cc-cost`; otherwise set it yourself with `cc-cost config set syncDir ~/Sync/cc-cost`.
4. **Ignore list.** On every device, the server included, add an `.stignore` file in the root of the
   shared folder with these two lines, so the per-machine dashboard and half-written snapshots never
   travel. Syncthing does not sync `.stignore` itself, so each device needs its own:

   ```
   dashboard.html
   *.tmp
   ```

   Each machine rewrites its own `dashboard.html` on every sync, so nothing is lost; without this rule,
   two machines writing it close together leave `dashboard.sync-conflict-*.html` copies.

For a server you don't fully trust, such as a rented VPS, Syncthing's untrusted devices (still marked
beta) keep only encrypted data on it: set an encryption password when sharing the folder with that
device.

Syncthing runs whenever your machines are on, while cc-cost runs once a day and when a Claude Code
session ends. A machine that was offline sends its file when it reconnects; a report may lag by that
much.

A network share from the server (SMB or NFS) also works as `syncDir`, but only while it is mounted:
away from home, or with the server off, `sync` fails. Syncthing keeps a local copy and catches up later.

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
| `CLAUDE_CONFIG_DIR` | Where Claude Code keeps its data; a comma-separated list is read in full. Ignored when `claudeDirs` is set |
| `CC_COST_DIR` | Shared folder for this run, like `--sync-dir` |
| `NO_COLOR` | No colors |
| `XDG_CONFIG_HOME` | Base of the config folder outside Windows |

Without `claudeDirs` or `CLAUDE_CONFIG_DIR`, cc-cost reads `~/.claude` and `~/.config/claude`.

### Several Claude accounts

Each account keeps its own folder (for example `CLAUDE_CONFIG_DIR=~/.claude-work claude`). `setup`
finds the `~/.claude*` folders and offers to read them all, and adds the SessionEnd hook to each one's
`settings.json`. Or set them yourself: `cc-cost config set claudeDirs "~/.claude,~/.claude-work"`, then
run `setup` again for the hooks. The list wins over `CLAUDE_CONFIG_DIR` on purpose: a hook started from
one account's session inherits that account's variable and would otherwise sync only that account.

## Privacy

A snapshot contains, per day, project, session, model and attribution: token counts, call counts, the
largest context and a context-size histogram. It also holds session ids with their first and last
timestamps and the rate-limit events Claude Code recorded. It never contains prompts, answers, code,
file names or paths; a project is the name of its repository folder, or a hash of it with
`anonymizeProjects`.

Reports make at most two network requests a day: the public pricing page, and the npm registry to see
whether a newer cc-cost is out. Neither sends anything about your usage. `--offline` turns both off;
`--json`, `--csv` and `--quiet` skip the version check.
