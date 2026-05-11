# mcp-openai-bridge

本项目是一个本地 MCP 文件系统 Agent：让 OpenAI-compatible Responses API 通过 JSON 指令调用本地 MCP filesystem server，从而安全地读取、搜索和修改授权目录内的文件。

由于目标 API 当前不支持原生 tools/function calling，本项目采用“模型输出 JSON → 本地程序解析 → 调用 MCP 工具 → 将结果回传模型”的桥接方式。

## 架构

```text
用户 / CLI / HTTP / Chat
        ↓
本地 Agent
        ↓
OpenAI-compatible Responses API
        ↓
JSON 工具调用协议
        ↓
MCP filesystem server
        ↓
本地文件系统（仅限授权工作目录）
```

## 主要能力

- 读取、搜索、列出本地授权目录文件
- 支持写入、编辑、创建目录等文件操作
- 支持单次 CLI、交互式终端、HTTP 服务三种使用方式
- 支持按请求指定 `workdir`
- 通过 `agent.config.json` 控制工作目录白名单和工具权限
- 通过 `model.config.json` 控制 Codex、Claude、DeepSeek 等模型的调用顺序
- 所有模型 API Key、Base URL、Model 参数都集中放在 `.env`
- 非交互 HTTP 模式会拒绝需要人工确认的工具
- 每个 agent step 会说明当前正在使用什么工具以及用途
- agent step 不再返回参数摘要和工具调用结果摘要，减少冗余输出

## 项目结构

```text
.
├── README.md
├── package.json
├── .env
├── mcp.config.json
├── agent.config.json
├── model.config.json
└── src
    ├── agent-core.js   # Agent 核心逻辑、MCP 连接、权限检查、模型循环
    ├── config.js       # 配置加载：默认值、JSON 解析、路径常量
    ├── cli-utils.js    # CLI 公共逻辑：参数解析、帮助输出、交互循环
    ├── http-utils.js   # HTTP 公共逻辑：JSON 响应、请求体读取、日志收集
    ├── index.js        # 单次 CLI 入口：npm run ask / npm start
    ├── askagent.js     # 单次/多轮 CLI 入口：npm run askagent
    ├── askchat.js      # 多轮终端入口：npm run askchat
    └── server.js       # HTTP 服务入口：npm run server
```

## 安装

```bash
npm install
```

## 环境变量

在 `.env` 中配置：

```env
CODEX_API_KEY=你的_Codex_API_KEY
CODEX_BASE_URL=你的_Codex_OpenAI_compatible_API_地址
CODEX_MODEL=gpt-5.5

CLAUDE_API_KEY=你的_Claude_API_KEY
CLAUDE_BASE_URL=你的_Claude_OpenAI_compatible_API_地址
CLAUDE_MODEL=claude-sonnet-4-5

DEEPSEEK_API_KEY=你的_DeepSeek_API_KEY
DEEPSEEK_BASE_URL=你的_DeepSeek_OpenAI_compatible_API_地址
DEEPSEEK_MODEL=deepseek-chat

AGENT_SERVER_HOST=127.0.0.1
AGENT_SERVER_PORT=8765
```

建议保持 `AGENT_SERVER_HOST=127.0.0.1`，避免将本地文件 Agent 暴露到局域网。

## MCP 配置

`mcp.config.json` 配置 filesystem server 的启动方式：

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "/path/to/npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/home/segzix/Projects"]
    }
  }
}
```

程序会根据每次请求的 `workdir` 动态替换 filesystem server 的授权目录。

## 模型协作配置

`model.config.json` 控制 Agent 使用哪个主执行模型，以及是否启用协作审查。默认推荐配置：

```json
{
  "collaborationMode": "dynamic",
  "activeProvider": "codex",
  "activeStrategy": "deepseek-codex-claude-review"
}
```

字段说明：

- `activeProvider`：主执行模型，默认 `codex`。只有主执行模型负责输出可执行 JSON 工具调用。
- `collaborationMode`：协作模式，可选 `single`、`dynamic`、`serial`。
  - `single`：始终只调用 `activeProvider`，最快、最省成本。
  - `dynamic`（默认）：普通步骤只调用 `activeProvider`；当准备执行 `write_file`、`edit_file`、`create_directory`、`move_file` 等高风险工具时，才按 `activeStrategy` 中除主模型外的模型请求审查意见。审查模型只提供建议，不直接调用工具。
  - `serial`：兼容旧模式，每个 Agent Step 都按 `activeStrategy.order` 串行调用多个模型，最后一个模型输出 JSON 指令。
- `activeStrategy`：在 `dynamic` 模式下决定审查模型范围；在 `serial` 模式下决定完整串行调用顺序。

当前架构遵循「默认 Codex 单模型 + 高风险任务按需协作 + 单一工具执行者」：Codex 是唯一工具执行者，其他模型只在需要时提供规划或审查建议。

完整配置示例：

```json
{
  "collaborationMode": "dynamic",
  "activeProvider": "codex",
  "activeStrategy": "deepseek-codex-claude-review",
  "providers": {
    "codex": {
      "apiKeyEnv": "CODEX_API_KEY",
      "baseUrlEnv": "CODEX_BASE_URL",
      "modelEnv": "CODEX_MODEL",
      "defaultModel": "gpt-5.5"
    },
    "claude": {
      "apiKeyEnv": "CLAUDE_API_KEY",
      "baseUrlEnv": "CLAUDE_BASE_URL",
      "modelEnv": "CLAUDE_MODEL",
      "defaultModel": "claude-sonnet-4-5"
    },
    "deepseek": {
      "apiKeyEnv": "DEEPSEEK_API_KEY",
      "baseUrlEnv": "DEEPSEEK_BASE_URL",
      "modelEnv": "DEEPSEEK_MODEL",
      "defaultModel": "deepseek-v4-flash"
    }
  },
  "strategies": {
    "codex-only": {
      "description": "只调用 Codex/OpenAI-compatible 模型，适合最快落地代码修改。",
      "order": ["codex"]
    },
    "claude-codex": {
      "description": "Claude 先分析规划，Codex 最后输出可执行 JSON，适合复杂需求实现。",
      "order": ["claude", "codex"]
    },
    "deepseek-codex": {
      "description": "DeepSeek 先给低成本草稿，Codex 工程化落地，适合大量中等复杂度任务。",
      "order": ["deepseek", "codex"]
    },
    "deepseek-codex-claude-review": {
      "description": "DeepSeek 初稿，Codex 实现，Claude 最终审查，适合成本敏感但需要最终质量把关。",
      "order": ["deepseek", "codex", "claude"]
    }
  }
}
```

推荐策略：

- `codex-only`：最快代码落地，配合 `collaborationMode: single` 使用。
- `claude-codex`：高质量开发，dynamic 模式下高风险操作由 Claude 审查。
- `deepseek-codex`：高性价比开发，dynamic 模式下高风险操作由 DeepSeek 审查。
- `deepseek-codex-claude-review`：dynamic 模式下高风险操作同时获得 DeepSeek 和 Claude 审查。

切换协作模式只需修改 `collaborationMode`；切换审查模型范围只需修改 `activeStrategy`。

## Agent 配置

`agent.config.json` 控制默认目录、工作目录白名单、工具权限和限制：

```json
{
  "defaultWorkdir": "/home/segzix/Projects/mcp-openai-bridge",
  "allowedWorkdirRoots": ["/home/segzix/Projects", "/home/segzix/ai-workspace"],
  "permissions": {
    "autoAllowTools": ["read_text_file", "list_directory", "search_files"],
    "askBeforeTools": ["move_file"],
    "denyTools": []
  },
  "limits": {
    "maxAgentSteps": 12,
    "maxSessionHistoryMessages": 8
  }
}
```

权限分两层：

1. `allowedWorkdirRoots`：只有这些根目录下的路径可以作为工作目录。
2. `permissions`：控制 MCP 工具是自动允许、需要确认还是拒绝。

## Agent Step 输出

当模型需要调用 MCP 工具时，Agent 会输出当前步骤正在使用的工具及用途，例如：

```text
正在使用工具 read_text_file：读取 README.md 以检查文档内容
```

为减少噪声，agent step 不再返回：

- 工具参数摘要 `argsSummary`
- 工具调用结果摘要 `resultSummary`

模型可以在工具参数中附加 `purpose` 或 `_purpose` 描述用途。Agent 会在真正调用 MCP 工具前移除这些仅供 Agent 使用的字段，避免传给 MCP server。

## 运行方式

### 单次 CLI

```bash
npm run ask -- "请列出当前工作目录文件"
npm run ask -- -C /home/segzix/Projects/xinyuan "请分析这个项目"
```

### 推荐 CLI：askagent

有问题时作为单次调用，无问题时进入多轮终端：

```bash
npm run askagent -- -C /home/segzix/Projects/xinyuan "请总结项目结构"
npm run askagent -- -C /home/segzix/Projects/xinyuan
```

终端内命令：

```text
/help       查看帮助
/pwd        显示当前工作目录
/cd <目录>  切换工作目录
/clear      清空会话上下文
/exit       退出
```

### 多轮 Chat

```bash
npm run askchat -- -C /home/segzix/Projects/xinyuan
```

### HTTP 服务

启动：

```bash
npm run server
```

健康检查：

```bash
curl http://127.0.0.1:8765/health
```

提问：

```bash
curl http://127.0.0.1:8765/ask \
  -H "Content-Type: application/json" \
  -d '{
    "workdir": "/home/segzix/Projects/xinyuan",
    "question": "请列出当前工作目录文件"
  }'
```

HTTP 接口为非交互模式，需要确认的工具会被拒绝。

## 安全建议

- 不要把敏感目录加入 `allowedWorkdirRoots`，例如 `.ssh`、`.aws`、`/etc`、`/`。
- 重要项目修改前先查看 Git 状态：`git status`。
- 修改后使用 `git diff` 检查变更。
- 如果希望更安全，可将 `write_file`、`edit_file`、`create_directory` 从 `autoAllowTools` 移到 `askBeforeTools`。
- HTTP 服务建议只监听 `127.0.0.1`。

## 常见场景

```bash
npm run askagent -- -C /path/to/project "请分析技术栈和入口文件"
npm run askagent -- -C /path/to/project "请查找所有 README 和 package.json"
npm run askagent -- -C /path/to/project "请创建 notes.md，内容是 hello agent"
```
