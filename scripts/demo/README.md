# Demo: several Claude accounts and an SSH server

For developers. `demo.sh` runs the cc-cost sources from this repo against two pretend machines and a
throwaway SSH server in Docker, so you can try reading several Claude accounts and sharing through your
own server without touching your real config, Claude folders, `~/.ssh` or schedule.

- **demo-pc** has two Claude accounts: `~/.claude` logged in to a Max 5x account, with Opus transcripts,
  and `~/.claude-work` logged in to a Team seat, with Sonnet.
- **demo-mac** has one: `~/.claude` logged in to the same Team seat, with Haiku transcripts. So the Team
  account spans both machines.
- **demo-pi** is the SSH server in Docker, standing in for `pi@raspberrypi.local`. Both demo machines can
  log in to it with a key, without a password.

Everything lives in `$TMPDIR/cc-cost-demo` (`/tmp/cc-cost-demo`) and the `cc-cost-demo-sshd` container.
`demo-pc` and `demo-mac` both run on this computer; the names only tell the two pretend machines apart.

## Needs

- Docker, running
- bash: Git Bash on Windows (run the commands there, not in PowerShell, which opens `.sh` files in a
  separate window)
- Node 22.18 or newer (the sources run through type stripping)
- `ssh`, `scp`, `ssh-keygen`, `ssh-keyscan`: built into macOS, Linux and Git for Windows

## Commands

```bash
scripts/demo/demo.sh up                  # demo machines, sample transcripts, SSH server; starts over if run again
scripts/demo/demo.sh demo-pc <command>   # any cc-cost command and flags, run as demo-pc
scripts/demo/demo.sh demo-mac <command>  # the same, as demo-mac
scripts/demo/demo.sh server              # the files on the SSH server
scripts/demo/demo.sh server-stop         # stop the SSH server, to test without it
scripts/demo/demo.sh server-start        # start it again, with its files and host key
scripts/demo/demo.sh down                # remove the container and the demo folder
```

The SSH server is a container that Docker starts by itself whenever Docker runs: after `up`, after Docker
Desktop starts, after a reboot. There is no command to run for it; `server-stop` and `server-start` are
only for testing. A server stopped with `server-stop` stays down, Docker restarts included, until
`server-start`.

`setup` in the demo never installs the daily schedule: Windows Task Scheduler, launchd and systemd would
run it outside the demo, on your real config and transcripts.

## 1. Two accounts and an SSH server

```bash
scripts/demo/demo.sh up
scripts/demo/demo.sh demo-pc setup
```

Setup asks one question per step. ↑↓ and Enter pick an option, a number picks it directly, Space ticks a
box, q or Esc cancels without saving anything.

| Step | Answer |
|---|---|
| Language | English or Türkçe |
| Where to keep the data | **SSH server…**, then type `demo-pi:cc-cost` |
| Claude Code folders to read | both are ticked: Enter |
| Claude account in ~/.claude | a name, like `Personal`; then its plan: Max 5x is preselected, found in the login |
| Claude account in ~/.claude-work | a name, like `Work`; then its plan: Team Premium is preselected, or pick Sponsored / free |
| Sync when a Claude Code session ends | Yes (the hook goes into the demo Claude folders) |
| Open the dashboard? | No (see [the browser on Windows](#the-browser-on-windows)) |

The server listens on port 2222, so the address needs that port. Two ways work:

- `demo-pi:cc-cost`: the alias `demo-pi` in each demo machine's `~/.ssh/config` carries the port;
- `ssh://pi@127.0.0.1:2222/cc-cost`: the port written in a URL, the way you would for a real server on
  another port than 22.

`pi@127.0.0.1:cc-cost` goes to port 22, where nothing answers, and `demo-pi:127.0.0.1:2222:cc-cost` is
refused: in that form only the first `:` separates the server from the folder. See
[configuration.md](../../docs/configuration.md#your-own-server-over-ssh-raspberry-pi-home-server-vps).

After the address, setup connects at once and shows `✓ Connected to demo-pi:cc-cost`. On this first
connection ssh records the server's host key in demo-pc's `known_hosts` by itself; nothing to confirm.
The first sync then prints `exchanged with demo-pi:cc-cost` and a summary with demo-pc's 42 calls, both
accounts together.

## 2. A second machine

```bash
scripts/demo/demo.sh demo-mac config set remote demo-pi:cc-cost
scripts/demo/demo.sh demo-mac            # uploads demo-mac's file, downloads demo-pc's
scripts/demo/demo.sh demo-pc             # downloads demo-mac's file

scripts/demo/demo.sh demo-pc machines    # demo-pc 42 calls, demo-mac 40
scripts/demo/demo.sh demo-pc models      # Opus, Sonnet and Haiku together
scripts/demo/demo.sh server              # demo-pc.json and demo-mac.json on the server
```

## 3. Accounts and plans

The logins are fake but shaped like Claude Code's own `.claude.json` (ids and plan, no e-mail). Name the
Team seat on demo-mac too, with the same name; until then each machine shows the folder's name for it.

```bash
scripts/demo/demo.sh demo-mac setup             # SSH server demo-pi:cc-cost, then name the Team account
scripts/demo/demo.sh demo-pc                    # picks up demo-mac's file

scripts/demo/demo.sh demo-pc accounts           # Personal (Opus), Work (Sonnet on demo-pc + Haiku on demo-mac)
scripts/demo/demo.sh demo-pc plan               # each account against its own plan, then the paid ones together
scripts/demo/demo.sh demo-pc blocks --last 1    # 5-hour windows, one timeline per account
scripts/demo/demo.sh demo-pc models --account work
scripts/demo/demo.sh demo-pc config             # Claude accounts: rename, change a plan, a sponsored seat
```

Usage from before accounts were told apart has no account. To see the question setup asks about it, give
demo-pc a day like that and run `config` → Claude accounts → Usage from before accounts:

```bash
node -e "const f=process.argv[1],fs=require('fs'),s=JSON.parse(fs.readFileSync(f));s.rows.push({d:'2026-07-01',p:'old',s:'old',m:'claude-opus-5',t:[1e6,0,0,0,0,3,0,0,0,0,0,0,0,0]});fs.writeFileSync(f,JSON.stringify(s))" "$(d="${TMPDIR:-/tmp}/cc-cost-demo/demo-pc"; cygpath -w "$d/AppData/Roaming/cc-cost/data/machines/demo-pc.json" 2>/dev/null || echo "$d/.config/cc-cost/data/machines/demo-pc.json")"
scripts/demo/demo.sh demo-pc accounts --no-sync # $5 under (unknown)
scripts/demo/demo.sh demo-pc config             # give it to an account
```

## 4. Testing SSH

**The server is down.** cc-cost warns once and reports from the copies it already has:

```bash
scripts/demo/demo.sh server-stop
scripts/demo/demo.sh demo-pc
# could not reach demo-pi:cc-cost, using the local copies: ssh: connect to host 127.0.0.1 port 2222: Connection refused
```

**It comes back.** The same container starts again, with its files and host key:

```bash
scripts/demo/demo.sh server-start
scripts/demo/demo.sh demo-pc             # exchanged with demo-pi:cc-cost
```

**A new server.** Remove the container and start a new one: it is empty and has a new host key. Each
machine uploads its file on its next run, and the first connection records the new key, since `server-start`
clears the old one from the demo machines:

```bash
docker rm -f cc-cost-demo-sshd
scripts/demo/demo.sh server-start
scripts/demo/demo.sh demo-pc
scripts/demo/demo.sh demo-mac
scripts/demo/demo.sh server              # both files are back
```

A real server whose host key changed is refused instead, with ssh's "REMOTE HOST IDENTIFICATION HAS
CHANGED" warning; that is the point of recording the key.

**Setup cannot connect.** With the server stopped, choose **SSH server…** in setup (or in
`scripts/demo/demo.sh demo-pc config`, under "Where the data is kept") and type `demo-pi:cc-cost`. Setup
shows ssh's error and offers **Try again**, **Save it anyway** and **Back**. Start the server in another
terminal with `scripts/demo/demo.sh server-start` and pick Try again.

**A wrong address.** Type `demo-pi` without `:folder`: setup says it is not `user@host:folder` and asks
again. Type `nobody@demo-pi:cc-cost`: the server refuses the login and setup shows ssh's error.

**Status.** `scripts/demo/demo.sh demo-pc status` shows the server, the Claude folders and the hook.

## Settings menu

`scripts/demo/demo.sh demo-pc config` opens the settings menu: pick a setting, answer its question, and
it is saved at once. `config --json` prints the settings instead.

## The browser on Windows

Opening the dashboard from the demo starts the browser with the demo machine's AppData, so it creates a
fresh browser profile in the demo folder. Answer No to "Open the dashboard?" and open the printed
`dashboard.html` yourself.

## Port

The server listens on 127.0.0.1:2222; set `CC_COST_DEMO_PORT` if that port is taken, then run `up` again.
