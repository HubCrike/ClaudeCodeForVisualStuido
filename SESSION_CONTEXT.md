# ClaudeCodeForVS SDK 迁移 - 会话上下文

> 此文档用于记录 AI 辅助迁移的上下文信息，便于后续会话继续工作

**最后更新**: 2026-01-14

---

## 1. 项目概述

**项目名称**: ClaudeCodeForVS  
**项目类型**: Visual Studio 扩展 (VSIX)

**技术栈**:
- 后端: C# (.NET, Visual Studio SDK)
- 前端: Vue 3 + TypeScript (WebView2)
- 当前 AI 集成: Claude Code CLI 进程

**迁移目标**: 从 Claude Code CLI 迁移到 `@anthropic-ai/claude-agent-sdk` TypeScript SDK

---

## 2. 已完成的工作

### 2.1 项目分析 ✅

已分析的核心文件:

| 文件 | 路径 | 分析内容 |
|-----|------|---------|
| CLI 服务 | `src/ClaudeCodeForVS/Services/ClaudeCodeCommandService.cs` | 进程管理、参数构建、输出解析 |
| 视图模型 | `src/ClaudeCodeForVS/ViewModels/ChatViewModel.cs` | 状态管理、消息处理 |
| 前端入口 | `src/ClaudeCodeForVS/frontend/src/App.vue` | UI 结构 |
| VS 桥接 | `src/ClaudeCodeForVS/frontend/src/utils/vsbridge.ts` | C#-JS 通信 |

### 2.2 SDK 文档研究 ✅

已研究的 SDK 文档:

| 文档 | 位置 | 关键内容 |
|-----|------|---------|
| TypeScript 参考 | `docs/SDK/.../typescript.html` | `query()`, `tool()`, Options |
| 权限系统 | `docs/SDK/.../permissions.html` | `canUseTool`, 权限模式 |
| 会话管理 | `docs/SDK/.../sessions.html` | `resume`, `forkSession` |
| 快速开始 | `docs/SDK/.../quickstart.html` | 基本用法 |

### 2.3 计划书生成 ✅

- 生成了完整的迁移计划书: `SDK_MIGRATION_PLAN.md`
- 包含 10 个章节、6 个实施阶段
- 预计工期: 10-11 周

---

## 3. 关键架构决策

### 3.1 技术选型

| 决策点 | 选择 | 理由 |
|-------|------|------|
| SDK 运行环境 | Node.js 子进程 | SDK 仅支持 TS/Python |
| 进程通信协议 | JSON-RPC 2.0 | 标准化、易调试 |
| 权限 UI 位置 | Vue.js 前端 | 与现有 UI 风格一致 |

### 3.2 核心问题定位

当前代码中的问题行:

```csharp
// ClaudeCodeCommandService.cs
arguments.Append($" --permission-mode bypassPermissions");  // ← 绕过所有安全检查
```

迁移后的解决方案:

```typescript
// TypeScript SDK
permissions: {
  canUseTool: async (toolRequest) => {
    // 发送到前端 UI，等待用户决策
    return await requestUserPermission(toolRequest);
  },
}
```

---

## 4. 待实施任务

### 4.1 阶段 1: 基础设施 (下一步)

- [ ] 创建 `src/ClaudeCodeForVS/claude-agent-service/` 目录
- [ ] 初始化 npm 项目 (`package.json`, `tsconfig.json`)
- [ ] 实现 IPC 服务器基础框架
- [ ] 创建 `ClaudeAgentBridge.cs`
- [ ] 验证双向通信

### 4.2 后续阶段

参见 `SDK_MIGRATION_PLAN.md` 第 7 章节

---

## 5. 重要约束

### 5.1 MUST DO

- ✅ 使用 Node.js 运行 TypeScript SDK
- ✅ 实现用户交互式权限审批
- ✅ 保持与现有前端的兼容性
- ✅ 支持会话恢复功能

### 5.2 MUST NOT DO

- ❌ 删除 `ClaudeCodeCommandService.cs` 直到新服务完全可用
- ❌ 使用 WebAssembly 运行 SDK (不可行)
- ❌ 更改前端核心消息协议结构 (需保持兼容)
- ❌ 跳过权限系统实现 (这是迁移的核心动机)

---

## 6. 文件索引

### 6.1 关键源文件

```
src/ClaudeCodeForVS/
├── Services/
│   └── ClaudeCodeCommandService.cs    # 当前 CLI 服务 (待替换)
├── ViewModels/
│   └── ChatViewModel.cs               # 聊天状态管理 (需修改)
├── frontend/
│   ├── src/
│   │   ├── App.vue                    # 主应用
│   │   ├── components/                # UI 组件
│   │   └── utils/
│   │       └── vsbridge.ts            # C#-JS 桥接
│   └── package.json
└── wwwroot/                           # 前端构建输出
```

### 6.2 SDK 文档位置

```
docs/SDK/platform.claude.com/docs/zh-CN/agent-sdk/
├── overview.html
├── quickstart.html
├── typescript.html     # ← TypeScript API 参考
├── permissions.html    # ← 权限系统详解
└── sessions.html       # ← 会话管理详解
```

### 6.3 新增文件 (待创建)

```
src/ClaudeCodeForVS/
├── Services/
│   └── ClaudeAgentBridge.cs           # 新增: SDK 桥接服务
└── claude-agent-service/              # 新增: TypeScript 服务
    ├── package.json
    ├── tsconfig.json
    └── src/
        ├── index.ts
        ├── agent.ts
        ├── ipc/
        └── permissions/
```

---

## 7. 继续对话的 Prompt 模板

```
我们正在将 ClaudeCodeForVS Visual Studio 扩展从 Claude CLI 迁移到 TypeScript SDK。

## 项目位置
G:\ClaudeCodeForVS

## 参考文档
- 迁移计划书: SDK_MIGRATION_PLAN.md
- 会话上下文: SESSION_CONTEXT.md (本文件)
- SDK 文档: docs/SDK/platform.claude.com/docs/zh-CN/agent-sdk/

## 当前进度
[描述当前进度，如 "阶段 1 已完成" 或 "正在实施阶段 2.3"]

## 本次任务
[描述具体要做的任务]

## 注意事项
- 修改 UI 后需执行: cd src/ClaudeCodeForVS/frontend; pnpm run build
- 请使用简体中文回复
```

---

## 8. 修订历史

| 日期 | 内容 |
|-----|------|
| 2026-01-14 | 初始创建，完成项目分析和计划书生成 |
