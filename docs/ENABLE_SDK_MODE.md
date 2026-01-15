# 启用 SDK 模式

## 前置条件

1. **Node.js 18+** 已安装并在 PATH 中
2. **ANTHROPIC_API_KEY** 环境变量已设置

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

### 3. 在 Visual Studio 中编译扩展

打开解决方案并编译。

## 启用 SDK 模式

目前 SDK 模式默认关闭。要启用，需要在代码中设置 `UseAgentBridge = true`：

```csharp
// 在 ChatViewModel 中
viewModel.UseAgentBridge = true;
```

未来可以通过 VS 设置页面控制此开关。

## 验证

1. 启动 Visual Studio 调试
2. 打开 Claude Chat 工具窗口
3. 发送消息，例如 "请列出当前目录的文件"
4. 当 Claude 需要执行文件操作时，应该会弹出权限对话框
5. 选择"允许"或"拒绝"

## 回滚

如果遇到问题，设置 `UseAgentBridge = false` 即可回滚到 CLI 模式。

## 故障排除

### Node.js 未找到

确保 Node.js 在系统 PATH 中：
```bash
where node
```

### TypeScript 服务未编译

检查 `claude-agent-service/dist/index.js` 是否存在。

### 权限对话框不显示

查看 Visual Studio 输出窗口中的 "Claude Code" 面板，检查日志。

### 日志位置

- **Visual Studio 输出窗口**: Claude Code 面板
- **文件日志**: `%LOCALAPPDATA%\ClaudeCodeForVS\Logs`
- **Node.js 服务日志**: 输出到 stderr，可在输出窗口查看
