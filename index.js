/**
 * 每日签到仪表盘 —— Host 半区。
 *
 * 这样做是因为 DSH 的插件市场里已经装了 `dsh-connect-workbuddy-models`，
 * 它负责真正的签到（凭据解封、调上游接口、自动签到）。本插件只做两件事：
 *
 *   1. 读它公开的 HTTP 接口 `/plugins/dsh-connect-workbuddy-models/status`；
 *   2. 把每次读到的结果折算成一条按「账号 + 日期」幂等的流水，落盘保存，
 *      再通过自己的 HTTP 路由给浏览器半区。
 *
 * 不复制上游的凭据逻辑，也不写它任何文件，所以上游升级不会连带打坏这里。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const PLUGIN_ID = 'dsh-checkin-dashboard';

const ROUTE_PREFIX = `/plugins/${PLUGIN_ID}`;
const DASHBOARD_PATH = `${ROUTE_PREFIX}/dashboard`;
const CHECKIN_PATH = `${ROUTE_PREFIX}/checkin`;

/**
 * 已接入的签到平台源。
 *
 * 每个源描述「去哪读状态、用什么形状的适配器解析」。加一个平台 = 往这里加一条，
 * 不需要改采样、账本、路由或前端。
 *
 * `adapt(raw, sampledAtMs)` 把该平台 `/status` 的应答折算成统一形状：
 *   { accounts: [{ id, name, platform, region, balance, checkedIn, credit,
 *                  streakDays, perDayCredit, claimable, claimText }] }
 * 各平台字段命名不同，差异全部收在各自的 adapt 里。
 */
const PLATFORM_SOURCES = [
  {
    /** 唯一 key，同时是账本里 record.source 的值。 */
    id: 'workbuddy',
    /** 展示名。 */
    label: 'WorkBuddy',
    /** npm 包名：前端引导条要告诉用户去装/启用哪个包。 */
    packageName: 'dsh-connect-workbuddy-models',
    /** 该插件不可达时，界面上给出的一键安装 spec。 */
    installSpec: 'dsh-connect-workbuddy-models',
    /** 上游插件提供的 HTTP 路由前缀。 */
    prefix: '/plugins/dsh-connect-workbuddy-models',
    /** 该平台的状态路由。 */
    statusPath: '/plugins/dsh-connect-workbuddy-models/status',
    /** 重新扫描（刷新余额与签到）的路由；没有就留空。 */
    refreshPath: '/plugins/dsh-connect-workbuddy-models/accounts/refresh',
    /** 手动签到路由；没有就留空。 */
    checkinPath: '/plugins/dsh-connect-workbuddy-models/checkin',
    /**
     * 把该平台应答折算成统一形状。
     * dsh-connect-workbuddy-models 的形状：accounts[].account / .checkin / .total
     *
     * `credit` 取的是「今天签到应得的积分」，按可信度依次回退：
     * 1. `automation.earningsToday[id]` —— 上游自己领的，最准；
     * 2. `checkin.todayCredit` —— 签到活动的固定奖励值，同样准确；
     * 3. 都拿不到就给 0，由调用方决定怎么显示。
     *
     * 绝不用余额差值推算：签到收入是固定的 100，而余额里还混着模型消耗，
     * 两者相减得到的是「净变化」，不是「签到所得」（曾因此把 +100 显示成 +94）。
     */
    adapt(raw, sampledAtMs) {
      const earningsToday = (raw && raw.automation && raw.automation.earningsToday) || {};
      const list = Array.isArray(raw && raw.accounts) ? raw.accounts : [];
      return list.map((entry) => {
        const account = (entry && entry.account) || {};
        const checkin = (entry && entry.checkin) || {};
        const id = String(account.id || entry.id || '');
        const earned = earningsToday[id] || {};

        const fromEarnings = Number(earned.credit != null ? earned.credit : earned.checkinCredit) || 0;
        /** 签到活动声明的固定奖励（当前档位），只在活动开启时有意义。 */
        const perDayCredit = Number(checkin.todayCredit != null ? checkin.todayCredit : checkin.dailyCredit) || 0;
        const checkedIn = Boolean(entry.todayCheckedIn != null ? entry.todayCheckedIn : checkin.todayCheckedIn);

        // 已签到才有「今日所得」；未签到则一律 0，避免把预期奖励当成已得。
        const credit = checkedIn ? (fromEarnings > 0 ? fromEarnings : perDayCredit) : 0;

        return {
          id: `${this.id}:${id}`,
          rawId: id,
          name: String(entry.label || account.accountName || id),
          platform: this.id,
          platformLabel: this.label,
          region: String(account.region || (raw && raw.region) || 'cn'),
          balance: Number(entry.total) || 0,
          checkedIn,
          credit,
          /** 固定奖励值：净变化兜底、以及「预计可领」提示都用它。 */
          perDayCredit,
          streakDays: Number(entry.streakDays != null ? entry.streakDays : checkin.streakDays) || 0,
          claimable: Boolean(checkin.active),
          claimText: String(checkin.claimButtonText || ''),
        };
      });
    },
  },
];

/** 采样间隔：签到是每天一次级别的事，10 分钟足够且不打扰上游。 */
const DEFAULT_SAMPLE_INTERVAL_MS = 10 * 60 * 1000;

/** 流水上限，避免无限增长。 */
const MAX_RECORDS = 500;

function dashboardHome() {
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
  return path.join(home, PLUGIN_ID);
}

function ledgerFile() {
  return path.join(dashboardHome(), 'ledger.json');
}

/** 读账本；任何异常都退化成空账本，绝不让界面因此打不开。 */
function readLedger() {
  try {
    const raw = fs.readFileSync(ledgerFile(), 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.records)) return { records: [], lastSampleAtMs: 0 };
    return {
      records: migrateRecords(parsed.records),
      lastSampleAtMs: Number(parsed.lastSampleAtMs) || 0,
    };
  } catch {
    return { records: [], lastSampleAtMs: 0 };
  }
}

/**
 * 账本兼容迁移：修正旧字段格式与状态语义，并按新键去重。
 *
 * 主要处理三件历史遗留：
 *
 * 1. **`accountId` 缺平台前缀**：早期只有 WorkBuddy，`accountId` 就是上游裸 id；
 *    改成多平台后变成 `workbuddy:<id>`。幂等键是 `日期:账号`，键一变同一天就被
 *    算成两条（表现为「今天有两条一模一样的流水」）。
 * 2. **状态语义错误**：旧逻辑写的是 `checkedIn && credit > 0 ? 'success' : 'already'`，
 *    于是「签到了但上游没回填数额」被存成 `already` + `credit: 0`，界面上显示
 *    「今日已签到 / 本次获得为空」这种自相矛盾的组合。现在统一成
 *    `success` 表示已签到，数额未知由 `creditKnown: false` 单独表达。
 * 3. **文案含糊**：旧的 `'今日已签到'` 换成明确的「已签到（上游未回填本次所得）」。
 *
 * 迁移是幂等的：反复读取同一份账本结果不变。
 */
function migrateRecords(records) {
  const byId = new Map();

  for (const item of records) {
    if (!item || typeof item !== 'object') continue;

    let accountId = String(item.accountId || '');
    if (!accountId) continue;

    // 没有平台前缀的老记录，按唯一已知的历史平台补上。
    if (!accountId.includes(':')) accountId = `workbuddy:${accountId}`;

    const day = String(item.day || '');
    const id = `${day}:${accountId}`;

    const credit = Number(item.credit) || 0;
    // 已签到就算 success；数额有没有是另一件事。
    const checkedIn = item.status === 'success' || item.status === 'already';
    const creditKnown = checkedIn && credit > 0;

    const next = {
      ...item,
      id,
      accountId,
      platform: item.platform || 'WorkBuddy',
      credit,
      creditKnown,
      status: checkedIn ? 'success' : 'pending',
      message: checkedIn
        ? creditKnown
          ? `已签到，获得 ${credit} 积分`
          : '已签到（上游未回填本次所得）'
        : String(item.message || '待领取'),
    };

    const previous = byId.get(id);
    if (previous === undefined || Number(next.sampledAtMs) > Number(previous.sampledAtMs)) {
      byId.set(id, next);
    }
  }

  const list = [...byId.values()];
  list.sort((a, b) => (b.sampledAtMs || 0) - (a.sampledAtMs || 0) || String(a.accountId).localeCompare(String(b.accountId)));
  return list.slice(0, MAX_RECORDS);
}

function writeLedger(ledger) {
  try {
    const dir = dashboardHome();
    fs.mkdirSync(dir, { recursive: true });
    const tmp = path.join(dir, `ledger-${process.pid}-${Date.now()}.tmp`);
    fs.writeFileSync(tmp, JSON.stringify(ledger), 'utf8');
    fs.renameSync(tmp, ledgerFile());
  } catch (error) {
    console.error(`[${PLUGIN_ID}] 写账本失败:`, error && error.message ? error.message : error);
  }
}

/** 北京时间自然日，与上游自动签到的时区口径一致。 */
function dayKey(ms) {
  const shifted = new Date(ms + 8 * 3600 * 1000);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const d = String(shifted.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * 把一批**已归一**的账号折算进流水。
 *
 * 幂等键是 `日期:平台:账号`：同一天反复采样只更新同一条，且保留首次采样时间，
 * 这样流水里的时间戳不会每 10 分钟跳一次。
 *
 * @param accounts PLATFORM_SOURCES[x].adapt() 的输出
 */
function upsertRecords(records, accounts, sampledAtMs) {
  const day = dayKey(sampledAtMs);

  for (const entry of accounts) {
    const id = entry.id;
    if (!id) continue;

    const checkedIn = entry.checkedIn;
    const credit = Number(entry.credit) || 0;
    /** 数额是否可信：签到成功但上游没回填数额时，credit 是 0 而不是「真的 0」。 */
    const creditKnown = checkedIn && credit > 0;

    const record = {
      id: `${day}:${id}`,
      day,
      accountId: id,
      accountName: entry.name,
      platform: entry.platformLabel || entry.platform,
      region: entry.region || 'cn',
      // 状态只表示「签没签到」。数额为 0 不等于没签到成功 —— 早期把两者混在一个
      // 判断里，导致「已签到」却写着 credit=0、state=already，界面上自相矛盾。
      status: checkedIn ? 'success' : 'pending',
      credit,
      creditKnown,
      streakDays: Number(entry.streakDays) || 0,
      balance: Number(entry.balance) || 0,
      message: checkedIn
        ? creditKnown
          ? `已签到，获得 ${credit} 积分`
          : '已签到（上游未回填本次所得）'
        : String(entry.claimText || '待领取'),
      sampledAtMs,
    };

    const at = records.findIndex((item) => item.id === record.id);
    if (at >= 0) {
      record.sampledAtMs = records[at].sampledAtMs || sampledAtMs;
      records[at] = record;
    } else {
      records.push(record);
    }
  }

  // 兜底去重：任何来源写入重复键时只保留最新一条，避免界面出现同名重复行。
  const byId = new Map();
  for (const item of records) {
    const previous = byId.get(item.id);
    if (previous === undefined || Number(item.sampledAtMs) > Number(previous.sampledAtMs)) {
      byId.set(item.id, item);
    }
  }

  const list = [...byId.values()];
  list.sort((a, b) => (b.sampledAtMs || 0) - (a.sampledAtMs || 0) || String(a.accountId).localeCompare(String(b.accountId)));
  return list.slice(0, MAX_RECORDS);
}

/**
 * 整理成前端直接能画的结构；这里不含任何业务判断。
 *
 * 入参 `accounts` 是各平台 `adapt()` 的输出并集，因此前端不再关心平台差异。
 *
 * # 为什么不再用余额差值推算
 *
 * 早期版本拿「当前余额 − 上次余额」当今日所得，理由是「用户在 IDE 签的，平台
 * 账本里没有这笔」。但余额里**同时**混着模型消耗：签到 +100、当天用了 5.95，
 * 净变化就是 94.05，于是界面把固定的 100 显示成「约 94」。
 *
 * 差额算的是**净变化**，不是**签到所得**，两者在有消耗时必然不等。签到奖励是
 * 固定值，平台已经通过 `checkin.todayCredit` 告诉我们，直接用那个值就够准确。
 *
 * 现在的口径：
 *   今日获得 = 平台账本的领取额 → 没有则用签到活动的固定奖励值 → 都没有就不显示数字。
 */
function buildDashboard(accounts, sources, ledger, now) {
  const today = dayKey(now);

  /** 统一成「今日所得 + 是否已签到」的固定口径，不再做任何余额推算。 */
  const enriched = accounts.map((entry) => {
    const balance = Number(entry.balance) || 0;
    const checkedIn = Boolean(entry.checkedIn);
    const credit = Number(entry.credit) || 0;

    return {
      ...entry,
      balance,
      checkedIn,
      todayCredit: checkedIn ? credit : 0,
      /** 该值是否为「活动固定奖励」而非平台账本实测值，前端可据此决定措辞。 */
      creditDerived: false,
    };
  });

  /**
   * 把今天的账本记录刷成和卡片一致的口径。
   *
   * 账本在采样那一刻写入，那时平台还没回填领取额，于是记的是 `credit: 0`。
   * 现在卡片有准确值，流水也该跟着更新 —— 只在内存里改，不回写磁盘。
   */
  const enrichedById = new Map(enriched.map((a) => [a.id, a]));
  const records = ledger.records.map((item) => {
    if (item.day !== today) return item;
    const account = enrichedById.get(item.accountId);
    if (account === undefined || account.todayCredit <= 0) return item;
    return {
      ...item,
      credit: account.todayCredit,
      creditKnown: true,
      status: 'success',
      message: `已签到，获得 ${account.todayCredit} 积分`,
    };
  });

  const todayRecords = records.filter((item) => item.day === today);
  const todayCredit = Math.round(todayRecords.reduce((sum, item) => sum + (Number(item.credit) || 0), 0));

  /** 各平台自动签到的最近一次运行信息：取 lastRunAtMs 最大的那个。 */
  const run = sources.reduce(
    (best, s) => {
      const r = (s && s.lastRun) || {};
      return Number(r.lastRunAtMs) > Number(best.lastRunAtMs) ? r : best;
    },
    { lastRunAtMs: 0 },
  );

  return {
    sampledAtMs: now,
    lastSampleAtMs: ledger.lastSampleAtMs,
    accounts: enriched,
    totals: {
      // 余额可能是小数（上游按倍率折算），显示时保留两位，不做取整以免掩盖真实数值。
      balance: Math.round(enriched.reduce((s, a) => s + a.balance, 0) * 100) / 100,
      /** 今日获得的积分：直接累加各账号的准确值，不做任何推算。 */
      todayCredit,
      /** 保留字段（前端历史用法），当前恒为 false。 */
      creditDerived: false,
      checkedInCount: enriched.filter((a) => a.checkedIn).length,
      accountCount: enriched.length,
    },
    automation: {
      /** 至少有一个平台开启了自动签到。 */
      enabled: sources.some((s) => s.enabled),
      running: sources.some((s) => s.running),
      checkinHours: sources.flatMap((s) => s.checkinHours),
      /** 最近一次自动签到运行（取各平台里最晚的）。 */
      lastRunAtMs: Number(run.lastRunAtMs) || 0,
      lastRunDate: String(run.lastRunDate || ''),
      message: String(run.message || ''),
      detail: Array.isArray(run.detail) ? run.detail : [],
      ok: Number(run.ok) || 0,
      failed: Number(run.failed) || 0,
    },
    /** 各平台的独立状态，前端需要时就地展开。 */
    platforms: sources,
    records: records.slice(0, 200),
    upstreamError: null,
    /**
     * 依赖健康度：前端据此显示「去启用上游插件」的引导条。
     *
     * `missing` 是「上游插件整体不可用」（路由 404 或连接失败）—— 多半是装了但没启用，
     * 或者根本没装。`degraded` 是「部分平台失败」。
     */
    dependencies: {
      missing: sources.filter((s) => s.notEnabled || s.error).map((s) => ({
        name: s.source.packageName || s.source.id,
        label: s.source.label,
        installSpec: s.source.installSpec || '',
        reason: s.error || '不可达',
      })),
    },
  };
}

/**
 * 当前 DSH 服务的源地址，用于回环调用上游路由。
 *
 * 宿主的服务名是 `webServer`（大小写敏感），早期文档里的 `webserver` 只是
 * 路由前缀的叫法，取服务时必须用 `webServer`，否则插件会永远停在
 * 「waiting for service: webserver」。
 */
let origin = '';
function getOrigin() {
  return origin || `http://127.0.0.1:${process.env.DSH_PORT || 3080}`;
}
function setOriginFromServer(server) {
  if (!server) return;
  if (typeof server.getOrigin === 'function') {
    try {
      const value = server.getOrigin();
      if (value) {
        origin = String(value).replace(/\/+$/, '');
        return;
      }
    } catch {
      /* 端口还没绑定，留到下一轮定时器再取 */
    }
  }
  const protocol = server.protocol || 'http:';
  const host = typeof server.host === 'string' && server.host ? server.host : '127.0.0.1';
  const port = Number(server.port);
  if (port) origin = `${protocol}//${host}:${port}`;
}

/** 读一个平台的状态。失败返回 `{ error }` 而不是抛，单平台挂掉不影响其它平台。 */
async function fetchSourceStatus(source) {
  try {
    const response = await fetch(`${getOrigin()}${source.statusPath}`, {
      headers: { accept: 'application/json' },
    });
    if (!response.ok) {
      return { source, error: `HTTP ${response.status}`, notEnabled: response.status === 404 };
    }
    const raw = await response.json();
    const accounts = typeof source.adapt === 'function' ? source.adapt.call(source, raw, Date.now()) : [];
    const automation = (raw && raw.automation) || {};
    const job = (automation.jobs && automation.jobs.checkin) || {};
    return {
      source,
      accounts,
      enabled: Boolean(automation.enabled),
      running: Boolean(automation.running),
      checkinHours: Array.isArray(automation.checkinHours) ? automation.checkinHours : [],
      /** 该平台自动签到的最近一次运行信息，供汇总时挑最新的一条。 */
      lastRun: {
        lastRunAtMs: Number(job.lastRunAtMs) || 0,
        lastRunDate: String(job.lastRunDate || ''),
        message: String(job.message || ''),
        detail: Array.isArray(job.detail) ? job.detail : [],
        ok: Number(job.ok) || 0,
        failed: Number(job.failed) || 0,
      },
    };
  } catch (error) {
    return { source, error: error && error.message ? error.message : String(error) };
  }
}

/**
 * 采样一次并落盘。
 *
 * `rescan` 为真时先 POST 各平台的 refresh 路由。
 * 上游把积分余额缓存在内存里 10 分钟（BALANCE_REFRESH_MS），`/status` 读到的是
 * 那份缓存；而 refresh 会重新探测余额与签到状态。只在用户按下刷新、
 * 或刚点完签到这类「他明确期望看到最新数字」的时刻才是真，定时采样不碰它，
 * 免得每 10 分钟去打一次上游。
 *
 * 任一平台失败都只记录该平台的错误，其余平台照常采样与落盘。
 */
async function sample(options = {}) {
  const rescan = Boolean(options && options.rescan);

  if (rescan) {
    await Promise.all(
      PLATFORM_SOURCES.filter((s) => s.refreshPath).map(async (s) => {
        try {
          const response = await fetch(`${getOrigin()}${s.refreshPath}`, {
            method: 'POST',
            headers: { accept: 'application/json' },
          });
          if (!response.ok) {
            console.warn(`[${PLUGIN_ID}] ${s.label} 重新扫描返回 HTTP ${response.status}`);
          }
          await response.text();
        } catch (error) {
          // 重扫失败不致命：下面照常读缓存里的 /status，页面至少还有旧数据。
          console.warn(`[${PLUGIN_ID}] ${s.label} 重新扫描失败:`, error && error.message ? error.message : error);
        }
      }),
    );
  }

  const results = await Promise.all(PLATFORM_SOURCES.map(fetchSourceStatus));
  const accounts = results.flatMap((r) => r.accounts || []);

  const now = Date.now();
  const ledger = readLedger();
  ledger.records = upsertRecords(ledger.records, accounts, now);
  ledger.lastSampleAtMs = now;
  writeLedger(ledger);

  return { accounts, sources: results, ledger };
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

async function handleDashboard(res, url) {
  try {
    // `?refresh=1` 表示用户要看到最新数字：先让各平台重扫一次余额与签到。
    const rescan = Boolean(url && url.searchParams.get('refresh'));
    const { accounts, sources, ledger } = await sample({ rescan });
    const body = buildDashboard(accounts, sources, ledger, Date.now());

    // 把各平台自身的错误拼成一句人话；全部正常时为空。
    const failures = sources.filter((s) => s.error).map((s) => `${s.source.label}: ${s.error}`);
    body.upstreamError = failures.length > 0 ? failures.join('；') : null;
    // 一个平台都没读成功才算致命，前端据此决定是否显示警告。
    body.upstreamFailed = sources.every((s) => Boolean(s.error));

    sendJson(res, 200, body);
  } catch (error) {
    // 任何未预料异常都要给出可读响应，否则宿主只会回一个空体 400，无从排查。
    console.error(`[${PLUGIN_ID}] 组装仪表盘失败:`, error && error.stack ? error.stack : error);
    sendJson(res, 200, {
      sampledAtMs: Date.now(),
      lastSampleAtMs: 0,
      accounts: [],
      totals: { balance: 0, todayCredit: 0, creditDerived: false, checkedInCount: 0, accountCount: 0 },
      automation: { enabled: false, running: false, checkinHours: [], lastRunAtMs: 0, lastRunDate: '', message: '', detail: [], ok: 0, failed: 0 },
      platforms: [],
      records: [],
      upstreamError: error && error.message ? error.message : String(error),
      upstreamFailed: true,
    });
  }
}

async function handleCheckin(req, res, url) {
  try {
    // `accountId` 形如 `workbuddy:<上游账号 id>`，按前缀分派到对应平台。
    const composite = url.searchParams.get('accountId') || '';
    const sep = composite.indexOf(':');
    const sourceId = sep > 0 ? composite.slice(0, sep) : '';
    const rawId = sep > 0 ? composite.slice(sep + 1) : composite;

    const source = PLATFORM_SOURCES.find((s) => s.id === sourceId);
    if (!source || !source.checkinPath) {
      sendJson(res, 400, { ok: false, error: `未找到可签到的平台：${sourceId || '(未指定)'}` });
      return;
    }

    const target = new URL(`${getOrigin()}${source.checkinPath}`);
    if (rawId) target.searchParams.set('accountId', rawId);

    const response = await fetch(target, { method: 'POST', headers: { accept: 'application/json' } });
    const text = await response.text();

    let dashboard = null;
    try {
      // 签到之后用户一定想看到新余额与新状态，这里直接重扫。
      const { accounts, sources, ledger } = await sample({ rescan: true });
      dashboard = buildDashboard(accounts, sources, ledger, Date.now());
    } catch {
      dashboard = null;
    }

    sendJson(res, response.ok ? 200 : response.status, {
      ok: response.ok,
      upstreamStatus: response.status,
      upstreamBody: text.slice(0, 2000),
      dashboard,
    });
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error && error.message ? error.message : String(error) });
  }
}

export const name = PLUGIN_ID;

/** 宿主注入的服务名是 `webServer`（大小写敏感），写错会一直卡在 pending。 */
export const inject = ['webServer'];

export function apply(ctx, config = {}) {
  const intervalMs = Number(config && config.sampleIntervalMs) || DEFAULT_SAMPLE_INTERVAL_MS;

  ctx.effect(() => {
    const server = ctx.get('webServer');
    setOriginFromServer(server);

    // 首次采样异步执行，不阻塞插件激活。
    sample().catch(() => {});

    const timer = setInterval(() => {
      setOriginFromServer(ctx.get('webServer'));
      sample().catch(() => {});
    }, intervalMs);
    if (typeof timer.unref === 'function') timer.unref();

    return () => clearInterval(timer);
  }, `${PLUGIN_ID}: sampler`);

  ctx.effect(() => {
    const server = ctx.get('webServer');
    if (!server || typeof server.register !== 'function') {
      console.warn(`[${PLUGIN_ID}] webServer 上没有 register，路由未注册`);
      return () => {};
    }
    setOriginFromServer(server);

    const handler = async (req, res) => {
      const url = new URL(req.url || '/', getOrigin());
      const pathname = url.pathname;

      if (pathname === DASHBOARD_PATH) {
        if (req.method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' });
        return handleDashboard(res, url);
      }

      if (pathname === CHECKIN_PATH) {
        if (req.method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' });
        return handleCheckin(req, res, url);
      }

      sendJson(res, 404, { error: 'not found' });
    };

    const disposers = [];
    for (const p of [DASHBOARD_PATH, CHECKIN_PATH]) {
      try {
        const dispose = server.register({ path: p, kind: 'exact', handler });
        if (typeof dispose === 'function') disposers.push(dispose);
      } catch (error) {
        console.warn(`[${PLUGIN_ID}] 注册路由 ${p} 失败:`, error && error.message ? error.message : error);
      }
    }

    return () => {
      for (const dispose of disposers) {
        try {
          dispose();
        } catch {
          /* ignore */
        }
      }
    };
  }, `${PLUGIN_ID}: routes`);
}
