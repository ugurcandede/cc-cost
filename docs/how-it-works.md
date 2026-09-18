# How it works

## Per run

1. Finds every `*.jsonl` transcript under `~/.claude/projects` (or `CLAUDE_CONFIG_DIR`), subagent
   transcripts included.
2. Reads the assistant messages that carry a `usage` block, and the rate-limit events. Message content
   is never parsed beyond that.
3. Removes duplicates (below) and sums the tokens per day, project, session, model and attribution.
4. Merges the result into this machine's snapshot in the shared folder (see [the archive](#the-archive)).
5. Reads every machine's snapshot, prices it, prints the report and rewrites `dashboard.html`.

## Costs

Each token type has its own rate. For Claude Opus 5:

| Tokens | $ / million | |
|---|---|---|
| Uncached input | 5 | |
| Cache write, 5 minutes | 6.25 | 1.25 × input |
| Cache write, 1 hour | 10 | 2 × input; Claude Code writes this tier |
| Cache read | 0.50 | 0.1 × input (0.025 × on Claude Fable 5.1) |
| Output | 25 | |

On top of tokens, web searches cost $10 per 1,000. Fast-mode calls (`usage.speed == "fast"`) use the
fast rates, with the cache multipliers applied to them, and appear as `<model>-fast`.

Claude 4.6 and later models bill a 1M-token context at the standard rate, so there is no long-context
surcharge to apply.

The result is what the same tokens would cost on the API at list price. It is not a bill: a subscription
isn't charged per token.

### Prices

Prices are read from `https://platform.claude.com/docs/en/about-claude/pricing.md`, the official page in
Markdown, at most once every 24 hours, and cached in the config folder. The model table and the
fast-mode table are parsed; a page that yields fewer than five models is treated as unrecognized rather
than half-used. If the page can't be fetched or parsed, the last cached copy is used, then the table
shipped with the package, and the output says which.

Models retired from the page keep the prices shipped with the package, so old usage stays priced.
Today's prices apply to all history.

## Duplicates

The same API call can appear several times:

- **Resume and compaction** copy earlier messages into a new transcript file.
- **Streaming** writes one line per content block of a message, and `output_tokens` keeps growing until
  the last one.

cc-cost identifies a call by its message id and request id and keeps the copy with the most output
tokens. Without this, totals come out about twice as high; keeping the first copy instead of the most
complete one undercounts output by around 6%.

## Days, projects, attribution

- A day ends at local midnight in the configured time zone.
- A project is the git repository the session's working directory belongs to. Sessions often `cd` into
  subfolders; they still count for the repository. A worktree counts for its main repository. A folder
  that has been deleted resolves through its nearest remaining parent; without a repository, the folder
  name is used.
- Subagent calls are grouped by subagent type (`Explore`, `general-purpose`, …); everything else is
  `main`. Skill and MCP attribution come from the fields Claude Code writes on each call.

## The archive

Claude Code deletes transcripts after `cleanupPeriodDays` (30 by default; cc-cost reads the setting).
cc-cost's snapshots keep the numbers after that, so history grows past the cleanup window.

A new scan replaces a stored day only when that day is inside the cleanup window, where all of its
transcripts must still exist. An older day may be only partly on disk: its short sessions deleted, a
long session reaching into it still there. Such a day only fills a gap; it never overwrites the stored
one. Days no longer on disk are kept as they are.

The condition is running cc-cost on each machine at least once per cleanup period; the daily schedule
does.

## What it can't see

- **Cloud sessions.** Claude Code on the web runs in Anthropic's environment and doesn't write
  transcripts to your machine. A session teleported to your terminal is counted from then on.
- **Background calls.** Calls Claude Code makes by itself, such as titles and summaries (usually Haiku),
  aren't in the transcripts. In testing they came to a few cents a month.
- **US-only inference** (`inference_geo: "us"`, 1.1 ×): Claude Code transcripts record the field as
  `not_available`.
- **Plan limits.** Anthropic doesn't publish them in tokens, so no tool can say which plan would have
  been enough. The rate-limit hits in your transcripts are the direct signal, and `plan` shows them;
  retries within one limit period count once.
- **Repricing on another model** (`insights`, "the same tokens on …") uses the same token counts. Models
  with a different tokenizer would count the same text differently, so treat it as a rough comparison.

## Accuracy

Every rule on this page (deduplication, cache tiers, fast mode, web searches, day boundaries, the
archive merge) has a test in `test/`. Claude Code's own per-session `cost-state` records come out lower;
they appear to cover only the current process, which starts over when a session is resumed.
