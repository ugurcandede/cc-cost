# Screenshots

All on the demo's sample data (`scripts/demo`): two machines, two Claude accounts (a Max 5x account and
a Team seat), 30 days of made-up usage. Window 1280 pixels wide.

## Dashboard

| | |
|---|---|
| ![The dashboard, dark](assets/dashboard-dark.png) | ![The dashboard, light](assets/dashboard-light.png) |
| The dashboard, dark | The same, light |
| ![Accounts](assets/accounts.png) | ![Daily cost by account](assets/chart-by-account.png) |
| Accounts: buttons to pick one, a card per account with its cost, share and multiple against its own plan | Daily cost stacked by account; also by model, project or machine |
| ![Cost by token type and context size](assets/cost-and-context.png) | ![By model and by project](assets/models-and-projects.png) |
| Where the cost goes, and calls by context size | Cost, share, calls and average context per model and per project |
| ![Most expensive sessions](assets/sessions.png) | ![Main thread vs subagents, skills, MCP servers](assets/attribution.png) |
| The most expensive sessions in the range | What subagents, skills and MCP servers cost |
| ![By machine and rate-limit hits](assets/machines-and-limits.png) | ![Theme menu](assets/theme-menu.png) |
| Per machine, and every rate-limit hit with its account | Light, dark, or whatever the system uses |
| ![In Turkish](assets/turkish.png) | |
| The dashboard in Turkish; the language switches on the page | |

## Terminal

| | |
|---|---|
| ![cc-cost](assets/terminal-summary.png) | ![cc-cost plan](assets/terminal-plan.png) |
| `cc-cost`: sync, then the summary by month, account, machine, model, project and token type | `cc-cost plan`: the API equivalent against every plan, then each account against its own |
| ![cc-cost insights](assets/terminal-insights.png) | ![cc-cost projects](assets/terminal-projects.png) |
| `cc-cost insights`: cache, context size, attribution, models, busiest times, limits | `cc-cost projects --last 30` |
