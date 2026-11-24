/**
 * 每日签到仪表盘 —— 浏览器半区。
 *
 * 只做两件事：
 *   1. 往 `sidebar.panellist` 注册一个左侧导航行（图标 + 文案）；
 *   2. 往主区域 `main` 的 keyed 槽注册同 id 的面板页面。
 *
 * 侧边栏点击只负责切换「选中面板」，不自己弹窗，因此布局、宽度、折叠
 * 全交给宿主 shell —— 插件不写 DOM、不动 body。
 */
window.__ModuleLoader__.load({
  id: 'dsh-checkin-dashboard',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    /** 面板 id：左侧导航行与主区域页面共用这一个键。 */
    const PANEL_ID = 'checkin-dashboard';

    /** locale 命名空间与文案；键名用于 `t()`，界面里所有可见文字都走这里。 */
    const LOCALE_NS = 'checkinDashboard';
    const zh = {
      'panel.label': '每日签到',
      'page.title': '每日签到',
      'page.subtitle': '每天一键领取 WorkBuddy 各账号的签到积分，自动记录余额与签到流水',
      'page.sampledAt': '最近一次采样 {time} · 自动签到{state}',
      'page.on': '已开启',
      'page.off': '已关闭',
      'page.loading': '正在读取签到状态…',
      'page.refresh': '刷新',
      'page.checkinAll': '全部签到',
      'page.checkingIn': '签到中…',
      'summary.todayCredit': '今日获得积分',
      'summary.checkedAccounts': '{done}/{total} 个账号已签',
      'summary.balance': '总积分余额',
      'summary.balanceSub': '所有账号合计',
      'summary.nextRun': '下次自动签到',
      'summary.nextRunSub': '北京时间整点',
      'summary.autoOff': '自动签到已关闭',
      'account.todayClaim': '今日领取',
      'account.claimed': '已领取',
      'account.claimedNoAmount': '今日已签到（上游未回填本次所得）',
      'account.notClaimed': '未领取',
      'account.claim': '立即领取',
      'account.creditUnit': '积分',
      'account.gained': '今日获得 {credit} 积分',
      'account.gainedStreak': '今日获得 {credit} 积分，连续 {days} 天',
      'account.claimable': '可领取 {credit} 积分',
      'account.noActivity': '上游今日没有可领取的签到活动',
      'history.title': '签到流水',
      'history.empty': '还没有流水记录，插件会每 10 分钟采样一次。',
      'history.time': '时间',
      'history.account': '账号',
      'history.result': '结果',
      'history.credit': '本次获得',
      'history.balance': '余额',
      'history.message': '说明',
      'history.statusSuccess': '已领取',
      'history.statusSuccessUnknown': '已签到',
      'history.creditUnknown': '未知',
      'history.statusPending': '未领取',
      'error.upstream': '上游插件不可达：{message}。请确认 dsh-connect-workbuddy-models 已启用。',
      'empty.accounts': '暂无账号数据。',
      'dep.title': '缺少依赖插件，暂时读不到签到数据',
      'dep.desc': '本插件只负责展示，真正的签到与积分查询由 {pkg} 完成。',
      'dep.step1': '打开左侧「插件」页面（或按快捷键打开插件市场）',
      'dep.step2': '搜索并安装 {pkg}',
      'dep.step3': '确认它处于「已启用」状态，然后点下面的按钮重试',
      'dep.retry': '我已启用，重试',
    };
    const en = {
      'panel.label': 'Check-in',
      'page.title': 'Daily check-in',
      'page.subtitle': 'Claim daily check-in credits for every WorkBuddy account in one click, with balances and history recorded automatically',
      'page.sampledAt': 'Sampled {time} · auto check-in {state}',
      'page.on': 'on',
      'page.off': 'off',
      'page.loading': 'Reading check-in status…',
      'page.refresh': 'Refresh',
      'page.checkinAll': 'Check in all',
      'page.checkingIn': 'Checking in…',
      'summary.todayCredit': 'Credits today',
      'summary.checkedAccounts': '{done}/{total} accounts checked in',
      'summary.balance': 'Total balance',
      'summary.balanceSub': 'All accounts',
      'summary.nextRun': 'Next auto check-in',
      'summary.nextRunSub': 'Beijing time, on the hour',
      'summary.autoOff': 'Auto check-in is off',
      'account.todayClaim': "Today's claim",
      'account.claimed': 'Claimed',
      'account.claimedNoAmount': 'Checked in today (upstream did not report the amount)',
      'account.notClaimed': 'Not claimed',
      'account.claim': 'Claim now',
      'account.creditUnit': 'credits',
      'account.gained': 'Earned {credit} credits today',
      'account.gainedStreak': 'Earned {credit} credits today, {days}-day streak',
      'account.claimable': '{credit} credits available',
      'account.noActivity': 'No claimable check-in activity upstream today',
      'history.title': 'Check-in history',
      'history.empty': 'No history yet; the plugin samples every 10 minutes.',
      'history.time': 'Time',
      'history.account': 'Account',
      'history.result': 'Result',
      'history.credit': 'Earned',
      'history.balance': 'Balance',
      'history.message': 'Message',
      'history.statusSuccess': 'Claimed',
      'history.statusSuccessUnknown': 'Checked in',
      'history.creditUnknown': 'unknown',
      'history.statusPending': 'Pending',
      'error.upstream': 'Upstream plugin unreachable: {message}. Verify dsh-connect-workbuddy-models is enabled.',
      'empty.accounts': 'No accounts yet.',
      'dep.title': 'A required plugin is missing, so there is no check-in data yet',
      'dep.desc': 'This plugin only presents data; the actual check-in and credit queries are done by {pkg}.',
      'dep.step1': 'Open the Plugins page from the left sidebar',
      'dep.step2': 'Search for and install {pkg}',
      'dep.step3': 'Make sure it is enabled, then press the button below',
      'dep.retry': 'It is enabled now, retry',
    };

    /** 极简模板替换，避免为了 `{name}` 占位引入额外依赖。 */
    const makeT = (dict, fallback) => (key, params) => {
      const template = dict[key] || fallback[key] || key;
      if (!params) return template;
      return template.replace(/\{(\w+)\}/g, (whole, name) => (name in params ? String(params[name]) : whole));
    };

    const DASHBOARD_URL = '/plugins/dsh-checkin-dashboard/dashboard';
    const CHECKIN_URL = '/plugins/dsh-checkin-dashboard/checkin';

    /** 主题令牌同时给出回退值，宿主令牌改名时界面不会塌成黑块。 */
    const C = {
      bgLayer2: 'var(--dsw-alias-bg-layer-2, #ffffff)',
      bgLayer3: 'var(--dsw-alias-bg-layer-3, #f7f8fa)',
      border: 'var(--dsw-alias-border-l2, #e5e7eb)',
      labelPrimary: 'var(--dsw-alias-label-primary, #111827)',
      labelSecondary: 'var(--dsw-alias-label-secondary, #4b5563)',
      labelTertiary: 'var(--dsw-alias-label-tertiary, #9ca3af)',
      labelSuccess: 'var(--dsw-alias-label-success, #16a34a)',
      labelDanger: 'var(--dsw-alias-label-danger, #dc2626)',
      labelWarning: 'var(--dsw-alias-label-warning, #d97706)',
      brand: 'var(--dsw-alias-brand-primary, #2563eb)',
    };

    const fmtTime = (ms) => {
      if (!ms) return '—';
      const d = new Date(ms);
      const pad = (n) => String(n).padStart(2, '0');
      return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };

    const fmtDay = (day) => String(day || '').slice(5);

    /** 侧边栏行与折叠态共用的图标。 */
    function SidebarIcon(props) {
      const size = (props && props.size) || 16;
      return h(
        'svg',
        {
          viewBox: '0 0 24 24',
          width: size,
          height: size,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.8,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
          style: { display: 'block' },
        },
        h('rect', { x: 3, y: 4, width: 18, height: 17, rx: 3 }),
        h('path', { d: 'M3 9h18' }),
        h('path', { d: 'M8 13v4M12 12v5M16 14v3' }),
      );
    }

    /** 小圆点状态徽标。 */
    function StatusPill(props) {
      const ok = props.ok;
      const text = props.text;
      return h(
        'span',
        {
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '2px 8px',
            borderRadius: 999,
            fontSize: 12,
            fontWeight: 500,
            color: ok ? C.labelSuccess : C.labelDanger,
            background: ok ? 'rgba(22,163,74,.10)' : 'rgba(220,38,38,.10)',
            border: `1px solid ${ok ? 'rgba(22,163,74,.25)' : 'rgba(220,38,38,.25)'}`,
          },
        },
        h('span', { style: { width: 6, height: 6, borderRadius: 999, background: 'currentColor' } }),
        text,
      );
    }

    function Card(props) {
      return h(
        'div',
        {
          style: {
            background: C.bgLayer2,
            border: `1px solid ${C.border}`,
            borderRadius: 12,
            padding: 16,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            ...(props.style || {}),
          },
        },
        props.children,
      );
    }

    function AccountCard(props) {
      const a = props.account;
      const busy = props.busy;
      const t = props.t;
      return h(
        Card,
        null,
        h(
          'div',
          { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 } },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0 } },
            h('span', { style: { fontWeight: 600, fontSize: 14, color: C.labelPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, a.name),
            h('span', { style: { fontSize: 12, color: C.labelTertiary } }, a.region),
          ),
          h('button',
            {
              type: 'button',
              disabled: busy || !a.claimable,
              onClick: () => props.onCheckin(a.id),
              style: {
                flexShrink: 0,
                padding: '4px 10px',
                fontSize: 12,
                borderRadius: 8,
                border: `1px solid ${a.checkedIn ? C.border : C.labelSuccess}`,
                background: a.checkedIn ? 'transparent' : 'rgba(22,163,74,.10)',
                color: a.checkedIn ? C.labelTertiary : C.labelSuccess,
                cursor: busy || !a.claimable ? 'default' : 'pointer',
              },
            },
            a.checkedIn ? t('account.claimed') : busy ? t('page.checkingIn') : t('account.claim'),
          ),
        ),
        h(
          'div',
          { style: { display: 'flex', alignItems: 'baseline', gap: 6 } },
          h('span', { style: { fontSize: 30, fontWeight: 700, color: C.labelPrimary, letterSpacing: '-0.5px' } }, String(a.balance)),
          h('span', { style: { fontSize: 12, color: C.labelTertiary } }, t('account.creditUnit')),
        ),
        h(
          'div',
          { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 } },
          h('span', { style: { fontSize: 12, color: C.labelSecondary } }, t('account.todayClaim')),
          h(StatusPill, { ok: a.checkedIn, text: a.checkedIn ? (a.todayCredit > 0 ? `+${a.todayCredit}` : t('account.claimed')) : t('account.notClaimed') }),
        ),
        h(
          'div',
          { style: { fontSize: 12, color: C.labelTertiary, lineHeight: 1.5 } },
          a.checkedIn
            ? a.todayCredit > 0
              ? a.streakDays
                ? t('account.gainedStreak', { credit: a.todayCredit, days: a.streakDays })
                : t('account.gained', { credit: a.todayCredit })
              : t('account.claimedNoAmount')
            : a.claimable
              ? t('account.claimable', { credit: a.perDayCredit || 0 })
              : t('account.noActivity'),
        ),
      );
    }

    function Summary(props) {
      const d = props.data;
      const t = props.t;
      const items = [
        {
          label: t('summary.todayCredit'),
          value: `+${d.totals.todayCredit}`,
          sub: t('summary.checkedAccounts', { done: d.totals.checkedInCount, total: d.totals.accountCount }),
        },
        { label: t('summary.balance'), value: String(d.totals.balance), sub: t('summary.balanceSub') },
        {
          label: t('summary.nextRun'),
          value: (d.automation.checkinHours || []).join(' / ') || '—',
          sub: d.automation.enabled ? t('summary.nextRunSub') : t('summary.autoOff'),
        },
      ];
      return h(
        'div',
        { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 } },
        items.map((item) =>
          h(
            Card,
            { key: item.label },
            h('div', { style: { fontSize: 12, color: C.labelSecondary } }, item.label),
            h('div', { style: { fontSize: 26, fontWeight: 700, color: C.labelPrimary } }, item.value),
            h('div', { style: { fontSize: 12, color: C.labelTertiary } }, item.sub),
          ),
        ),
      );
    }

    function HistoryTable(props) {
      const rows = props.rows;
      const t = props.t;
      if (!rows.length) {
        return h(Card, null, h('div', { style: { fontSize: 13, color: C.labelTertiary } }, t('history.empty')));
      }
      const cell = (text, style) => h('td', { style: { padding: '8px 10px', fontSize: 13, color: C.labelSecondary, ...(style || {}) } }, text);
      const columns = [
        t('history.time'),
        t('history.account'),
        t('history.result'),
        t('history.credit'),
        t('history.balance'),
        t('history.message'),
      ];
      return h(
        'div',
        { style: { background: C.bgLayer2, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' } },
        h(
          'table',
          { style: { width: '100%', borderCollapse: 'collapse' } },
          h(
            'thead',
            null,
            h(
              'tr',
              { style: { background: C.bgLayer3 } },
              columns.map((label) =>
                h('th', { key: label, style: { textAlign: 'left', padding: '8px 10px', fontSize: 12, fontWeight: 500, color: C.labelTertiary } }, label),
              ),
            ),
          ),
          h(
            'tbody',
            null,
            rows.map((r) =>
              h(
                'tr',
                { key: r.id, style: { borderTop: `1px solid ${C.border}` } },
                cell(fmtDay(r.day) + ' ' + fmtTime(r.sampledAtMs).slice(6)),
                cell(r.accountName, { color: C.labelPrimary }),
                h(
                  'td',
                  { style: { padding: '8px 10px' } },
                  h(StatusPill, {
                    ok: r.status !== 'pending',
                    text:
                      r.status === 'success'
                        ? r.creditKnown
                          ? t('history.statusSuccess')
                          : t('history.statusSuccessUnknown')
                        : t('history.statusPending'),
                  }),
                ),
                cell(
                  r.credit > 0 ? `+${r.credit}` : r.creditKnown === false ? t('history.creditUnknown') : '—',
                  { color: r.credit > 0 ? C.labelSuccess : C.labelTertiary },
                ),
                cell(String(r.balance)),
                cell(r.message, { color: C.labelTertiary }),
              ),
            ),
          ),
        ),
      );
    }

    /**
     * 依赖缺失引导条。
     *
     * 本插件只读上游插件的 HTTP 接口，无法自己装它、也不该擅自改用户的 profile 配置，
     * 所以上游没启用时只能给出明确的操作指引，并说明「装好后会怎样」。
     */
    function DependencyBanner(props) {
      const t = props.t;
      const first = props.missing[0];
      return h(
        'div',
        {
          style: {
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            padding: '14px 16px',
            borderRadius: 10,
            background: 'rgba(217,119,6,.10)',
            border: '1px solid rgba(217,119,6,.35)',
          },
        },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          h('span', { style: { fontSize: 16 } }, '⚠️'),
          h('strong', { style: { fontSize: 13.5, color: C.labelWarning } }, t('dep.title')),
        ),
        h(
          'div',
          { style: { fontSize: 12.5, color: C.labelSecondary, lineHeight: 1.6 } },
          t('dep.desc', { pkg: first.name }),
        ),
        h(
          'ol',
          { style: { margin: 0, paddingLeft: 20, fontSize: 12.5, color: C.labelSecondary, lineHeight: 1.8 } },
          h('li', null, t('dep.step1')),
          h('li', null, t('dep.step2', { pkg: first.name })),
          h('li', null, t('dep.step3')),
        ),
        h(
          'div',
          { style: { display: 'flex', gap: 8, marginTop: 2 } },
          h(
            'button',
            {
              type: 'button',
              onClick: props.onRetry,
              style: {
                padding: '6px 14px',
                fontSize: 12.5,
                borderRadius: 8,
                border: `1px solid ${C.labelWarning}`,
                background: 'transparent',
                color: C.labelWarning,
                cursor: 'pointer',
              },
            },
            t('dep.retry'),
          ),
          h(
            'code',
            {
              style: {
                padding: '6px 10px',
                fontSize: 12,
                borderRadius: 8,
                background: C.bgLayer3,
                border: `1px solid ${C.border}`,
                color: C.labelSecondary,
                fontFamily: 'Consolas, monospace',
              },
            },
            first.installSpec || first.name,
          ),
        ),
      );
    }

    function DashboardPage(props) {
      const t = props.t;
      const [state, setState] = React.useState({ loading: true, data: null, error: null });
      const [busyId, setBusyId] = React.useState(null);

      const load = React.useCallback(async (withRefresh) => {
        try {
          // `refresh=1` 让 Host 半区先让上游重扫余额与签到，绕开它 10 分钟的余额缓存。
          const target = withRefresh ? `${DASHBOARD_URL}?refresh=1` : DASHBOARD_URL;
          const response = await fetch(target, { headers: { accept: 'application/json' }, credentials: 'same-origin' });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const data = await response.json();
          setState({ loading: false, data, error: data.upstreamError || null });
        } catch (error) {
          setState({ loading: false, data: null, error: error && error.message ? error.message : String(error) });
        }
      }, []);

      React.useEffect(() => {
        // 首次打开要读最新数字，之后每分钟读缓存，避免频繁打扰上游。
        load(true);
        const timer = setInterval(() => load(false), 60 * 1000);
        return () => clearInterval(timer);
      }, [load]);

      const checkin = React.useCallback(
        async (accountId) => {
          setBusyId(accountId || 'all');
          try {
            await fetch(`${CHECKIN_URL}?accountId=${encodeURIComponent(accountId || '')}`, {
              method: 'POST',
              credentials: 'same-origin',
            });
          } catch {
            /* 失败时下面统一重读状态，错误由 dashboard 的 upstreamError 体现 */
          } finally {
            await load(true);
            setBusyId(null);
          }
        },
        [load],
      );

      const data = state.data;

      return h(
        'div',
        {
          style: {
            height: '100%',
            overflow: 'auto',
            padding: '24px 28px 40px',
            background: C.bgLayer3,
            color: C.labelPrimary,
            fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
          },
        },
        h(
          'div',
          { style: { maxWidth: 1100, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 } },
          h(
            'div',
            { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' } },
            h(
              'div',
              null,
              h('h1', { style: { margin: 0, fontSize: 24, fontWeight: 700 } }, t('page.title')),
              h(
                'p',
                { style: { margin: '4px 0 0', fontSize: 12.5, color: C.labelTertiary, lineHeight: 1.5 } },
                t('page.subtitle'),
              ),
              h(
                'p',
                { style: { margin: '6px 0 0', fontSize: 13, color: C.labelSecondary } },
                data
                  ? t('page.sampledAt', {
                      time: fmtTime(data.lastSampleAtMs || data.sampledAtMs),
                      state: data.automation.enabled ? t('page.on') : t('page.off'),
                    })
                  : t('page.loading'),
              ),
            ),
            h(
              'div',
              { style: { display: 'flex', gap: 8 } },
              h(
                'button',
                {
                  type: 'button',
                  onClick: () => checkin(null),
                  disabled: busyId !== null,
                  style: {
                    padding: '8px 14px',
                    fontSize: 13,
                    borderRadius: 8,
                    border: `1px solid ${C.labelSuccess}`,
                    background: 'rgba(22,163,74,.10)',
                    color: C.labelSuccess,
                    cursor: busyId !== null ? 'default' : 'pointer',
                  },
                },
                busyId === 'all' ? t('page.checkingIn') : t('page.checkinAll'),
              ),
              h(
                'button',
                {
                  type: 'button',
                  onClick: () => load(true),
                  style: {
                    padding: '8px 14px',
                    fontSize: 13,
                    borderRadius: 8,
                    border: `1px solid ${C.border}`,
                    background: C.bgLayer2,
                    color: C.labelSecondary,
                    cursor: 'pointer',
                  },
                },
                t('page.refresh'),
              ),
            ),
          ),

          state.error
            ? h(
                'div',
                {
                  style: {
                    padding: '10px 14px',
                    borderRadius: 10,
                    fontSize: 13,
                    color: C.labelWarning,
                    background: 'rgba(217,119,6,.10)',
                    border: '1px solid rgba(217,119,6,.25)',
                  },
                },
                t('error.upstream', { message: state.error }),
              )
            : null,

          data && data.dependencies && data.dependencies.missing && data.dependencies.missing.length > 0
            ? h(DependencyBanner, { missing: data.dependencies.missing, onRetry: () => load(true), t })
            : null,

          data ? h(Summary, { data, t }) : null,

          data
            ? h(
                'div',
                { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 } },
                data.accounts.length
                  ? data.accounts.map((a) => h(AccountCard, { key: a.id, account: a, busy: busyId === a.id, onCheckin: checkin, t }))
                  : h(Card, null, h('div', { style: { fontSize: 13, color: C.labelTertiary } }, t('empty.accounts'))),
              )
            : null,

          data
            ? h(
                'div',
                { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
                h('h2', { style: { margin: 0, fontSize: 15, fontWeight: 600 } }, t('history.title')),
                h(HistoryTable, { rows: data.records, t }),
              )
            : null,
        ),
      );
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        // 文案注册到自己的命名空间；`t()` 从 locale 服务取，跟随界面语言切换。
        ctx.effect(() => ctx.locale.register(LOCALE_NS, { zh, en }), `${PANEL_ID}: locale`);
        const bound = ctx.locale.bind(LOCALE_NS);
        const t = (key, params) => {
          try {
            const value = typeof bound === 'function' ? bound(key, params) : undefined;
            if (typeof value === 'string' && value && value !== key) return value;
          } catch {
            /* 语言包缺失时退回内置文案 */
          }
          return makeT(zh, en)(key, params);
        };

        // 左侧导航行：图标 + 文案，点击由宿主切换主区域面板。
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            {
              name: 'sidebar.panellist',
              id: PANEL_ID,
              order: 20,
              label: () => t('panel.label'),
              inject: () => ({ t }),
            },
            SidebarIcon,
          ),
        );

        // 主区域面板页面：id 必须与导航行一致，宿主据此配对。
        ctx.slots.inject('main', () =>
          ctx.slots.register(
            {
              name: 'main',
              key: PANEL_ID,
              inject: () => ({ t }),
            },
            DashboardPage,
          ),
        );
      },
    };
  },
});
