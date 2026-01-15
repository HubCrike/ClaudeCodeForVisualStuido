# ClaudeCodeForVS

[English](README.en.md) | 简体中文

> 🤖 让 Claude 成为你的 Visual Studio 编程搭档！一个将 Claude Code ~~深度~~集成到 IDE 的扩展，带来丝滑的 AI 辅助编码体验。

这是一个将 Claude Code 集成到 Visual Studio 的扩展，提供聊天界面、编辑器上下文、文件引用以及通过 Claude CLI 执行命令的能力。

## ✨ 功能特性

- 🎨 **内置聊天窗口** - 在 Visual Studio 中直接打开工具窗口，无需切换应用
- 🎯 **智能上下文跟踪** - 可选捕获当前文件和选中内容，让 Claude 更懂你的代码
- 📁 **便捷文件引用** - 文件选择器轻松添加文件引用，无需手动输入路径
- ⚡ **流式输出渲染** - Claude Agent 的响应实时呈现在时间线中，体验流畅自然
- 📝 **完善的日志系统** - 基于 Serilog 记录运行日志，按天滚动存储，问题排查更轻松

## 💡 关于本项目

**🤖 AI 生成声明**

本项目代码主要由 AI 自动生成，通过 Claude Code 的强大能力，将自然语言需求转化为高质量的生产代码。这不仅是实用的开发工具，更是展示 AI 辅助编程可能性的探索项目。

## 🔧 环境要求

- **Visual Studio** 2022 或 2026（⭐ 推荐 2026 以获得最佳体验）
- **WebView2 运行时**（现代 Visual Studio 已自带）
- **Node.js** v20 或更高版本（用于运行 Claude Agent Service）

## 🚀 安装方式

从本仓库构建并安装 VSIX 扩展包即可开始使用。

## 🎮 快速开始

1️⃣ 打开 Visual Studio

2️⃣ 在扩展菜单中选择 **"Open Claude Chat"** 打开聊天窗口

3️⃣ 输入你的提示词，开始与 Claude 对话！

## ⚙️ 配置说明

- 扩展使用内置的 Agent SDK Service (Node.js)
- 请确保系统已安装 Node.js 且 `node` 命令可用
- 首次使用可能需要配置 Claude API 密钥

## 📋 日志位置

运行日志输出到以下路径：

```
%LOCALAPPDATA%\ClaudeCodeForVS\Logs
```

遇到问题时查看日志可以帮你快速定位原因。

## 📄 许可证

见 [LICENSE](LICENSE) 文件。

---

⭐ 如果这个项目对你有帮助，欢迎给个 Star！有问题也欢迎提 Issue。
