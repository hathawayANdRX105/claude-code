# Scope: Claude Code daemon + client (CSR split)

让完整 TUI 跑在 client，重头 agent 跑在 daemon，N 个终端共享一个 harness 进程，大幅省内存。做法是 CSR（client 渲染 + server 计算），等价于 web 的前后端分离。

**Build approach:** Facade（在现有 AcpAgent 上做薄封装，先让单 client 连 daemon 跑通完整 TUI，再加多连接复用）。
**Workflow:** Beta（check verify，再 test）。项目默认严谨度。`/wf-architect` 是有真实决策 feature 的首选第一步，但已经知道怎么建时可以跳过。

_这些是保持构建有序的 recommendations，不是要求。不合身就跳过：已经知道怎么建某个 feature，直接 `/wf-develop` 跳过 `/wf-architect`。何时 `done` 由你定。_

## At a glance

| # | Feature | Phase | Status |
|---|---------|-------|--------|
| 1 | Full REPL as ACP client | Foundation | in-progress |
| 2 | Daemon hosting AcpAgent | Foundation | planned |
| 3 | Permission round trip | Core | planned |
| 4 | Multi client session multiplexing | Core | planned |
| 5 | Client slimming to render only | Core | planned |
| 6 | Memory saving verification | Verification | planned |
| 7 | Slash commands over daemon | Slice 2 | planned |
| 8 | Session resume across clients | Slice 2 | planned |

## Existing (pre-workflow, 上下文参考)

### A. Full ACP agent (AcpAgent) · existing
完整 ACP server：17 个方法（initialize/newSession/loadSession/listSessions/fork/close/delete/cancel/setSessionMode/requestPermission 权限管道）。每终端 spawn 一个独立进程，是 CSR 要复用的 agent 端。code in `src/services/acp/agent/`

### B. Full REPL TUI · existing
完整交互界面，6755 行，43 个 components（Messages/PromptInput/permissions/hooks…）。当前 agent 硬跑在自己进程里（REPL.tsx:3551 直接 import `query.js`）。code in `src/screens/REPL.tsx`, `src/components/`

### C. Harness core (QueryEngine + tools + commands) · existing
重头 harness：QueryEngine（53 个重头 import：query.js/commands/API/tools/memdir/cost-tracker），1366 行。4 个 harness 入口。code in `src/QueryEngine.ts`, `src/query.ts`

### D. Legacy sharedSession + acp-tui · existing
上一轮尝试：7 方法简化 daemon + 144 行极简 client TUI（硬编码 canUseTool allow，无完整 sessionUpdate）。CSR 重做时不复用此实现。code in `src/daemon/sharedSession.ts`, `packages/acp-tui/`

## Foundations

### 1. Full REPL as ACP client · in-progress
让完整 REPL 走 ACP 协议连 daemon：把 REPL 硬调用的 `query()`（函数型入参 canUseTool/toolUseContext）改成经 ACP 的 RPC 调用，agent 在 daemon 跑，client 只渲染。这是 CSR 的骨架和最大一块。
**Done when:** 单个 client 连 daemon 时，界面与功能等于老 REPL（消息流、工具展示、流式输出），agent 在 daemon 侧执行。
- [x] 设计它 (spec): `/wf-architect full REPL as ACP client`
- [ ] 建它: `/wf-develop full REPL as ACP client`
  - [ ] query() 入参 RPC 化：函数型 (canUseTool) 改 handle 引用
  - [ ] toolUseContext 序列化边界与 daemon 侧重建
  - [ ] client 事件流渲染接回 Messages/PromptInput
- [ ] 验证它: `/wf-check verify full REPL as ACP client`
- [ ] 测它: `/wf-test full REPL as ACP client`

### 2. Daemon hosting AcpAgent · needs a decision
daemon 进程内跑 AcpAgent（复用现有完整 agent，不重写）。用 socket 复用承载多连接，daemon 自身常驻、client 缺失自动拉起。
**Done when:** `ccb daemon` 起一个跑 AcpAgent 的常驻进程，多个 client 能连上同一实例。
- [ ] 设计它 (spec): `/wf-architect daemon hosting AcpAgent`

## Core

### 3. Permission round trip
权限决策跨 client/daemon 边界：daemon 跑工具前用 requestPermission 反向问 client（复用 AcpAgent 现有 permissions.ts 管道），client 用完整权限 UI（components/permissions/）渲染交互。
**Done when:** 工具触发权限时，daemon 挂起、client 弹出完整权限对话框、决策回传 daemon 继续执行。
- [ ] 设计它 (spec): `/wf-architect permission round trip`

### 4. Multi client session multiplexing
一个 daemon 服务 N 个 client 各自的会话：会话注册表、attach/detach、互不干扰。走 AcpAgent 现有 session 生命周期（newSession/loadSession/closeSession）。
**Done when:** N 个 client 各连同一 daemon、各自独立会话，client 断开不杀会话、daemon 侧会话状态保持。
- [ ] 设计它 (spec): `/wf-architect multi client session multiplexing`

### 5. Client slimming to render only
把 client 瘦身成纯渲染：client 进程不再加载 QueryEngine/tools/commands 等重头 harness，只保留 Ink 组件 + ACP client 通信 + 渲染逻辑。
**Done when:** client 进程内存显著低于单终端跑完整 agent（agent 侧重头已在 daemon，client 不再重复加载）。
- [ ] 设计它 (spec): `/wf-architect client slimming to render only`

## Verification

### 6. Memory saving verification
以实测内存为最终验收标准：对比 N 终端独立跑 vs N client 共享一个 daemon 的总内存，量化每加一个终端省多少。
**Done when:** 有可复跑的实测数据，N client 共享 daemon 的总内存显著低于 N 个独立 agent。
- [ ] 设计它 (spec): `/wf-architect memory saving verification`

## Slice 2: 进阶

### 7. Slash commands over daemon
斜杠命令跨边界工作：命令定义与执行在 daemon，client 侧命令菜单与补全从 daemon 拉取。
**Done when:** 斜杠命令在 client 侧可用，命令实际在 daemon 执行。
- [ ] 设计它 (spec): `/wf-architect slash commands over daemon`

### 8. Session resume across clients
会话跨 client 恢复：一个 client 断开后，状态在 daemon 保留，新 client 可 loadSession 接手。
**Done when:** client 断开重连或换终端，能恢复同一会话的上下文。
- [ ] 设计它 (spec): `/wf-architect session resume across clients`

## Deferred

留给后续，不在当前构建范围。
- **老 sharedSession + acp-tui 极简实现清理**：CSR 稳定后再删，避免同时动两套 · needs a decision
- **远程 client**：daemon 跑在另一台机器，client 跨网络连 · needs a decision
- **多 daemon 实例协调**：同一台机器跑多个 daemon 时的会话归属 · needs a decision

## Legend

**The decision box.** 每个 feature 恰有一个 label 以 `(spec)` 结尾的子任务（通常 `Design it (spec)`）。其它都是执行 box，`/wf-architect` 只 tick 那一个。

**Feature lifecycle**：scope 随 feature 状态更新，每行显示什么、谁设它：
| State | Set by | The feature shows |
|---|---|---|
| `planned` · needs a decision | `/wf-scope` | 一个 box：`Design it (spec): /wf-architect <feature>` |
| `in-progress` (designed) | `/wf-architect` at spec capture | `Design it` 勾上；spec 链接；`Build it: /wf-develop <feature>` + 2-5 个 milestone；tier 收尾 box；浮出的 follow-up 登记 |
| `in-progress` (building) | `/wf-develop` | milestone 子 box 逐个 tick；填 code pointer |
| `in-progress` (verified) | `/wf-check verify` | `Build it` + milestone 全 tick；`Verify it` tick |
| `done` | 你决定时 | 跑过的 box 勾上，未跑的标 skipped；tier 最后一阶是建议的 done 时点 |

- **Next step** = 第一个未勾的 box（永远是命令或 tracked milestone）。
- **needs a decision** = 先跑 `/wf-architect`；否则直接 `/wf-develop`。
- **原子 build task 留在 spec 的 `## Build plan`，不在这里**：scope 只带 milestone rollup。
- **Status**：`planned` → `in-progress` → `done`，加 `existing`（workflow 前就有）和 `dropped`（移出范围，保留历史）。
- **Workflow**（header 行）是项目默认，develop 之后跑什么：`Beta` = `/wf-check verify` 再 `/wf-test`。
- **Pointer line**（`spec <n> · code in <path>`）：spec 链接由 `/wf-architect` 加，code 路径由 `/wf-develop` 加。
