# A tour of cc-cost

## One file, every machine

`cc-cost report` opens `dashboard.html`: a single file in the shared folder, no server, nothing to
install on the machine that opens it. The last 30 days across both machines and both accounts, with the
daily cost stacked by model.

![The dashboard: filters, the total with a card per account, and the daily cost chart](assets/dashboard-dark.png)

Three rows of filters narrow everything on the page: the account, then the scope (machine) and the
breakdown (project, model), then the period. The chart stacks by model, project, machine or account.

## Several Claude accounts, each against its own plan

A Max account and a Team seat on one machine, or the same seat on two machines: cc-cost tells them apart
by the login in each Claude Code folder. With all accounts selected, a card per account shows its cost,
its share of the total and its multiple against its own plan; a card, or a button above, narrows the
page to that account. The plan multiple in the row below sets the accounts in view against what their
plans cost together. A sponsored seat shows its cost but stays out of the multiple.

![Account buttons above the filters, and a card per account inside the total](assets/accounts.png)

Stacked by account, the daily chart shows which account the spending comes from.

![Daily cost stacked by account](assets/chart-by-account.png)

## Where the money goes

Cache reads are usually the largest item: every call re-reads the whole conversation. Next to it, how
many tokens each call carried. Bigger contexts cost more on every call, so a session that sits above
200K tokens is worth a `/compact`.

![Cost by token type, and calls by context size](assets/cost-and-context.png)

## By model and by project

Cost, share, calls and average context per model and per project. A project is the git repository the
session ran in; fast-mode calls show as `<model>-fast`.

![Cost per model and per project](assets/models-and-projects.png)

## The sessions that cost the most

The 15 most expensive sessions in the range, with their project, machine, dates, calls and average
context. The session id is the one Claude Code shows in `/resume`.

![The most expensive sessions](assets/sessions.png)

## Subagents, skills, MCP servers

What the main thread costs against the subagents it spawned, and which skills and MCP servers the calls
were attributed to.

![Main thread vs subagents, skills, MCP servers](assets/attribution.png)

## Machines and rate limits

Each machine's share, and every rate-limit hit Claude Code recorded, with the machine and the account it
hit. Limits are per account, so the hits are too.

![Cost per machine, and the rate-limit hits with their account](assets/machines-and-limits.png)

## Light or dark, English or Turkish

The dashboard follows the system theme and can be set to light or dark from the header; the choice is
remembered in the browser. The language switches on the page, with the same data.

![The dashboard in the light theme](assets/dashboard-light.png)

![The theme menu in the header: system, light, dark](assets/theme-menu.png)

![The dashboard in Turkish](assets/turkish.png)

## In the terminal

Every number on the dashboard is also a terminal report, with the same filters (`--last`, `--account`,
`--machine`, `--project`, `--model`, ...) and `--json` or `--csv` for scripts.

`cc-cost` alone syncs this machine, rewrites the dashboard and prints the summary: by month, account,
machine, model, project and token type.

![cc-cost: the summary](assets/terminal-summary.png)

`cc-cost plan` puts the API equivalent against every plan's price per month, then each account against
its own plan and all of them against the paid plans together. Rate-limit hits sit beside it: they are
the direct signal of a plan that is too small.

![cc-cost plan](assets/terminal-plan.png)

`cc-cost insights` reads the numbers for you: cache hit ratio, context sizes, the largest sessions,
attribution, what the same tokens would cost on another model, the busiest hours, the limits.

![cc-cost insights](assets/terminal-insights.png)

`cc-cost projects`, like `models`, `machines`, `accounts`, `sessions`, `agents`, `skills`, `mcp`, and
`daily`, `weekly`, `monthly` for the periods.

![cc-cost projects --last 30](assets/terminal-projects.png)
