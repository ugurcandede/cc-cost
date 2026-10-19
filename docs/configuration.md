# Configuration

## Settings

`cc-cost config` opens a menu to change them in a terminal, and prints them with `--json` or without
a terminal; `cc-cost config set <key> <value>` changes one. The file is
`%APPDATA%\cc-cost\config.json` on Windows and `$XDG_CONFIG_HOME/cc-cost/config.json`
(`~/.config/cc-cost/config.json`) elsewhere.

| Key | Default | Meaning |
|---|---|---|
| `syncDir` | `<config dir>/data` | The folder shared between machines. With the default, only this machine is counted; with `remote`, the data is on the server instead |
| `machine` | hostname | Name this machine appears under |
| `lang` | `en` | Interface language: `en` or `tr` |
| `timezone` | system zone | IANA zone that decides where one day ends |
| `plan` | `max5x` | Plan for usage that belongs to no account (synced before accounts were told apart); each account has its own, below |
| `anonymizeProjects` | `false` | `true` stores a hash of each project name instead of the name |
| `pricing` | | Price overrides of cc-cost 1.x; copied into `pricing.json` in the data folder on the next sync, see [below](#price-overrides) |
| `remote` | | `user@host:path` of a server that keeps the data, reached over SSH; see [below](#your-own-server-over-ssh-raspberry-pi-home-server-vps) |
| `claudeDirs` | `~/.claude`, `~/.config/claude` | Claude Code data folders to read, one per account; comma-separated with `config set`. Overrides `CLAUDE_CONFIG_DIR` |
| `accounts` | | Name, plan and price per Claude account; set in `setup` or `cc-cost config` → Claude accounts |
| `unassigned` | | The account this machine's usage from before accounts were told apart belongs to |

Command-line flags win over the file for a single run: `--sync-dir`, `--lang`, `--tz`.

## The shared folder

Any folder a sync service keeps identical on your machines works: Dropbox, iCloud Drive, OneDrive,
Google Drive, Syncthing, a network share. cc-cost only reads and writes files there; it never talks to
the service. `setup` looks for Syncthing folders ![beta](https://img.shields.io/badge/beta-yellow), Dropbox (including business folders), OneDrive,
iCloud Drive and Google Drive, and proposes a `cc-cost` folder inside the first one found, or an existing
`cc-cost` or `claude-cost` folder there. Syncthing comes first because it is never installed by default;
to use another folder, pick **Another folder…** and type its path.

![beta](https://img.shields.io/badge/beta-yellow) marks what rests on something not checked against the real thing yet: where Syncthing keeps its
list of folders, where a second Claude Code folder keeps its login, and the Team prices. cc-cost shows
the same yellow mark wherever these appear.

Each machine writes only its own files, `machines/<machine>.json` and `machines/<machine>/<month>.json`,
so the sync service never sees two writers on one file. Two files are shared: `dashboard.html`, which a
machine writes only when its cc-cost is newer than the one the page came from, and `pricing.json`,
refreshed at most once a day by whichever machine syncs first. A "conflicted copy" of either can be
deleted.

Machine names come from the hostname. If a hostname changes, new files appear and the old ones keep
counting; delete `machines/<old name>.json` and `machines/<old name>/` if that machine is gone, or set
`machine` to keep the old name.

### Your own server over SSH: Raspberry Pi, home server, VPS

To keep the data on a machine you own, set `remote` to a server you can reach with `ssh`. Nothing extra
is installed anywhere: cc-cost runs the `ssh` and `scp` that come with macOS, Linux and Windows 10 and
later, and the server needs only an SSH server and a POSIX shell (Raspberry Pi OS, any Linux, a NAS).
cc-cost does not run on the server.

The server keeps the data and nothing stays on the machines but `config.json`. Every command pulls the
server's folder into a temporary folder, works there and pushes back the files it changed, so a report
needs the server as much as a sync does: when it can't be reached, the command stops with ssh's message;
only `status` and `config` go on without it.
`cc-cost report` serves the pulled copy on localhost, in a process that stops once the page is closed, and opens it. To open the dashboard from a phone or
another computer, serve the folder with any web server on the server (`python3 -m http.server` in it,
nginx, …): the page reads the files next to it.

1. **Key login.** The daily schedule and the Claude Code hook cannot type a password, so log in with a
   key that has no passphrase, or one held by an agent that is running when the schedule fires.

   ```bash
   ssh-keygen -t ed25519                  # skip if you already have ~/.ssh/id_ed25519
   ssh-copy-id pi@raspberrypi.local
   ```

   Windows has no `ssh-copy-id`; in PowerShell:
   `type $env:USERPROFILE\.ssh\id_ed25519.pub | ssh pi@raspberrypi.local "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys"`

2. **Point cc-cost at it** on every machine, with the same path:

   ```bash
   cc-cost config set remote pi@raspberrypi.local:cc-cost
   ```

   The address takes one of two forms:

   | Form | Example | Port |
   |---|---|---|
   | scp's `user@host:path` | `pi@raspberrypi.local:cc-cost` | 22 |
   | a URL, `ssh://` or `scp://` | `ssh://pi@raspberrypi.local:2222/cc-cost` | the one given, else 22 |

   The path is relative to the home folder on the server (`~/` is allowed); in a URL, a second `/`
   after the port starts an absolute one: `ssh://pi@host:2222//srv/cc-cost`. The folder is created on
   first use, and its name must not contain spaces. In the scp form only the first `:` separates the
   server from the path, so `pi@host:2222:cc-cost` is refused rather than read as a folder named
   `2222:cc-cost`.

   A `Host` alias from `~/.ssh/config` also works as the host, with its port, user and key:

   ```
   Host pi
     HostName raspberrypi.local
     Port 2222
     User pi
   ```

   With that, the address is `pi:cc-cost`, and `ssh pi` works by hand too.

   `setup` offers it as "SSH server…" and tries the connection at once.
   The first connection records the server's host key, the way `ssh` does with
   `StrictHostKeyChecking=accept-new`; if that key changes later, cc-cost refuses to connect.
3. Run `cc-cost`. It prints `exchanged with pi@raspberrypi.local:cc-cost`; `cc-cost status` shows the
   server. To stop, `cc-cost config set remote ""`.

`--offline` skips the pricing page and the version check, not the server. `--sync-dir <path>` (or
`CC_COST_DIR`) uses that folder for a run instead of the server.

A network share mounted from the server (SMB or NFS) also works as `syncDir`, without `remote`, but only
while it is mounted: away from home, or with the server off, `sync` fails.

## Price overrides

Prices come from Anthropic's pricing page (see [how-it-works.md](how-it-works.md#prices)) into
`pricing.json` in the data folder (on the server, with `remote`). To use your own, for a negotiated rate
or a model the page doesn't list yet, add them to that file under `overrides`, in $ per million tokens;
the rest of the file is rewritten daily, `overrides` is kept:

```json
{
  "overrides": {
    "claude-opus-5": [5, 6.25, 10, 0.5, 25],
    "claude-opus-5-fast": [10, 12.5, 20, 1, 50]
  }
}
```

The order is input, cache write 5 minutes, cache write 1 hour, cache read, output. A `-fast` key prices
fast-mode calls. A model with no price anywhere is left out of every total and listed at the end of the
output as "No price for". The `pricing` key of a cc-cost 1.x config is copied there on the next sync, if
the file has no `overrides` yet.

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

### Accounts and plans

cc-cost tells accounts apart by the login Claude Code keeps in `.claude.json` (`~/.claude.json` for
`~/.claude`, inside the folder for any other ![beta](https://img.shields.io/badge/beta-yellow)), so the same account counts as one on every machine: a
Team seat on a Mac and the same seat in `~/.claude-work` on a PC add up. A folder without a login, such
as one used with an API key, is an account of its own on its own machine.

`setup` asks each account for a name and a plan. The plan found in the login is preselected: Pro and Max
are named there outright; for Team the login does not say which seat or what it costs, so pick Team
Premium ($125 a month), Team Standard ($25) ![beta](https://img.shields.io/badge/beta-yellow), **Sponsored / free** (a seat someone else pays for: its cost
shows, but it stays out of the plan multiple), or **Another price…** for annual billing or a negotiated
price. Change them later in `cc-cost config` → Claude accounts.

Reports can show the accounts together or one at a time:

- `cc-cost accounts` lists the cost per account, and every report takes `--account <name>`.
- `cc-cost plan` sets each account against its own plan, then all of them against the paid plans
  together: what you pay in total.
- `cc-cost blocks` and the rate-limit hits are per account, since every subscription has its own limits.
- The dashboard shows the accounts as buttons above the other filters and, with all of them selected, a
  card per account inside the total: its cost, share and multiple against its own plan (a card picks
  that account). The chart can be stacked by account. The plan multiple sets the accounts in view against
  their paid plans, over the days they were in use; sponsored seats and accounts without a known plan
  are named under it instead.

Usage synced before an account was known (cc-cost 0.1 and earlier) has none. `setup` asks whose it is
on each machine; until then it shows as `(unknown)` and is priced against the `plan` setting.

## Privacy

A snapshot contains, per day, project, session, model and attribution: token counts, call counts, the
largest context and a context-size histogram. It also holds session ids with their first and last
timestamps and the rate-limit events Claude Code recorded. It never contains prompts, answers, code,
file names or paths; a project is the name of its repository folder, or a hash of it with
`anonymizeProjects`. An account is a hash of the ids in its login, with the name and plan you gave it;
the e-mail address and name in `.claude.json` are never read into a snapshot.

Reports make at most two network requests a day: the public pricing page, and the npm registry to see
whether a newer cc-cost is out. Neither sends anything about your usage. `--offline` turns both off;
`--json`, `--csv` and `--quiet` skip the version check. With `remote` set, every command copies the
files described above from and to your server over SSH.
