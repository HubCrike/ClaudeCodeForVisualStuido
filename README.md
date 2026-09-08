# ClaudeCodeForVS（Fork 版）

> 🤖 让 Claude 成为你的 Visual Studio 编程搭档！一个将 Claude Code 集成到 IDE 的扩展，带来丝滑的 AI 辅助编码体验。

本项目 Fork 自 [YaKun9/ClaudeCodeForVS](https://github.com/HubCrike/ClaudeCodeForVisualStuido)，在其基础上进行了增强和改进。

## 📌 Fork 的原因

原版本基于**旧版 Claude Code**使用的是cli.js,新版本使用的是原生二进制分发（claude.exe），在新版本下运行会直接报错。作者好像有段时间没有维护了，因此自己 Fork 了一份进行修改，让扩展能够在新版本 Claude Code 下**正常运行并读取修改代码**。

## ✨ 相比原版的主要改进

- 🆕 **适配新版 Claude Code** - 修复了新版 Claude Code 下无法启动/报错的问题，扩展可以正常运行并正确读取代码修改
- 💬 **新建会话** - 原版整个使用过程都在同一份上下文中进行，使用久了上下文会变得很长，既浪费 token 也不利于聚焦。现在可以随时新建一个干净的会话
- 📜 **历史会话管理** - 历史会话分为**当前项目**和**全部**两个视图：
  - 点击某个历史会话，即可继续之前的上下文继续对话
  - 支持删除不再需要的历史会话

## 🔧 环境要求

- **Visual Studio**（本人环境为 VS2016，理论上 2022+ 均可）
- **Claude Code** v2.1.263（本人环境实测可用）截止目前最新版
- **WebView2 运行时**（现代 Visual Studio 已自带）
- **Node.js** v20 或更高版本（用于运行 Claude Agent Service）
- **Claude API 凭据**（`ANTHROPIC_API_KEY` 等）

## 🚀 安装方式

从本仓库构建并安装 VSIX 扩展包即可开始使用。

## 🎮 快速开始

1️⃣ 打开 Visual Studio

2️⃣ 在扩展菜单中选择 **"Open Claude Chat"** 打开聊天窗口

3️⃣ 输入你的提示词，开始与 Claude 对话！

## 🗂️ 会话使用说明

- **新建会话**：需要开始一个新任务时，新建一个会话，避免旧上下文干扰、节省 token
- **历史会话**：侧边栏可查看历史会话列表，支持按 **当前项目** / **全部** 筛选
- **继续对话**：点击任意历史会话即可恢复其上下文，接着聊
- **删除会话**：不需要的会话可直接删除

## ⚙️ 配置说明

- 扩展使用内置的 Agent SDK Service (Node.js)，请确保系统已安装 Node.js 且 `node` 命令可用
- 正常Claude Code Cli能使用一般就没问题

## 📋 日志位置

```
%LOCALAPPDATA%\ClaudeCodeForVS\Logs
```

遇到问题时查看日志可以帮你快速定位原因。

## 📄 许可证

见 [LICENSE](LICENSE) 文件。

---

⭐ 如果这个项目对你有帮助，欢迎给个 Star！有问题也欢迎提 Issue。
