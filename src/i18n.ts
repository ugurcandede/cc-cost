// All user-facing text. English is the default everywhere; `tr` must mirror every key of `en`.

const en = {
    langName: 'English',
    help: `cc-cost {version}: API-equivalent cost of your Claude Code usage, across all your machines

Usage: cc-cost [command] [options]

Commands:
  (none)                        Sync this machine, print a summary, update the dashboard
  sync                          Sync this machine and update the dashboard
  daily | weekly | monthly      Cost per day, week (starting Monday) or month
  models | machines | projects  Cost per model, machine or project
  agents | skills | mcp         Cost by main thread vs subagents, by skill, by MCP server
  sessions                      Most expensive sessions
  blocks                        Usage in 5-hour windows
  insights                      Where the money goes and what drives it
  plan                          API equivalent vs subscription prices, rate-limit hits
  report                        Open the HTML dashboard (--location prints its path instead)
  pricing                       Prices in use (--refresh to fetch them again)
  setup                         Pick the shared folder, schedule daily runs, add the Claude Code hook
  status                        Settings, machines, last sync, scheduler and hook
  update                        Update cc-cost to the latest version
  config                        Edit settings in a menu (prints them with --json or without a terminal);
                                "config set <key> <value>" changes one

Filters:
  --since <date>     From YYYY-MM-DD
  --until <date>     Until YYYY-MM-DD, inclusive
  --last <n>         Last n calendar days, including today
  --machine <name>   Only these machines (comma-separated, partial match)
  --project <name>   Only these projects
  --model <name>     Only these models, e.g. opus or fable
  --session <id>     Only these sessions (id prefix)
  --agent <name>     main, or a subagent type such as Explore
  --skill <name>     Only calls attributed to these skills
  --mcp <name>       Only calls attributed to these MCP servers

Output:
  --json             JSON
  --csv              CSV (tables only)
  --breakdown        Per-model rows under each period
  --limit <n>        Rows in sessions, projects and blocks (default 20)
  --lang <en|tr>     Language
  --tz <zone>        IANA time zone for day boundaries
  --no-color         Plain text
  --no-sync          Report from stored data without scanning transcripts
  --offline          Don't fetch live prices or check for a new version
  --quiet            Print nothing on success (for schedulers and hooks)
  --sync-dir <path>  Folder shared between machines
  -h, --help         This help
  -v, --version      Version

Setup:
  --yes              Accept the defaults without asking
  --no-schedule      Don't schedule daily runs
  --no-hook          Don't add the Claude Code hook
  --remove           Remove the schedule and the hook

Docs and issues: {url}`,
    scanned: '{machine}: scanned {files} transcripts ({dupes} duplicate lines skipped)',
    snapshot: 'snapshot: {file}',
    kept: ' (+{n} archived days kept)',
    remoteSynced: 'exchanged with {remote}',
    remoteFailed: 'could not reach {remote}, using the local copies: {reason}',
    sshHint: {
        authUser: 'The server did not let "{user}" in. Check the user name before "@", and that this machine\'s public key (~/.ssh/id_ed25519.pub) is in that user\'s ~/.ssh/authorized_keys on the server.',
        auth: 'The server refused the login. Check the user, and that this machine\'s public key (~/.ssh/id_ed25519.pub) is in that user\'s ~/.ssh/authorized_keys on the server.',
        refused: 'Nothing answers at that address and port. Is the server on, and is SSH listening on that port?',
        resolve: 'No computer has that name. Check the host name, or use its IP address.',
        hostkey: 'The server\'s host key is not the one recorded on the first connection. If the server was reinstalled, remove the old key with: ssh-keygen -R "{known}"; otherwise do not connect.',
        timeout: 'The server did not answer in time. Is it on, and reachable from this network?',
    },
    total: 'TOTAL {cost} · {calls} API calls · {machines} machines',
    dashboard: 'dashboard: {file}',
    unknownModels: 'No price for (left out of totals): {list}',
    pricesLive: 'prices: {source}, fetched {date}',
    pricesFallback: 'live prices unavailable ({reason}); using {source} prices from {date}',
    noData: 'No usage in this range.',
    configFile: 'config: {file}',
    configSet: '{key} = {value}',
    configUnknownKey: 'Unknown setting "{key}". Settings: {keys}',
    unknownCommand: 'Unknown command "{cmd}". Run cc-cost --help.',
    badDate: '{flag} must be YYYY-MM-DD, got "{value}"',
    badNumber: '{flag} must be a positive number, got "{value}"',
    csvUnsupported: '--csv works with table commands only',
    hourFilters: 'note: --project, --session, --agent, --skill and --mcp do not apply to hourly data',
    col: {
        date: 'Date', week: 'Week', month: 'Month', model: 'Model', machine: 'Machine', project: 'Project',
        session: 'Session', input: 'Input', output: 'Output', cacheWrite: 'Cache write', cacheRead: 'Cache read',
        calls: 'Calls', cost: 'Cost', share: 'Share', first: 'First', last: 'Last', avgContext: 'Avg context',
        item: 'Item', total: 'Total', price: 'Input / Write 5m / Write 1h / Read / Output ($/MTok)',
        agent: 'Agent', skill: 'Skill', mcp: 'MCP server', effort: 'Effort', context: 'Context', readCost: 'Cache read $',
        days: 'Days', perMonth: 'Per 30 days', limitHits: 'Limit hits', start: 'Start', end: 'End', tokens: 'Tokens',
        state: 'State',
    },
    item: { read: 'cache read', write: 'cache write', output: 'output', input: 'uncached input', web: 'web search' },
    ins: {
        overview: 'Overview',
        cost: 'Cost',
        calls: 'API calls',
        perCall: '{cost} per call',
        activeDays: 'Active days',
        activeOf: '{active} of {calendar} calendar days',
        avgContext: 'Average context',
        avgContextValue: '{avg} tokens per call (largest {max})',
        cache: 'Cache',
        hitRatio: 'Hit ratio',
        hitRatioValue: '{pct} of prompt tokens came from cache',
        readShare: 'Cache reads',
        writeShare: 'Cache writes',
        ofCost: '{pct} of cost',
        oneHour: '{pct} of cost (1-hour tier: {tier})',
        contextSize: 'Context size',
        above200k: 'Cache reads beyond 200K context cost about {cost} (rough estimate).',
        contextTip: 'Every call re-reads the whole conversation. /clear between unrelated tasks and /compact in long sessions keep it small.',
        bigSessions: 'Largest-context sessions',
        agents: 'Main thread vs subagents',
        skills: 'Skills',
        mcp: 'MCP servers',
        effort: 'Effort',
        models: 'Models',
        whatIf: 'The same tokens on {model}: {cost}',
        fast: 'Fast mode',
        thinking: 'Thinking',
        thinkingValue: '{pct} of output tokens',
        when: 'When',
        weekday: 'Busiest weekday',
        hour: 'Busiest hour',
        limits: 'Rate limits',
        limitsValue: 'limit hits: {n} ({types}), last {last}',
        noLimits: 'no hits recorded',
        bucket: ['under 50K', '50K to 200K', '200K to 500K', '500K and over'],
    },
    plan: {
        note: 'Anthropic does not publish plan limits in tokens, so no tool can tell which plan would have been enough. Rate-limit hits are the direct signal.',
        yours: 'Your plan ({plan}, ${price}/month): over this range the API equivalent is {multiple}× its price.',
        noPlan: 'Set your plan with: cc-cost config set plan max5x (pro, max5x, max20x)',
    },
    blocks: {
        active: 'active, {left} left',
    },
    update: {
        available: 'cc-cost {latest} is available (you have {current}). Run: cc-cost update',
        upToDate: 'cc-cost {current} is up to date.',
        running: 'Updating to {latest}: {command}',
        done: 'Updated to cc-cost {latest}. The schedule and hook keep working; no need to run setup again.',
        failed: 'The update failed (exit code {code}). Run it yourself: {command}',
        checkFailed: 'Could not reach the npm registry to check for a newer version.',
        ephemeral: 'cc-cost is running through npx or dlx, which fetch it each time. For the newest version: npx {pkg}@latest',
        manual: 'cc-cost runs from {path}, not from a package-manager install. Update it the way you installed it (a git checkout: git pull, then yarn build).',
    },
    setup: {
        title: 'cc-cost {version} setup',
        keys: '↑↓ move · enter select · 1-9 pick · q cancel',
        checkKeys: '↑↓ move · space tick · enter confirm · q cancel',
        yes: 'Yes',
        no: 'No',
        cancelled: 'Setup cancelled; nothing was saved.',
        stepLang: 'Language',
        stepWhere: 'Where to keep the data',
        whereIntro: 'To count all your machines together, cc-cost keeps its data in a place each of them can reach.',
        currentFolder: 'Current folder',
        otherFolder: 'Another folder…',
        otherFolderDetail: 'one your machines sync, like ~/Dropbox/cc-cost',
        sshServer: 'SSH server…',
        sshServerDetail: 'a Raspberry Pi or your own server',
        thisMachine: 'This machine only',
        askPath: 'Folder, like ~/Dropbox/cc-cost (Enter: back)',
        notAPath: '"{answer}" is not a full folder path. Type one like ~/Dropbox/cc-cost.',
        askRemote: 'Server and folder, like pi@raspberrypi.local:cc-cost\nOn another port than 22: ssh://pi@raspberrypi.local:2222/cc-cost (Enter: back)',
        remoteInvalid: '"{remote}" is neither user@host:folder nor ssh://user@host:port/folder.',
        remotePort: '"{remote}": in user@host:folder only the first ":" separates the server from the folder. For a port, write ssh://user@host:port/folder, like ssh://pi@raspberrypi.local:2222/cc-cost.',
        connecting: 'Connecting to {remote}…',
        connected: 'Connected to {remote}',
        connectFailed: 'Could not connect: {reason}',
        retry: 'Try again',
        saveAnyway: 'Save it anyway',
        back: 'Back',
        stepClaude: 'Claude Code folders to read',
        claudeIntro: 'Each Claude account keeps its own folder.',
        stepPlan: 'Your plan',
        perMonth: '{price} a month',
        stepSchedule: 'Sync every day at {time}',
        scheduleIntro: 'Keeps the numbers current even on days you don\'t run cc-cost.',
        stepHook: 'Sync when a Claude Code session ends',
        hookIntro: 'Adds a SessionEnd hook to {file}',
        saved: 'saved {file}',
        scheduled: 'scheduled: {what}',
        scheduleFailed: 'could not schedule daily runs: {reason}',
        hookAdded: 'hook added to {file}',
        hookKept: 'hook already in {file}',
        npx: 'cc-cost is running from a temporary npx or dlx folder, so a scheduler or hook would point at a path that disappears. Install it first: npm i -g @ugurcandede/cc-cost (Yarn 1: yarn global add @ugurcandede/cc-cost)',
        removed: 'removed: {what}',
        nothingToRemove: 'nothing to remove',
        firstSync: 'First sync:',
        removeTitle: 'Remove these?',
        scheduleItem: 'the daily schedule',
        hookItem: 'the SessionEnd hook in {file}',
        keptAll: 'Nothing removed.',
        openDashboard: 'Open the dashboard?',
    },
    settingsMenu: {
        title: 'Settings · {file}',
        lang: 'Language',
        where: 'Where the data is kept',
        claude: 'Claude Code folders',
        plan: 'Plan',
        machine: 'Machine name',
        timezone: 'Time zone',
        anonymize: 'Hide project names',
        done: 'Done',
        askMachine: 'Machine name (Enter: keep {current})',
        machineNote: 'Each machine name has its own file in the shared folder; after a rename, delete the old file there.',
        askTimezone: 'IANA time zone, like Europe/Istanbul (Enter: keep {current})',
        badTimezone: '"{tz}" is not a time zone.',
        anonymizeIntro: 'Stores a hash of each project name instead of the name. Days older than Claude Code\'s cleanup window keep the names they were saved with.',
    },
    status: {
        version: 'version',
        config: 'config file',
        syncDir: 'shared folder',
        remote: 'ssh server',
        machine: 'this machine',
        machines: 'machines',
        machineLine: '{name}: updated {updated} · days with data: {days}',
        claudeDirs: 'Claude Code folders',
        retention: 'transcripts kept',
        retentionValue: '{n} days (cleanupPeriodDays)',
        scheduler: 'daily schedule',
        hook: 'SessionEnd hook',
        prices: 'prices',
        yes: 'installed',
        no: 'not installed',
        none: 'none yet',
    },
    dash: {
        title: 'Claude Code: API equivalent',
        timeRange: 'Time range',
        today: 'Today', yesterday: 'Yesterday', last7: 'Last 7 days', last30: 'Last 30 days', last90: 'Last 90 days', all: 'All',
        from: 'From', to: 'To', clear: 'Clear',
        machine: 'Machine', allMachines: 'All machines',
        project: 'Project', allProjects: 'All projects',
        model: 'Model', allModels: 'All models',
        groupBy: 'Chart by', byModelOpt: 'Model', byProjectOpt: 'Project', byMachineOpt: 'Machine',
        other: 'other',
        heroNote: 'API list-price equivalent. Not billed on a subscription.',
        dailyAvg: 'Daily average', activeDays: '{n} active days',
        planMultiple: '× the {price} plan', normalized: '{n} calendar days, normalized to 30',
        apiCalls: 'API calls', perCall: '{cost} / call', machines: 'Machines',
        cacheHit: 'Cache hit ratio', cacheHitNote: 'of prompt tokens',
        avgContext: 'Average context', avgContextNote: 'tokens per call',
        dailyCost: 'Daily cost', dailyCostSub: 'Stacked. Hover or focus a day for its breakdown.',
        chartLabel: 'Daily cost chart',
        whereCost: 'Where the cost goes',
        whereCostSub: 'By token type. Cache read is usually the largest item; without caching the same input would bill at 10×.',
        itemsLabel: 'Cost by token type',
        cacheRead: 'Cache read', cacheWrite: 'Cache write', output: 'Output', input: 'Uncached input', web: 'Web search',
        contextTitle: 'Context size per call', contextSub: 'Calls by how many tokens they re-read. Bigger contexts cost more on every call.',
        buckets: ['< 50K', '50K–200K', '200K–500K', '≥ 500K'],
        byModel: 'By model', byMachine: 'By machine', byProject: 'By project',
        sessions: 'Most expensive sessions', sessionsSub: 'Top 15 in the selected range.',
        attribution: 'Attribution', agents: 'Main thread vs subagents', skills: 'Skills', mcp: 'MCP servers',
        main: 'main thread', none: '(none)', agentCol: 'Agent', skillCol: 'Skill', mcpCol: 'Server',
        limits: 'Rate-limit hits', limitsNone: 'None in this range.',
        cost: 'Cost', share: 'Share', calls: 'Calls', session: 'Session', first: 'First', last: 'Last', avgCtx: 'Avg context',
        allRecords: 'All records ({n} days)', lastDays: 'Last {n} days',
        empty: 'No data in this range. Records cover {min} to {max}.',
        total: 'Total',
        note: 'Updated {updated} · {machines} machines · records {min} to {max} · prices: {prices}',
        language: 'Language',
        theme: 'Theme',
        themeButton: 'Theme: {mode}',
        themeSystem: 'System',
        themeLight: 'Light',
        themeDark: 'Dark',
        footer: 'Generated by cc-cost {version}',
        website: 'Website',
    },
};

export type Dict = typeof en;

const tr: Dict = {
    langName: 'Türkçe',
    help: `cc-cost {version}: Claude Code kullanımının API karşılığı, tüm makinelerin toplamı

Kullanım: cc-cost [komut] [seçenekler]

Komutlar:
  (yok)                         Bu makineyi senkronla, özet bas, dashboard'u güncelle
  sync                          Bu makineyi senkronla, dashboard'u güncelle
  daily | weekly | monthly      Günlük, haftalık (pazartesi başlar) veya aylık maliyet
  models | machines | projects  Model, makine veya projeye göre maliyet
  agents | skills | mcp         Ana akış / subagent, skill ve MCP sunucusuna göre maliyet
  sessions                      En pahalı session'lar
  blocks                        5 saatlik pencerelerde kullanım
  insights                      Para nereye gidiyor, neyden kaynaklanıyor
  plan                          API karşılığı ve abonelik fiyatları, limit aşımları
  report                        HTML dashboard'u aç (--location sadece yolunu basar)
  pricing                       Kullanılan fiyatlar (--refresh ile yeniden çek)
  setup                         Paylaşılan klasörü seç, günlük çalışmayı zamanla, Claude Code hook'unu ekle
  status                        Ayarlar, makineler, son senkron, zamanlayıcı ve hook
  update                        cc-cost'u en son sürüme güncelle
  config                        Ayarları menüden düzenle (--json ile ya da terminal yoksa yazdırır);
                                "config set <anahtar> <değer>" ile birini değiştir

Filtreler:
  --since <tarih>    YYYY-MM-DD'den itibaren
  --until <tarih>    YYYY-MM-DD'ye kadar, dahil
  --last <n>         Bugün dahil son n takvim günü
  --machine <ad>     Sadece bu makineler (virgülle, kısmi eşleşme)
  --project <ad>     Sadece bu projeler
  --model <ad>       Sadece bu modeller, ör. opus veya fable
  --session <id>     Sadece bu session'lar (id başı)
  --agent <ad>       main veya Explore gibi bir subagent türü
  --skill <ad>       Sadece bu skill'lere atfedilen çağrılar
  --mcp <ad>         Sadece bu MCP sunucularına atfedilen çağrılar

Çıktı:
  --json             JSON
  --csv              CSV (sadece tablolar)
  --breakdown        Her dönemin altında model satırları
  --limit <n>        sessions, projects ve blocks'ta satır sayısı (varsayılan 20)
  --lang <en|tr>     Dil
  --tz <bölge>       Gün sınırı için IANA saat dilimi
  --no-color         Düz metin
  --no-sync          Transcript taramadan, kayıtlı veriden raporla
  --offline          Canlı fiyat çekme, yeni sürüm kontrol etme
  --quiet            Başarıda hiçbir şey basma (zamanlayıcı ve hook için)
  --sync-dir <yol>   Makineler arası paylaşılan klasör
  -h, --help         Bu yardım
  -v, --version      Sürüm

Kurulum:
  --yes              Sormadan varsayılanları kabul et
  --no-schedule      Günlük çalışmayı zamanlama
  --no-hook          Claude Code hook'unu ekleme
  --remove           Zamanlamayı ve hook'u kaldır

Dokümantasyon ve hata bildirimi: {url}`,
    scanned: '{machine}: {files} transcript tarandı ({dupes} tekrar satır atlandı)',
    snapshot: 'snapshot: {file}',
    kept: ' (+{n} arşiv gün korundu)',
    remoteSynced: '{remote} ile eşitlendi',
    remoteFailed: '{remote} adresine ulaşılamadı, yerel kopyalar kullanılıyor: {reason}',
    sshHint: {
        authUser: 'Sunucu "{user}" kullanıcısını içeri almadı. "@" öncesindeki kullanıcı adını ve bu makinenin public key\'inin (~/.ssh/id_ed25519.pub) sunucuda o kullanıcının ~/.ssh/authorized_keys dosyasında olduğunu kontrol et.',
        auth: 'Sunucu girişi reddetti. Kullanıcıyı ve bu makinenin public key\'inin (~/.ssh/id_ed25519.pub) sunucuda o kullanıcının ~/.ssh/authorized_keys dosyasında olduğunu kontrol et.',
        refused: 'O adres ve portta cevap veren yok. Sunucu açık mı, SSH o portta mı çalışıyor?',
        resolve: 'Bu adda bir bilgisayar bulunamadı. Sunucu adını kontrol et ya da IP adresini kullan.',
        hostkey: 'Sunucunun host key\'i ilk bağlantıda kaydedilenle aynı değil. Sunucu yeniden kurulduysa eski key\'i şununla sil: ssh-keygen -R "{known}"; değilse bağlanma.',
        timeout: 'Sunucu zamanında cevap vermedi. Açık mı, bu ağdan erişilebiliyor mu?',
    },
    total: 'TOPLAM {cost} · {calls} API çağrısı · {machines} makine',
    dashboard: 'dashboard: {file}',
    unknownModels: 'Fiyatı bilinmeyen (toplama girmedi): {list}',
    pricesLive: 'fiyatlar: {source}, çekildi {date}',
    pricesFallback: 'canlı fiyatlar alınamadı ({reason}); {source} fiyatları kullanılıyor ({date})',
    noData: 'Bu aralıkta kullanım yok.',
    configFile: 'config: {file}',
    configSet: '{key} = {value}',
    configUnknownKey: 'Bilinmeyen ayar "{key}". Ayarlar: {keys}',
    unknownCommand: 'Bilinmeyen komut "{cmd}". cc-cost --help ile bak.',
    badDate: '{flag} YYYY-MM-DD olmalı, gelen: "{value}"',
    badNumber: '{flag} pozitif bir sayı olmalı, gelen: "{value}"',
    csvUnsupported: '--csv sadece tablo komutlarıyla çalışır',
    hourFilters: 'not: --project, --session, --agent, --skill ve --mcp saatlik veriye uygulanmaz',
    col: {
        date: 'Tarih', week: 'Hafta', month: 'Ay', model: 'Model', machine: 'Makine', project: 'Proje',
        session: 'Session', input: 'Girdi', output: 'Çıktı', cacheWrite: 'Cache yazma', cacheRead: 'Cache okuma',
        calls: 'Çağrı', cost: 'Maliyet', share: 'Pay', first: 'İlk', last: 'Son', avgContext: 'Ort. context',
        item: 'Kalem', total: 'Toplam', price: 'Girdi / Yazma 5dk / Yazma 1sa / Okuma / Çıktı ($/MTok)',
        agent: 'Agent', skill: 'Skill', mcp: 'MCP sunucusu', effort: 'Effort', context: 'Context', readCost: 'Cache okuma $',
        days: 'Gün', perMonth: '30 günde', limitHits: 'Limit aşımı', start: 'Başlangıç', end: 'Bitiş', tokens: 'Token',
        state: 'Durum',
    },
    item: { read: 'cache okuma', write: 'cache yazma', output: 'çıktı', input: 'cache\'siz girdi', web: 'web arama' },
    ins: {
        overview: 'Genel',
        cost: 'Maliyet',
        calls: 'API çağrısı',
        perCall: 'çağrı başına {cost}',
        activeDays: 'Aktif gün',
        activeOf: '{calendar} takvim gününün {active} günü',
        avgContext: 'Ortalama context',
        avgContextValue: 'çağrı başına {avg} token (en büyük {max})',
        cache: 'Cache',
        hitRatio: 'İsabet oranı',
        hitRatioValue: '{pct} (prompt token\'larının cache\'ten okunan kısmı)',
        readShare: 'Cache okuma',
        writeShare: 'Cache yazma',
        ofCost: '{pct} (maliyet payı)',
        oneHour: '{pct} (maliyet payı; 1 saatlik katman: {tier})',
        contextSize: 'Context boyutu',
        above200k: '200K\'nın üzerindeki context\'in cache okuma maliyeti yaklaşık {cost} (kaba tahmin).',
        contextTip: 'Her çağrı tüm konuşmayı yeniden okur. Alakasız işler arasında /clear, uzun session\'larda /compact context\'i küçük tutar.',
        bigSessions: 'En büyük context\'li session\'lar',
        agents: 'Ana akış ve subagent\'lar',
        skills: 'Skill\'ler',
        mcp: 'MCP sunucuları',
        effort: 'Effort',
        models: 'Modeller',
        whatIf: 'Aynı token\'lar {model} ile: {cost}',
        fast: 'Fast mode',
        thinking: 'Thinking',
        thinkingValue: '{pct} (çıktı token\'ları içindeki payı)',
        when: 'Ne zaman',
        weekday: 'En yoğun gün',
        hour: 'En yoğun saat',
        limits: 'Limitler',
        limitsValue: 'limit aşımı: {n} ({types}), son {last}',
        noLimits: 'kayıtlı aşım yok',
        bucket: ['50K altı', '50K – 200K', '200K – 500K', '500K ve üstü'],
    },
    plan: {
        note: 'Anthropic plan limitlerini token cinsinden yayınlamıyor; hangi planın yeteceğini hiçbir araç söyleyemez. Doğrudan sinyal limit aşımları.',
        yours: 'Planın ({plan}, aylık ${price}): bu aralıktaki API karşılığı, plan fiyatının {multiple} katı.',
        noPlan: 'Planını ayarla: cc-cost config set plan max5x (pro, max5x, max20x)',
    },
    blocks: {
        active: 'aktif, {left} kaldı',
    },
    update: {
        available: 'cc-cost {latest} yayında (sizdeki {current}). Güncellemek için: cc-cost update',
        upToDate: 'cc-cost {current} güncel.',
        running: '{latest} sürümüne güncelleniyor: {command}',
        done: 'cc-cost {latest} sürümüne güncellendi. Zamanlama ve hook çalışmaya devam eder; setup\'ı yeniden çalıştırmaya gerek yok.',
        failed: 'Güncelleme başarısız oldu (çıkış kodu {code}). Kendiniz çalıştırın: {command}',
        checkFailed: 'Yeni sürümü kontrol etmek için npm registry\'ye ulaşılamadı.',
        ephemeral: 'cc-cost npx ya da dlx ile çalışıyor; bunlar her seferinde paketi indirir. En yeni sürüm için: npx {pkg}@latest',
        manual: 'cc-cost {path} konumundan çalışıyor, bir paket yöneticisi kurulumu değil. Nasıl kurduysanız öyle güncelleyin (git kopyası: git pull, ardından yarn build).',
    },
    setup: {
        title: 'cc-cost {version} kurulumu',
        keys: '↑↓ gez · enter seç · 1-9 hızlı seç · q iptal',
        checkKeys: '↑↓ gez · boşluk işaretle · enter onayla · q iptal',
        yes: 'Evet',
        no: 'Hayır',
        cancelled: 'Kurulum iptal edildi; hiçbir şey kaydedilmedi.',
        stepLang: 'Dil',
        stepWhere: 'Verinin tutulacağı yer',
        whereIntro: 'Tüm makinelerini birlikte saymak için cc-cost verisini hepsinin erişebildiği bir yerde tutar.',
        currentFolder: 'Şu anki klasör',
        otherFolder: 'Başka bir klasör…',
        otherFolderDetail: 'makinelerinin eşitlediği bir klasör, örneğin ~/Dropbox/cc-cost',
        sshServer: 'SSH sunucusu…',
        sshServerDetail: 'bir Raspberry Pi ya da kendi sunucun',
        thisMachine: 'Sadece bu makine',
        askPath: 'Klasör, örneğin ~/Dropbox/cc-cost (Enter: geri)',
        notAPath: '"{answer}" tam bir klasör yolu değil. ~/Dropbox/cc-cost gibi bir yol yaz.',
        askRemote: 'Sunucu ve klasör, örneğin pi@raspberrypi.local:cc-cost\n22 dışında bir portta: ssh://pi@raspberrypi.local:2222/cc-cost (Enter: geri)',
        remoteInvalid: '"{remote}" ne kullanıcı@sunucu:klasör ne de ssh://kullanıcı@sunucu:port/klasör biçiminde.',
        remotePort: '"{remote}": kullanıcı@sunucu:klasör biçiminde sunucuyu klasörden sadece ilk ":" ayırır. Port için ssh://kullanıcı@sunucu:port/klasör yaz, örneğin ssh://pi@raspberrypi.local:2222/cc-cost.',
        connecting: '{remote} adresine bağlanılıyor…',
        connected: '{remote} adresine bağlanıldı',
        connectFailed: 'Bağlanılamadı: {reason}',
        retry: 'Tekrar dene',
        saveAnyway: 'Yine de kaydet',
        back: 'Geri dön',
        stepClaude: 'Okunacak Claude Code klasörleri',
        claudeIntro: 'Her Claude hesabının kendi klasörü var.',
        stepPlan: 'Planın',
        perMonth: 'ayda {price}',
        stepSchedule: 'Her gün {time}\'de senkronla',
        scheduleIntro: 'cc-cost\'u çalıştırmadığın günlerde de rakamlar güncel kalır.',
        stepHook: 'Claude Code session\'ı bitince senkronla',
        hookIntro: 'SessionEnd hook\'u eklenir: {file}',
        saved: 'kaydedildi: {file}',
        scheduled: 'zamanlandı: {what}',
        scheduleFailed: 'günlük çalışma zamanlanamadı: {reason}',
        hookAdded: 'hook eklendi: {file}',
        hookKept: 'hook zaten var: {file}',
        npx: 'cc-cost geçici bir npx ya da dlx klasöründen çalışıyor; zamanlayıcı ve hook silinecek bir yolu gösterir. Önce kur: npm i -g @ugurcandede/cc-cost (Yarn 1: yarn global add @ugurcandede/cc-cost)',
        removed: 'kaldırıldı: {what}',
        nothingToRemove: 'kaldırılacak bir şey yok',
        firstSync: 'İlk senkron:',
        removeTitle: 'Bunlar kaldırılsın mı?',
        scheduleItem: 'günlük zamanlama',
        hookItem: '{file} içindeki SessionEnd hook\'u',
        keptAll: 'Hiçbir şey kaldırılmadı.',
        openDashboard: 'Dashboard açılsın mı?',
    },
    settingsMenu: {
        title: 'Ayarlar · {file}',
        lang: 'Dil',
        where: 'Verinin tutulduğu yer',
        claude: 'Claude Code klasörleri',
        plan: 'Plan',
        machine: 'Makine adı',
        timezone: 'Saat dilimi',
        anonymize: 'Proje adlarını gizle',
        done: 'Bitti',
        askMachine: 'Makine adı (Enter: {current} kalsın)',
        machineNote: 'Her makine adının paylaşılan klasörde kendi dosyası var; ad değişince oradaki eski dosyayı sil.',
        askTimezone: 'IANA saat dilimi, örneğin Europe/Istanbul (Enter: {current} kalsın)',
        badTimezone: '"{tz}" bir saat dilimi değil.',
        anonymizeIntro: 'Proje adı yerine adın özeti (hash) saklanır. Claude Code\'un temizlik süresinden eski günler kaydedildikleri adlarla kalır.',
    },
    status: {
        version: 'sürüm',
        config: 'config dosyası',
        syncDir: 'paylaşılan klasör',
        remote: 'ssh sunucusu',
        machine: 'bu makine',
        machines: 'makineler',
        machineLine: '{name}: güncellendi {updated} · veri olan gün: {days}',
        claudeDirs: 'Claude Code klasörleri',
        retention: 'transcript saklama',
        retentionValue: '{n} gün (cleanupPeriodDays)',
        scheduler: 'günlük zamanlama',
        hook: 'SessionEnd hook',
        prices: 'fiyatlar',
        yes: 'kurulu',
        no: 'kurulu değil',
        none: 'henüz yok',
    },
    dash: {
        title: 'Claude Code: API karşılığı',
        timeRange: 'Zaman aralığı',
        today: 'Bugün', yesterday: 'Dün', last7: 'Son 7 gün', last30: 'Son 30 gün', last90: 'Son 90 gün', all: 'Tümü',
        from: 'Başlangıç', to: 'Bitiş', clear: 'Temizle',
        machine: 'Makine', allMachines: 'Tüm makineler',
        project: 'Proje', allProjects: 'Tüm projeler',
        model: 'Model', allModels: 'Tüm modeller',
        groupBy: 'Grafik', byModelOpt: 'Model', byProjectOpt: 'Proje', byMachineOpt: 'Makine',
        other: 'diğer',
        heroNote: 'API liste fiyatı karşılığı. Abonelikte bu tutar faturalanmıyor.',
        dailyAvg: 'Günlük ortalama', activeDays: '{n} aktif gün',
        planMultiple: '{price} planın katı', normalized: '{n} takvim günü, 30 güne normalize',
        apiCalls: 'API çağrısı', perCall: '{cost} / çağrı', machines: 'Makine',
        cacheHit: 'Cache isabeti', cacheHitNote: 'prompt token\'larında',
        avgContext: 'Ortalama context', avgContextNote: 'çağrı başına token',
        dailyCost: 'Günlük maliyet', dailyCostSub: 'Yığılmış. Bir güne gel, o günün dökümünü gör.',
        chartLabel: 'Günlük maliyet grafiği',
        whereCost: 'Maliyet nereye gidiyor',
        whereCostSub: 'Token türüne göre. En büyük kalem genelde cache okuma; cache olmasa aynı girdi 10 katına faturalanırdı.',
        itemsLabel: 'Token türüne göre maliyet',
        cacheRead: 'Cache okuma', cacheWrite: 'Cache yazma', output: 'Çıktı', input: 'Cache\'siz girdi', web: 'Web arama',
        contextTitle: 'Çağrı başına context', contextSub: 'Çağrıların yeniden okuduğu token miktarına göre dağılımı. Context büyüdükçe her çağrı pahalılaşır.',
        buckets: ['< 50K', '50K–200K', '200K–500K', '≥ 500K'],
        byModel: 'Model dökümü', byMachine: 'Makine dökümü', byProject: 'Proje dökümü',
        sessions: 'En pahalı session\'lar', sessionsSub: 'Seçili aralıktaki ilk 15.',
        attribution: 'Atıf', agents: 'Ana akış ve subagent\'lar', skills: 'Skill\'ler', mcp: 'MCP sunucuları',
        main: 'ana akış', none: '(yok)', agentCol: 'Agent', skillCol: 'Skill', mcpCol: 'Sunucu',
        limits: 'Limit aşımları', limitsNone: 'Bu aralıkta yok.',
        cost: 'Maliyet', share: 'Pay', calls: 'Çağrı', session: 'Session', first: 'İlk', last: 'Son', avgCtx: 'Ort. context',
        allRecords: 'Tüm kayıtlar ({n} gün)', lastDays: 'Son {n} gün',
        empty: 'Bu aralıkta veri yok. Kayıtlar {min} ile {max} arasını kapsıyor.',
        total: 'Toplam',
        note: 'Güncellendi {updated} · {machines} makine · kayıtlar {min} – {max} · fiyatlar: {prices}',
        language: 'Dil',
        theme: 'Tema',
        themeButton: 'Tema: {mode}',
        themeSystem: 'Sistem',
        themeLight: 'Açık',
        themeDark: 'Koyu',
        footer: 'cc-cost {version} ile oluşturuldu',
        website: 'Web sitesi',
    },
};

export const LANGS: Record<string, Dict> = { en, tr };

let current: Dict = en;
let currentLang = 'en';
export const setLang = (lang: string) => {
    currentLang = LANGS[lang] ? lang : 'en';
    current = LANGS[currentLang]!;
};
export const L = () => current;
export const lang = () => currentLang;

export const fill = (text: string, vars: Record<string, string | number> = {}) =>
    text.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`));
