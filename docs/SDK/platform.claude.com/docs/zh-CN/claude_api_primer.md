# Claude API 使用入门指南

本指南旨在为 Claude 提供使用 Claude API 的基础知识。它提供了模型 ID/基本消息 API、工具使用、流式传输、扩展思考的解释和示例，仅此而已。

---

# Claude API 使用入门指南

> 本指南旨在为 Claude 提供使用 Claude API 的基础知识。它提供了模型 ID/基本消息 API、工具使用、流式传输、扩展思考的解释和示例，仅此而已。

## 模型

```
最智能的模型：Claude Opus 4.5：claude-opus-4-5-20251101
智能模型：Claude Sonnet 4.5：claude-sonnet-4-5-20250929
用于快速、经济高效的任务：Claude Haiku 4.5：claude-haiku-4-5-20251001
```

## 调用 API

### 基本请求和响应

```python
import anthropic
import os

message = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY")).messages.create(
    model="claude-sonnet-4-5",
    max_tokens=1024,
    messages=[
        {"role": "user", "content": "Hello, Claude"}
    ]
)
print(message)
```

```json
{
  "id": "msg_01XFDUDYJgAACzvnptvVoYEL",
  "type": "message",
  "role": "assistant",
  "content": [
    {
      "type": "text",
      "text": "Hello!"
    }
  ],
  "model": "claude-sonnet-4-5",
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "usage": {
    "input_tokens": 12,
    "output_tokens": 6
  }
}
```

### 多轮对话

Messages API 是无状态的，这意味着你总是向 API 发送完整的对话历史。你可以使用这种模式随时间推移建立对话。早期的对话轮次不一定需要真正来自 Claude — 你可以使用合成的 `assistant` 消息。

```python
import anthropic

message = anthropic.Anthropic().messages.create(
    model="claude-sonnet-4-5",
    max_tokens=1024,
    messages=[
        {"role": "user", "content": "Hello, Claude"},
        {"role": "assistant", "content": "Hello!"},
        {"role": "user", "content": "Can you describe LLMs to me?"}
    ],
)
print(message)
```

### 为 Claude 代言

你可以在输入消息列表的最后位置预填 Claude 响应的一部分。这可以用来塑造 Claude 的响应。下面的示例使用 `"max_tokens": 1` 从 Claude 获得单个多选答案。

```python
message = anthropic.Anthropic().messages.create(
    model="claude-sonnet-4-5",
    max_tokens=1,
    messages=[
        {"role": "user", "content": "What is latin for Ant? (A) Apoidea, (B) Rhopalocera, (C) Formicidae"},
        {"role": "assistant", "content": "The answer is ("}
    ]
)
```

### 视觉

Claude 可以在请求中读取文本和图像。我们支持图像的 `base64` 和 `url` 源类型，以及 `image/jpeg`、`image/png`、`image/gif` 和 `image/webp` 媒体类型。

```python
import anthropic
import base64
import httpx

# 选项 1：Base64 编码的图像
image_url = "https://upload.wikimedia.org/wikipedia/commons/a/a7/Camponotus_flavomarginatus_ant.jpg"
image_media_type = "image/jpeg"
image_data = base64.standard_b64encode(httpx.get(image_url).content).decode("utf-8")

message = anthropic.Anthropic().messages.create(
    model="claude-sonnet-4-5",
    max_tokens=1024,
    messages=[
        {
            "role": "user",
            "content": [
                {
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": image_media_type,
                        "data": image_data,
                    },
                },
                {
                    "type": "text",
                    "text": "What is in the above image?"
                }
            ],
        }
    ],
)

# 选项 2：URL 引用的图像
message_from_url = anthropic.Anthropic().messages.create(
    model="claude-sonnet-4-5",
    max_tokens=1024,
    messages=[
        {
            "role": "user",
            "content": [
                {
                    "type": "image",
                    "source": {
                        "type": "url",
                        "url": "https://upload.wikimedia.org/wikipedia/commons/a/a7/Camponotus_flavomarginatus_ant.jpg",
                    },
                },
                {
                    "type": "text",
                    "text": "What is in the above image?"
                }
            ],
        }
    ],
)
```

## 扩展思考

扩展思考有时可以帮助 Claude 完成非常困难的任务。启用时，温度必须设置为 1。

以下模型支持扩展思考：

- Claude Opus 4.1（`claude-opus-4-1-20250805`）
- Claude Opus 4（`claude-opus-4-20250514`）
- Claude Sonnet 4.5（`claude-sonnet-4-5-20250929`）

### 扩展思考如何工作

启用扩展思考后，Claude 会创建 `thinking` 内容块，其中输出其内部推理。API 响应将包括 `thinking` 内容块，后跟 `text` 内容块。

```python
import anthropic

client = anthropic.Anthropic()

response = client.messages.create(
    model="claude-sonnet-4-5",
    max_tokens=16000,
    thinking={
        "type": "enabled",
        "budget_tokens": 10000
    },
    messages=[{
        "role": "user",
        "content": "Are there an infinite number of prime numbers such that n mod 4 == 3?"
    }]
)

# 响应将包含总结的思考块和文本块
for block in response.content:
    if block.type == "thinking":
        print(f"\nThinking summary: {block.thinking}")
    elif block.type == "text":
        print(f"\nResponse: {block.text}")
```

`budget_tokens` 参数确定 Claude 允许用于其内部推理过程的最大令牌数。在 Claude 4 模型中，此限制适用于完整思考令牌，而不是总结输出。更大的预算可以通过为复杂问题启用更彻底的分析来改进响应质量。一条规则：max_tokens 的值必须严格大于 budget_tokens 的值，以便 Claude 在思考完成后有空间写出响应。

## 扩展思考与工具使用

扩展思考可以与工具使用一起使用，允许 Claude 通过工具选择和结果处理进行推理。

重要限制：

1. **工具选择限制**：仅支持 `tool_choice: {"type": "auto"}`（默认）或 `tool_choice: {"type": "none"}`。
2. **保留思考块**：在工具使用期间，你必须将 `thinking` 块传回 API 以用于最后的助手消息。

### 保留思考块

```python
# 第一个请求 - Claude 响应思考和工具请求
response = client.messages.create(
    model="claude-sonnet-4-5",
    max_tokens=16000,
    thinking={
        "type": "enabled",
        "budget_tokens": 10000
    },
    tools=[weather_tool],
    messages=[
        {"role": "user", "content": "What's the weather in Paris?"}
    ]
)

# 提取思考块和工具使用块
thinking_block = next((block for block in response.content
                      if block.type == 'thinking'), None)
tool_use_block = next((block for block in response.content
                      if block.type == 'tool_use'), None)

# 第二个请求 - 包括思考块和工具结果
continuation = client.messages.create(
    model="claude-sonnet-4-5",
    max_tokens=16000,
    thinking={
        "type": "enabled",
        "budget_tokens": 10000
    },
    tools=[weather_tool],
    messages=[
        {"role": "user", "content": "What's the weather in Paris?"},
        # 注意 thinking_block 与 tool_use_block 一起传递
        {"role": "assistant", "content": [thinking_block, tool_use_block]},
        {"role": "user", "content": [{
            "type": "tool_result",
            "tool_use_id": tool_use_block.id,
            "content": f"Current temperature: {weather_data['temperature']}°F"
        }]}
    ]
)
```

### 交错思考

Claude 4 模型中的扩展思考与工具使用支持交错思考，这使 Claude 能够在工具调用之间进行思考。要启用，请将 beta 标头 `interleaved-thinking-2025-05-14` 添加到你的 API 请求中。

```python
response = client.beta.messages.create(
    model="claude-sonnet-4-5",
    max_tokens=16000,
    thinking={
        "type": "enabled",
        "budget_tokens": 10000
    },
    tools=[calculator_tool, database_tool],
    messages=[{
        "role": "user",
        "content": "What's the total revenue if we sold 150 units of product A at $50 each?"
    }],
    betas=["interleaved-thinking-2025-05-14"]
)
```

使用交错思考，且仅使用交错思考（不是常规扩展思考），`budget_tokens` 可以超过 `max_tokens` 参数，因为在这种情况下 `budget_tokens` 代表一个助手轮次内所有思考块的总预算。

## 工具使用

### 指定客户端工具

客户端工具在 API 请求的 `tools` 顶级参数中指定。每个工具定义包括：

| 参数           | 描述                                                                                         |
| :------------- | :-------------------------------------------------------------------------------------------------- |
| `name`         | 工具的名称。必须匹配正则表达式 `^[a-zA-Z0-9_-]{1,64}$`。                                 |
| `description`  | 工具功能、何时应使用以及其行为方式的详细纯文本描述。 |
| `input_schema` | 定义工具预期参数的 [JSON Schema](https://json-schema.org/) 对象。     |

```json
{
  "name": "get_weather",
  "description": "Get the current weather in a given location",
  "input_schema": {
    "type": "object",
    "properties": {
      "location": {
        "type": "string",
        "description": "The city and state, e.g. San Francisco, CA"
      },
      "unit": {
        "type": "string",
        "enum": ["celsius", "fahrenheit"],
        "description": "The unit of temperature, either 'celsius' or 'fahrenheit'"
      }
    },
    "required": ["location"]
  }
}
```

### 工具定义的最佳实践

**提供极其详细的描述。** 这是迄今为止影响工具性能的最重要因素。你的描述应该解释有关工具的每个细节，包括：

- 工具的功能
- 何时应该使用它（以及何时不应该）
- 每个参数的含义以及它如何影响工具的行为
- 任何重要的注意事项或限制

**考虑为复杂工具使用 `input_examples`。** 对于具有嵌套对象、可选参数或格式敏感输入的工具，你可以使用 `input_examples` 字段（beta）提供具体示例。这有助于 Claude 理解预期的输入模式。有关详细信息，请参阅[提供工具使用示例](/docs/zh-CN/agents-and-tools/tool-use/implement-tool-use#providing-tool-use-examples)。

好的工具描述示例：

```json
{
  "name": "get_stock_price",
  "description": "Retrieves the current stock price for a given ticker symbol. The ticker symbol must be a valid symbol for a publicly traded company on a major US stock exchange like NYSE or NASDAQ. The tool will return the latest trade price in USD. It should be used when the user asks about the current or most recent price of a specific stock. It will not provide any other information about the stock or company.",
  "input_schema": {
    "type": "object",
    "properties": {
      "ticker": {
        "type": "string",
        "description": "The stock ticker symbol, e.g. AAPL for Apple Inc."
      }
    },
    "required": ["ticker"]
  }
}
```

## 控制 Claude 的输出

### 强制工具使用

你可以通过在 `tool_choice` 字段中指定工具来强制 Claude 使用特定工具：

```python
tool_choice = {"type": "tool", "name": "get_weather"}
```

使用 tool_choice 参数时，我们有四个可能的选项：

- `auto` 允许 Claude 决定是否调用任何提供的工具（默认）。
- `any` 告诉 Claude 它必须使用提供的工具之一。
- `tool` 允许我们强制 Claude 始终使用特定工具。
- `none` 防止 Claude 使用任何工具。

### JSON 输出

工具不一定需要是客户端函数 — 你可以在任何想要模型返回遵循提供的模式的 JSON 输出时使用工具。

### 思考链

使用工具时，Claude 通常会显示其"思考链"，即它用来分解问题和决定使用哪些工具的逐步推理。

```json
{
  "role": "assistant",
  "content": [
    {
      "type": "text",
      "text": "<thinking>To answer this question, I will: 1. Use the get_weather tool to get the current weather in San Francisco. 2. Use the get_time tool to get the current time in the America/Los_Angeles timezone, which covers San Francisco, CA.</thinking>"
    },
    {
      "type": "tool_use",
      "id": "toolu_01A09q90qw90lq917835lq9",
      "name": "get_weather",
      "input": { "location": "San Francisco, CA" }
    }
  ]
}
```

### 并行工具使用

默认情况下，Claude 可能会使用多个工具来回答用户查询。你可以通过设置 `disable_parallel_tool_use=true` 来禁用此行为。

## 处理工具使用和工具结果内容块

### 处理来自客户端工具的结果

响应将具有 `tool_use` 的 `stop_reason` 和一个或多个 `tool_use` 内容块，其中包括：

- `id`：此特定工具使用块的唯一标识符。
- `name`：正在使用的工具的名称。
- `input`：包含传递给工具的输入的对象。

当你收到工具使用响应时，你应该：

1. 从 `tool_use` 块中提取 `name`、`id` 和 `input`。
2. 在你的代码库中运行与该工具名称对应的实际工具。
3. 通过发送带有 `tool_result` 的新消息继续对话：

```json
{
  "role": "user",
  "content": [
    {
      "type": "tool_result",
      "tool_use_id": "toolu_01A09q90qw90lq917835lq9",
      "content": "15 degrees"
    }
  ]
}
```

### 处理 `max_tokens` 停止原因

如果 Claude 的响应在工具使用期间因达到 `max_tokens` 限制而被截断，请使用更高的 `max_tokens` 值重试请求。

### 处理 `pause_turn` 停止原因

使用服务器工具（如网络搜索）时，API 可能会返回 `pause_turn` 停止原因。通过在后续请求中按原样传回暂停的响应来继续对话。

## 故障排除错误

### 工具执行错误

如果工具本身在执行期间抛出错误，请使用 `"is_error": true` 返回错误消息：

```json
{
  "role": "user",
  "content": [
    {
      "type": "tool_result",
      "tool_use_id": "toolu_01A09q90qw90lq917835lq9",
      "content": "ConnectionError: the weather service API is not available (HTTP 500)",
      "is_error": true
    }
  ]
}
```

### 无效的工具名称

如果 Claude 尝试使用工具无效（例如缺少必需参数），请使用工具定义中更详细的 `description` 值再次尝试请求。

## 流式传输消息

创建消息时，你可以设置 `"stream": true` 以使用服务器发送事件 (SSE) 增量流式传输响应。

### 使用 SDK 进行流式传输

```python
import anthropic

client = anthropic.Anthropic()

with client.messages.stream(
    max_tokens=1024,
    messages=[{"role": "user", "content": "Hello"}],
    model="claude-sonnet-4-5",
) as stream:
    for text in stream.text_stream:
        print(text, end="", flush=True)
```

### 事件类型

每个服务器发送事件都包括一个命名事件类型和关联的 JSON 数据。每个流使用以下事件流：

1. `message_start`：包含一个具有空 `content` 的 `Message` 对象。
2. 一系列内容块，每个块都有 `content_block_start`、一个或多个 `content_block_delta` 事件和 `content_block_stop`。
3. 一个或多个 `message_delta` 事件，指示对最终 `Message` 对象的顶级更改。
4. 最后一个 `message_stop` 事件。

**警告**：`message_delta` 事件的 `usage` 字段中显示的令牌计数是_累积的_。

### 内容块 delta 类型

#### 文本 delta

```json
{
  "type": "content_block_delta",
  "index": 0,
  "delta": { "type": "text_delta", "text": "Hello frien" }
}
```

#### 输入 JSON delta

对于 `tool_use` 内容块，delta 是_部分 JSON 字符串_：

```json
{"type": "content_block_delta","index": 1,"delta": {"type": "input_json_delta","partial_json": "{\"location\": \"San Fra"}}
```

#### 思考 delta

使用扩展思考进行流式传输时：

```json
{
  "type": "content_block_delta",
  "index": 0,
  "delta": {
    "type": "thinking_delta",
    "thinking": "Let me solve this step by step..."
  }
}
```

### 基本流式传输请求示例

```json
event: message_start
data: {"type": "message_start", "message": {"id": "msg_1nZdL29xx5MUA1yADyHTEsnR8uuvGzszyY", "type": "message", "role": "assistant", "content": [], "model": "claude-sonnet-4-5", "stop_reason": null, "stop_sequence": null, "usage": {"input_tokens": 25, "output_tokens": 1}}}

event: content_block_start
data: {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}}

event: content_block_delta
data: {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "Hello"}}

event: content_block_delta
data: {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "!"}}

event: content_block_stop
data: {"type": "content_block_stop", "index": 0}

event: message_delta
data: {"type": "message_delta", "delta": {"stop_reason": "end_turn", "stop_sequence":null}, "usage": {"output_tokens": 15}}

event: message_stop
data: {"type": "message_stop"}
```