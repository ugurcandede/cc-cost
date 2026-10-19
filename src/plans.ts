// Subscription plans. No imports: this file is embedded into the dashboard as well (see dashboard.ts).

// Monthly subscription price in USD. Team prices are per seat, billed monthly; an annual or negotiated
// price goes into the account's own price.
export const PLANS: Record<string, number> = { pro: 20, max5x: 100, max20x: 200, teamStandard: 25, teamPremium: 125 };

export const PLAN_NAMES: Record<string, string> = {
    pro: 'Pro', max5x: 'Max 5x', max20x: 'Max 20x', teamStandard: 'Team Standard', teamPremium: 'Team Premium',
};

// Team prices come from third-party sources, and a Team seat's type is guessed from its limits: shown as beta
export const isBetaPlan = (plan?: string) => !!plan?.startsWith('team');

// $ a month for an account: its own price, its plan's, 0 for a sponsored seat, or unknown
export const planPrice = (plan?: string, price?: number): number | undefined =>
    price ?? (plan === 'free' ? 0 : plan ? PLANS[plan] : undefined);
