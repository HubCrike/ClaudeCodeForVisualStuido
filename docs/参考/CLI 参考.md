# CLI 参考

Claude Code 命令行界面的完整参考，包括命令和标志。

## CLI 命令

命令 | 描述 | 示例  
---|---|---  
`claude ` | 启动交互式 REPL | `claude `  
`claude "query"` | 使用初始提示启动 REPL | `claude "explain this project"`  
`claude -p "query"` | 通过 SDK 查询，然后退出 | `claude -p "explain this function"`  
`cat file | claude -p "query"` | 处理管道内容 | `cat logs.txt | claude -p "explain"`  
`claude -c ` | 继续最近的对话 | `claude -c `  
`claude -c -p "query"` | 通过 SDK 继续 | `claude -c -p "Check for type errors"`  
`claude -r "<session-id>" "query"` | 按 ID 恢复会话 | `claude -r "abc123" "Finish this PR"`  
`claude update ` | 更新到最新版本 | `claude update `  
`claude mcp ` | 配置模型上下文协议 (MCP) 服务器 | 请参阅 Claude Code MCP 文档。

## CLI 标志

使用这些命令行标志自定义 Claude Code 的行为：

标志 | 描述 | 示例  
---|---|---  
`--add-dir ` | 添加额外的工作目录供 Claude 访问（验证每个路径是否存在为目录） | `claude --add-dir ../apps ../lib`  
`--agents ` | 通过 JSON 动态定义自定义 子代理（参见下面的格式） | `claude --agents '{"reviewer":{"description":"Reviews code","prompt":"You are a code reviewer"}}'`  
`--allowedTools ` | 应允许的工具列表，无需提示用户获得权限，除了 settings.json 文件 | `"Bash(git log:*)" "Bash(git diff:*)" "Read"`  
`--disallowedTools ` | 应禁止的工具列表，无需提示用户获得权限，除了 settings.json 文件 | `"Bash(git log:*)" "Bash(git diff:*)" "Edit"`  
`--print`, `-p ` | 打印响应而不进入交互模式（有关程序化使用详情，请参阅 SDK 文档） | `claude -p "query"`  
`--system-prompt ` | 用自定义文本替换整个系统提示（在交互和打印模式中都有效；在 v2.0.14 中添加） | `claude --system-prompt "You are a Python expert"`  
`--system-prompt-file ` | 从文件加载系统提示，替换默认提示（仅打印模式；在 v1.0.54 中添加） | `claude -p --system-prompt-file ./custom-prompt.txt "query"`  
`--append-system-prompt ` | 将自定义文本附加到默认系统提示的末尾（在交互和打印模式中都有效；在 v1.0.55 中添加） | `claude --append-system-prompt "Always use TypeScript"`  
`--output-format ` | 为打印模式指定输出格式（选项：text、json、stream-json） | `claude -p "query" --output-format json`  
`--input-format ` | 为打印模式指定输入格式（选项：text、stream-json） | `claude -p --output-format json --input-format stream-json`  
`--include-partial-messages ` | 在输出中包含部分流事件（需要 `--print` 和 `--output-format=stream-json`） | `claude -p --output-format stream-json --include-partial-messages "query"`  
`--verbose ` | 启用详细日志记录，显示完整的逐轮输出（有助于在打印和交互模式中调试） | `claude --verbose`  
`--max-turns ` | 限制非交互模式中的代理轮数 | `claude -p --max-turns 3 "query"`  
`--model ` | 为当前会话设置模型，带有最新模型的别名（`sonnet` 或 `opus`）或模型的完整名称 | `claude --model claude-sonnet-4-5-20250929`  
`--permission-mode ` | 以指定的权限模式开始 | `claude --permission-mode plan`  
`--permission-prompt-tool ` | 指定 MCP 工具以在非交互模式中处理权限提示 | `claude -p --permission-prompt-tool mcp_auth_tool "query"`  
`--resume ` | 按 ID 恢复特定会话，或在交互模式中选择 | `claude --resume abc123 "query"`  
`--continue ` | 加载当前目录中最近的对话 | `claude --continue`  
`--dangerously-skip-permissions ` | 跳过权限提示（谨慎使用） | `claude --dangerously-skip-permissions`  
`--output-format json` 标志对于脚本和自动化特别有用，允许您以编程方式解析 Claude 的响应。

## 代理标志格式

`--agents` 标志接受定义一个或多个自定义子代理的 JSON 对象。每个子代理需要一个唯一的名称（作为键）和一个具有以下字段的定义对象：

字段 | 必需 | 描述  
---|---|---  
`description ` | 是 | 何时应调用子代理的自然语言描述  
`prompt ` | 是 | 指导子代理行为的系统提示  
`tools ` | 否 | 子代理可以使用的特定工具数组（例如 `["Read", "Edit", "Bash"]`）。如果省略，继承所有工具  
`model ` | 否 | 要使用的模型别名：`sonnet`、`opus` 或 `haiku`。如果省略，使用默认子代理模型

示例：

```text
claude --agents '{
  "code-reviewer": {
    "description": "Expert code reviewer. Use proactively after code changes.",
    "prompt": "You are a senior code reviewer. Focus on code quality, security, and best practices.",
    "tools": ["Read", "Grep", "Glob", "Bash"],
    "model": "sonnet"
  },
  "debugger": {
    "description": "Debugging specialist for errors and test failures.",
    "prompt": "You are an expert debugger. Analyze errors, identify root causes, and provide fixes."
  }
}'
````

有关创建和使用子代理的更多详情，请参阅子代理文档。

## 系统提示标志

Claude Code 提供三个用于自定义系统提示的标志，每个标志都有不同的用途：

| 标志                        | 行为       | 模式      | 用例                           |
| ------------------------- | -------- | ------- | ---------------------------- |
| `--system-prompt `        | 替换整个默认提示 | 交互 + 打印 | 完全控制 Claude 的行为和指令           |
| `--system-prompt-file `   | 替换为文件内容  | 仅打印     | 从文件加载提示以实现可重现性和版本控制          |
| `--append-system-prompt ` | 附加到默认提示  | 交互 + 打印 | 添加特定指令，同时保持默认 Claude Code 行为 |

何时使用每个：

* `--system-prompt`：当您需要完全控制 Claude 的系统提示时使用。这会删除所有默认 Claude Code 指令，为您提供一个空白的开始。

```text
claude --system-prompt "You are a Python expert who only writes type-annotated code"
```

* `--system-prompt-file`：当您想从文件加载自定义提示时使用，对于团队一致性或版本控制的提示模板很有用。

```text
claude -p --system-prompt-file ./prompts/code-review.txt "Review this PR"
```

* `--append-system-prompt`：当您想添加特定指令，同时保持 Claude Code 的默认功能完整时使用。这是大多数用例中最安全的选项。

```text
claude --append-system-prompt "Always use TypeScript and include JSDoc comments"
```

`--system-prompt` 和 `--system-prompt-file` 是互斥的。您不能同时使用两个标志。对于大多数用例，建议使用 `--append-system-prompt`，因为它保留了 Claude Code 的内置功能，同时添加了您的自定义要求。仅当您需要完全控制系统提示时才使用 `--system-prompt` 或 `--system-prompt-file`。

有关打印模式 (`-p`) 的详细信息，包括输出格式、流、详细日志记录和程序化使用，请参阅 SDK 文档。

## 另请参阅

* 交互模式 — 快捷键、输入模式和交互功能
* 斜杠命令 — 交互会话命令
* 快速入门指南 — Claude Code 入门
* 常见工作流 — 高级工作流和模式
* 设置 — 配置选项
* SDK 文档 — 程序化使用和集成

```
