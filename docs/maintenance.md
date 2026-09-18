# Maintenance

## Automatic runs

`cc-cost setup` offers two ways to keep the numbers current. Both run `cc-cost sync --quiet`, and a sync
that runs twice changes nothing, so having both is fine.

**Daily schedule, 10:23 local time**

| OS | Mechanism | Where |
|---|---|---|
| Windows | Task Scheduler task `cc-cost`, through a hidden PowerShell so no window flashes | `taskschd.msc` |
| macOS | launchd agent `com.cc-cost.sync` | `~/Library/LaunchAgents/com.cc-cost.sync.plist` |
| Linux | systemd user timer | `~/.config/systemd/user/cc-cost.timer` |

A run missed while the machine was off happens at the next start on Windows (`StartWhenAvailable`) and
Linux (`Persistent=true`). launchd catches up after sleep but not after a shutdown.

**SessionEnd hook**

Added to `~/.claude/settings.json`, so each Claude Code session is synced when it ends. The hook runs
synchronously with a 60-second timeout; a sync takes about a second. Other hooks in the file are kept,
and the file is copied once to `settings.json.cc-cost.bak` before the first change. If cc-cost moves,
running `setup` again updates the hook instead of adding a second one.

**Removing them**

```bash
cc-cost setup --remove
```

removes the schedule and the hook, and nothing else.

**Install globally first.** The schedule and the hook store the absolute paths of Node and of cc-cost.
Under `npx` those point into a cache that gets cleaned, so `setup` refuses to install them there. With a
Node version manager (nvm, fnm, volta), run `setup` again after switching versions.

## Checking on it

```bash
cc-cost status
```

```
config file       ~/.config/cc-cost/config.json
shared folder     ~/Dropbox/cc-cost
this machine      work-pc
machines          work-pc: updated 9/18/2026, 10:23:04 AM · days with data: 42
                  macbook: updated 9/17/2026, 6:12:55 PM · days with data: 30
transcripts kept  30 days (cleanupPeriodDays)
daily schedule    installed
SessionEnd hook   installed
prices            https://platform.claude.com/docs/en/about-claude/pricing.md, 2026-09-18
```

A machine whose last update is older than its cleanup period may already have lost days that were never
synced.

## New models

A model the pricing page lists is priced the day after it appears (sooner with `cc-cost pricing
--refresh`). Until then it is left out of the totals and named in "No price for" at the end of the
output; add it under `pricing` in the config to count it right away. Chart colors are fixed per model in
`src/dashboard.ts` (`ORDER`); a new model gets the eighth color until it is added there, at the end of
the list so existing colors don't shift.

## Moving from the original cc-cost.mjs

cc-cost began as a single script that wrote `<machine>.json` files into a Dropbox folder.

1. Install cc-cost and run `setup`; it proposes the existing `claude-cost` folder when it finds one.
2. The old files are read as they are. Their days show the project and session as `(unknown)`, since
   the old format didn't record them; days still on disk are rescanned in full.
3. On Windows, `setup` replaces the old `cc-cost` scheduled task. On macOS, unload the old agent if you
   installed one: `launchctl bootout gui/$(id -u)/com.cc-cost`.
4. Once every machine runs the new version, the old `<machine>.json` and `report.html` files in the folder
   can be deleted; the new ones live in `machines/` and `dashboard.html`.

## Development

```bash
yarn install
yarn dev daily        # runs src/cli.ts directly; Node strips the types
yarn test
yarn typecheck
yarn build            # compiles to dist/ for npm
```

The snapshot format (`src/types.ts`) outlives the transcripts it was built from: add fields at the end,
never change the meaning of an existing one.
