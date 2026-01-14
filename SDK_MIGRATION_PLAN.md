# ClaudeCodeForVS SDK 迁移计划书

> 从 Claude Code CLI 进程通信迁移到 `@anthropic-ai/claude-agent-sdk` TypeScript SDK

**版本**: 1.0  
**创建日期**: 2026-01-14  
**状态**: 待实施

---

## 目录

1. [项目背景与目标](#1-项目背景与目标)
2. [现有架构分析](#2-现有架构分析)
3. [目标架构设计](#3-目标架构设计)
4. [技术方案详细设计](#4-技术方案详细设计)
5. [权限系统设计](#5-权限系统设计)
6. [会话管理设计](#6-会话管理设计)
7. [实施阶段规划](#7-实施阶段规划)
8. [风险分析与缓解措施](#8-风险分析与缓解措施)
9. [测试策略](#9-测试策略)
10. [附录](#10-附录)

---

## 1. 项目背景与目标

### 1.1 当前问题

现有 ClaudeCodeForVS 插件基于 Claude Code CLI 实现，存在以下核心问题：

| 问题类别 | 具体问题 | 影响 |
|---------|---------|------|
| **权限处理** | 使用 `--permission-mode bypassPermissions` 绕过所有安全检查 | 安全风险高，无法进行用户交互式审批 |
| **交互能力** | CLI 输出解析困难，无法获取结构化响应 | 功能受限，无法实现高级特性 |
| **会话管理** | 依赖 CLI 的 `--resume` 参数，功能有限 | 无法实现会话分支、编程式恢复 |
| **扩展性** | 无法添加自定义工具或 Hooks | 架构僵化，难以扩展 |

### 1.2 迁移目标

```
┌─────────────────────────────────────────────────────────────────┐
│                        迁移核心目标                              │
├─────────────────────────────────────────────────────────────────┤
│ ✓ 实现用户交互式权限审批 (canUseTool 回调)                       │
│ ✓ 获取结构化响应流 (tool_use, text, result 事件)                 │
│ ✓ 支持编程式会话管理 (resume, forkSession)                      │
│ ✓ 支持自定义工具和 Hooks                                        │
│ ✓ 保持与现有 Vue.js 前端的兼容性                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 1.3 成功标准

- [ ] 所有工具调用前支持用户审批
- [ ] 消息流式输出正常工作
- [ ] 会话可以正确恢复和分支
- [ ] 现有前端功能 100% 兼容
- [ ] 无回归缺陷

---

## 2. 现有架构分析

### 2.1 架构概览

```
┌─────────────────────────────────────────────────────────────────┐
│                    Visual Studio Extension                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────┐     ┌──────────────────┐                  │
│  │   ChatWindow     │     │  ChatViewModel   │                  │
│  │   (WPF Host)     │◄───►│  (状态管理)       │                  │
│  └────────┬─────────┘     └────────┬─────────┘                  │
│           │                        │                             │
│           ▼                        ▼                             │
│  ┌──────────────────┐     ┌──────────────────────────────┐      │
│  │   WebView2       │     │  ClaudeCodeCommandService    │      │
│  │   (Vue.js 前端)   │     │  (CLI 进程管理)              │      │
│  └──────────────────┘     └──────────────────────────────┘      │
│                                    │                             │
└────────────────────────────────────┼─────────────────────────────┘
                                     │
                                     ▼ Process.Start()
                              ┌──────────────────┐
                              │  claude.exe CLI  │
                              │  (外部进程)       │
                              └──────────────────┘
```

### 2.2 核心文件分析

#### 2.2.1 ClaudeCodeCommandService.cs

**位置**: `src/ClaudeCodeForVS/Services/ClaudeCodeCommandService.cs`

**当前职责**:
- 管理 claude.exe 子进程
- 构建 CLI 命令参数
- 处理 stdout/stderr 输出流
- 维护进程生命周期

**关键代码片段**:

```csharp
// 当前 CLI 调用方式
var arguments = new StringBuilder();
arguments.Append($"--print \"{escapedInput}\"");
arguments.Append($" --output-format stream-json");
arguments.Append($" --permission-mode bypassPermissions");  // 问题所在！

if (!string.IsNullOrEmpty(sessionId))
{
    arguments.Append($" --resume \"{sessionId}\"");
}
```

**问题分析**:
1. `bypassPermissions` 模式绕过所有安全检查
2. 无法在工具执行前请求用户确认
3. 输出解析依赖正则表达式，脆弱易错

#### 2.2.2 ChatViewModel.cs

**位置**: `src/ClaudeCodeForVS/ViewModels/ChatViewModel.cs`

**当前职责**:
- 维护聊天状态
- 处理消息队列
- 管理会话 ID
- 与前端通信

**需要修改的部分**:
- 添加权限请求处理
- 修改消息接收逻辑
- 适配新的事件模型

#### 2.2.3 前端结构

**位置**: `src/ClaudeCodeForVS/frontend/`

```
frontend/
├── src/
│   ├── App.vue              # 主应用组件
│   ├── components/
│   │   ├── ChatInput.vue    # 输入组件
│   │   ├── MessageList.vue  # 消息列表
│   │   └── ...
│   └── utils/
│       └── vsbridge.ts      # VS 通信桥接
└── package.json
```

---

## 3. 目标架构设计

### 3.1 新架构概览

```
┌─────────────────────────────────────────────────────────────────────────┐
│                       Visual Studio Extension                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌──────────────────┐     ┌──────────────────┐                          │
│  │   ChatWindow     │     │  ChatViewModel   │                          │
│  │   (WPF Host)     │◄───►│  (状态管理)       │                          │
│  └────────┬─────────┘     └────────┬─────────┘                          │
│           │                        │                                     │
│           ▼                        ▼                                     │
│  ┌──────────────────┐     ┌──────────────────────────────┐              │
│  │   WebView2       │     │    ClaudeAgentBridge.cs      │  ← 新增      │
│  │   (Vue.js 前端)   │     │    (SDK 服务桥接)            │              │
│  │                  │     └──────────────────────────────┘              │
│  │  ┌────────────┐  │                  │                                │
│  │  │Permission  │  │                  │ JSON-RPC IPC                   │
│  │  │Dialog.vue  │  │                  ▼                                │
│  │  └────────────┘  │     ┌──────────────────────────────┐              │
│  └──────────────────┘     │  claude-agent-service/       │  ← 新增      │
│           ▲               │  (Node.js 子进程)             │              │
│           │               │                              │              │
│           │               │  ┌────────────────────────┐  │              │
│           │               │  │ @anthropic-ai/         │  │              │
│           └───────────────┼──│ claude-agent-sdk       │  │              │
│         权限请求回调       │  └────────────────────────┘  │              │
│                           └──────────────────────────────┘              │
└─────────────────────────────────────────────────────────────────────────┘
```

### 3.2 组件职责

| 组件 | 职责 | 技术栈 |
|-----|------|-------|
| **ClaudeAgentBridge.cs** | C# 与 Node.js 进程通信桥接 | C#, JSON-RPC |
| **claude-agent-service/** | 运行 SDK，处理 Agent 逻辑 | TypeScript, Node.js |
| **PermissionDialog.vue** | 权限请求 UI 展示 | Vue 3, TypeScript |

### 3.3 通信协议设计

使用 **JSON-RPC 2.0 风格** 的 IPC 协议：

```typescript
// 请求格式
interface Request {
  jsonrpc: "2.0";
  id: string;
  method: string;
  params: Record<string, unknown>;
}

// 响应格式
interface Response {
  jsonrpc: "2.0";
  id: string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

// 事件通知格式 (无 id)
interface Notification {
  jsonrpc: "2.0";
  method: string;
  params: Record<string, unknown>;
}
```

---

## 4. 技术方案详细设计

### 4.1 claude-agent-service 设计

#### 4.1.1 项目结构

```
src/ClaudeCodeForVS/claude-agent-service/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts              # 入口点，IPC 服务器
│   ├── agent.ts              # Agent 封装
│   ├── ipc/
│   │   ├── server.ts         # JSON-RPC IPC 服务器
│   │   ├── handlers.ts       # 方法处理器
│   │   └── types.ts          # 类型定义
│   ├── permissions/
│   │   ├── manager.ts        # 权限管理器
│   │   └── types.ts          # 权限类型
│   └── utils/
│       └── logger.ts         # 日志工具
└── dist/                     # 编译输出
```

#### 4.1.2 核心代码示例

**agent.ts**:

```typescript
import { Agent, query, tool } from "@anthropic-ai/claude-agent-sdk";

export class ClaudeAgentWrapper {
  private agent: Agent;

  constructor(options: { apiKey: string; model?: string }) {
    this.agent = new Agent({
      model: options.model ?? "claude-sonnet-4-20250514",
      apiKey: options.apiKey,
    });
  }

  async query(
    prompt: string,
    options: {
      workingDirectory: string;
      sessionId?: string;
      permissionHandler: (toolRequest: ToolRequest) => Promise<boolean>;
      onEvent: (event: AgentEvent) => void;
    }
  ): Promise<QueryResult> {
    const result = await query(this.agent, {
      prompt,
      options: {
        cwd: options.workingDirectory,
        resume: options.sessionId ? { sessionId: options.sessionId } : undefined,
        // 核心：权限回调
        permissions: {
          canUseTool: async (toolRequest) => {
            // 通过 IPC 发送到 C#，再由 C# 转发到前端 UI
            return await options.permissionHandler(toolRequest);
          },
        },
      },
    });

    // 处理事件流
    for await (const event of result) {
      options.onEvent(event);
    }

    return {
      sessionId: result.sessionId,
      totalCost: result.totalCost,
    };
  }
}
```

**ipc/server.ts**:

```typescript
import * as readline from "readline";

export class IPCServer {
  private handlers: Map<string, Handler> = new Map();
  private pendingRequests: Map<string, { resolve: Function; reject: Function }> = new Map();

  constructor() {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
    });

    rl.on("line", (line) => this.handleMessage(line));
  }

  registerHandler(method: string, handler: Handler) {
    this.handlers.set(method, handler);
  }

  private async handleMessage(line: string) {
    try {
      const message = JSON.parse(line);
      
      if (message.id && message.result !== undefined) {
        // 这是对我们请求的响应（如权限请求的用户决策）
        const pending = this.pendingRequests.get(message.id);
        if (pending) {
          pending.resolve(message.result);
          this.pendingRequests.delete(message.id);
        }
        return;
      }

      // 这是来自 C# 的请求
      const handler = this.handlers.get(message.method);
      if (handler) {
        const result = await handler(message.params);
        this.send({ jsonrpc: "2.0", id: message.id, result });
      }
    } catch (error) {
      console.error("IPC Error:", error);
    }
  }

  // 发送请求到 C# 并等待响应
  async request<T>(method: string, params: unknown): Promise<T> {
    const id = crypto.randomUUID();
    
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      this.send({ jsonrpc: "2.0", id, method, params });
      
      // 超时处理
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error("Permission request timeout"));
        }
      }, 300000); // 5 分钟超时
    });
  }

  // 发送事件通知（无需响应）
  notify(method: string, params: unknown) {
    this.send({ jsonrpc: "2.0", method, params });
  }

  private send(message: unknown) {
    console.log(JSON.stringify(message));
  }
}
```

### 4.2 ClaudeAgentBridge.cs 设计

```csharp
using System.Diagnostics;
using System.Text.Json;

namespace ClaudeCodeForVS.Services
{
    public class ClaudeAgentBridge : IDisposable
    {
        private Process? _nodeProcess;
        private readonly Dictionary<string, TaskCompletionSource<JsonElement>> _pendingRequests = new();
        private readonly object _lock = new();

        public event EventHandler<AgentEventArgs>? OnAgentEvent;
        public event EventHandler<PermissionRequestArgs>? OnPermissionRequest;

        public async Task StartAsync()
        {
            var startInfo = new ProcessStartInfo
            {
                FileName = "node",
                Arguments = "dist/index.js",
                WorkingDirectory = GetServicePath(),
                UseShellExecute = false,
                RedirectStandardInput = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true,
            };

            _nodeProcess = new Process { StartInfo = startInfo };
            _nodeProcess.OutputDataReceived += OnOutputReceived;
            _nodeProcess.ErrorDataReceived += OnErrorReceived;
            _nodeProcess.Start();
            _nodeProcess.BeginOutputReadLine();
            _nodeProcess.BeginErrorReadLine();
        }

        public async Task<QueryResult> QueryAsync(
            string prompt,
            string workingDirectory,
            string? sessionId = null)
        {
            var request = new
            {
                jsonrpc = "2.0",
                id = Guid.NewGuid().ToString(),
                method = "query",
                @params = new
                {
                    prompt,
                    workingDirectory,
                    sessionId,
                }
            };

            return await SendRequestAsync<QueryResult>(request);
        }

        // 处理来自 Node.js 的权限请求
        public async Task<bool> HandlePermissionRequestAsync(string requestId, bool approved)
        {
            var response = new
            {
                jsonrpc = "2.0",
                id = requestId,
                result = approved,
            };

            await SendAsync(response);
            return approved;
        }

        private void OnOutputReceived(object sender, DataReceivedEventArgs e)
        {
            if (string.IsNullOrEmpty(e.Data)) return;

            try
            {
                var message = JsonSerializer.Deserialize<JsonElement>(e.Data);
                
                // 检查是否是事件通知
                if (!message.TryGetProperty("id", out _) && 
                    message.TryGetProperty("method", out var method))
                {
                    var methodName = method.GetString();
                    var @params = message.GetProperty("params");

                    switch (methodName)
                    {
                        case "permission_request":
                            OnPermissionRequest?.Invoke(this, 
                                new PermissionRequestArgs(@params));
                            break;
                        case "agent_event":
                            OnAgentEvent?.Invoke(this, 
                                new AgentEventArgs(@params));
                            break;
                    }
                    return;
                }

                // 这是对我们请求的响应
                if (message.TryGetProperty("id", out var id))
                {
                    var requestId = id.GetString();
                    lock (_lock)
                    {
                        if (_pendingRequests.TryGetValue(requestId!, out var tcs))
                        {
                            if (message.TryGetProperty("result", out var result))
                            {
                                tcs.SetResult(result);
                            }
                            else if (message.TryGetProperty("error", out var error))
                            {
                                tcs.SetException(new Exception(error.GetProperty("message").GetString()));
                            }
                            _pendingRequests.Remove(requestId!);
                        }
                    }
                }
            }
            catch (JsonException ex)
            {
                Debug.WriteLine($"JSON Parse Error: {ex.Message}");
            }
        }

        // ... 其他辅助方法
    }
}
```

---

## 5. 权限系统设计

### 5.1 权限请求流程

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│   SDK       │    │   Node.js   │    │   C#        │    │   Vue.js    │
│   Agent     │    │   Service   │    │   Bridge    │    │   Frontend  │
└──────┬──────┘    └──────┬──────┘    └──────┬──────┘    └──────┬──────┘
       │                  │                  │                  │
       │ canUseTool()     │                  │                  │
       │─────────────────>│                  │                  │
       │                  │                  │                  │
       │                  │ permission_request                  │
       │                  │─────────────────>│                  │
       │                  │                  │                  │
       │                  │                  │ showPermission() │
       │                  │                  │─────────────────>│
       │                  │                  │                  │
       │                  │                  │           ┌──────┴──────┐
       │                  │                  │           │  用户决策    │
       │                  │                  │           │  Allow/Deny │
       │                  │                  │           └──────┬──────┘
       │                  │                  │                  │
       │                  │                  │◄─────────────────│
       │                  │                  │  user_decision   │
       │                  │                  │                  │
       │                  │◄─────────────────│                  │
       │                  │  response        │                  │
       │                  │                  │                  │
       │◄─────────────────│                  │                  │
       │  return boolean  │                  │                  │
       │                  │                  │                  │
```

### 5.2 权限请求数据结构

```typescript
interface PermissionRequest {
  requestId: string;
  toolName: string;           // 如 "file_write", "bash", "browser"
  toolInput: {
    command?: string;         // bash 命令
    path?: string;            // 文件路径
    content?: string;         // 写入内容
    url?: string;             // 浏览器 URL
    // ... 其他工具特定参数
  };
  riskLevel: "low" | "medium" | "high";
  suggestedAction: "allow" | "deny" | "ask";
}

interface PermissionResponse {
  requestId: string;
  approved: boolean;
  rememberChoice?: boolean;   // 是否记住此类请求的决策
}
```

### 5.3 PermissionDialog.vue 设计

```vue
<template>
  <div v-if="visible" class="permission-dialog">
    <div class="permission-header">
      <span class="permission-icon" :class="riskClass">
        {{ riskIcon }}
      </span>
      <h3>权限请求</h3>
    </div>
    
    <div class="permission-content">
      <p class="tool-name">{{ request.toolName }}</p>
      
      <!-- 根据工具类型显示不同内容 -->
      <div v-if="request.toolName === 'bash'" class="command-preview">
        <code>{{ request.toolInput.command }}</code>
      </div>
      
      <div v-if="request.toolName === 'file_write'" class="file-preview">
        <p>文件: {{ request.toolInput.path }}</p>
        <pre>{{ truncatedContent }}</pre>
      </div>
    </div>
    
    <div class="permission-actions">
      <label class="remember-choice">
        <input type="checkbox" v-model="rememberChoice" />
        记住此类决策
      </label>
      <button class="btn-deny" @click="deny">拒绝</button>
      <button class="btn-allow" @click="allow">允许</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';

const props = defineProps<{
  request: PermissionRequest;
  visible: boolean;
}>();

const emit = defineEmits<{
  (e: 'response', response: PermissionResponse): void;
}>();

const rememberChoice = ref(false);

const riskClass = computed(() => `risk-${props.request.riskLevel}`);
const riskIcon = computed(() => {
  switch (props.request.riskLevel) {
    case 'high': return '⚠️';
    case 'medium': return '⚡';
    default: return 'ℹ️';
  }
});

function allow() {
  emit('response', {
    requestId: props.request.requestId,
    approved: true,
    rememberChoice: rememberChoice.value,
  });
}

function deny() {
  emit('response', {
    requestId: props.request.requestId,
    approved: false,
    rememberChoice: rememberChoice.value,
  });
}
</script>
```

### 5.4 权限策略配置

```typescript
interface PermissionPolicy {
  // 自动允许的工具
  autoAllow: string[];       // 如 ["file_read"]
  
  // 自动拒绝的工具
  autoDeny: string[];        // 如 ["browser"] (如果不需要浏览器)
  
  // 需要询问的工具（默认所有不在 autoAllow/autoDeny 中的工具）
  alwaysAsk: string[];       // 如 ["bash", "file_write"]
  
  // 路径白名单 (file_* 工具)
  allowedPaths: string[];    // 如 ["/project/**"]
  
  // 路径黑名单
  deniedPaths: string[];     // 如 ["**/.env", "**/secrets/**"]
  
  // 命令白名单 (bash 工具)
  allowedCommands: RegExp[]; // 如 [/^npm /, /^git /]
}
```

---

## 6. 会话管理设计

### 6.1 会话恢复

```typescript
// TypeScript SDK 会话恢复
const result = await query(agent, {
  prompt: "继续之前的工作",
  options: {
    resume: {
      sessionId: "previous-session-id",
      // 可选：从特定消息 ID 开始
      // continueFromMessageId: "msg_xxx"
    },
  },
});
```

### 6.2 会话分支

```typescript
// 从现有会话创建分支
const forkedSession = await agent.forkSession({
  sourceSessionId: "original-session-id",
  forkFromMessageId: "msg_xxx", // 可选
});
```

### 6.3 会话存储

会话信息由 SDK 自动管理，存储在 `~/.claude/` 目录下。C# 端只需保存 `sessionId` 用于恢复。

```csharp
// ChatViewModel.cs 中的会话管理
public class SessionInfo
{
    public string SessionId { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime LastAccessedAt { get; set; }
    public string? Title { get; set; }  // 可选：AI 生成的会话标题
}
```

---

## 7. 实施阶段规划

### 阶段 1: 基础设施搭建 (Week 1-2)

**目标**: 建立 TypeScript 服务和 C# 桥接层的基本框架

| 任务 | 详细描述 | 产出物 |
|-----|---------|--------|
| 1.1 | 创建 `claude-agent-service/` 项目结构 | package.json, tsconfig.json |
| 1.2 | 实现 IPC 服务器基础框架 | src/ipc/server.ts |
| 1.3 | 创建 `ClaudeAgentBridge.cs` | 进程管理、基本通信 |
| 1.4 | 实现基本的 ping/pong 测试 | 验证双向通信 |

**验收标准**:
- [ ] Node.js 服务可被 C# 启动
- [ ] 双向 JSON-RPC 通信正常
- [ ] 服务可正确关闭和清理

### 阶段 2: SDK 集成 (Week 3-4)

**目标**: 集成 Claude Agent SDK 并替换 CLI 调用

| 任务 | 详细描述 | 产出物 |
|-----|---------|--------|
| 2.1 | 安装并配置 `@anthropic-ai/claude-agent-sdk` | 依赖配置 |
| 2.2 | 实现 `ClaudeAgentWrapper` | src/agent.ts |
| 2.3 | 实现 query 方法的 IPC 封装 | 处理器实现 |
| 2.4 | 修改 `ChatViewModel` 使用新服务 | 替换 CLI 调用 |
| 2.5 | 处理流式事件并转发到前端 | 事件流处理 |

**验收标准**:
- [ ] 可通过新服务发送消息并接收响应
- [ ] 流式输出正常工作
- [ ] 基本功能与 CLI 版本一致

### 阶段 3: 权限系统实现 (Week 5-6)

**目标**: 实现完整的权限请求和审批流程

| 任务 | 详细描述 | 产出物 |
|-----|---------|--------|
| 3.1 | 实现权限请求 IPC 协议 | 协议实现 |
| 3.2 | 创建 `PermissionDialog.vue` | 前端组件 |
| 3.3 | 实现权限策略配置 | 配置系统 |
| 3.4 | 集成到 `ChatViewModel` | 状态管理 |
| 3.5 | 实现"记住决策"功能 | 缓存逻辑 |

**验收标准**:
- [ ] 工具调用前弹出权限对话框
- [ ] 用户可以允许/拒绝请求
- [ ] "记住决策"功能正常工作

### 阶段 4: 会话管理 (Week 7)

**目标**: 实现会话恢复和分支功能

| 任务 | 详细描述 | 产出物 |
|-----|---------|--------|
| 4.1 | 实现会话 ID 持久化 | 存储逻辑 |
| 4.2 | 实现 resume 功能 | 恢复逻辑 |
| 4.3 | 实现会话列表 UI | 前端组件 |
| 4.4 | 实现会话分支（可选） | 分支功能 |

**验收标准**:
- [ ] 关闭窗口后可恢复会话
- [ ] 会话列表正确显示
- [ ] 会话切换正常工作

### 阶段 5: 高级功能 (Week 8-9)

**目标**: 实现 Hooks 和自定义工具

| 任务 | 详细描述 | 产出物 |
|-----|---------|--------|
| 5.1 | 实现 `beforeToolCall` Hook | Hook 系统 |
| 5.2 | 实现 `afterToolCall` Hook | Hook 系统 |
| 5.3 | 支持自定义工具注册 | 工具 API |
| 5.4 | 实现 IDE 集成工具（可选） | 如代码跳转 |

**验收标准**:
- [ ] Hooks 可正确触发
- [ ] 自定义工具可被 Agent 调用

### 阶段 6: 测试与迁移 (Week 10-11)

**目标**: 全面测试并完成迁移

| 任务 | 详细描述 | 产出物 |
|-----|---------|--------|
| 6.1 | 编写单元测试 | 测试代码 |
| 6.2 | 编写集成测试 | E2E 测试 |
| 6.3 | 性能测试和优化 | 性能报告 |
| 6.4 | 文档更新 | 用户文档 |
| 6.5 | 移除旧 CLI 代码 | 代码清理 |

**验收标准**:
- [ ] 所有测试通过
- [ ] 性能符合预期
- [ ] 文档完整

---

## 8. 风险分析与缓解措施

| 风险 | 可能性 | 影响 | 缓解措施 |
|-----|-------|-----|---------|
| SDK API 变更 | 中 | 高 | 封装 SDK 调用，隔离变更影响 |
| Node.js 进程不稳定 | 低 | 高 | 实现进程守护和自动重启 |
| IPC 性能瓶颈 | 低 | 中 | 使用高效序列化，批量处理 |
| 权限 UI 用户体验差 | 中 | 中 | 早期用户测试，迭代改进 |
| 与现有前端不兼容 | 低 | 高 | 保持消息格式兼容，渐进式迁移 |
| API Key 安全问题 | 中 | 高 | 使用系统凭据存储，不硬编码 |

---

## 9. 测试策略

### 9.1 单元测试

- TypeScript 服务：Jest
- C# 代码：xUnit

### 9.2 集成测试

```typescript
// 示例：权限请求流程测试
describe("Permission Flow", () => {
  it("should request permission for file write", async () => {
    const mockPermissionHandler = jest.fn().mockResolvedValue(true);
    
    await agentWrapper.query("创建一个 test.txt 文件", {
      workingDirectory: "/tmp",
      permissionHandler: mockPermissionHandler,
      onEvent: () => {},
    });

    expect(mockPermissionHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: "file_write",
        toolInput: expect.objectContaining({
          path: expect.stringContaining("test.txt"),
        }),
      })
    );
  });
});
```

### 9.3 手动测试检查清单

- [ ] 基本对话功能
- [ ] 文件读取权限请求
- [ ] 文件写入权限请求
- [ ] Bash 命令权限请求
- [ ] 会话恢复
- [ ] 流式输出
- [ ] 错误处理
- [ ] 取消操作

---

## 10. 附录

### 10.1 参考文档

- [TypeScript SDK 参考](docs/SDK/platform.claude.com/docs/zh-CN/agent-sdk/typescript.html)
- [权限系统文档](docs/SDK/platform.claude.com/docs/zh-CN/agent-sdk/permissions.html)
- [会话管理文档](docs/SDK/platform.claude.com/docs/zh-CN/agent-sdk/sessions.html)
- [快速开始指南](docs/SDK/platform.claude.com/docs/zh-CN/agent-sdk/quickstart.html)

### 10.2 相关文件

| 文件 | 用途 |
|-----|------|
| `src/ClaudeCodeForVS/Services/ClaudeCodeCommandService.cs` | 当前 CLI 服务（将被替换） |
| `src/ClaudeCodeForVS/ViewModels/ChatViewModel.cs` | 聊天状态管理（需修改） |
| `src/ClaudeCodeForVS/frontend/` | Vue.js 前端（需添加权限组件） |

### 10.3 关键决策记录

| 决策 | 理由 | 替代方案 |
|-----|------|---------|
| 使用 Node.js 子进程 | SDK 仅支持 TypeScript/Python | WebAssembly（不可行） |
| JSON-RPC 2.0 协议 | 标准化、易于调试 | 自定义二进制协议 |
| 权限 UI 在前端实现 | 与现有 UI 风格一致 | WPF 原生对话框 |

---

## 修订历史

| 版本 | 日期 | 修改内容 | 作者 |
|-----|------|---------|-----|
| 1.0 | 2026-01-14 | 初始版本 | AI Assistant |
