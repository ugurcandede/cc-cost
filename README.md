<div align="center">
  <img src="docs/assets/logo.svg" alt="cc-cost" width="88">
  <h1>cc-cost</h1>
  <p>What your Claude Code usage would cost at API list prices, totalled across all your machines (Windows, Mac, Linux), with an archive that outlives Claude Code's transcript cleanup and a dashboard you open with a double-click.</p>
  <br>
  <a href="https://www.npmjs.com/package/@ugurcandede/cc-cost" target="_blank"><img src="https://img.shields.io/npm/v/@ugurcandede/cc-cost?style=flat-square&label=version" alt="npm version"></a>
  <img src="https://img.shields.io/badge/Node.js-22%2B%20·%20zero%20dependencies-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node.js 22+, zero dependencies">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="License: MIT"></a>
  <br>  
  <img src="https://img.shields.io/badge/Windows-0078D6?style=flat-square&logo=data:image/svg%2Bxml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHBhdGggZmlsbD0id2hpdGUiIGQ9Ik0zIDUuNUwxMCA0LjVWMTEuNUgzVjUuNU0xMSA0LjVMMjEgM1YxMS41SDExVjQuNU0zIDEyLjVIMTBWMTkuNUwzIDE4LjVWMTIuNU0xMSAxMi41SDIxVjIxTDExIDE5LjVWMTIuNVoiLz48L3N2Zz4=" alt="Windows">
  <img src="https://img.shields.io/badge/macOS-000?style=flat-square&logo=apple&logoColor=white" alt="macOS">
  <img src="https://img.shields.io/badge/Linux-FCC624?style=flat-square&logo=linux&logoColor=black" alt="Linux">
</div>

<br>
<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/dashboard-dark.png">
    <img src="docs/assets/dashboard-light.png" alt="The cc-cost dashboard: the last 30 days across two machines and two Claude accounts, daily cost stacked by model" width="800">
  </picture>
  <br>
  <sub>The dashboard, on the demo's sample data. <a href="docs/screenshots.md">A tour of every panel and report</a></sub>
</p>

## Quick start

```bash
npm i -g @ugurcandede/cc-cost          # or, with Yarn 1: yarn global add @ugurcandede/cc-cost

# Pick where the data lives (a folder your machines share, or your own server over SSH),
# name your Claude accounts and their plans; schedule a daily sync and add the Claude Code hook.
cc-cost setup

cc-cost                  # sync this machine, print a summary
cc-cost report           # open the dashboard
```

Run `setup` on every machine and point them at the same folder. Each one adds its numbers; every one
sees the total. No cloud account? Share through a Raspberry Pi or your own server over SSH, with nothing
to install: see [your own server](docs/configuration.md#your-own-server-over-ssh-raspberry-pi-home-server-vps).

Yarn 2 and later have no global installs: install with npm, or try a report once with
`yarn dlx @ugurcandede/cc-cost` (or `npx @ugurcandede/cc-cost`). `setup` needs a permanent install,
since the schedule and hook point at it.

## Prerequisites

- Node.js 22 or newer (no runtime dependencies)
- Claude Code, which keeps its transcripts in `~/.claude/projects`; several accounts in separate folders
  (`CLAUDE_CONFIG_DIR`) are read together and told apart
- For several machines: a folder they all sync. Without one, cc-cost counts this machine only

## Everyday commands

```bash
cc-cost                      # sync, summary, dashboard
cc-cost daily --last 7       # also weekly, monthly; --breakdown adds per-model rows
cc-cost projects             # also models, machines, accounts, sessions
cc-cost agents               # main thread vs subagents; also skills, mcp
cc-cost insights             # context size, cache efficiency, what drives the cost
cc-cost plan                 # API equivalent vs your plans (Pro, Max, Team), per account and together
cc-cost blocks               # usage in Claude's 5-hour windows
cc-cost status               # settings, machines, schedule, hook
cc-cost update               # update to the latest version
```

```
$ cc-cost projects --last 30
Project        Calls  Avg context  Cache read  Output     Cost   Share
─────────────  ─────  ───────────  ──────────  ──────  ───────  ──────
api-server       607        95.7K       57.3M  806.8K   $47.15   38.9%
web-app          307       114.8K       34.9M  426.5K   $26.99   22.3%
mobile-app       594        90.0K       52.7M  777.4K   $24.97   20.6%
infra            169        95.0K       15.8M  217.3K   $10.87    9.0%
data-pipeline     90       132.1K       11.8M  118.6K    $6.23    5.1%
docs-site        199        64.2K       12.5M  272.6K    $4.85    4.0%
─────────────  ─────  ───────────  ──────────  ──────  ───────  ──────
Total          1,966        95.4K      185.1M    2.6M  $121.07  100.0%
```

Every report takes the same filters and output options:

```bash
cc-cost daily --since 2026-09-01 --machine macbook --model opus
cc-cost models --account work     # one Claude account; also --project, --session, --agent
cc-cost sessions --project api --limit 10
cc-cost monthly --json            # or --csv
cc-cost insights --lang tr        # interface language: en (default) or tr
```

## How it differs from other tools

- **Several machines, one total**: through a folder you already sync, or your own server over SSH; no
  service in between.
- **Several Claude accounts**: a Max account and a Team seat, each against its own plan, together or apart.
- **History that stays**: numbers are kept after Claude Code deletes old transcripts.
- **A dashboard in one file**: date, machine, project and model filters, works offline.
- **Insights, not just totals**: context size per call, cache hit ratio, subagents, skills, MCP servers,
  the costliest sessions.
- **Current prices**: read from Anthropic's pricing page daily, with a bundled fallback.

## Screenshots

<table>
  <tr>
    <td><img src="docs/assets/accounts.png" alt="Two Claude accounts: buttons to pick one, and a card per account with its cost, share and plan multiple"></td>
    <td><img src="docs/assets/chart-by-account.png" alt="Daily cost stacked by account"></td>
  </tr>
  <tr>
    <td><sub>Accounts: each against its own plan, together or apart</sub></td>
    <td><sub>Daily cost, stacked by account, project, machine or model</sub></td>
  </tr>
  <tr>
    <td><img src="docs/assets/cost-and-context.png" alt="Cost by token type and calls by context size"></td>
    <td><img src="docs/assets/terminal-plan.png" alt="cc-cost plan in the terminal: API equivalent against every plan, then per account"></td>
  </tr>
  <tr>
    <td><sub>Where the cost goes and how big the contexts are</sub></td>
    <td><sub><code>cc-cost plan</code>: what the same usage would cost at API prices, per plan and per account</sub></td>
  </tr>
</table>

[docs/screenshots.md](docs/screenshots.md) walks through every panel and terminal report. The images
come from the demo's sample data (`scripts/demo`), not from a real account.

## Layout

What cc-cost keeps in the shared folder:

```
<shared folder>/
├── machines/
│   ├── work-pc.json        # one per machine, written only by that machine
│   └── macbook.json
└── dashboard.html          # rewritten on every sync
```

and on each machine:

```
~/.config/cc-cost/          # %APPDATA%\cc-cost on Windows
├── config.json             # cc-cost config
├── pricing-cache.json      # last prices read from the pricing page
└── update-check.json       # when the npm registry was last asked for a newer version
```

## Safety

- **No conversation content leaves your machine.** Snapshots hold token and call counts per day, project,
  session and model, plus rate-limit events. Project names can be hashed (`anonymizeProjects`).
- **The archive only grows.** A day older than Claude Code's cleanup window is never overwritten by a
  scan that may see only part of it.
- **No sync conflicts.** Each machine writes only its own file, through write-then-rename.
- **Your Claude Code settings are backed up** to `settings.json.cc-cost.bak` before the hook is added;
  other hooks are left alone. `cc-cost setup --remove` takes the schedule and the hook away.
- Read-only toward transcripts: cc-cost never modifies `~/.claude/projects`.

## Further reading

- [docs/screenshots.md](docs/screenshots.md): a tour of the dashboard and the terminal reports
- [docs/cli.md](docs/cli.md): every command, filter and option
- [docs/configuration.md](docs/configuration.md): settings, the shared folder, price overrides, privacy
- [docs/how-it-works.md](docs/how-it-works.md): how costs are calculated, deduplication, the archive,
  and what cc-cost can't see
- [docs/maintenance.md](docs/maintenance.md): automatic runs, status, moving from the original script

---
<p align="center">
  Built with ❤️ for the Claude Community
</p>

<p align="center">
  <a href="https://github.com/ugurcandede">
    <img src="https://img.shields.io/badge/@ugurcandede-181717?logo=github&logoColor=white" alt="GitHub · @ugurcandede">
  </a>
  <a href="https://claude.com/claude-code">
    <img src="https://img.shields.io/badge/developed%20with-Claude%20Code-D97757?logo=claude&logoColor=white" alt="Developed with Claude Code">
  </a>
</p>

<p align="center">
  <sub>Not affiliated with or endorsed by Anthropic. "Claude" is a trademark of Anthropic, PBC.</sub>
</p>
