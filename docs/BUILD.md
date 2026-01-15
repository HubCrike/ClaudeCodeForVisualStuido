# 构建指南

## 🏗️ 项目结构

```
src/ClaudeCodeForVS/
├── wwwroot/                          # 发布输出目录（会被打包进 VSIX）
│   ├── index.html                    # 主页面
│   ├── assets/                       # Frontend 构建输出
│   │   ├── app.js                    # Vue 应用
│   │   └── app.css                   # 样式
│   └── claude-agent/                 # Agent Service 构建输出
│       └── index.js                  # Node.js IPC 服务（单文件）
│
├── frontend/                         # Frontend 源码 (Vue 3 + TypeScript)
│   ├── src/
│   ├── package.json
│   └── vite.config.ts
│
├── claude-agent-service/             # Agent Service 源码 (Node.js + TypeScript)
│   ├── src/
│   ├── package.json
│   └── tsconfig.json
│
└── ClaudeCodeForVS.csproj           # C# 扩展项目
```

## 🔧 构建顺序

**重要**：必须按照以下顺序构建，否则文件会被覆盖！

### 1️⃣ 构建 claude-agent-service

```bash
cd src/ClaudeCodeForVS/claude-agent-service
pnpm run build
```

**输出**：`../wwwroot/claude-agent/index.js` (~557KB)

**说明**：
- 使用 esbuild 将 TypeScript 源码打包为单个 ESM 文件
- 包含所有依赖（除了 `sharp`，需要原生模块）
- 输出到 `wwwroot/claude-agent/` 目录

### 2️⃣ 构建 frontend

```bash
cd src/ClaudeCodeForVS/frontend
pnpm run build
```

**输出**：
- `../wwwroot/index.html`
- `../wwwroot/assets/app.js` (~1.2MB)
- `../wwwroot/assets/app.css` (~21KB)

**说明**：
- 使用 Vite 构建 Vue 3 应用
- **不会清空** `wwwroot` 目录（`emptyOutDir: false`）
- 保留 `claude-agent/` 目录不被删除

### 3️⃣ 编译 C# 项目

在 Visual Studio 中：
- 打开解决方案
- 右键点击 `ClaudeCodeForVS` 项目
- 选择 **"生成"** 或按 `Ctrl+Shift+B`

或使用命令行：
```bash
dotnet build src/ClaudeCodeForVS.sln
```

**说明**：
- C# 项目会引用 `wwwroot/` 下的所有文件
- 最终打包进 VSIX 扩展包

## 📝 完整构建脚本

在项目根目录执行：

```bash
# Windows (PowerShell)
cd src/ClaudeCodeForVS/claude-agent-service; pnpm run build; cd ../frontend; pnpm run build

# Linux/macOS (Bash)
cd src/ClaudeCodeForVS/claude-agent-service && pnpm run build && cd ../frontend && pnpm run build
```

## ⚠️ 常见问题

### Q: 为什么 `vite.config.ts` 设置了 `emptyOutDir: false`？

A: 因为 `frontend` 和 `claude-agent-service` 都输出到同一个 `wwwroot` 目录。如果设置为 `true`，frontend 构建时会删除 `claude-agent/` 目录。

### Q: 修改了 TypeScript 代码，但扩展运行时没有变化？

A: 需要按顺序执行：
1. 重新构建对应的子项目（`pnpm run build`）
2. 重新编译 C# 项目（Visual Studio 中按 `Ctrl+Shift+B`）
3. 重启调试（`F5`）

### Q: 如何验证构建是否成功？

A: 检查以下文件是否存在且时间戳正确：

```bash
ls -lh src/ClaudeCodeForVS/wwwroot/claude-agent/index.js  # ~557KB
ls -lh src/ClaudeCodeForVS/wwwroot/assets/app.js          # ~1.2MB
```

## 🚀 快速开发流程

### 修改 Frontend

```bash
cd src/ClaudeCodeForVS/frontend
pnpm run build
# 在 VS 中按 Ctrl+Shift+B 重新编译
# 按 F5 启动调试
```

### 修改 Agent Service

```bash
cd src/ClaudeCodeForVS/claude-agent-service
pnpm run build
# 在 VS 中按 Ctrl+Shift+B 重新编译
# 按 F5 启动调试
```

### 修改 C# 代码

直接在 Visual Studio 中修改并按 `F5` 重新启动调试即可。

## 📦 发布 VSIX

1. 确保所有子项目都已构建
2. 在 Visual Studio 中右键点击项目
3. 选择 **"生成 VSIX"**
4. 输出位置：`bin/Debug/` 或 `bin/Release/`

---

📚 **更多文档**：
- [迁移指南](MIGRATION.md) - SDK 迁移详细文档
- [架构设计](ARCHITECTURE.md) - 系统架构说明
