// Snapshot format, schema 2. Everything here is synced between machines and outlives the
// transcripts it came from, so fields are append-only: never repurpose an index or a key.

// Positions in a token counter array (Row.t, HourRow.t).
export const T = {
    input: 0,
    write5m: 1,
    write1h: 2,
    read: 3,
    output: 4,
    calls: 5,
    thinking: 6,
    webSearch: 7,
    webFetch: 8,
    maxContext: 9, // largest single-call context (input + cache write + cache read)
    // calls by context size: < 50K, 50K-200K, 200K-500K, >= 500K tokens
    ctx50k: 10,
    ctx200k: 11,
    ctx500k: 12,
    ctxOver500k: 13,
} as const;
export const T_LEN = 14;
export const CTX_BOUNDS = [50_000, 200_000, 500_000];

export interface Row {
    d: string; // local date, YYYY-MM-DD
    p: string; // project (basename of cwd, or a hash when anonymized)
    s: string; // session id
    m: string; // normalized model id
    f?: 1; // fast mode
    a?: string; // subagent type; absent on the main thread
    k?: string; // skill the call is attributed to
    x?: string; // MCP server the call is attributed to
    e?: string; // effort level
    ep?: string; // entrypoint (cli, sdk-cli, ...)
    bg?: 1; // background session
    ac?: string; // account (see accounts.ts); absent on rows synced before accounts were told apart
    t: number[];
}

export interface HourRow {
    d: string;
    h: number; // local hour 0-23
    m: string;
    f?: 1;
    ac?: string;
    t: number[];
}

export interface SessionMeta {
    p: string;
    first: string; // ISO timestamps
    last: string;
}

export interface LimitEvent {
    ts: string; // first time this limit period was hit
    type: string; // five_hour, seven_day, ...
    status: string; // rejected, allowed_warning, ...
    resetsAt?: number; // epoch seconds; identifies the limit period, so retries within it count once
    ac?: string; // limits belong to an account's subscription
}

// What a machine knows about an account it reads; every machine writes it for its own accounts, so
// reports on any machine can name them and price their plans.
export interface AccountMeta {
    name?: string; // given by the user
    plan?: string; // key of PLANS, or "free" for a sponsored seat
    price?: number; // $ a month, instead of the plan's list price
    folder?: string; // the Claude Code folder's name, the label when no name was given
}

export interface Snapshot {
    schema: 2;
    machine: string;
    updated: string;
    timezone: string;
    rows: Row[];
    hourly: HourRow[];
    sessions: Record<string, SessionMeta>;
    limits: LimitEvent[];
    accounts?: Record<string, AccountMeta>; // by account id
    unassigned?: string; // the account this machine's rows without one belong to, as the user chose
}

export const UNKNOWN = '(unknown)';
