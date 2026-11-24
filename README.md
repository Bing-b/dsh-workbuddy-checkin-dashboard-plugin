# dsh-checkin-dashboard

每日签到仪表盘 —— DeepSeek Harness (DSH) 插件。

把 `dsh-connect-workbuddy-models` 每天签到的结果，变成一页能看的数据面板：左侧导航一键打开，卡片看各账号余额与签到状态，表格看历史流水。

---

## 功能

- **左侧导航入口** —— 侧边栏「每日签到」一行，点击在主区域打开，与对话平级切换。
- **账号卡片** —— 每个账号一张卡：当前积分、今日领取状态、连续天数、「立即领取」按钮。
- **今日汇总** —— 今日获得积分、总积分余额、下次自动签到时间。
- **签到流水** —— 按「日期 + 账号」记录每次签到结果，可回看历史。
- **多平台架构** —— 平台接入写在配置表里（见下文），加新平台不用动采样、账本和前端。

## 依赖

必须同时启用上游插件，否则读不到数据：

| 包 | 作用 |
|---|---|
| [`dsh-connect-workbuddy-models`](https://github.com/DragonHorizon-xtihc/dsh-connect-workbuddy-models) | 真正执行签到、管理凭据、查余额 |

本插件**只调用它公开的 HTTP 接口**，不碰登录凭据、不读写它的文件：

```
GET  /plugins/dsh-connect-workbuddy-models/status
POST /plugins/dsh-connect-workbuddy-models/checkin
POST /plugins/dsh-connect-workbuddy-models/accounts/refresh
```

## 安装

### 1. 先安装上游插件

在 DSH 的插件市场里搜索并安装 `dsh-connect-workbuddy-models`，确认它处于**启用**状态。

### 2. 安装本插件

在 DSH 中打开 **Plugins → Add plugin**，选择本目录（或克隆到本地后的目录）。

安装完成后左上角会出现「每日签到」入口。

### 3. 验证

```powershell
# 换成本机 DSH 实际端口
curl "http://127.0.0.1:3080/plugins/dsh-checkin-dashboard/dashboard"
```

应返回 JSON，`accounts` 里能看到账号读数。

## 数据存放

| 内容 | 位置 | 是否入库 |
|---|---|---|
| 签到流水账本 | `$DSH_HOME/dsh-checkin-dashboard/ledger.json` | ❌ 已在 `.gitignore` 中排除 |
| 插件代码 | 本目录 | ✅ |

**账本里含真实账号名、账号 ID、余额**，属于本机私有数据，**不要提交到仓库**。

## 接入新平台

在 `index.js` 的 `PLATFORM_SOURCES` 里加一条即可：

```js
{
  id: 'trae',
  label: 'Trae',
  statusPath:  '/plugins/dsh-connect-trae-models/status',
  refreshPath: '/plugins/dsh-connect-trae-models/accounts/refresh',
  checkinPath: '/plugins/dsh-connect-trae-models/checkin',
  adapt(raw, sampledAtMs) {
    // 把该平台的字段折成本插件统一的账号形状
    return (raw.accounts || []).map((a) => ({
      id: `trae:${a.id}`,          // 必须带平台前缀，避免跨平台撞号
      name: a.name,
      platform: 'trae',
      platformLabel: 'Trae',
      region: 'cn',
      balance: Number(a.total) || 0,
      checkedIn: Boolean(a.todayCheckedIn),
      credit: Number(a.earnedToday) || 0,
      streakDays: Number(a.streakDays) || 0,
      perDayCredit: 0,
      claimable: Boolean(a.active),
      claimText: String(a.buttonText || ''),
    }));
  },
}
```

采样、账本、路由、前端**都不用改** —— 它们只认统一形状。

**注意**：`id` 必须带 `<平台>:` 前缀。幂等键是 `日期:账号`，前缀变化会让同一天的记录被算成两条（历史教训，见 `migrateRecords()` 的注释）。

## 提交前检查

仓库带一个敏感信息扫描脚本：

```powershell
# 只查 git 会提交的文件
powershell -NoProfile -ExecutionPolicy Bypass -File .\check-sensitive.ps1

# 查所有文件
powershell -NoProfile -ExecutionPolicy Bypass -File .\check-sensitive.ps1 -All
```

会拦住：账号 ID（12 位以上十六进制）、`sk-` 密钥、Bearer 凭据、硬编码密码、私钥、手机号。

**安装为 git 钩子（一次性）：**

```powershell
@'
#!/bin/sh
powershell -NoProfile -ExecutionPolicy Bypass -File "$(git rev-parse --show-toplevel)/check-sensitive.ps1" || exit 1
'@ | Out-File -Encoding ascii -NoNewline .git/hooks/pre-commit
```

之后每次 `git commit` 都会先扫描，发现问题直接拒绝提交。

## 已知限制

| 限制 | 原因 |
|---|---|
| 历史流水从安装那天开始 | 上游不保存每日历史，只能靠本插件轮询累积 |
| 不提供用量统计与成本估算 | 上游没有公开相关接口，本插件不伪造数字 |
| 只统计 WorkBuddy | Trae / Qoder 需要各自的签到插件提供接口 |
| 换电脑需重新安装 | DSH 的 `link:` 是绝对路径，属正常流程 |

## 文件结构

```
checkin-dashboard-plugin/
├── index.js              Host 半区：数据聚合、账本、HTTP 路由
├── client.js             浏览器半区：侧边栏入口 + 仪表盘页面
├── cordis.patch.yml      加载条目（缺了插件不会激活）
├── package.json          清单：dsh.bundle / dsh.client / locale / icon
├── locale/zh.json,en.json  插件标题、描述
├── docs/DETAIL.md        插件详情页
├── icon.svg              插件图标
├── check-sensitive.ps1   提交前敏感信息扫描
└── .gitignore
```

## License

MIT
