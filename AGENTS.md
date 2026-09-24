<!-- managed by canon agents.yaml @ 2026-09-24 -->
## claude-code 约定

This file provides guidance to Claude Code (claude.ai/code) and other AI coding agents when working with code in this repository.

#### Project Overview

This is a **reverse-engineered / decompiled** version of Anthropic's official Claude Code CLI tool. The goal is to restore core functionality while trimming secondary capabilities. Many modules are stubbed or feature-flagged off. TypeScript strict mode is enforced — **`bun run precheck` 必须零错误通过**（包含 typecheck + lint fix + test）。

#### Git Commit Message Convention

使用 **Conventional Commits** 规范：

```
<type>: <描述>
```

常见 type：`feat`、`fix`、`docs`、`chore`、`refactor`

示例：
- `feat: 添加模型 1M 上下文切换`
- `fix: 修复初次登陆的校验问题`
- `chore: remove prefetchOfficialMcpUrls call on startup`

#### Commands

```bash
### Install dependencies
bun install

### Dev mode (runs cli.tsx with MACRO defines injected via -d flags)
bun run dev

### Dev mode with debugger (set BUN_INSPECT=9229 to pick port)
bun run dev:inspect

### Pipe mode
echo "say hello" | bun run src/entrypoints/cli.tsx -p

### Build (code splitting, outputs dist/cli.js + chunk files)
bun run build

### Build with Vite (alternative build pipeline)
bun run build:vite

### Test
bun test                                    # run all tests
bun test src/utils/__tests__/hash.test.ts   # run single file
bun test --coverage                         # with coverage report

### Lint & Format (Biome) — 日常开发用 precheck 代替单独调用
bun run lint              # lint check (全项目)
bun run lint:fix          # auto-fix lint issues
bun run format            # format all (全项目)
bun run check             # lint + format check (全项目)
bun run check:fix         # lint + format auto-fix

### Health check
bun run health

### Check unused exports
bun run check:unused

### Full check (typecheck + lint fix + test) — 任务完成后必须运行
bun run precheck

### Remote Control Server
bun run rcs

### Docs dev server (Mintlify)
bun run docs:dev
```

详细的测试规范、覆盖状态和改进计划见 `docs/testing-spec.md`。

#### Architecture

##### Runtime & Build

- **Runtime**: Bun (not Node.js). All imports, builds, and execution use Bun APIs.
- **Build**: `build.ts` 执行 `Bun.build()` with `splitting: true`，入口 `src/entrypoints/cli.tsx`，输出 `dist/cli.js` + chunk files。Build 默认启用 19 个 feature（见下方 Feature Flag 段）。构建后自动替换 `import.meta.require` 为 Node.js 兼容版本（产物 bun/node 都可运行）。构建时会将 `vendor/audio-capture/` 和 `src/utils/vendor/ripgrep/` 复制到 `dist/vendor/` 下。
- **Build (Vite)**: `vite.config.ts` + `scripts/post-build.ts`，代码分割模式，chunk 输出到 `dist/chunks/`。post-build 遍历 `dist/` 和 `dist/chunks/` 下所有 `.js` 文件做 `globalThis.Bun` 解构 patch，复制 vendor 文件到 `dist/vendor/`。
- **Vendor 路径解析**: 构建后 chunk 文件位于 `dist/` 或 `dist/chunks/` 下，vendor 二进制在 `dist/vendor/`。`src/utils/distRoot.ts` 提供共享的 `distRoot` 函数，通过 `import.meta.url` 路径中 `lastIndexOf('dist')` 或 `lastIndexOf('src')` 定位根目录。`ripgrep.ts`、`computerUse/setup.ts`、`claudeInChrome/setup.ts`、`updateCCB.ts` 均使用 `distRoot` 而非内联 `import.meta.url` 路径推算。`packages/audio-capture-napi/src/index.ts` 有独立的 `lastIndexOf('dist')` 逻辑，功能等价。
- **为什么 Vite 必须代码分割**: Bun/JSC 会全量解析单个大 JS 文件的 bytecode 和 JIT，单文件 17MB 产物导致 RSS 暴涨至 ~1GB（Node/V8 懒解析仅需 ~220MB）。代码分割为 600+ 小 chunk 后 Bun 按需加载，`--version` RSS 从 966MB 降至 35MB，完整加载从 1GB+ 降至 ~500MB。
- **Dev mode**: `scripts/dev.ts` 通过 Bun `-d` flag 注入 `MACRO.*` defines，运行 `src/entrypoints/cli.tsx`。默认启用全部 feature。
- **Module system**: ESM (`"type": "module"`), TSX with `react-jsx` transform.
- **Monorepo**: Bun workspaces — 17 个 workspace packages + 若干辅助目录 in `packages/` resolved via `workspace:*`。
- **Lint/Format**: Biome (`biome.json`)。覆盖 `src/`、`scripts/`、`packages/` 全项目（含 `packages/@ant/`）。`bun run lint` / `bun run lint:fix` / `bun run format` / `bun run check` / `bun run check:fix`。42 条规则因 decompiled 代码被关闭，仅保留 `recommended` 基线。
- **Pre-commit**: husky + lint-staged。提交时自动对暂存文件执行 `biome check --fix`（TS/JS）和 `biome format --write`（JSON）。
- **CI Lint**: `ci.yml` 在依赖安装后、类型检查前执行 `bunx biome ci .`，lint 或格式化不达标则 CI 失败。
- **Defines**: 集中管理在 `scripts/defines.ts`。版本号从 `package.json` 读取（不再硬编码）。
- **CI**: GitHub Actions — `ci.yml`（lint + 构建 + 测试）、`release-rcs.yml`（RCS 发布）、`update-contributors.yml`（自动更新贡献者）。

##### Entry & Bootstrap

1. **`src/entrypoints/cli.tsx`** — True entrypoint。`main()` 函数按优先级处理多条快速路径：
   - `--version` / `-v` — 零模块加载
   - `--dump-system-prompt` — feature-gated (DUMP_SYSTEM_PROMPT)
   - `--claude-in-chrome-mcp` / `--chrome-native-host`
   - `--computer-use-mcp` — 独立 MCP server 模式
   - `--daemon-worker=<kind>` — feature-gated (DAEMON)
   - `remote-control` / `rc` / `remote` / `sync` / `bridge` — feature-gated (BRIDGE_MODE)
   - `daemon` [subcommand] — feature-gated (DAEMON)
   - `ps` / `logs` / `attach` / `kill` / `--bg` — feature-gated (BG_SESSIONS)
   - `new` / `list` / `reply` — Template job commands
   - `environment-runner` / `self-hosted-runner` — BYOC runner
   - `--tmux` + `--worktree` 组合
   - 默认路径：加载 `main.tsx` 启动完整 CLI
2. **`src/main.tsx`** (~5674 行) — Commander.js CLI definition。注册大量 subcommands：`mcp` (serve/add/remove/list...)、`server`、`ssh`、`open`、`auth`、`plugin`、`agents`、`auto-mode`、`doctor`、`update` 等。主 `.action()` 处理器负责权限、MCP、会话恢复、REPL/Headless 模式分发。
3. **`src/entrypoints/init.ts`** — One-time initialization (telemetry, config, trust dialog)。

##### Core Loop

- **`src/query.ts`** — The main API query function. Sends messages to Claude API, handles streaming responses, processes tool calls, and manages the conversation turn loop.
- **`src/QueryEngine.ts`** — Higher-level orchestrator wrapping `query()`. Manages conversation state, compaction, file history snapshots, attribution, and turn-level bookkeeping. Used by the REPL screen.
- **`src/screens/REPL.tsx`** — The interactive REPL screen (React/Ink component). Handles user input, message display, tool permission prompts, and keyboard shortcuts.

##### API Layer

- **`src/services/api/claude.ts`** — Core API client. Builds request params (system prompt, messages, tools, betas), calls the Anthropic SDK streaming endpoint, and processes `BetaRawMessageStreamEvent` events.
- **7 providers**: `firstParty` (Anthropic direct), `bedrock` (AWS), `vertex` (Google Cloud), `foundry`, `openai`, `gemini`, `grok` (xAI)。
- Provider selection in `src/utils/model/providers.ts`。优先级：modelType 参数 > 环境变量 > 默认 firstParty。

##### Tool System

- **`src/Tool.ts`** — Tool interface definition (`Tool` type) and utilities (`findToolByName`, `toolMatchesName`).
- **`src/tools.ts`** — Tool registry. Assembles the tool list; tools are imported from `@claude-code-best/builtin-tools` package. Some tools are conditionally loaded via `feature()` flags or `process.env.USER_TYPE`.
- **`src/constants/tools.ts`** — `CORE_TOOLS` 白名单常量（38 个核心工具名），用于 `isDeferredTool` 白名单制判定。
- **`packages/builtin-tools/src/tools/`** — 60 个工具目录（含 shared/testing 等工具目录），通过 `@claude-code-best/builtin-tools` 包导出。主要分类：
  - **文件操作**: FileEditTool, FileReadTool, FileWriteTool, GlobTool, GrepTool
  - **Shell/执行**: BashTool, PowerShellTool, REPLTool
  - **Agent 系统**: AgentTool, TaskCreateTool, TaskUpdateTool, TaskListTool, TaskGetTool
  - **规划**: EnterPlanModeTool, ExitPlanModeV2Tool, VerifyPlanExecutionTool
  - **Web/MCP**: WebFetchTool, WebSearchTool, MCPTool, McpAuthTool
  - **调度**: CronCreateTool, CronDeleteTool, CronListTool
  - **工具发现**: SearchExtraToolsTool, ExecuteExtraTool, SyntheticOutput（CORE_TOOLS，用于延迟工具按需加载）
  - **其他**: LSPTool, ConfigTool, SkillTool, EnterWorktreeTool, ExitWorktreeTool 等
- **`src/tools/shared/`** / **`packages/builtin-tools/src/tools/shared/`** — Tool 共享工具函数。
- **`src/services/searchExtraTools/`** — TF-IDF 工具索引模块（`toolIndex.ts`），为延迟工具提供语义搜索能力。复用 `localSearch.ts` 的 TF-IDF 算法函数（`computeWeightedTf`、`computeIdf`、`cosineSimilarity` 已导出）。修改这些函数时需同步检查工具索引测试。`prefetch.ts` 的 `extractQueryFromMessages` 复用了 `skillSearch/prefetch.ts` 的同名导出函数，修改 skill prefetch 的该函数时需同步检查工具预取行为。工具预取使用独立的 `discoveredToolsThisSession` Set，与 skill prefetch 的去重集合互不影响。

##### UI Layer (Ink)

- **`src/ink.ts`** — Ink render wrapper with ThemeProvider injection.
- **`packages/@ant/ink/`** — Custom Ink framework（forked/internal），包含 components、core、hooks、keybindings、theme、utils。注意：不是 `src/ink/`。
- **老控制台兼容模式** — `packages/@ant/ink/src/core/legacyConsole.ts`：检测 Windows build < 17763（无 ConPTY 的老系统，如 1709/LTSC 内网机器）时自动启用；`log-update.ts` 的渲染循环每约 1 秒（`LEGACY_CONSOLE_RESET_MS`）用一次全量重绘替换增量 diff，自愈老 conhost 的光标漂移花屏。`CLAUDE_CODE_LEGACY_CONSOLE=1`/`=0` 可强制开/关。其他环境完全不走此路径。
- **`src/components/`** — 149 个组件目录/文件，渲染于终端 Ink 环境中。关键组件：
  - `App.tsx` — Root provider (AppState, Stats, FpsMetrics)
  - `Messages.tsx` / `MessageRow.tsx` — Conversation message rendering
  - `PromptInput/` — User input handling
  - `permissions/` — Tool permission approval UI
  - `design-system/` — 复用 UI 组件（Dialog, FuzzyPicker, ProgressBar, ThemeProvider 等）
- Components use React Compiler runtime (`react/compiler-runtime`) — decompiled output has `_c()` memoization calls throughout.

##### State Management

- **`src/state/AppState.tsx`** — Central app state type and context provider. Contains messages, tools, permissions, MCP connections, etc.
- **`src/state/AppStateStore.ts`** — Default state and store factory.
- **`src/state/store.ts`** — Zustand-style store for AppState (`createStore`).
- **`src/state/selectors.ts`** — State selectors.
- **`src/bootstrap/state.ts`** — Module-level singletons for session-global state (session ID, CWD, project root, token counts, model overrides, client type, permission mode).

##### Workspace Packages

| Package | 说明 |
|---------|------|
| `packages/@ant/ink/` | Forked Ink 框架（components、hooks、keybindings、theme） |
| `packages/@ant/computer-use-mcp/` | Computer Use MCP server（截图/键鼠/剪贴板/应用管理） |
| `packages/@ant/computer-use-input/` | 键鼠模拟（dispatcher + darwin/win32/linux backend） |
| `packages/@ant/computer-use-swift/` | 截图 + 应用管理（dispatcher + per-platform backend） |
| `packages/@ant/claude-for-chrome-mcp/` | Chrome 浏览器控制（通过 `--chrome` 启用） |
| `packages/@ant/model-provider/` | Model provider 抽象层 |
| `packages/builtin-tools/` | 内置工具集（60 个 tool 实现，通过 `@claude-code-best/builtin-tools` 导出） |
| `packages/agent-tools/` | Agent 工具集 |
| `packages/acp-link/` | ACP 代理服务器（WebSocket → ACP agent 桥接） |
| `packages/mcp-client/` | MCP 客户端库 |
| `packages/remote-control-server/` | 自托管 Remote Control Server（Docker 部署，含 Web UI）— Web UI 已重构为 React + Vite + Radix UI，支持 ACP agent 接入 |
| `packages/cloud-artifacts/` | 独立 Cloudflare Worker + R2 服务：POST `/upload` HTML 上传返回 hash URL，GET `/<7d\|30d>/<id>.html` 由 Worker 代理读取；R2 lifecycle rule 自动 7/30 天过期 |
| `packages/audio-capture-napi/` | 原生音频捕获（已恢复） |
| `packages/color-diff-napi/` | 颜色差异计算（完整实现，11 tests） |
| `packages/image-processor-napi/` | 图像处理（已恢复） |
| `packages/modifiers-napi/` | 键盘修饰键检测（macOS FFI 实现） |
| `packages/url-handler-napi/` | URL scheme 处理（环境变量 + CLI 参数读取） |
| `packages/weixin/` | 微信集成（非 workspace 包） |

辅助目录（无 package.json，非 workspace 包）: `langfuse-dashboard`（Langfuse 面板）、`shared-web-ui`（共享 Web UI 组件）、`highlight-code`（代码高亮）、`claude-pencil`（编辑器）、`vscode-ide-bridge`（VS Code 桥接）、`pokemon`（示例/测试）。

##### Bridge / Remote Control

- **`src/bridge/`** — Remote Control / Bridge 模式。feature-gated by `BRIDGE_MODE`。包含 bridge API、会话管理、JWT 认证、消息传输、权限回调等。Entry: `bridgeMain.ts`。
- **`packages/remote-control-server/`** — 自托管 RCS，支持 Docker 部署，含 Web UI 控制面板（React 19 + Vite + Radix UI）。支持 ACP agent 通过 acp-link 接入（ACP WebSocket handler、relay handler、SSE event stream）。通过 `bun run rcs` 启动。
- CLI 快速路径: `claude remote-control` / `claude rc` / `claude bridge`。
- 详见 `docs/features/remote-control-self-hosting.md`。

##### HTML Artifact Hosting

- **`packages/cloud-artifacts/`** — 独立 Cloudflare Worker + R2 服务，类似 `remote-control-server/` 的"独立部署服务"定位，**不被主 CLI import**。Worker 处理 `POST /upload`（Bearer token 鉴权 + text/html 校验 + 10MB 上限 + ttl∈{7,30}）和 `GET /<7d|30d>/<id>.html`（从 R2 读 + Cache-Control: max-age=86400）。R2 用 prefix + lifecycle rule 实现 TTL（`7d/` 删 7 天、`30d/` 删 30 天），Worker 不参与过期处理。ID 默认 `nanoid(21)`（126 bit 熵），可指定 `?hash=` 自定义 ID（覆盖语义：先删 7d/30d prefix 旧 key 再写新 key）。Worker 用 `wrangler types` 生成的全局 `Env` 类型（`worker-configuration.d.ts`，已 gitignore），不依赖 `@cloudflare/workers-types`。部署用 `npm create cloudflare@latest` 初始化 + `bun run setup`（创建 bucket + lifecycle + secret）+ `bun run deploy`。生产出口经 Deno Deploy 边缘代理（`https://cloud-artifacts.claude-code-best.win`），副作用是 HTTP status code 被抹平为 200（body 的 `{error}` 字段仍保留）。详见 `packages/cloud-artifacts/README.md`。

##### ACP Protocol (Agent Client Protocol)

- **`src/services/acp/`** — ACP agent 实现，包含 `agent.ts`（AcpAgent 类）、`bridge.ts`（Claude Code ↔ ACP 桥接）、`permissions.ts`（权限处理）、`entry.ts`（入口）。
- **`packages/acp-link/`** — ACP 代理服务器，将 WebSocket 客户端桥接到 ACP agent。提供 `acp-link` CLI 命令，支持自定义端口/HTTPS/认证/会话管理、RCS 集成（REST 注册 + WS identify 两步流程）、权限模式透传（fallback: 客户端传值 > config > `ACP_PERMISSION_MODE` 环境变量）。
- ACP 权限管道改进：`createAcpCanUseTool` 统一权限流水线，`applySessionMode` 模式同步，`bypassPermissions` 可用性检测（非 root/sandbox 环境）。
- ACP Plan 可视化已支持 `session/update plan` 类型的消息展示（PlanView 组件，含进度条/状态图标/优先级标签）。

##### Daemon Mode

- **`src/daemon/`** — Daemon 模式（长驻 supervisor）。feature-gated by `DAEMON`。包含 `main.ts`（entry）和 `workerRegistry.ts`（worker 管理）。

##### Context & System Prompt

- **`src/context.ts`** — Builds system/user context for the API call (git status, date, CLAUDE.md contents, memory files).
- **`src/utils/claudemd.ts`** — Discovers and loads CLAUDE.md files from project hierarchy.

##### Feature Flag System

Feature flags control which functionality is enabled at runtime. 代码中统一通过 `import { feature } from 'bun:bundle'` 导入，调用 `feature('FLAG_NAME')` 返回 `boolean`。

**启用方式**: 环境变量 `FEATURE_<FLAG_NAME>=1`。例如 `FEATURE_BUDDY=1 bun run dev`。

**Build 默认 features**（65+ 个，见 `build.ts` 中 `DEFAULT_BUILD_FEATURES`）:
- 基础: `BUDDY`, `TRANSCRIPT_CLASSIFIER`, `BRIDGE_MODE`, `AGENT_TRIGGERS_REMOTE`, `CHICAGO_MCP`, `VOICE_MODE`
- 统计/缓存: `SHOT_STATS`, `PROMPT_CACHE_BREAK_DETECTION`, `TOKEN_BUDGET`
- P0 本地: `AGENT_TRIGGERS`, `ULTRATHINK`, `BUILTIN_EXPLORE_PLAN_AGENTS`, `LODESTONE`
- P1 API 依赖: `EXTRACT_MEMORIES`, `VERIFICATION_AGENT`, `KAIROS_BRIEF`, `AWAY_SUMMARY`, `ULTRAPLAN`
- P2: `DAEMON`, `ACP`
- 工作流: `WORKFLOW_SCRIPTS`, `HISTORY_SNIP`, `MONITOR_TOOL`, `KAIROS`
- 多 worker: `COORDINATOR_MODE`, `BG_SESSIONS`, `TEMPLATES`
- 连接器: `CONNECTOR_TEXT`, `COMMIT_ATTRIBUTION`, `DIRECT_CONNECT`
- 实验性: `EXPERIMENTAL_SKILL_SEARCH`, `EXPERIMENTAL_SEARCH_EXTRA_TOOLS`
- 模式: `POOR`, `SSH_REMOTE`
- 已禁用: `CONTEXT_COLLAPSE`, `FORK_SUBAGENT`, `UDS_INBOX`, `LAN_PIPES`, `REVIEW_ARTIFACT`, `TEAMMEM`, `SKILL_LEARNING`

**Dev mode 默认**: 全部启用（见 `scripts/dev.ts`）。

**类型声明**: `src/types/internal-modules.d.ts` 中声明了 `bun:bundle` 模块的 `feature` 函数签名。

**新增功能的正确做法**: 保留 `import { feature } from 'bun:bundle'` + `feature('FLAG_NAME')` 的标准模式，在运行时通过环境变量或配置控制，不要绕过 feature flag 直接 import。

##### Multi-API 兼容层

所有兼容层均采用流适配器模式：将第三方 API 格式转为 Anthropic 内部格式，下游代码完全不改。通过 `/login` 命令配置。

###### OpenAI 兼容层

通过 `CLAUDE_CODE_USE_OPENAI=1` 启用，支持 Ollama/DeepSeek/vLLM 等任意 OpenAI Chat Completions 协议端点。含 DeepSeek thinking mode 支持。

- **`src/services/api/openai/`** — client、消息/工具转换、流适配、模型映射
- 关键环境变量：`CLAUDE_CODE_USE_OPENAI`、`OPENAI_API_KEY`、`OPENAI_BASE_URL`、`OPENAI_MODEL`

###### Gemini 兼容层

通过 `CLAUDE_CODE_USE_GEMINI=1` 启用。独立环境变量体系。

- **`src/services/api/gemini/`** — client、模型映射、类型定义
- 关键环境变量：`GEMINI_API_KEY`（必填）、`GEMINI_MODEL`（直接指定）、`GEMINI_DEFAULT_SONNET_MODEL`/`GEMINI_DEFAULT_OPUS_MODEL`（按能力映射）
- 模型映射优先级：`GEMINI_MODEL` > `GEMINI_DEFAULT_*_MODEL` > `ANTHROPIC_DEFAULT_*_MODEL`(已废弃) > 原样返回

###### Grok 兼容层

通过 `CLAUDE_CODE_USE_GROK=1` 启用。自定义模型映射支持 xAI Grok API。

- **`src/services/api/grok/`** — client、模型映射

详见各兼容层的 docs 文档。

##### 穷鬼模式（Budget Mode）

- 通过 `/poor` 命令切换，持久化到 `settings.json`。
- 启用后跳过 `extract_memories`、`prompt_suggestion` 和 `verification_agent`，显著减少 token 消耗。
- 实现在 `src/commands/poor/poorMode.ts`。

##### Stubbed/Deleted Modules

| Module | Status |
|--------|--------|
| Computer Use (`@ant/*`) | Restored — macOS + Windows + Linux（后端完整度不一） |
| `*-napi` packages | 全部已恢复/实现：`audio-capture-napi`、`image-processor-napi` 已恢复；`color-diff-napi` 完整；`modifiers-napi`（macOS FFI）；`url-handler-napi`（环境变量+CLI） |
| Voice Mode | Restored — Push-to-Talk 语音输入（需 Anthropic OAuth） |
| OpenAI/Gemini/Grok 兼容层 | Restored |
| Remote Control Server | Restored — 自托管 RCS + Web UI |
| `packages/shell/`, `packages/swarm/`, `packages/mcp-server/`, `packages/cc-knowledge/` | Removed — 功能合并或废弃 |
| Analytics / GrowthBook / Sentry | Empty implementations |
| Magic Docs / LSP Server | Restored — Magic Docs 自动更新 + LSP 服务器管理器 |
| Plugins / Marketplace | Restored — 插件安装/卸载/启用/禁用 + Marketplace 浏览 |
| MCP OAuth | Simplified |

##### Key Type Files

- **`src/types/global.d.ts`** — Declares `MACRO`, `BUILD_TARGET`, `BUILD_ENV` and internal Anthropic-only identifiers.
- **`src/types/internal-modules.d.ts`** — Type declarations for `bun:bundle`, `bun:ffi`, `@anthropic-ai/mcpb`.
- **`src/types/message.ts`** — Message type hierarchy (UserMessage, AssistantMessage, SystemMessage, etc.).
- **`src/types/permissions.ts`** — Permission mode and result types.

#### Testing

- **框架**: `bun:test`（内置断言 + mock）
- **单元测试**: 就近放置于 `src/**/__tests__/`，文件名 `<module>.test.ts`
- **集成测试**: `tests/integration/` — 6 个文件（cli-arguments, context-build, message-pipeline, tool-chain, autonomy-lifecycle-user-flow, dependency-overrides）
- **共享 mock/fixture**: `tests/mocks/`（api-responses, file-system, fixtures/）
- **命名**: `describe("functionName")` + `test("behavior description")`，英文
- **包测试**: `packages/` 下各包也有独立测试（如 `color-diff-napi` 11 tests）

##### Mock 使用规范

**只 mock 有副作用的依赖链，不 mock 纯函数/纯数据模块。**

被迫 mock 的根源：`log.ts` / `debug.ts` → `bootstrap/state.ts`（模块级 `realpathSync` / `randomUUID` 副作用）。必须 mock 的模块：`log.ts`、`debug.ts`、`bun:bundle`、`settings/settings.js`、`config.ts`、`auth.ts`、第三方网络库。

**`log.ts` 和 `debug.ts` 使用共享 mock**（`tests/mocks/log.ts` / `tests/mocks/debug.ts`），不要在测试文件中内联 mock 定义。使用方式：

```ts
import { logMock } from "../../../tests/mocks/log";
mock.module("src/utils/log.ts", logMock);

import { debugMock } from "../../../../tests/mocks/debug";
mock.module("src/utils/debug.ts", debugMock);
```

源文件导出变更时只需更新 `tests/mocks/` 下的对应文件，不需要逐个修改测试。

不要 mock：纯函数模块（`errors.ts`、`stringUtils.js`）、mock 值与真实实现相同的模块、mock 路径与实际 import 不匹配的模块。

路径规则：统一用 `.ts` 扩展名 + `src/*` 别名路径，禁止双重 mock 同一模块。

###### 跨文件 mock 污染（process-global `mock.module`）

**Bun 的 `mock.module` 是进程全局的（last-write-wins），不是 per-file 隔离的。** 一个测试文件的 `mock.module` 会污染同一进程中所有其他测试文件的 `require`/`import`。

**关键事实（Bun 1.x 实测验证）：**
- 测试文件执行顺序**不是严格字母序**，不要假设文件 A 一定在文件 B 之前执行。
- `mock.module` 在 `beforeAll` 内部调用时**不会被提升**（hoist），但仍会污染后续加载的文件。
- `require()` 和 `import()` 共享同一模块注册表，`mock.module` 对两者都生效。
- 一个模块一旦被某个文件的 `mock.module` 替换，同一进程中所有后续 `require`/`import` 都会返回 mock 值，即使调用方使用不同的 specifier 路径。

**核心规则：不要 mock 被测模块的上层业务模块。**

错误做法（会污染同目录的 `api.test.ts`）：
```ts
// launchSchedule.test.ts — 直接 mock 源 API 模块 ❌
mock.module('src/commands/schedule/triggersApi.js', () => ({
  listTriggers: listTriggersMock,
  // ...
}))
```

正确做法（mock 底层 HTTP 层，不污染业务模块）：参考 `launchSkillStore.test.ts`、`launchVault.test.ts` 的模式。
```ts
// launchSchedule.test.ts — mock axios 而非 triggersApi ✅
import { setupAxiosMock } from '../../../../tests/mocks/axios.js'

const axiosHandle = setupAxiosMock()
axiosHandle.stubs.get = axiosGetMock
axiosHandle.stubs.post = axiosPostMock

beforeAll(() => { axiosHandle.useStubs = true })
afterAll(() => { axiosHandle.useStubs = false })
```

**判断标准：** 如果目录下同时有 `launch*.test.ts`（集成测试）和 `api.test.ts`（回归测试），`launch*.test.ts` 必须 mock axios 而非源 API 模块。`api.test.ts` 需要测试真实 API 模块的 HTTP 方法/URL/错误处理逻辑，被 mock 后就无法测试。

**排查 mock 污染的方法：**
1. 单独运行可疑文件确认其通过：`bun test path/to/suspect.test.ts`
2. 与同目录其他文件一起运行定位污染源：`bun test path/to/__tests__/`
3. 在两个文件中各加 `console.error('[file] milestone')` 追踪实际执行顺序
4. 检查 `mock.module` 的 specifier 是否与同目录其他测试的 `require`/`import` 路径解析到同一模块

##### 类型检查

项目使用 TypeScript strict 模式，**tsc 必须零错误**。每次修改后运行：

```bash
bun run precheck
```

**类型规范**：
- 生产代码禁止 `as any`；测试文件中 mock 数据可用 `as any`
- 类型不匹配优先用 `as unknown as SpecificType` 双重断言，或补充 interface
- 未知结构对象用 `Record<string, unknown>` 替代 `any`
- 联合类型用类型守卫（type guard）收窄，不要强转
- `msg.request` 属性访问：`const req = msg.request as Record<string, unknown>`
- Ink `color` prop：用 `as keyof Theme` 而非 `as any`

#### Working with This Codebase

- **precheck must pass** — `bun run precheck`（typecheck + lint fix + test）必须零错误，任何修改都不能引入新的类型/lint/测试错误。
- **Feature flags** — 默认全部关闭（`feature()` 返回 `false`）。Dev/build 各有自己的默认启用列表。不要在 `cli.tsx` 中重定义 `feature` 函数。
- **React Compiler output** — Components have decompiled memoization boilerplate (`const $ = _c(N)`). This is normal.
- **`bun:bundle` import** — `import { feature } from 'bun:bundle'` 是 Bun 内置模块，由运行时/构建器解析。不要用自定义函数替代它。**`feature()` 只能直接用在 `if` 语句或三元表达式的条件位置**（Bun 编译器限制），不能赋值给变量、不能放在箭头函数体里、不能作为 `&&` 链的一部分。正确：`if (feature('X')) {}` 或 `feature('X') ? a : b`。
- **`src/` path alias** — tsconfig maps `src/*` to `./src/*`. Imports like `import { ... } from 'src/utils/...'` are valid.
- **MACRO defines** — 集中管理在 `scripts/defines.ts`。Dev mode 通过 `bun -d` 注入，build 通过 `Bun.build({ define })` 注入。修改版本号等常量只改这个文件。
- **构建产物兼容 Node.js** — `build.ts` 会自动后处理 `import.meta.require`，产物可直接用 `node dist/cli.js` 运行。
- **Biome 配置** — 42 条 lint 规则因 decompiled 代码被关闭，仅保留 `recommended` 基线。格式化覆盖全项目（`src/`、`scripts/`、`packages/`，含 `packages/@ant/`）。`.tsx` 文件用 120 行宽 + 强制分号；其他文件 80 行宽 + 按需分号。JSON 格式化已启用。`.editorconfig` 与 Biome 配置对齐（2-space 缩进）。修改任何代码后应运行 `bun run precheck` 确认无类型/lint/格式/测试问题，pre-commit hook 会自动拦截不合格提交。
- **tsc 与 Biome 冲突处理** — 当 tsc 要求声明属性（赋值使用）但 biome 报 `noUnusedPrivateClassMembers`（只写不读）时，用 `// biome-ignore lint/correctness/noUnusedPrivateClassMembers: <原因>` 抑制 lint 警告，保留类型声明。`biome ci` 必须零 warnings。
- **`@ts-expect-error` 维护** — 只在下方代码确实有类型错误时保留 `@ts-expect-error`。如果类型系统已更新导致 directive 变为 unused（TS2578），直接移除注释。MACRO 替换产生的永假比较（如 `'production' === 'development'`）仍需保留 `@ts-expect-error`。
- **Ink 框架在 `packages/@ant/ink/`** — 不是 `src/ink/`（该目录不存在）。Ink 相关的组件、hooks、keybindings 都在 packages 中。
- **Provider 优先级** — `modelType` 参数 > 环境变量 > 默认 `firstParty`。新增 provider 需在 `src/utils/model/providers.ts` 注册。

#### Design Context

Impeccable 设计上下文保存在 `.impeccable.md` 中。设计 Web UI（RCS 控制面板、文档站、着陆页）时必须参考该文件。

##### 核心设计原则

1. **Considered over clever** — 每个设计选择都应感觉有意为之，而非追逐潮流
2. **Warmth through subtlety** — 通过橙色色调的中性色、留白布局、有温度的文案来传达温暖
3. **Density with clarity** — 技术用户需要信息密度，但不能混乱
4. **Community voice** — 设计应感觉是由使用者创造的，而非遥远的设计团队
5. **Anthropic's shadow** — 遵循 Anthropic 的设计直觉：干净的布局、充足的间距、温暖的色温

##### 品牌色

- 主色：Claude Orange `#D77757`（terra cotta）
- 辅色：Claude Blue `#5769F7`
- 暗色模式使用温暖的深色表面（非冷蓝黑色）

##### 目标用户

技术团队/企业，在专业工作流中使用 AI 辅助编程。友好的开源社区氛围，非企业 SaaS 风格。

##### 视觉参考

Anthropic 公司的设计风格 — 干净、考究、温暖的底色。大量留白，以排版为核心。避免 AI 产品常见的设计套路（渐变文字、玻璃态、霓虹色）。

## 发现处置纪律

自动检查（gate 的 `FAIL`/`WARN`、`jev` L3 语义发现、CRG / `ocr review` 审查意见）
产出的是**发现**，不是判决。每条发现都必须被显式处置，不存在"绕过"这个选项。

### 先读规范，再改代码

1. 拿到 finding，先读规则原文，确认这条发现到底要求什么：
   - gate 规则总览：`.githooks/GATE_HANDBOOK.md`（无则 `canon/manual/gate.md`）
   - 单条规则的参数（匹配范围 / 严重度 / harness）：`.githooks/spec/**/<rule>.yaml`
   - 项目适配说明（本仓为什么这么定）：`.agent/rules/gates.md`
2. 不确定 finding 是否成立时，读完规则仍不能判定 → **记为待裁决**并在交付记录里写明，
   不要凭猜测改代码，也不要直接忽略。

### 按根因修，不按症状修

- finding 指向的**约束**是根因。修代码使约束成立，而不是让检查不再报。
- 修完自问：这条约束在本仓还成立吗？下次同类改动还会不会触发？

### 完整读输出，不截断

- 拦截信息**逐条读完**再动手。`| head -5`、`| tail`、`grep -v` 会吞掉后面的 finding，
  让人误以为已经修完。
- 报告里出现「N checks passed」时，确认 N 覆盖了你改动的部分。

### 禁止糊弄式修复

以下动作一律视为违规（无论 gate 是否因此变绿）：

| 禁止 | 为什么 | 正确做法 |
|---|---|---|
| 改 `.githooks/spec/` 规则、降低 `fail_severity`、删 spec 文件 | 把约束改没，不是修问题 | 开 issue 说明规则缺陷，交维护者决定 |
| `--no-verify`、跳过钩子、直接推 | 绕过的是整个门禁体系 | 修到清零；规则有误走 issue |
| `head` / `tail` / `grep -v` 截断输出后当没看见 | 后面的 finding 被吞 | 完整读输出 |
| 加 `#[allow(dead_code)]` / `# noqa` 消告警 | 压制信号而非解决 | 删无用代码，或写清保留理由 |
| 建空文件 / 空目录 / 占位文件骗过目录类规则 | 结构噪音 | 真按规则合并或删除 |
| 给无断言测试塞 `assert!(true)` | 测试变成永真装饰 | 断言真实行为；无行为可测就删测试 |
| 拆分 / 改名 / 移动只为躲过匹配范围 | 破坏结构换绿灯 | 按规则设计的结构改 |

### 逐条处置并留下书面说明

- **每条 finding 一个处置**：修复（默认）或**书面驳回**。
- 修复 → 在交付记录里写：`规则 ID → 根因 → 改法（file:line）`。
- 驳回 → 必须写 `规则 ID + 不修理由 + 依据`，由维护者裁决。沉默即违规。
- 交付记录落点：PR 正文 `## Delivery record` 段，或 issue 的交付评论。
- WARN 与 FAIL 同等对待。WARN 只是不拦，不是可忽略。

### 规范层级

- `.githooks/` 是 gate 领地：agent 不改规则。
- `.agent/rules/`、`specs/rules/` 是规范正本：发现规则与现实冲突 → 提 issue，不自行改写。
- 本纪律与各仓既有条款冲突时，以本纪律为准（它更严格）。

## 代码风格

### 命名与结构

- 函数名动宾结构、见名知目的（`parse_channel_config` 而不是 `do_config`）。
- 公共 API 写文档注释（用途、参数、错误、示例），模块头写 `//!`。
- 变量与类型不缩写到看不出含义；短名只留给公认短物（`id`、`ctx`、`err`）。

### 注释

- 注释写**为什么**，不复述代码在做什么。
- 不留 AI 味注释（`// Step 1:` / `// This function` / `// 该函数…` / `// 首先…然后…`）。
- 需要解释的复杂逻辑，宁可提取成命名清晰的函数，也不要靠注释块描述流程。
- 注释掉的代码直接删；git 记得它。

### 占位符与未完成

- 未实现的函数或 trait 用语言原生宏，并带 issue 号：
  - Rust：`todo!("TODO(#123): 说明这里要做什么")` / `unimplemented!("…")`
- TODO / FIXME 注释必须带 issue 号：`// TODO(#123): …`。
- 不留空的 `todo!()` / `pass` / `NotImplemented` 桩而无说明。

### 复用与删除

- 动手前先找同仓同类实现与已装依赖。已有工具能解决就不新写。
- 新增依赖前确认：标准库能做完？已装依赖能做？确实都需要才加。
- **删除优于新增**：不留兼容垫片、旧别名、废弃分支、注释掉的旧实现。
- 改了接口就同步迁移所有调用方，不留双路径兼容。

### 工具

- 命名、缩进、格式化交给项目工具（`cargo fmt` / `gofmt` / `ruff format` / `prettier` / `biome`），
  不手工对齐，不在格式化工具之外争论风格。
- lint 报错逐条判断：真问题就修；误报就在规则允许的方式下局部豁免并写明理由，
  不整文件关掉。

## 构建与验证

### 基线

- 改动前先确认基线状态。基线已经红就先说清，别把自己的问题和既有问题混在一起报。

### 验证行为，不是验证代码存在

- 改完跑**真实命令**验证："跑一下" = 启动实际程序、调用实际接口、发真实请求、观察输出或状态。
- bug 修复先复现再修，修完确认复现路径不再触发。
- 永久性改动要留一个能抓住真实回归的检查。
- 测可观察行为与边界：状态迁移、转换、优先级、真实错误、边界值。
  不测 plumbing、不断言源码文本、不写永真断言、不测 mock 的回声。
- 测试与被测文件就近放 `tests/`（同名对应），保持全量套件可通过。

### 重命令放对位置

- 全量测试、全量构建、全量 lint 放 CI 或收尾阶段，不在改动过程中反复跑。
- 本地只跑轻量、快的针对性检查（单 crate `cargo check`、单包测试、`fmt --check`、
  类型检查）。
- 需要本地跑重命令时，套资源限制（`cpulimit -l 65 -i --` 或本仓等价手段），
  不抢占用户正在用的 CPU。
- 装依赖、打包等命令同样受限。

### 收尾

- 一次跑完该跑的检查（测试 + lint + 类型），不在半成品状态下宣称通过。
- 验证不了的部分（缺运行环境、缺凭据、缺硬件）明确说"未验证 + 为什么"，
  不把"没跑"说成"通过"。
- 不因为失败就改测试迎合实现。测试红了先判断是实现错还是测试错。

## 破坏性操作与敏感信息

### 删除

- 删文件前确认它确实是废弃物（生成物、已合并的临时文件），不是"看起来没用"。
- 用可恢复的方式删（`gio trash`），不用不可恢复的直接删除。
- `rm -rf`、覆盖写、清空数据库这类不可逆操作：**先说明影响，等确认**。
- 删的是别人的产物、你不理解用途的文件、或 gitignore 里的东西 → 停下来问。

### 敏感与不可逆

- 凭据、token、密钥、私钥：不打印到输出、不写进提交、不粘到 issue/PR 正文。
- 不擅自 dump 整个配置文件或环境变量（可能含密钥）。要看就只看需要的字段。
- 系统级配置、字体、全局环境、dotfiles 里的全局项：默认别动，改动前先问。
- 数据库迁移、配置格式变更、依赖大版本升级：先确认可回滚。

### 安装与全局改动

- 装包、改 PATH、装 systemd 服务、改 shell 配置：先确认再动。
- 写进 dotbot / 配置管理器托管范围的路径前，先确认该由谁管。
- 不可逆的系统级改动（分区、引导、网络栈）一律先问，不自行执行。

## 调查与审查

### 先建图，再查调用

- 调查陌生代码先建调用图谱（`code-review-graph update`）再查调用关系，
  不逐文件翻、不靠 grep 猜。
- 改共享逻辑前先看影响面（谁在调、调了会怎样），再动。

### 审查两层

1. **结构层**：`code-review-graph detect-changes` 看结构影响、循环依赖、风险面。
2. **规范层**：`ocr review`（**代码审查工具**，与 OCR 截图识别无关）看代码规范。
   按模块分批喂，不要一次性喂整个仓。

- 审查发现逐条处置：修或书面驳回（同发现处置纪律）。
- 改完核心逻辑后跑一次工具审查再收工。

### 写代码的模型 ≠ 审查的模型

- 自己写的代码自己审有盲区。审查方尽量指定与写作不同的模型。
- 无法可靠判断"这段是谁写的" → 开工前问一句，别猜。

### UI 验证

- 交互元素加 `data-testid`（值取稳定标识，如 `name` 属性），容器加 `role` + `aria-label`。
- 冒烟验证用结构化快照（`tab.ariaSnapshot()`）做 role / name / testid 断言。
- 禁区：只靠截图肉眼判断、用 class 选择器断言、绕过结构化快照直接提 PR。
- 截图能证明"看起来对"，不能证明"结构对、可访问、可自动化"。

### 别造 demo 污染真实仓

- 验证 issue/PR 流程、gh 拦截、规则改动，用专用沙盒仓（如 `demo-githooks`），
  不在业务仓创建 demo issue/PR。

## 提交与 PR

### 分支

- 默认分支是 `main`（本仓若不同以本仓为准），功能从默认分支拉。
- 一个任务一个分支，分支名带类型前缀（`feat/` / `fix/` / `refactor/` / `chore/`）。
- 合并后清理已合并分支与 worktree，不留 stale 分支。

### Commit

- 标题走 conventional commit（`feat:` / `fix:` / `refactor:` / `docs:` / `chore:` /
  `test:` / `ci:` / `build:` / `perf:` / `style:` / `revert:`）。
- 标题**用英文**，正文可用中文。
- 一个 commit 一件事。不把无关改动、格式化噪声、生成物混进逻辑改动。
- 提交前跑对应检查（`gate pre-commit` / `gate pre-push`），不靠推送失败才发现。

### Issue

- 标题中文；正文 heading 英文、内容中文。
- sub-issue 必须自包含：正文不写 `Parent:` / `Related:` / PR 占位符，直接写清它要什么。
- 关闭前 `Done when` 的 checkbox 全勾。

### PR

- 标题纯英文（conventional commit 风格）；正文小节标题英文、内容中文。
- 正文按仓库模板（`.github/PULL_REQUEST_TEMPLATE.md`）写：背景 / 改了什么 / 为什么 /
  实现步骤 / 交付记录 / 怎么验证 / 检查清单。
- 关联 issue 用 `Fixes #<n>` 收尾行；draft 阶段用 `Related #<n>`，合并授权前改 `Fixes`。
- 开启或更新 PR 后看 CI 结果到底（`gh pr checks`），红了就修，不等用户来问。
- 被 gate 拦下就修代码，**不改规则**。规则确有缺陷 → 开 issue 交维护者裁决。

### 收尾

- 收尾时清掉：已合并分支、临时 worktree、临时进程、跑完的 dev server。
- 资源及时释放；只保留维护者需要的进程（如用户要看的 web 前端）。

## 工具与命令

- 先用仓库已有的构建/测试/检查入口（`Makefile`、`justfile`、`package.json` scripts、`.githooks/hooks/`），不自己拼裸命令。
- 装依赖、跑重命令（长构建、全量测试、打包）前确认不会抢占用户正在用的资源。
- 长驻进程（dev server、watcher、调试器）用后台管理，不用一次性命令挂着。
- 破坏性操作（删除目录、系统级配置、凭据）先停下来说明影响，确认后再做。
- 命令跑不通时读完整输出，不要只看第一行就下结论。

## 子代理与并行

- 派子代理时 prompt 写全：目标文件 / 符号、要做什么、验收标准、明确不做什么。
- 子代理之间不共享未写进文件的结论；结论落文件，不落聊天。
- 独立切片才并行；有依赖的按序做。
- 子代理声称改完的东西要自己核对，不以"它说完成了"为凭据。
- 大范围改动派只读代理先摸清结构，再动手改。
