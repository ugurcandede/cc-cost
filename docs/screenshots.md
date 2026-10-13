# Screenshots

All on the demo's sample data (`scripts/demo`): two machines, two Claude accounts (a Max 5x account and
a Team seat), 30 days of made-up usage. Window 1280 pixels wide.

## Dashboard

<table>
  <tr>
    <td><img src="assets/dashboard-dark.png" alt="The dashboard in English, dark theme"></td>
    <td><img src="assets/turkish.png" alt="The dashboard in Turkish, dark theme"></td>
  </tr>
  <tr>
    <td><sub>English</sub></td>
    <td><sub>Türkçe: the language switches on the page</sub></td>
  </tr>
  <tr>
    <td><img src="assets/dashboard-light.png" alt="The dashboard, light theme"></td>
    <td><img src="assets/theme-menu.png" alt="The theme menu: system, light, dark"></td>
  </tr>
  <tr>
    <td><sub>Light theme</sub></td>
    <td><sub>Light, dark, or whatever the system uses</sub></td>
  </tr>
  <tr>
    <td><img src="assets/accounts.png" alt="Two Claude accounts: buttons to pick one, and a card per account"></td>
    <td><img src="assets/chart-by-account.png" alt="Daily cost stacked by account"></td>
  </tr>
  <tr>
    <td><sub>Accounts: buttons to pick one, a card per account with its cost, share and multiple against its own plan</sub></td>
    <td><sub>Daily cost stacked by account; also by model, project or machine</sub></td>
  </tr>
  <tr>
    <td><img src="assets/cost-and-context.png" alt="Cost by token type and calls by context size"></td>
    <td><img src="assets/models-and-projects.png" alt="Cost per model and per project"></td>
  </tr>
  <tr>
    <td><sub>Where the cost goes, and calls by context size</sub></td>
    <td><sub>Cost, share, calls and average context per model and per project</sub></td>
  </tr>
  <tr>
    <td><img src="assets/sessions.png" alt="The most expensive sessions"></td>
    <td><img src="assets/attribution.png" alt="Main thread vs subagents, skills, MCP servers"></td>
  </tr>
  <tr>
    <td><sub>The most expensive sessions in the range</sub></td>
    <td><sub>What subagents, skills and MCP servers cost</sub></td>
  </tr>
  <tr>
    <td colspan="2"><img src="assets/machines-and-limits.png" alt="Cost per machine, and the rate-limit hits with their account"></td>
  </tr>
  <tr>
    <td colspan="2"><sub>Per machine, and every rate-limit hit with its account</sub></td>
  </tr>
</table>

## Terminal

<table>
  <tr>
    <td><img src="assets/terminal-summary.png" alt="cc-cost: the summary"></td>
    <td><img src="assets/terminal-plan.png" alt="cc-cost plan"></td>
  </tr>
  <tr>
    <td><sub><code>cc-cost</code>: sync, then the summary by month, account, machine, model, project and token type</sub></td>
    <td><sub><code>cc-cost plan</code>: the API equivalent against every plan, then each account against its own</sub></td>
  </tr>
  <tr>
    <td><img src="assets/terminal-insights.png" alt="cc-cost insights"></td>
    <td><img src="assets/terminal-projects.png" alt="cc-cost projects --last 30"></td>
  </tr>
  <tr>
    <td><sub><code>cc-cost insights</code>: cache, context size, attribution, models, busiest times, limits</sub></td>
    <td><sub><code>cc-cost projects --last 30</code></sub></td>
  </tr>
</table>
