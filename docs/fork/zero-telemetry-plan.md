# T3 Code fork：零外发遥测改造事实基线与实施计划

## 0. 文档状态

本文件基于当前 `main` 基线 `4c8a324e8fec28fe5f2c34a8a3551078d5aa5dc6`，由 4 个并行 subagent 与主代理交叉复核后重写。旧版中的所有过时状态、内部矛盾和过度承诺已删除。

该 fork 基线以 `4c8a324e8fec28fe5f2c34a8a3551078d5aa5dc6` 为基础，已纳入以下内容：

- feedback 入口禁用涉及 5 个源码/测试文件。
- rebase 守卫资产：`.githooks/post-rewrite`、`fork/no-telemetry-guard.json`、`scripts/no-telemetry-guard.mjs`、`scripts/rebase-upstream.sh` 和 `package.json` script。
- 本文件作为 fork 活文档随代码维护。
- 已落地内容是 feedback 的最低成本禁用和 rebase 守卫初版。
- Phase 1–4、Phase 6 尚未实施。
- 本机缺少 `vp` 和 `node_modules`，未运行测试、typecheck 或构建；Node 版本也与 `package.json` 要求不一致。

本轮结论：**技术路线可行，但当前文档、guard 和状态描述不能直接当作已完成方案验收。进入 Phase 1 前，先修本文件列出的守卫缺口。**

## 1. 目标与边界

### 1.1 准确目标

目标是**零外发产品遥测/诊断**，不是零本地 trace、不是零网络：

- 不向 `ingest.t3.codes` 发送产品分析事件或 feedback 报告。
- 不向 Axiom/OTLP 发送 relay trace、browser trace、server trace/metrics/logs、desktop trace 或 mobile crash/error。
- 客户端不再生成或发送 `anonymous-id`、`clientOwner`、`clientDevice`、`t3code.analytics.device-id`、`t3code:analytics-device-id`。
- 保留 host 上的线程、项目、消息、会话、权限、provider 登录、worktree、attachments、必要日志和客户端缓存。
- 允许 coding provider API、Git/PR、用户配置 webhook 等正常功能通信。

### 1.2 不属于产品遥测的相邻通道

以下通道可能访问网络，但不属于本方案要删除的自动产品遥测：

- 用户主动配置并启用的 coding provider。
- Git/PR/issue 集成与用户配置 webhook。
- 桌面更新检查与更新 feed。
- 用户显式开启的 agent activity 发布、移动通知/Live Activity。
- 用户显式配置的 OTLP receiver，前提是保留该能力；本方案默认关闭消费，不禁止用户自行外发。

因此验收口径不能写成“无任何外连”，只能写成“无上述遥测端点外连”。

## 2. 已复核事实

| 结论 | 判定 | 关键证据与修正 |
|---|---|---|
| `AnalyticsService` 是唯一产品分析 POST 出口 | 确认 | `apps/server/src/telemetry/AnalyticsService.ts:247-252`；默认 host 在 `:74-76`。no-op layer 可停止投递。实现时需要保留 `type TelemetryOwner` import，因为 Service 接口在 `:102-105` 使用它。 |
| DNT / `T3CODE_TELEMETRY_ENABLED=false` 不能阻止匿名 ID 文件 | 确认 | `AnalyticsService.ts:136-156` 的开关是延迟求值，`getTelemetryIdentity()` 在 layer 构建时无条件执行；`Identify.ts:103-133` 写入 `userdata/anonymous-id`。直接替换 `layer` 使 `make` 不执行即可避免。 |
| no-op 后仍会本地读取 Connect 账号哈希 | 确认 | `apps/server/src/serverRuntimeStartup.ts:178` 调用 `recordOwners(getServerOwners(...))`；`Identify.ts:151-163` 读取本地 secret 并哈希。零身份读取必须删除该调用。 |
| `clientOwner/clientDevice` 不参与鉴权 | 确认 | 生成与写入在 `packages/client-runtime/src/authorization/remote.ts:45-62,108-113,298-302,354-359`；服务端只交给 `recordOwners`（`apps/server/src/ws.ts:885-900,3864-3865`）。鉴权消费 `wsTicket/dpop`。 |
| `clientSurface/clientDeviceModel` 等是分析字段 | 确认 | `apps/server/src/ws.ts:837-878` 的函数名是 `readClientAnalyticsProps`，结果进入 `feature.used` 和 `client.turn.requested`。不能称为“普通元数据”。 |
| `RelayTracing.layer` 返回 None 足以让 wrapper 透传 | 确认 | `packages/shared/src/relayTracing.ts:29-59,166-209`；`apps/server/src/cloud/traceRelayRequest.ts:23-25` 在 None 时直接返回原 effect。 |
| 仅关 relay wrapper 不足够 | 确认 | web exporter `apps/web/src/observability/clientTracing.ts:110-115`；server traces/metrics `apps/server/src/observability/Observability.ts:57-97`；server logs `apps/server/src/serverLogger.ts:57-78`；desktop `apps/desktop/src/app/DesktopObservability.ts:627-685`；proxy `apps/server/src/http.ts:435-478`；Test 按钮 `OtlpEndpointCheck.ts:50-71`。 |
| Web 有两套 OTLP 相关配置 | 确认 | `apps/web/vite.config.ts:38-40,339-343` 注入 relay tracing；`apps/web/src/observability/clientTracing.ts:84-115` 发往同源 proxy。二者需分别关闭。 |
| 移动端崩溃/连接 trace 不是“只改默认值” | 确认 | `apps/mobile/src/persistence/mobile-preferences.ts:157-160,356-360` 是未关即开；`apps/mobile/app.config.ts:22-26,489-497` 有 native observe 与默认 Axiom URL；已有显式 `true` 会覆盖默认值。 |
| Web 也有 analytics device ID | 确认 | `apps/web/src/connection/platform.ts:352-364,462` 使用 localStorage key `t3code:analytics-device-id`；移动端是 `t3code.analytics.device-id`（`apps/mobile/src/persistence/mobile-storage.ts:12,194`）。 |
| `agent_feedback` migration 不能改旧文件 | 确认 | `apps/server/src/persistence/Migrations.ts:243,363-366` 只执行 `id > latestRecordedId`。删表必须新增 migration。 |
| no-op analytics 会让 feedback 卡片显示 cancelled | 确认 | `apps/server/src/feedback/FeedbackStore.ts:208-227,351-356`；不会误报 sent。 |
| 本地数据库无应用层加密 | 确认 | iOS `apps/mobile/src/persistence/mobile-database.ts:122,127`；host `packages/shared/src/nodeSqliteClient.ts:210,685`；目录/secret 仅权限控制。依赖 OS 全盘加密。 |
| `telemetryChannel` 不能删除 | 确认 | `apps/server/src/policy/ManagedPolicy.ts:183` 用其决定 dev managed-policy override；也用于 `apps/server/src/config.ts:136` 的 OTLP resource。 |
| feedback 最低成本禁用尚未覆盖模型指令 | 确认 | `apps/server/src/orchestration-v2/ProviderSessionManager.ts:500-505,2741-2742` 仍读取持久化设置；`packages/provider-core/src/server/runtimeInstructions.ts:39-40` 会写入 `t3_feedback` 指令。 |

## 3. 修订后的实施计划

### Phase 0：固化和提交当前 fork 基线

1. 先把当前 feedback 禁用与 guard 改动提交到 fork 分支，或全部 stash；Phase 1 开始前工作树应可预测。
2. 配置 upstream：

```sh
git remote add upstream <upstream-url>   # 若尚未添加
git fetch upstream
```

3. 记录当前 fork 基线提交到本文件。

**验收**：`git status --short` 干净；`upstream/main` 可访问；guard 默认检查通过。

### Phase 1：服务端产品分析 no-op

1. 修改 `apps/server/src/telemetry/AnalyticsService.ts`：
   - 保留 `AnalyticsService` class、Service 接口和 `type TelemetryOwner` import。
   - 删除 `TelemetryEnvConfig`、`make()`、`getTelemetryIdentity` 调用、HTTP payload、buffer/retry/flush、OS/架构映射。
   - `layer = Layer.succeed(AnalyticsService, AnalyticsService.of({ record: () => Effect.succeed(false), flush: Effect.void, recordOwners: () => Effect.void }))`。
2. 删除 `apps/server/src/serverRuntimeStartup.ts:178` 的 `recordOwners(getServerOwners(...))`。
3. 保留其他 `analytics.record()` 调用点，它们通过 no-op 接口继续编译。
4. 重写或删除依赖投递/身份的测试：`AnalyticsService.test.ts`、`Identify.test.ts`、`ws.test.ts` 中 mock 部分；`ProviderUsageAnalytics.test.ts` 使用 mock 的项目通常无需改。

**验收**：全新 home 无 `anonymous-id`；无 `/batch/` POST；相关测试通过。

### Phase 2：客户端停止生成分析身份

统一策略：**客户端不生成、不发送；服务端兼容解析保留但喂 no-op。** 不为降低冲突而改高 churn 的 `ws.ts`。

1. `packages/client-runtime/src/authorization/remote.ts`：
   - 删除 `ClientOwnerParams`、`readClientOwnerParams` 及 `clientOwner/clientDevice` query 设置。
   - 删除 `hashTelemetryId` import。
2. `packages/client-runtime/src/connection/resolver.ts`：
   - 删除 `ClientOwnerParams` import、`readClientOwnerParams` 调用与 `owners` 实参。
3. 移除 `AnalyticsDevice` 实质注入：
   - `apps/web/src/connection/platform.ts:352-364,462` 及 localStorage key。
   - `apps/mobile/src/connection/platform.ts:193-195`。
   - `apps/mobile/src/persistence/mobile-storage.ts:12,70-73,194`。
4. 可保留 `capabilities.ts` 的 `AnalyticsDevice` 默认 `None`，避免改更多调用方；但不得再有实际 ID 注入。
5. 更新 `remote.test.ts`、`mobile-storage.test.ts`、`linkEnvironment.test.ts`、`remoteRegistration.test.ts`。

**验收**：WS/OAuth URL 无 `clientOwner/clientDevice`；直接连接、Tailscale、T3 Connect 均正常。`clientSurface` 等分析字段由 Phase 1 no-op 防止外发，是否物理删除另列后续任务。

### Phase 3：关闭 relay tracing 与所有 OTLP 出口

1. `packages/shared/src/relayTracing.ts`：
   - `layer()` 固定返回 `Layer.succeed(RelayClientTracer, Option.none())`。
   - `withRelayClientTracing()` 保持或改为透传。
2. `apps/server/src/cloud/relayTracing.ts` 与 `allowedFor()`：
   - 固定不启用 relay tracing。
   - 同步关闭 `apps/server/src/ws.ts:1952-1955` 写入的 `relayTracingAllowed`，避免 web 误判可用。
3. 分别停止以下 exporter/proxy：
   - `apps/web/src/observability/clientTracing.ts` 与 `apps/web/src/routes/__root.tsx`。
   - `apps/server/src/observability/Observability.ts` 的 traces 与 metrics exporter。
   - `apps/server/src/serverLogger.ts` 的 logs exporter。
   - `apps/server/src/http.ts` 的 `/api/observability/v1/traces` proxy 与 `OtlpEndpointCheck` RPC/UI。
   - `apps/desktop/src/app/DesktopObservability.ts` 的 logs/traces exporter。
4. 保留 contracts/settings/RPC 中 OTLP 字段兼容，隐藏：
   - `apps/web/src/components/settings/TelemetryExportSettings.tsx`。
   - `apps/web/src/components/settings/DiagnosticsSettings.tsx` 的挂载。
5. 清理构建注入和配置读取：
   - `apps/web/vite.config.ts`、`apps/web/src/vite-env.d.ts`、`apps/web/src/cloud/publicConfig.ts`。
   - `apps/server/vite.config.ts`、`scripts/lib/public-config.ts`。
   - `apps/mobile/app.config.ts`、`apps/mobile/src/features/cloud/publicConfig.ts`。
   - `.github/workflows/release.yml`、`release-desktop.yml` 中相关变量。

**验收**：Web/server/desktop/relay 不产生 trace/metrics/logs 外发；mobile 尚未处理，留到 Phase 4；即使设置中残留 OTLP URL 字段也不创建 exporter；`relayTracingAllowed` 不为 true。

### Phase 4：移动端零外发遥测

1. 删除 `expo-observe`：
   - `apps/mobile/package.json` 与 `pnpm-lock.yaml`。
   - `apps/mobile/index.ts`、`RenderErrorBoundary.tsx`、`observe.ts`。
   - `apps/mobile/app.config.ts` 的 `extra.eas.observe.endpointUrl`。
   - relay 契约/基础设施中的 mobile telemetry 路径：`packages/contracts/src/relay.ts`、`infra/relay/src/observability.ts`、`infra/relay/src/mobileTelemetry/*`。
2. 删除移动端 OTLP：
   - `apps/mobile/app.config.ts` 的 `extra.observability`。
   - `scripts/lib/public-config.ts` 的 `EXPO_PUBLIC_OTLP_*` 注入。
   - `apps/mobile/src/features/cloud/publicConfig.ts` 的解析与 `hasTracingPublicConfig`。
   - `apps/mobile/src/features/observability/tracing.ts`、`diagnosticsSetting.ts`。
   - `apps/mobile/src/lib/runtime.ts` 的 layer 装配。
   - `ConnectionTracesSwitch.tsx` 及 Diagnostics / ConnectOnboarding 两个挂载点。
   - `mobile-preferences.ts` 的 `crashReportsEnabled`、`connectionTracesEnabled` 及解析。
3. 相关测试同步：`tracing.test.ts`、`publicConfig.test.ts`、`protectedData.test.ts`、`mobile-storage.test.ts`。
4. 重新生成 native 项目，清理 build cache；native 项目中不得残留 observe endpoint。

**验收**：新安装 app 冷启动、解锁、崩溃后无 mobile observe/Axiom/OTLP 请求；需要抓包或系统代理验证，单靠静态扫描不足。手机作为 remote control 的功能正常；iOS 构建/签名仍需 macOS + Xcode 或等价 CI。

### Phase 5：feedback 禁用收口

#### 当前已实施

- `apps/server/src/environment/ServerEnvironment.ts`：capability `agentFeedback: false`，隐藏 Web/iOS 设置项和设置搜索。
- `apps/server/src/mcp/McpInvocationContext.ts`：`hiddenWhileFeedbackOff()` 固定 `false`，`t3_feedback` 工具不可见。
- `apps/server/src/binCli.ts`：移除 `feedbackCommand` 注册；`t3 feedback` 与 `t3 feedback list` 不存在。
- `apps/server/src/feedback/FeedbackReport.ts`：同步删除 subject 白名单中的 feedback 命令。

#### 仍需补做

1. 强制有效配置层 `agentFeedback.mode=off`，避免历史 settings 让 provider 指令仍然出现 `t3_feedback`：
   - 在服务端设置读取/归一化层固定返回 off，或新增迁移改写已有 settings。
2. 处理历史 pending feedback 卡片：
   - 当前旧审批 RPC 仍注册；因为无法产生新卡片，通常只影响旧数据。
   - 若要求零入口，删除 `agentFeedbackAnswerRequest` RPC、handler、client UI 和权限映射。
3. 保留 `FeedbackService`/`FeedbackStore`/migration 108 作为兼容代码；外发由 Phase 1 no-op 兜底。
4. 补跑 `mcp-tool-use` eval，因为 `T3_CLI_COMMANDS` 是模型可见文本。

**验收**：MCP `tools/list` 无 `t3_feedback`；provider runtime instructions 不含 `t3_feedback`；旧设置文件即使写 `auto` 也无效；未误删 Codex `/feedback`、截图反馈和 diff 评论。

### Phase 6：文档、配置与构建清理

1. 清理 `.env.example`、`.env.local`、release workflow 与构建脚本中的 telemetry/OTLP/observe 变量。
2. 更新 `docs/user/telemetry.md`、FAQ、隐私政策，并同步内部文档 `docs/internals/08_product-analytics.md`、`docs/operations/04_observability.md` 与 `docs/operations/05_relay-observability.md`。
3. 构建 web/server/desktop/mobile 产物，扫描 dist、source map、native 配置。
4. 重新运行 strict guard，并修正其已知缺口后再设为强制。

## 4. Rebase 守卫：现状与必须修正项

### 4.1 当前实现

- `scripts/no-telemetry-guard.mjs`：唯一执行器，检查项与 phase 逻辑硬编码在脚本中；`fork/no-telemetry-guard.json` 只提供 strict 开关和禁止模式。
- `scripts/rebase-upstream.sh`：fetch → rebase → guard。
- `.githooks/post-rewrite`：rebase/amend 成功后运行 guard；`core.hooksPath=.githooks` 已在本机启用。
- `package.json`：`npm run verify:no-telemetry`。

当前实测：默认 profile 为 `5 PASS / 7 TODO`，strict 按预期失败。其中 `client-owner-params-removed-direct` 的 PASS 是假阳性。

### 4.2 必须修正的守卫问题

1. `resolver.ts` 断言只查小写 `clientOwner/clientDevice`，但源码使用 `ClientOwnerParams`、`readClientOwnerParams`、`owners`。必须检查这些符号及 `appendClientConnectionParams` 实参个数。
2. remote 检查的 `/clientDevice/` 会误伤 `clientDeviceType/clientDeviceModel`，应改为词边界或精确 query key。
3. 全局 source scan 包含 `apps/packages/infra`，会扫到 relay 契约和基础设施中的 `expo-observe`、`/v1/mobile/observe`、`X-Axiom-Dataset`。应界定为“客户端运行时扫描”，或把 relay 清理纳入 Phase 4。
4. `--dist` 当前目录不存在也会 PASS，且不含 mobile/native/CLI asset/source map。必须要求至少一个预期产物存在，否则失败；扩展扫描路径。
5. `post-rewrite` 和当前 wrapper 都是**事后检测**，不是阻断：失败不会撤销已完成的 rebase；Git 也可能忽略 hook 退出码。真正阻断应放到 CI、pre-push 或 wrapper 的显式恢复流程。
6. 默认 guard 非 strict，只保护 feedback。所有 Phase 完成后必须设置 `strict: true`，并让 wrapper/CI 使用 strict。
7. `post-rewrite` 不覆盖 merge、cherry-pick、reset、filter-repo、no-op rebase 和冲突中止。文档不得称其“保证任何同步后都触发”。
8. `rebase-upstream.sh` 在缺少 `upstream` remote 时回退到 `origin`；fork 场景必须显式添加 `upstream` 或用 `UPSTREAM_REMOTE` 指定。

### 4.3 修正后的定位

当前机制只能称为：**rebase 成功后的自动检测和告警**。在完成上述修正、启用 strict，并增加 CI/pre-push 阻断后，才能称为“防止 fork 不变量回退”。

## 5. 验证与回归

### 5.1 静态验证

```sh
npm run verify:no-telemetry
node scripts/no-telemetry-guard.mjs --strict --dist
git diff --check
```

构建产物扫描需包含：

```text
ingest.t3.codes
api.axiom.co
xaat-
X-Axiom-Dataset
/v1/traces
/api/observability/v1/traces
/v1/mobile/observe
observe.invalid
t3code.analytics.device-id
t3code:analytics-device-id
VITE_RELAY_OTLP_TRACES_
EXPO_PUBLIC_OTLP_
T3CODE_RELAY_CLIENT_OTLP_
```

### 5.2 功能验证

用 Replay（dev）或本地 provider：

1. 全新 `T3CODE_HOME` 启动 server，确认无 `anonymous-id`。
2. Desktop、iOS、Browser 分别配对并切换。
3. 创建 thread、发消息、切项目、开 terminal。
4. 网络检查仅允许 host、Replay/local provider 与用户显式启用的功能端点；不得出现 ingest/Axiom/OTLP/observe。
5. iOS 冷启动、解锁、触发一次错误后再次抓包，确认 native Observe 已彻底消失。
6. 检查 provider prompt 不再包含 `t3_feedback` 指令。

### 5.3 测试命令

```sh
vp test run apps/server/src/telemetry/AnalyticsService.test.ts
vp test run apps/server/src/telemetry/Identify.test.ts
vp test run apps/server/src/feedback/FeedbackService.test.ts
vp test run apps/server/src/mcp/McpHttpServer.test.ts
vp test run apps/server/src/cli/feedback.test.ts
vp test run packages/shared/src/relayTracing.test.ts
vp test run apps/server/src/cloud/relayTracing.test.ts
vp test run packages/client-runtime/src/authorization/remote.test.ts
vp test run apps/mobile/src/persistence/mobile-storage.test.ts
vp run check:changed
```

如修改模型可见的工具描述或 provider instructions，按 `evals/README.md` 补跑相关 eval，尤其是 `mcp-tool-use`。

## 6. 风险登记

| 风险 | 缓解 |
|---|---|
| 删除 schema/RPC 造成版本不兼容 | 保留字段，停止 exporter 消费和 UI |
| `telemetryChannel` 被误删 | 保留或语义重命名，同步 ManagedPolicy |
| 改旧 migration | 只新增 migration |
| 移动端 native Observe 残留 | 删除依赖/配置、清 native cache、抓包验收 |
| guard 假阳性/假阴性 | 修 resolver、词边界、dist 空扫描、扫描范围 |
| rebase hook 不是阻断 | CI/pre-push strict guard，wrapper 明确恢复路径 |
| 高 churn 文件冲突 | 客户端停止生成，服务端保留兼容解析；最小化 schema 改动 |
| 把 Codex `/feedback` 当成 agent feedback | 按模块处理，不做文本全局删除 |
| 把 provider API 当遥测 | 用 Replay/local provider 做端到端验证 |
| 文档再次过期 | 每个 Phase 完成后更新本文件并运行 guard |

## 7. 推荐执行顺序

1. 修正 guard 的 resolver、词边界、scan scope、dist 和 strict 接入。
2. Phase 1，立即做一次 upstream rebase 演练，观察真实冲突。
3. Phase 2，再 rebase 验证一次。
4. Phase 3，再 rebase 验证一次。
5. Phase 4，构建并抓包验证移动端。
6. Phase 5 收口 feedback 有效配置和 provider 指令。
7. Phase 6，文档/配置清理，启用 strict guard。

最小可信里程碑：

- Phase 1：产品分析外发和 `anonymous-id` 消失。
- Phase 2：客户端分析哈希参数消失。
- Phase 3：Web/server/desktop/relay trace、metrics、logs 外发消失；mobile 尚未清零。
- Phase 4：移动端 SDK、默认开关和 native 通道消失。
- Phase 5：feedback 新入口、CLI、MCP、模型指令均不可用。
- Phase 6：strict guard 与构建产物扫描可作为发布门槛。
