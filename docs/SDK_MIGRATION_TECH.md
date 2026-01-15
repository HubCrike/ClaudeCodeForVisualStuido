# Claude Agent SDK 迁移技术文档

## 概述

本文档描述了 ClaudeCodeForVS 从 Claude CLI 进程通信迁移到 `@anthropic-ai/claude-agent-sdk` TypeScript SDK 的技术实现。

## 架构概览

```
┌─────────────────────────────────────────────────────────────┐
│                    Visual Studio Extension                   │
│  ┌───────────────┐  ┌───────────────────────────────────┐   │
│  │ ChatViewModel │──│     ClaudeChatControl.xaml.cs     │   │
│  └───────┬───────┘  └───────────────┬───────────────────┘   │
│          │                          │                        │
│          ▼                          ▼                        │
│  ┌───────────────────────────────────────────────────────┐  │
│  │                  ClaudeAgentBridge.cs                  │  │
│  │    (JSON-RPC 2.0 IPC over stdin/stdout)               │  │
│  └────────────────────────┬──────────────────────────────┘  │
└────────────────────────────┼────────────────────────────────┘
                             │
                    ┌────────▼────────┐
                    │   Node.js 进程   │
                    │  (子进程通信)    │
                    └────────┬────────┘
                             │
┌────────────────────────────┼────────────────────────────────┐
│        claude-agent-service (TypeScript)                     │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────┐  │
│  │  IpcServer  │──│  index.ts    │──│ ClaudeAgentWrapper │  │
│  │ (JSON-RPC)  │  │ (路由/调度)   │  │   (SDK 封装)       │  │
│  └─────────────┘  └──────────────┘  └────────┬───────────┘  │
│                                              │               │
│                          ┌───────────────────┴───────────┐  │
│                          │  @anthropic-ai/claude-agent-sdk│  │
│                          └───────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

## 目录结构

```
src/ClaudeCodeForVS/
├── Services/
│   ├── ClaudeCodeCommandService.cs   # 原 CLI 实现（保留作为后备）
│   └── ClaudeAgentBridge.cs          # 新 SDK 桥接服务
├── ViewModels/
│   └── ChatViewModel.cs              # 添加 UseAgentBridge 开关
├── ClaudeChatControl.xaml.cs         # 添加权限请求处理
├── claude-agent-service/             # TypeScript SDK 服务
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/
│   │   ├── index.ts                  # 服务入口点
│   │   ├── agent.ts                  # SDK 封装
│   │   ├── hooks.ts                  # Hooks 系统
│   │   ├── custom-tools.ts           # 自定义工具
│   │   ├── ipc/
│   │   │   ├── types.ts              # IPC 类型定义
│   │   │   └── server.ts             # IPC 服务器
│   │   └── utils/
│   │       └── logger.ts             # 日志工具
│   └── dist/                         # 编译输出
└── frontend/
    └── src/
        ├── App.vue                   # 添加权限处理
        └── components/
            └── PermissionDialog.vue  # 权限对话框组件
```

## 核心组件

### 1. ClaudeAgentBridge.cs

C# 端的桥接服务，负责：
- 启动和管理 Node.js 子进程
- 通过 stdin/stdout 进行 JSON-RPC 2.0 通信
- 提供异步 API 供 ViewModel 调用

**关键方法：**
```csharp
// 初始化服务
Task<bool> InitializeAsync(string workingDirectory, CancellationToken ct)

// 发送查询
Task<JObject> QueryAsync(string prompt, string sessionId, CancellationToken ct)

// 响应权限请求
Task RespondToPermissionAsync(string requestId, string decision, string reason, CancellationToken ct)

// 会话管理
Task<JArray> ListSessionsAsync(int? limit, CancellationToken ct)
Task<JObject> ResumeSessionAsync(string sessionId, string prompt, CancellationToken ct)
```

**事件：**
```csharp
event Action<JObject> OnAgentEvent;          // Agent 事件
event Action<JObject> OnPermissionRequest;   // 权限请求
event Action<string> OnLogMessage;           // 日志消息
```

### 2. claude-agent-service (TypeScript)

Node.js 服务，负责：
- 实际调用 Claude Agent SDK
- 处理 Agent 事件流
- 管理权限请求/响应

**IPC 方法（Methods）：**
| 方法 | 说明 |
|------|------|
| `initialize` | 初始化服务 |
| `query` | 发送查询 |
| `cancel` | 取消当前查询 |
| `permission.response` | 响应权限请求 |
| `sessions.list` | 列出会话 |
| `sessions.resume` | 恢复会话 |
| `ping` | 心跳测试 |
| `shutdown` | 关闭服务 |

**通知（Notifications）：**
| 通知 | 说明 |
|------|------|
| `agent.event` | Agent 事件（文本、工具调用等）|
| `permission.request` | 权限请求 |
| `log` | 日志消息 |

### 3. PermissionDialog.vue

前端权限对话框组件，支持：
- 显示工具名称和参数
- 风险等级指示（低/中/高）
- 三个操作：允许、始终允许、拒绝

## 权限系统流程

```
1. SDK 需要执行工具
       │
       ▼
2. agent.ts 的 canUseTool 回调被调用
       │
       ▼
3. 创建权限请求，通过 IPC 发送到 C#
       │
       ▼
4. ClaudeAgentBridge 触发 OnPermissionRequest 事件
       │
       ▼
5. ClaudeChatControl 转发到前端 WebView2
       │
       ▼
6. App.vue 显示 PermissionDialog
       │
       ▼
7. 用户做出决定（允许/拒绝）
       │
       ▼
8. 前端发送 permissionResponse 消息到 C#
       │
       ▼
9. ClaudeChatControl 调用 ClaudeAgentBridge.RespondToPermissionAsync()
       │
       ▼
10. TypeScript 服务解析响应，继续/终止工具执行
```

## 功能开关

`ChatViewModel.UseAgentBridge` 属性控制使用哪个后端：

```csharp
// 使用 CLI（默认，向后兼容）
viewModel.UseAgentBridge = false;

// 使用 SDK Bridge
viewModel.UseAgentBridge = true;
```

## 构建步骤

### 1. 构建 TypeScript 服务

```bash
cd src/ClaudeCodeForVS/claude-agent-service
pnpm install
pnpm run build
```

### 2. 构建前端

```bash
cd src/ClaudeCodeForVS/frontend
pnpm install
pnpm run build
```

### 3. 构建 Visual Studio 扩展

在 Visual Studio 中打开解决方案并编译。

## 部署注意事项

1. **Node.js 依赖**：需要用户安装 Node.js 18+
2. **claude-agent-service 目录**：需要随 VSIX 一起打包
3. **环境变量**：确保 `ANTHROPIC_API_KEY` 已设置

## 测试步骤

1. 在 Visual Studio 中启动调试
2. 打开 Claude Chat 工具窗口
3. 发送测试消息
4. 验证：
   - 消息正常发送和接收
   - 工具调用时显示权限对话框
   - 允许/拒绝权限后工具正确执行或停止

## 已知限制

1. **会话列表**：SDK 目前没有直接的会话列表 API，需要从文件系统读取
2. **Hooks**：SDK 的 hooks 功能可能在未来版本提供
3. **自定义工具**：需要通过 MCP 协议实现

## 回滚方案

如果 SDK 模式出现问题，可以通过设置 `UseAgentBridge = false` 回滚到 CLI 模式。原有的 `ClaudeCodeCommandService` 保持不变。
