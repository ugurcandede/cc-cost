# CLI reference

## Commands

```bash
cc-cost                          # sync this machine, print a summary, update the dashboard
cc-cost sync                     # sync and update the dashboard, print nothing else

cc-cost daily                    # cost per day
cc-cost weekly                   # cost per week, weeks start on Monday
cc-cost monthly                  # cost per month
cc-cost daily --breakdown        # per-model rows under each period

cc-cost models                   # cost per model; fast mode shows as <model>-fast
cc-cost machines                 # cost per machine
cc-cost projects                 # cost per git repository
cc-cost sessions                 # most expensive sessions (20 by default)
cc-cost agents                   # main thread vs each subagent type
cc-cost skills                   # calls Claude Code attributes to a skill
cc-cost mcp                      # calls Claude Code attributes to an MCP server

cc-cost insights                 # overview, cache, context size, attribution, models, busiest times, limits
cc-cost plan                     # per month: API equivalent, per-30-day rate, × Pro / Max 5x / Max 20x, limit hits
cc-cost blocks                   # 5-hour windows, the active one with time left

cc-cost report                   # write the dashboard and open it in the browser
cc-cost report --location        # write it and print its path, without opening it
cc-cost pricing                  # prices in use and their source
cc-cost pricing --refresh        # fetch the pricing page now

cc-cost setup                    # interactive first-time setup
cc-cost setup --yes              # accept the defaults (Dropbox or similar folder if found)
cc-cost setup --sync-dir <path>  # skip the folder question
cc-cost setup --no-schedule      # don't schedule the daily run
cc-cost setup --no-hook          # don't add the SessionEnd hook
cc-cost setup --remove           # remove the schedule and the hook

cc-cost status                   # settings, machines and their last update, schedule, hook, prices
cc-cost config                   # current settings
cc-cost config set <key> <value> # change one; see configuration.md
```

Unknown commands exit 1 with a `--help` hint.

## Filters

Every report accepts them; each takes a comma-separated list or can be repeated.

| Flag | Keeps |
|---|---|
| `--since <YYYY-MM-DD>` | Days from this date |
| `--until <YYYY-MM-DD>` | Days up to this date, inclusive |
| `--last <n>` | The last n calendar days, today included |
| `--machine <name>` | Machines whose name contains it |
| `--project <name>` | Projects whose name contains it |
| `--model <name>` | Models whose id contains it: `opus`, `fable-5-1`, `fast` |
| `--session <id>` | Sessions whose id starts with it |
| `--agent <name>` | `main`, or a subagent type such as `Explore` |
| `--skill <name>` | Calls attributed to these skills |
| `--mcp <name>` | Calls attributed to these MCP servers |

`blocks` works on hourly data, which has no project, session or attribution; those filters are ignored
there with a note on stderr.

## Output

| Flag | Effect |
|---|---|
| `--json` | JSON on every command |
| `--csv` | CSV for table commands (periods, dimensions, `plan`, `blocks`); raw numbers, no totals row |
| `--limit <n>` | Rows in `sessions`, `projects`, `blocks` (default 20) and any other dimension |
| `--lang <en\|tr>` | Language of the terminal output and the dashboard |
| `--tz <zone>` | IANA time zone for day boundaries, e.g. `Europe/Istanbul` |
| `--no-color` | Plain text; also off when output isn't a terminal or `NO_COLOR` is set |
| `--no-sync` | Report from the stored snapshots without scanning transcripts |
| `--offline` | Don't fetch prices; use the cached or bundled table |
| `--quiet` | Print nothing on success; for schedulers and hooks |
| `--sync-dir <path>` | Shared folder for this run |
| `-h`, `--help` / `-v`, `--version` | |

## Examples

```bash
cc-cost daily --last 14 --breakdown
cc-cost projects --machine macbook --since 2026-09-01
cc-cost sessions --project api --limit 5 --json
cc-cost monthly --csv > usage.csv
cc-cost insights --model fable
cc-cost blocks --last 2
```
