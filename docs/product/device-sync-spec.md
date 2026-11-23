# EnglishPod 多端无账号进度同步技术规范

**文档编号**：EP-SYNC-001  
**版本**：v1.0  
**日期**：2026-11-23（UTC+08:00）  
**适用范围**：Flutter iOS / iPad、Flutter Android、Flutter Web（含 Tesla 车机）、微信小程序（并预留 HarmonyOS NEXT 客户端枚举）  
**关联基线**：[`docs/product/playback-behavior-contract.md`](playback-behavior-contract.md)（EP-PBC-001 v1.5）  
**规范仓库路径**：`docs/product/device-sync-spec.md`  
**文档状态**：设计规范已确认，通过文档 PR 纳入仓库；**不代表服务端已部署，也不代表各端已完成代码开发或真机验收**。

> **两种标注约定**：  
> - **`[P]`**：owner 在需求讨论中明确确认的产品规则与架构决策；调整 `[P]` 条款须经 owner 再次确认。  
> - **`[D]`**：为保证 `[P]` 语义在并发、离线、跨端场景下确定性落地而定义的技术与协议边界；可在保持外部行为等价前提下演进实现。

---

## 1. 产品目标、设计原则与非目标

### 1.1 核心定位 `[P]`
1. **无账号互联**：不引入手机号、邮箱、密码、验证码或第三方 OAuth 登录体系；采用类似微信输入法的「匿名同步组 + 扫码 / 8 位一次性设备码直接绑定」机制实现多端进度互通。
2. **全端互通且面向公网用户**：覆盖 Flutter（iOS / iPad / Android / Web / Tesla）与微信小程序，面向所有公网用户可用，并非仅限个人内网调试。
3. **云端异步自动同步**：绑定一次后，各设备独立联网自动增量拉取（Pull）与推送（Push），无需两台设备同时在线或处于同一局域网。
4. **仅同步学习进度**：跨端同步范围严格限定为每课完成态（`lessonCompleted`）、Podcast/Dialogue 双轨独立已提交断点及句索引、全局最近打开课程（`lastOpenedLessonId`）。播放偏好（倍速、单句循环、音轨循环、Web 沉浸模式、自动连播开关）保留在各设备本地，不跨端覆盖。
5. **不设恢复码**：采用纯设备间互相配对模型，只要用户手中仍保有任意 1 台已绑定设备即可继续添加新设备；全部设备卸载/清缓存则从新组开始，避免增加额外密钥保管负担。
6. **传输加密 + 服务端增量合并**：采用 HTTPS 传输与独立设备凭证，服务端明文存储无 PII 的课程编号/毫秒进度并执行字段级增量合并，不做端到端加密（E2EE）。

### 1.2 非目标边界 `[P]/[D]`
以下事项**明确不在**本规范范围内：
- 用户注册/登录、密码找回、云端永久恢复码、微信头像/昵称展示；
- 付费/VIP 权益跨端共享（微信小程序虚拟支付权益仍由现有微信云开发体系独立管理）；
- WebSocket / SSE 长连接毫秒级实时联动、纯局域网 P2P 直连；
- 微信主界面「扫一扫」直接拉起外部 H5 域名跳转（配对二维码仅限各端应用内扫一扫识别）；
- 同步课表静态元数据或音频文件。

---

## 2. 总体架构与 Go 服务端技术选型

### 2.1 网络拓扑与合规通路 `[P]`

针对「核心同步服务部署在现有自托管服务器，同时确保微信小程序线上合法域名合规」这一约束，采用**单一数据源 + 小程序极薄云函数网关代理**架构：

```text
┌───────────────────────────┐   ┌───────────────────────────┐   ┌───────────────────────────┐
│   Flutter iOS / iPad      │   │     Flutter Android       │   │   Flutter Web / Tesla     │
│  (扫码 + 输码 + 展码)      │   │    (扫码 + 输码 + 展码)    │   │      (展码 + 输码)        │
└─────────────┬─────────────┘   └─────────────┬─────────────┘   └─────────────┬─────────────┘
              │ HTTPS 直连                    │ HTTPS 直连                    │ HTTPS 直连
              └───────────────────────────────┼───────────────────────────────┘
                                              ▼
                       ┌──────────────────────────────────────────────┐
                       │         自托管同步节点 (<SYNC_HOST>)          │
                       │         Nginx 反向代理 /api/sync/v1/*         │
                       │                      │                       │
                       │         ep-syncd (Go 单二进制服务 :8787)      │
                       │         SQLite (WAL 模式, 单库热备)           │
                       └──────────────────────▲───────────────────────┘
                                              │ HTTPS + X-Gateway-Signature
                                              │ (含不可逆 HMAC 限流主体哈希)
                       ┌──────────────────────┴───────────────────────┐
                       │    腾讯云 CloudBase (<CLOUDBASE_ENV_ID>)      │
                       │    云函数 syncGateway (极薄白名单代理)         │
                       └──────────────────────▲───────────────────────┘
                                              │ wx.cloud.callFunction
                       ┌──────────────────────┴───────────────────────┐
                       │                  微信小程序                   │
                       │        (wx.scanCode + 输码 + Canvas 展码)     │
                       └──────────────────────────────────────────────┘
```

- **Flutter 全端（含后续 HarmonyOS NEXT）**：直接通过 HTTPS 访问 `https://<SYNC_HOST>/api/sync/v1/*`。
- **微信小程序通路 `[P]`**：通过已有腾讯云 CloudBase 环境新增 1 个极薄代理云函数 `syncGateway` 转发请求到 `<SYNC_HOST>`。云函数从服务端出网，不受小程序前端 `request` 合法域名与大陆 ICP 备案阻塞；未来若配置好已备案合法域名，小程序仅需替换底层网络传输适配器即可切为直连，API 契约与客户端状态机零改动。

### 2.2 Go 同步服务设计 (`sync_server/`) `[P]`

考虑到现有节点同时承载 Web 静态资源与音频分发，同步服务必须极度克制资源占用：
- **语言与框架**：Go 1.23+，优先使用标准库 `net/http`（利用 Go 1.22+ 方法与路径参数路由），避免重型框架依赖。
- **存储引擎**：嵌入式 SQLite（`modernc.org/sqlite` 纯 Go 无 CGO 或 `mattn/go-sqlite3`），无须额外部署独立数据库常驻进程。
  - 启动初始化强制执行：
    ```sql
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = 5000;
    PRAGMA foreign_keys = ON;
    ```
  - 写入连接池限制为 `SetMaxOpenConns(1)` 序列化事务写（配合 SQLite WAL 多读并发），彻底杜绝 `SQLITE_BUSY` 竞态。
- **部署与运维**：
  - 编译为单二进制 `ep-syncd`，通过 `systemd` 托管监听 `127.0.0.1:8787`，由现有 Nginx 反代 `/api/sync/v1/`（开启 TLS 1.2/1.3 与严格请求体上限 `client_max_body_size 64k`）。
  - 常驻内存目标控制在 **15–30 MB**，支持 `SIGTERM` 优雅停机与本机 `/healthz` 健康检查。
  - 配置每日 `systemd timer` 执行 `sqlite3 <db> ".backup '<backup_dir>/sync-YYYYMMDD.db'"` 在线热备，保留近 7 天快照。
  - 服务启动时加载内置静态 335 课 `lesson_id` 白名单（与 `processed_lessons/index.json` 及 `flutter_app/pubspec.yaml` 资源清单对齐，覆盖 `0001`–`0120` 与 `0151`–`0365`）。

---

## 3. 跨端统一数据模型与 SQLite 表设计

### 3.1 跨端规范同步模型（Canonical Sync Schema v1） `[D]`

目前仓库三端本地持久化格式存在历史差异（Flutter 原生使用秒级浮点、Web 契约播放器使用 `TrackRecord`、微信小程序使用毫秒整数 `TrackPoint`）。同步层在服务端与传输协议中使用唯一规范格式，各端在本地同步适配器层完成双向映射，**不要求改动或破坏既有本地存储键**：

| 语义字段 | Canonical Sync 字段 | Flutter 原生 (`main.dart`, `ep_study_progress_v1`) | Flutter Web (`web_contract_player.dart`, `ep_web_learning_v2`) | 微信小程序 (`learningRecord.ts`, `ep_learning_v2_*`) |
| --- | --- | --- | --- | --- |
| 课程完成态 | `lessonCompleted` (`bool`) | `isCompleted` | `completed` | `lessonCompleted` |
| PB 已提交断点 | `pb.positionMs` (`int ≥ 0`) | `round(pbPosSec * 1000)` | `round(tracks['pb'].position * 1000)` | `podcast.committedPositionMs` |
| PB 句索引 | `pb.segmentIndex` (`int?`) | `pbSegIdx` | 按时间轴推导或省略 | `podcast.committedSegmentIndex` |
| PB 时长缓存 | `pb.durationMs` (`int?`) | `round(pbDurSec * 1000)` | `round(tracks['pb'].duration * 1000)` | `podcast.durationMs` |
| DG 已提交断点 | `dg.positionMs` (`int ≥ 0`) | `round(dgPosSec * 1000)` | `round(tracks['dg'].position * 1000)` | `dialogue.committedPositionMs` |
| DG 句索引 | `dg.segmentIndex` (`int?`) | `dgSegIdx` | 按时间轴推导或省略 | `dialogue.committedSegmentIndex` |
| DG 时长缓存 | `dg.durationMs` (`int?`) | `round(dgDurSec * 1000)` | `round(tracks['dg'].duration * 1000)` | `dialogue.durationMs` |
| 恢复锚点 | `lastOpenedLessonId` (`string?`) | 当前最近打开课程 ID | `lastOpened` | `ResumeAnchor.lastOpenedLessonId` |

**本地轻量同步元数据键**（各端新增独立存储键，例如 Flutter 使用 `ep_sync_state_v1`，小程序使用 `ep_sync_v1_state`）：
- `groupId`、`deviceId`、`deviceToken`、`deviceName`、`platform`
- `lastServerSeq`（上次拉取到的全局单调游标）
- `clockOffsetMs`（最近响应推算的 `serverTimeMs - localNowMs`）
- `trackBaseSeq`（记录每课 `pb` / `dg` 上次已同步版本的 `baseSeq`，用于 §5 因果冲突裁决）
- `dirtyLessons`（离线或节流期间待推送的变更课/轨集合及本地更改时间戳）

### 3.2 SQLite 表结构 `[D]`

```sql
-- 1. 匿名同步组（无账号主表）
CREATE TABLE sync_groups (
  group_id              TEXT PRIMARY KEY,              -- UUIDv4
  server_seq            INTEGER NOT NULL DEFAULT 0,    -- 组内单调递增同步游标
  last_opened_lesson_id TEXT,                          -- 335 课白名单 ID 或 NULL
  last_opened_at_ms     INTEGER NOT NULL DEFAULT 0,    -- 钳位后的客户端时间戳
  last_opened_by        TEXT,                          -- 最近修改该字段的 device_id
  last_opened_seq       INTEGER NOT NULL DEFAULT 0,    -- 最近修改该字段时的 server_seq
  created_at_ms         INTEGER NOT NULL,
  updated_at_ms         INTEGER NOT NULL,
  orphaned_at_ms        INTEGER                        -- 活跃设备数归零时打标，7 天后清理
);

-- 2. 已绑定设备（每台设备独立凭证，支持精确解绑/踢除）
CREATE TABLE sync_devices (
  device_id       TEXT PRIMARY KEY,                    -- UUIDv4
  group_id        TEXT NOT NULL REFERENCES sync_groups(group_id) ON DELETE CASCADE,
  token_hash      TEXT NOT NULL UNIQUE,                -- hex(SHA-256(device_token))
  device_name     TEXT NOT NULL,                       -- ≤ 32 字符净化展示名
  platform        TEXT NOT NULL CHECK (
                    platform IN ('ios', 'ipad', 'android', 'web', 'wechat', 'harmonyos')
                  ),
  created_at_ms   INTEGER NOT NULL,
  last_seen_at_ms INTEGER NOT NULL,
  revoked_at_ms   INTEGER                              -- 非 NULL 表示已退出或被踢除
);

-- 3. 一次性配对票据（二维码与 8 位短码共用）
CREATE TABLE pairing_tickets (
  code_hash      TEXT PRIMARY KEY,                     -- hex(SHA-256(normalized_8char_code))
  group_id       TEXT NOT NULL REFERENCES sync_groups(group_id) ON DELETE CASCADE,
  created_by     TEXT NOT NULL,                        -- 发起设备 device_id
  created_at_ms  INTEGER NOT NULL,
  expires_at_ms  INTEGER NOT NULL,                     -- created_at_ms + 300_000 (5 分钟)
  consumed_at_ms INTEGER,                              -- 消费后立即写入，防重放
  consumed_by    TEXT                                  -- 新加入设备的 device_id
);

-- 4. 单课学习进度（单课单行，PB / DG / 完成态完全独立）
CREATE TABLE lesson_progress (
  group_id         TEXT NOT NULL REFERENCES sync_groups(group_id) ON DELETE CASCADE,
  lesson_id        TEXT NOT NULL,                      -- 严格校验 335 课白名单
  lesson_completed INTEGER NOT NULL DEFAULT 0,         -- 单向 OR：0 -> 1 不可逆
  completed_at_ms  INTEGER NOT NULL DEFAULT 0,

  pb_position_ms   INTEGER,                            -- NULL 表示从未提交过 PB 有效断点
  pb_segment_index INTEGER,
  pb_duration_ms   INTEGER,
  pb_updated_at_ms INTEGER NOT NULL DEFAULT 0,
  pb_updated_by    TEXT,
  pb_seq           INTEGER NOT NULL DEFAULT 0,

  dg_position_ms   INTEGER,                            -- NULL 表示从未提交过 DG 有效断点
  dg_segment_index INTEGER,
  dg_duration_ms   INTEGER,
  dg_updated_at_ms INTEGER NOT NULL DEFAULT 0,
  dg_updated_by    TEXT,
  dg_seq           INTEGER NOT NULL DEFAULT 0,

  seq              INTEGER NOT NULL,                   -- 本行最近一次任意字段变更的 server_seq
  PRIMARY KEY (group_id, lesson_id)
);

CREATE INDEX idx_lesson_progress_group_seq ON lesson_progress(group_id, seq);
CREATE INDEX idx_devices_group_active      ON sync_devices(group_id, revoked_at_ms);
CREATE INDEX idx_tickets_expires           ON pairing_tickets(expires_at_ms);
```

---

## 4. 微信输入法式配对与设备生命周期协议

### 4.1 二维码与 8 位设备码规范 `[P]`/`[D]`

- **二维码载荷格式**：固定采用应用内自定义 URI，不依赖外部 HTTPS 跳转：
  ```text
  epsync://v1/pair?c=K7M9P2XR
  ```
- **8 位易读设备码规范**：
  - 字符集采用去除视觉混淆字符（`0 / O / 1 / I / L`）的 31 进制字母数字表：`23456789ABCDEFGHJKMNPQRSTUVWXYZ`，组合空间为 $31^8 \approx 8.53 \times 10^{11}$。
  - 生成使用密码学安全随机源 `crypto/rand`，展示格式为 `XXXX-XXXX`（例如 `K7M9-P2XR`）。
  - 客户端与服务端解析输入时统一执行：去空格、去连字符 `-`、转大写，并兼容解析完整 `epsync://v1/pair?c=...` 字符串。
- **时效与确认规则 `[P]`**：
  - 票据有效期固定 **5 分钟（300 秒）**，**单次消费后立即失效**。
  - 鉴于 8 位高熵短码 + 5 分钟 TTL + 严格防爆破限流已提供充足安全性，**扫码或输码成功后直接绑定生效，无需发起端二次弹窗确认**，确保车载等场景单手操作顺滑。

### 4.2 配对时序 `[D]`

```text
  设备 A（发起端）                      ep-syncd (Go)                      设备 B（加入端）
        │                                     │                                  │
        │ 1. POST /pair/create                │                                  │
        │   (无 Token 时自动建组+注册 A)        │                                  │
        ├────────────────────────────────────>│                                  │
        │<────────────────────────────────────┤                                  │
        │   { code, expiresAtMs, deviceTokenA }                                  │
        │                                     │                                  │
        │ 2. (若为新组) 立即推送 A 本地进度     │                                  │
        │    POST /sync/push                  │                                  │
        ├────────────────────────────────────>│                                  │
        │                                     │                                  │
        │ [展示二维码 + XXXX-XXXX + 5m 倒计时]  │                                  │
        │ [每 2s 轮询 GET /pair/status]        │                                  │
        │                                     │      3. 扫码或输入 8 位设备码      │
        │                                     │<─────────────────────────────────┤
        │                                     │         POST /pair/claim         │
        │                                     │   (校验 TTL/未使用/设备上限<10)     │
        │                                     ├─────────────────────────────────>│
        │                                     │     { deviceTokenB, groupId }    │
        │                                     │                                  │
        │ 4. GET /pair/status 返回 consumed    │      5. B 推送自身历史进度做合并  │
        │    弹窗提示「已连接: B」并 pull       │<─────────────────────────────────┤
        │<────────────────────────────────────┤         POST /sync/push          │
        │                                     │      6. B 全量 pull(since_seq=0) │
        │                                     │<─────────────────────────────────┤
        │                                     ├─────────────────────────────────>│
```

1. **防误串组保护 `[D]`**：若设备 B 本地已绑定到一个同步组，UI 不允许直接输入/扫码加入另一组；用户必须先在弹窗中点击「退出当前同步组」完成解绑后，才可加入新组，防止两人设备误触导致进度永久混杂。
2. **首次双向无损合并 `[D]`**：B 加入组后**必须先推后拉**：先把 B 本地已有的学习记录增量提交给服务端执行字段级无损合并，再以 `since_seq=0` 拉回最终完整进度落盘，确保两边此前各自听过的课都不会丢失。

### 4.3 设备管理、踢除与孤儿清理 `[D]`

- **设备清单**：组内任意活跃设备可调用 `GET /devices` 查看同组所有未撤销设备（`deviceId`、`deviceName`、`platform`、`lastSeenAtMs`、`isCurrent`），单组活跃设备上限 **10 台**（超限返回 `409 GROUP_FULL`）。
- **解绑与踢除**：
  - 用户可在任意设备上移除其他设备或退出本机（`DELETE /devices/:deviceId`）。
  - 服务端对目标设备置 `revoked_at_ms = now`，其 `device_token` 立即失效。
  - 被踢设备下次同步遇到 `401 DEVICE_REVOKED` 时：**仅清除本地同步凭证，温和提示「同步连接已断开，本地学习记录已保留」，绝不删除或清空本地任何课程进度**。
- **孤儿组清理**：当一组最后一台活跃设备被撤销（活跃数归零），置 `orphaned_at_ms = now`。每日后台清理任务物理删除 `orphaned_at_ms` 超过 7 天的孤儿组，以及超过 180 天无任何访问且仅剩 1 台设备的长期休眠组，防止 SQLite 无限膨胀。

---

## 5. 冲突合并算法与 EP-PBC-001 v1.5 严格对齐

### 5.1 服务端事务级合并规则 `[D]`

每次 `POST /sync/push` 在单一 `BEGIN IMMEDIATE` SQLite 事务内按字段独立裁决，单条记录不同字段互不覆盖：

1. **时间戳校时与防时钟漂移钳位**：
   - 所有响应均包含当前服务端时间戳 `serverTimeMs`。客户端每次收到响应更新本地偏差 `clockOffsetMs = serverTimeMs - localNowMs`，推送时将事件时间折算为校准时间 `clientUpdatedAtMs`。
   - 服务端额外执行防异常时钟钳位：`clampedTs = clamp(incomingTs, serverNow - 365天, serverNow + 30秒)`，杜绝某台设备系统时间错调至未来年份（如 2099 年）永久锁死整组进度。
2. **`lessonCompleted`（单向逻辑或）**：
   - `mergedCompleted = server.lesson_completed || incoming.lessonCompleted`
   - 严格遵守 EP-PBC-001 §3.1：一旦任意设备通过正常播放跨过 95% 或自然结束达成完成态，合并结果永久保持完成，永不因其他设备重听或未听而撤销。
3. **`pb` / `dg` 断点（独立轨道 + 因果 `baseSeq` 优先）**：
   - 同一课的 PB 与 DG 分别独立维护 `updated_at_ms` 与 `seq`，互不覆盖。
   - 对任一音轨 `T ∈ {pb, dg}` 收到变更 `(incomingPoint, baseSeq, clampedTs)` 时：
     1. 若服务端该轨尚无记录（`pb_position_ms IS NULL`）→ **直接采纳**；
     2. **因果优先**：若 `baseSeq >= server.track_seq`（说明推送方此前已同步到服务端当前最新版本的该轨断点，本次属于在已知状态上的严格后续推进）→ **直接采纳**（彻底消除设备间几秒时钟偏差导致新收听进度被拒）；
     3. **并发离线冲突**（`baseSeq < server.track_seq`，两台设备离线状态下各自听了同一课同一轨）→ 比较时间戳：`clampedTs > server.track_updated_at_ms` 采纳客户端；若毫秒完全相等，取 `positionMs` 更大者（再相等取 `deviceId` 字典序较大者），保证全组收敛结果 100% 确定性。
4. **`lastOpenedLessonId`（全局恢复锚点）**：
   - 同样采用 `baseSeq >= server.last_opened_seq` 因果优先，并发离线时按钳位后的 `lastOpenedAtMs` 较新者胜出。

### 5.2 EP-PBC-001 v1.5 语义保护红线 `[P]`/`[D]`

1. **00:00 不污染云端（EP-PBC-001 §4.1.2）**：
   - 只有本地已经按 EP-PBC-001 提交落盘的有效断点（Committed Position）才有资格进入 `dirtyLessons` 推送队列。
   - 手动上一课/下一课进入课程时临时置于 `00:00` 的播放头（`pendingUncommittedStartFromZero`）若未真正播放推进且未显式 Seek，**严禁推送到服务端**，避免把其他设备上保存的 08:45 断点清零。
2. **播放中不打断（EP-PBC-001 §2.2 / E14）**：
   - 当拉取到远端更新时，若本机当前处于课程列表（静音态），立即更新本地存储并刷新「继续收听」卡片与各课进度条；
   - 若本机**正在播放或暂停在某课播放器内**：其他课的远端更新静默合并落盘；针对当前正在会话中的同一课同一轨，**绝不强行 Seek 跳动或重置用户当前正在收听的实时播放头**，待用户切课或退回课程列表后再自然收敛。

### 5.3 同步触发时机与节流策略 `[D]`

| 同步方向 | 触发时机 | 行为说明 |
| --- | --- | --- |
| **Pull**（增量拉取） | 冷启动进入课程列表 | 请求 `GET /sync/pull?since_seq=N`，与本地状态合并后刷新列表与继续收听卡片 |
| **Pull** | App/小程序回前台、Web `visibilitychange` 可见 | 若距上次拉取 ≥ 10s 自动增量拉取 |
| **Pull** | 播放器退回课程列表、弹窗手动点击「立即同步」 | 立即拉取最新增量 |
| **Push**（增量推送） | 暂停、显式 Seek（防抖 2s）、触发完课（立即） | 仅提交 `dirtyLessons` 中的真实变更课/轨，**绝不每 3 秒请求服务端** |
| **Push** | 切课/切轨前、退回课程列表、App 退后台/页面隐藏 | 立即推送；Web 端退后台优先使用 `fetch(..., { keepalive: true })` |
| **Push** | 连续播放心跳 | 播放持续进行中每 **45 秒** 推送一次有效断点，兼顾车机意外断电恢复与服务端低负载 |

> 离线状态下所有变更静默累积在本地 `dirtyLessons` 并随每次本地保存持久化；一旦网络恢复且触发任意 Push/Pull 时机，优先补推本地脏数据再拉取远端增量。

---

## 6. REST API 契约与小程序 `syncGateway` 代理规范

### 6.1 API 端点清单（统一前缀 `/api/sync/v1`） `[D]`

所有请求与响应 `Content-Type: application/json`，所有成功及错误响应统一包含 `serverTimeMs` 字段用于客户端校准时钟。

| 方法与路径 | 鉴权 | 核心用途 |
| --- | --- | --- |
| `POST /api/sync/v1/pair/create` | 可选 `Bearer <deviceToken>` | 生成 5 分钟一次性 8 位配对码；无 Token 时原子创建新组并签发 `deviceToken` |
| `GET /api/sync/v1/pair/status?code=<8位码>` | `Bearer <deviceToken>`（发起设备） | 配对弹窗每 2s 轮询票据状态（`pending` / `consumed` / `expired`） |
| `POST /api/sync/v1/pair/claim` | 无（强限流保护） | 扫码/输码消费票据加入同步组，返回 `deviceToken`、`groupId`、`devices` |
| `POST /api/sync/v1/sync/push` | `Bearer <deviceToken>` | 提交增量变更（`lessons[]` 与可选 `lastOpened`），返回最新 `serverSeq` 与冲突裁决结果 |
| `GET /api/sync/v1/sync/pull?since_seq=N` | `Bearer <deviceToken>` | 增量拉取 `seq > N` 的全部课程记录与最新 `lastOpened`（`N=0` 即全量同步） |
| `GET /api/sync/v1/devices` | `Bearer <deviceToken>` | 查询当前同步组活跃设备列表 |
| `PATCH /api/sync/v1/devices/me` | `Bearer <deviceToken>` | 修改当前设备显示名称 |
| `DELETE /api/sync/v1/devices/:deviceId` | `Bearer <deviceToken>` | 解绑当前设备或踢除组内指定设备 |

#### 关键请求 / 响应载荷示例

**1. `POST /api/sync/v1/pair/create`**
```json
// Request（首次创建组时无需 Authorization）
{
  "deviceName": "iPhone 17",
  "platform": "ios"
}

// Response 200
{
  "serverTimeMs": 1795400000000,
  "groupId": "b6d9f1a4-3f6c-4a67-8e9a-24b5d1c0c910",
  "deviceId": "8f2a9c10-...",
  "deviceToken": "<仅首次建组时返回>",
  "code": "K7M9P2XR",
  "displayCode": "K7M9-P2XR",
  "qrPayload": "epsync://v1/pair?c=K7M9P2XR",
  "expiresAtMs": 1795400300000
}
```

**2. `POST /api/sync/v1/pair/claim`**
```json
// Request
{
  "code": "K7M9-P2XR",
  "deviceName": "Tesla Web",
  "platform": "web"
}

// Response 200
{
  "serverTimeMs": 1795400020000,
  "groupId": "b6d9f1a4-3f6c-4a67-8e9a-24b5d1c0c910",
  "deviceId": "2d91f7a3-...",
  "deviceToken": "<64-hex-256bit-secret>",
  "serverSeq": 14,
  "devices": [
    { "deviceId": "8f2a9c10-...", "deviceName": "iPhone 17", "platform": "ios", "lastSeenAtMs": 1795400010000, "isCurrent": false },
    { "deviceId": "2d91f7a3-...", "deviceName": "Tesla Web", "platform": "web", "lastSeenAtMs": 1795400020000, "isCurrent": true }
  ]
}
```

**3. `POST /api/sync/v1/sync/push`**
```json
// Request
{
  "lessons": [
    {
      "lessonId": "0012",
      "lessonCompleted": false,
      "pb": {
        "positionMs": 525000,
        "segmentIndex": 48,
        "durationMs": 790000,
        "updatedAtMs": 1795400100000,
        "baseSeq": 14
      }
    }
  ],
  "lastOpened": {
    "lessonId": "0012",
    "updatedAtMs": 1795400100000,
    "baseSeq": 14
  }
}

// Response 200
{
  "serverTimeMs": 1795400100120,
  "serverSeq": 15,
  "acceptedLessons": ["0012"],
  "rejectedConflicts": []
}
```

**4. `GET /api/sync/v1/sync/pull?since_seq=14`**
```json
// Response 200
{
  "serverTimeMs": 1795400120000,
  "serverSeq": 15,
  "hasMore": false,
  "lastOpened": {
    "lessonId": "0012",
    "updatedAtMs": 1795400100000,
    "seq": 15
  },
  "lessons": [
    {
      "lessonId": "0012",
      "lessonCompleted": false,
      "seq": 15,
      "pb": {
        "positionMs": 525000,
        "segmentIndex": 48,
        "durationMs": 790000,
        "updatedAtMs": 1795400100000,
        "seq": 15
      },
      "dg": null
    }
  ]
}
```

#### 标准错误码表

| HTTP 状态 | `error.code` | 含义与客户端处理 |
| --- | --- | --- |
| `400` | `INVALID_CODE` | 设备码格式不合法，提示重新核对 |
| `400` | `INVALID_LESSON_ID` | 非 335 课白名单 ID，客户端丢弃脏数据并告警 |
| `401` | `DEVICE_REVOKED` | 设备已被移除或退出，清除本地同步凭证，**保留本地全部学习进度** |
| `404` | `CODE_NOT_FOUND` | 配对码不存在 |
| `409` | `CODE_USED` | 配对码已被消费，提示重新生成 |
| `409` | `GROUP_FULL` | 同步组已达 10 台上限，提示先移除闲置设备 |
| `410` | `CODE_EXPIRED` | 配对码超过 5 分钟已过期，提示重新生成 |
| `413` | `PAYLOAD_TOO_LARGE` | 请求体超过 64 KB（服务端拒收，客户端分批推送） |
| `429` | `RATE_LIMITED` | 触发限流，按 `retryAfterSec` 退避重试 |

### 6.2 微信小程序 `syncGateway` 云函数代理规范 `[D]`

所有微信小程序用户经 CloudBase 发起外部 HTTPS 请求时会共享腾讯云 NAT 出口 IP。若服务端仅按 TCP 来源 IP 限流，单一用户的异常高频请求会误伤全体小程序用户。因此代理层强制采用以下签名与限流透传规范：

1. **严格路由白名单（防 SSRF）**：`syncGateway` 仅接受预定义的枚举路由与方法（对应 §6.1 的 8 个端点），拒绝任何自定义 URL、任意路径拼接或内网地址转发。
2. **不可逆主体哈希（零隐私泄露）**：云函数通过 `cloud.getWXContext().OPENID` 获取当前微信用户上下文后，在云函数本地计算：
   ```text
   rateSubject = hex(HMAC-SHA256(SYNC_GATEWAY_SECRET, "wechat:" + OPENID))
   ```
   服务端仅将该不可逆哈希作为限流桶键，**永远不传输、不读取、不存储原始 OpenID**。
3. **网关请求签名（防伪造头注入）**：云函数转发时注入以下请求头：
   - `X-Gateway-Timestamp`: Unix 毫秒时间戳（`ep-syncd` 校验在 `±60s` 窗口内）
   - `X-Gateway-Subject`: `rateSubject`
   - `X-Gateway-Signature`: `hex(HMAC-SHA256(SYNC_GATEWAY_SECRET, method + "\n" + pathAndQuery + "\n" + timestamp + "\n" + rateSubject + "\n" + sha256(body)))`
   - 仅当 `ep-syncd` 验签通过时，才切换为按 `X-Gateway-Subject` 独立限流；直连客户端伪造该请求头且无有效签名时直接按未验签丢弃并按真实客户端 IP 限流。
4. **环境变量隔离**：`SYNC_BASE_URL` 与 `SYNC_GATEWAY_SECRET` 仅配置在 CloudBase 云函数环境变量与同步节点受保护配置中，**严禁写入公共 Git 仓库或前端代码**。

---

## 7. 公网安全、防刷与隐私合规

1. **分层限流策略**：
   - `POST /pair/claim`（防撞库核心）：单限流主体（直连客户端 IP 或经网关验签的 `rateSubject`）**5 次/分钟**；连续失败 10 次进入 **15 分钟冷却期**。
   - `POST /pair/create`：单限流主体 **10 次/小时**，防止恶意刷爆组与票据表；同时定期清理过期未消费票据。
   - `POST /sync/push` / `GET /sync/pull`：单设备 **30 次/分钟**（令牌桶），正常用户每 45s 推一次远低于阈值。
2. **反云盘滥用校验**：
   - `lessonId` 必须命中 335 课静态白名单；
   - `positionMs` 与 `durationMs` 必须为 `[0, 7200000]` 整数；`segmentIndex` 为 `[0, 5000]` 整数；
   - `deviceName` 去除控制字符与 HTML 特殊字符后截断至 ≤ 32 Unicode 字符；
   - 单次 `push` 最多携带 335 条课程记录且请求体 ≤ 64 KB（Nginx 与 Go 双重限制）。
3. **零 PII 合规**：同步数据库不含任何个人身份信息（PII），微信小程序无需额外申请手机号/头像昵称/地理位置权限；使用 `wx.scanCode` 仅在用户主动点击「扫一扫加入设备」时按需触发相机权限。
4. **公共仓库脱敏要求**：公共仓库源码与文档禁止包含真实部署 IP、端口、内部服务器名、真实 CloudBase `envId` 及密钥。

---

## 8. UI / UX 与动效规范（主界面右上角进度触发 + RareUI FolderComponent 动效适配）

### 8.1 触发入口与克制布局 `[P]`

主界面（课程库页）顶部钉住区（Pinned Top Deck）**右上角已存在课程完成进度胶囊**，本次同步功能**直接复用该位置作为唯一入口**，不在主界面新增多余图标或悬浮按钮：

- **现有实现基准**：
  - **Flutter（`flutter_app/lib/main.dart`）**：右上角进度胶囊展示 `$completedCount / ${_lessons.length} Done`（高度 `28dp`、全圆角 `9999`、`p.surfaceInset` 背景、`1px p.border` 描边、`11.5px w700` 等宽数字 `p.accent`）。
  - **微信小程序（`miniprogram/components/pinned-top-deck`）**：`.deck__completion` 胶囊展示 `{{completionText}}`（高度 `28px`、`var(--ep-surface-inset)` 背景、`var(--ep-border)` 描边、`var(--ep-accent)` 文字）。
- **同步入口增强（克制微调）**：
  - 未开启同步时：保持当前静态胶囊外观，增加外扩隐形触控热区（≥ `44 × 36pt`）及轻触按压缩放（`0.96`, `100ms`），并支持极微弱的可交互暗示（或已连接图标微提示）。
  - 已绑定同步组后：在进度文字左侧增加 `5px` 状态圆点：
    - **已同步**：`p.accent` 实心圆点；
    - **同步中**：`p.accent` 柔和呼吸脉冲；
    - **待同步 / 离线**：`p.textPassed` 中性圆点；
    - **凭据失效 / 异常**：暖琥珀提示色圆点。
  - **点击行为**：打开**进度同步弹窗**（Modal / Bottom-Sheet 自适应居中弹窗）。

### 8.2 项目双主题令牌映射（严格沿用现有 `AppPalette` / `themeTokens.ts`） `[P]`/`[D]`

弹窗背景、文件夹三层材质与文字按钮 **100% 映射自项目既有的深浅双主题令牌**，绝不引入 RareUI 示例中自带的蓝色或高饱和冷灰等外部色彩：

| 组件层级 | Dark 主题 (`AppPalette.dark` · Spotify Dark Cocoon) | Paper 主题 (`AppPalette.paper` · Claude Warm Parchment) |
| --- | --- | --- |
| 弹窗遮罩 | `#070709` @ 72% 透明（`bgWell` 基底） | `#141413` @ 36% 透明 |
| 弹窗容器底板 | `deckBg` (`#13151C`) + `deckBorder` (`1px`) | `deckBg` (`#FAF8F5`) + `deckBorder` (`1px`) |
| **文件夹背板 (Back Plate)** | `surface1` (`#14151B`) + 微弱内高光 `0x14FFFFFF` | `surface2` (`#E6E0D4`) + 微弱内高光 `0x59FFFFFF` |
| **内页卡片 (Stacked Cards)** | `surface3` (`#282A36`) 描边 `0x26FFFFFF`，骨架线 `0x2EFFFFFF` | `surface1` (`#FAF8F5`) 描边 `border` (`0x14141413`)，骨架线 `surface3` (`#DAD2C3`) |
| **磨砂前盖 (Front Flap)** | `surface2` (`#1F2029`) @ 78% 透明 + `6px` 模糊 + `1px` `metroOutline` 描边 | `deckBg` (`#FAF8F5`) @ 82% 透明 + `6px` 模糊 + `1px` `metroOutline` 描边 |
| 强调点缀与进度条 | `accent` (`#1ED760`) + `accentSoft` + `accentFg` (`#060608`) | `accent` (`#CC785C`) + `accentSoft` + `accentFg` (`#FFFFFF`) |
| 文字层级 | 主 `textPrimary` (`#FFFFFF`) · 次 `textPassed` (`0x73FFFFFF`) | 主 `textPrimary` (`#141413`) · 次 `textPassed` (`0x7A141413`) |

> **暗色模式二维码可读性硬约束 `[D]`**：无论处于 Dark 还是 Paper 主题，展示配对二维码时，二维码区域本身**必须**使用高对比纯白/浅纸静区（如 `#FAF8F5` 底 + `#141413` 码点，四周留 ≥ 2 模块静区），严禁在暗色背景上直接反白绘制难以识别的低对比二维码。

### 8.3 RareUI FolderComponent 动效参考与物理参数 `[P]`/`[D]`

参考 [RareUI FolderComponent](https://www.rareui.com/components/foldercomponent) 的 3D 拟物文件夹结构与弹簧物理手感，将其作为进度同步弹窗顶部的核心视觉与状态反馈载体：

1. **几何比例与 3D 透视**：
   - 基准坐标系：`BASE_WIDTH = 321`，`BASE_HEIGHT = 270`；弹窗内根据屏宽等比缩放（推荐手机端 `scale ≈ 0.62–0.68`，桌面/Tesla 大视口 `scale ≈ 0.72`）。
   - 3D 透视距离：`perspective = 800 * scale`（Flutter `Matrix4` 对应 `setEntry(3, 2, 1.0 / (800 * scale))`）。
2. **三层结构与特征形状**：
   - **底板（Back Plate）**：`321 × 270`，圆角 `25`，带柔和内阴影，承托后方三张卡片。
   - **三张内容卡片（Stacked Progress Cards）**：每张尺寸约 `164 × 214`、圆角 `20`，承载真实的同步信息而非空占位线：
     - **左卡（`Card-L`，总进度统计）**：展示 `已完成课数 / 335` 与 `accent` 细进度条；
     - **中卡（`Card-C`，同步核心/状态焦点）**：展示「当前同步状态」（未连接 / 已连接 / 配对倒计时提示）；
     - **右卡（`Card-R`，多端设备摘要）**：展示已连设备数量与平台图标标签（如 `iPhone · Tesla · 微信`）。
   - **磨砂前盖（Front Flap）**：`321 × 241`，沿用文件夹左上标签缺口特征轮廓（SVG / `Path`），旋转锚点固定在 **底部中心（`bottom center`）**，叠加 `blur(6px)` 磨砂玻璃与 `1px` 细描边；前盖表面展示简洁的「多端进度同步」标题与右上角同步状态微胶囊。
3. **三态弹簧关键帧参数（以基准 `321×270` 坐标系定义，运行时按 `scale` 等比缩放位移）**：

| 图层 | 弹簧参数 | Idle（收起） | Peek（悬停/按下微启） | Open（弹窗展开态） | 错峰延迟 |
| --- | --- | --- | --- | --- | --- |
| **Card-L（左卡）** | `stiffness=120, damping=13` | `x: -40, y: -22, rot: -5°` | `x: -40, y: -44, rot: -9°` | `x: -65, y: -170, rot: -14°` | `0 ms` |
| **Card-C（中卡）** | `stiffness=120, damping=13` | `x: +3, y: -20, rot: +2°` | `x: +3, y: -35, rot: -1°` | `x: 0, y: -180, rot: -3°` | `Open: 50ms / Peek: 60ms` |
| **Card-R（右卡）** | `stiffness=120, damping=13` | `x: +40, y: -10, rot: +10°` | `x: +40, y: -30, rot: +14°` | `x: +70, y: -160, rot: +18°` | `Open: 100ms / Peek: 120ms` |
| **Front Flap（前盖）** | `stiffness=120, damping=14` | `rotateX(-15°)` | `rotateX(-45°)` | `rotateX(-55°)` | `0 ms` |

### 8.4 弹窗三态交互编排与跨端适配 `[D]`

弹窗随打开动效将文件夹从 `Idle → Open` 弹簧展开，用户也可轻点文件夹区域在 `Open / Idle` 之间把玩切换（同步触发一次轻微触感反馈 `HapticFeedback`）：

- **State A：未开启同步（单机状态）**
  - 上方文件夹展开展示当前本地 `Done` 统计卡与「仅本机保存」提示；
  - 下方操作区（按设备能力自适应）：
    - **iOS / iPad / Android / 微信小程序（有摄像头）**：主按钮「**扫一扫连接设备**」、次按钮「**生成本机配对码**」、底部链接「输入 8 位设备码」；
    - **Flutter Web / Tesla 车机（无摄像头）**：自动隐藏摄像头扫码按钮，主按钮「**展示配对二维码**」、次按钮「**输入 8 位设备码**」（大触控按键，方便车机操作）。
- **State B：配对码展示 / 输入态**
  - **展示码态**：中卡内容平滑切换（或下方卡片区展开）高对比二维码（带白色静区）+ 等宽大号 `XXXX-XXXX` 设备码（一键复制）+ 5 分钟实时倒计时；轮询收到新设备加入后，触发**入组确认动效**（文件夹回弹轻合再轻启，`accent` 对勾 + 「已连接 `<设备名>`，进度已同步」），随后转入 State C。
  - **输码态**：8 位分段输入框（自动过滤 `0/O/1/I/L` 并在输入过程中自动格式化 `XXXX-XXXX`）+ 「确认连接」按钮 + 明确内联错误提示（过期/已用/不存在/限流）。
- **State C：已绑定同步组（常态管理）**
  - 上方文件夹前盖显示「已同步 · 刚刚 / X 分钟前」与组内设备数；
  - 下方展示紧凑的**已连接设备列表**（设备名 + 平台图标 + 最近同步时间 +「本机」胶囊；支持修改本机名称、点击移除其他设备）以及底部操作栏：「**添加新设备**」、「**立即同步**」、「**退出同步组**」（二次确认弹窗，明确告知「退出后仅断开同步，本机学习进度完整保留」）。

### 8.5 各端动效实现与降级边界 `[D]`

1. **Flutter（iOS / iPad / Android / Web / Tesla）**：
   - 使用 `SpringSimulation(SpringDescription(mass: 1, stiffness: 120, damping: 13/14))` 驱动 `AnimationController.unbounded()` 实现原生弹性物理曲线；
   - 前盖使用 `CustomClipper<Path>` 复现异形文件夹缺口 + `BackdropFilter(ImageFilter.blur(sigmaX: 6, sigmaY: 6))` + `Transform` `Matrix4` 3D `rotateX`；
   - 二维码绘制选用纯 Dart 轻量包（如 `qr_flutter`），移动端扫码选用 `mobile_scanner`（Web 端条件隔离不初始化摄像头插件）；
   - **Tesla 视口适配**：同时兼容 `1256×706` 居中模态卡片与 `773×601` 紧凑自适应高度弹窗；弹窗开关与窗口尺寸变化期间**绝不中断、暂停或重载音频**（EP-PBC-001 §6）。
2. **微信小程序（WebView 渲染）**：
   - 复用 `miniprogram/core/themeTokens.ts` 既有的 `MOTION.easeBounce`（`cubic-bezier(0.34, 1.38, 0.64, 1)`）与纯 WXSS CSS 3D `transform` + `transition-delay`（`0ms / 50ms / 100ms`），由 GPU 合成器执行，**严禁在 JS 逻辑层使用定时器逐帧 `setData` 驱动动画**；
   - 扫码直接调用微信原生 `wx.scanCode({ onlyFromCamera: false, scanType: ['qrCode'] })`，展码通过纯 JS 轻量 Canvas 组件绘制（不引入臃肿第三方组件库）。
3. **无障碍减少动效降级**：
   - Flutter 侦测 `MediaQuery.disableAnimationsOf(context)`、Web/小程序侦测 `@media (prefers-reduced-motion: reduce)`；开启时关闭 3D 翻折与弹性位移，降级为 `160ms`（`MOTION.durQuick`）平滑淡入与轻量平移动效。

---

## 9. 分阶段实施路线图与验收向量

### 9.1 分阶段实施计划 `[D]`

1. **Phase 1：Go 同步服务端建设与部署**
   - 在仓库新增 `sync_server/`（Go HTTP 服务 + SQLite WAL 迁移/存储层 + 335 课白名单校验 + 分层限流 + `X-Gateway-Signature` 网关鉴权）；
   - 完成核心单元测试与并发竞争集成测试（覆盖因果 `baseSeq`、时钟钳位、单向 `lessonCompleted`、票据一次性原子消费）；
   - 部署至自托管节点并配置 Nginx 反代 `/api/sync/v1/` 与每日 SQLite 热备定时任务。
2. **Phase 2：Flutter 全端（Web/Tesla + iOS/iPad + Android）接入**
   - 在 `flutter_app/lib/services/sync/` 实现平台无关的 `SyncEngine`、`SyncApiClient` 与三套适配器（同时兼容 `ContractPlayer` 与原生 `main.dart`）；
   - 实现主界面右上角进度胶囊触发器与自适应双主题 Folder 同步弹窗（含二维码绘制与移动端扫码）；
   - 验证 Web ↔ iOS 真机双向同步、离线合并与 Tesla 双视口不断播。
3. **Phase 3：微信小程序接入**
   - 新增云函数 `miniprogram/cloudfunctions/syncGateway`；
   - 在 `miniprogram/core/syncEngine.ts` 实现纯 TypeScript 同步状态机与冲突收敛逻辑（严格保持 `core/` 零 `wx.*` 依赖与完整单元测试），并接入唯一写入通道 `services/progressJournal.ts`；
   - 扩展 `pinned-top-deck` 右上角胶囊点击与 WXSS 3D Folder 弹窗组件；
   - 真机验收微信小程序 ↔ iOS ↔ Web/Tesla 全端互通。
4. **Phase 4（预留）：HarmonyOS NEXT (`harmonyos_app`) 接入**
   - 复用同一 `/api/sync/v1` REST 契约与 Canonical Sync Schema v1 接入。

### 9.2 正式验收向量（当前结果均为 `NOT TESTED`）

| ID | 测试场景与前置条件 | 预期结果 | 初始状态 |
| --- | --- | --- | --- |
| SYNC-01 | 设备 A 首次点右上角进度胶囊 → 生成配对码，设备 B 扫码加入 | A 原子建组并自动推本地基线；B 扫码直接绑定生效并完成双向无损合并 | NOT TESTED |
| SYNC-02 | Tesla Web 手输 8 位小写/无连字符配对码 `k7m9p2xr` | 服务端规范化识别成功直接绑定；A 端弹窗 2s 内感知连接完成并刷新设备数 | NOT TESTED |
| SYNC-03 | 使用已过期（>5 分钟）或已消费过一次的配对码重试加入 | 分别返回 `410 CODE_EXPIRED` / `409 CODE_USED`，界面给出明确提示 | NOT TESTED |
| SYNC-04 | 高频爆破 `POST /pair/claim` 连续输错配对码 | 触发 `429 RATE_LIMITED` 并进入冷却；通过 `syncGateway` 的不同小程序用户互不误伤 | NOT TESTED |
| SYNC-05 | 第 11 台设备尝试加入已满 10 台活跃设备的同步组 | 返回 `409 GROUP_FULL`，提示先移除闲置设备 | NOT TESTED |
| SYNC-06 | 已入组设备尝试扫码/输码加入另一组 | 前端拦截，要求先显式「退出当前同步组」再加入新组，防误串组 | NOT TESTED |
| SYNC-07 | A 听第 10 课 PB，B 离线听第 12 课 PB，联网后互相 Pull | 粒度到单课单轨，两课进度各自保留互不覆盖 | NOT TESTED |
| SYNC-08 | 同一课 A 听 PB、B 听 DG，分别 Push 后再 Pull | PB 与 DG 断点独立收敛，互不覆写对方轨道 | NOT TESTED |
| SYNC-09 | A 正常播完某课（`lessonCompleted=true`），B 从头重听该课至 20% 并 Push | 合并后两端 `lessonCompleted` 仍为 `true`，绝不回退 | NOT TESTED |
| SYNC-10 | A 时钟比标准时间慢 10 秒，先拉取 `seq=5` 后继续听并 Push；B 时钟调至 2099 年尝试覆盖 | 因果 `baseSeq >= track_seq` 优先采纳 A 的新推进；B 异常未来时间被服务端钳位在 `+30s` 内 | NOT TESTED |
| SYNC-11 | A 手动点「下一课」停在 `00:00` 未播放即退出，此前云端该课 PB 有 `08:45` | `00:00` 临时播放头绝不入队推送，云端与 B 端 `08:45` 断点完好保留 | NOT TESTED |
| SYNC-12 | B 正在播放第 5 课 PB 至 `03:10`，后台拉取到 A 推来的第 5 课 PB `06:00` | 当前正在播放的音轨不被强行 Seek 打断，非当前课静默落盘更新 | NOT TESTED |
| SYNC-13 | 设备 A 踢除设备 B，或 B 主动点「退出同步」 | B 收到 `401 DEVICE_REVOKED` 后清除凭证并温和提示，B 本地全部历史进度完整保留 | NOT TESTED |
| SYNC-14 | 组内最后一台设备退出，经过清理窗口 | `orphaned_at_ms` 打标并在 7 天后由清理任务回收孤儿组数据 | NOT TESTED |
| SYNC-15 | 推送非 335 课白名单 ID 或超大请求体（>64 KB） | 分别返回 `400 INVALID_LESSON_ID` / `413 PAYLOAD_TOO_LARGE` 拒绝入库 | NOT TESTED |
| SYNC-16 | 深色主题（Dark Cocoon）与浅色主题（Warm Parchment）下打开同步弹窗 | 文件夹双主题令牌与项目一致；暗色模式下二维码仍保有高对比浅色静区可秒扫 | NOT TESTED |
| SYNC-17 | 打开/收起文件夹动效及系统开启「减少动效」 | 正常模式呈 3D 磨砂前盖与三卡片弹簧错峰展开；减少动效时降级为 160ms 平滑淡入且小程序无逐帧 `setData` | NOT TESTED |
| SYNC-18 | Tesla Web 播放音频期间点击右上角打开/关闭同步弹窗及切换 `1256×706` ↔ `773×601` 视口 | 弹窗布局自适应不溢出，音频持续播放无重载、无暂停、无 Seek 跳变 | NOT TESTED |
