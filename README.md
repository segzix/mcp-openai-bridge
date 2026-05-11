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
└── src
    ├── agent-core.js   # Agent 核心逻辑、MCP 连接、权限检查、模型循环
    ├── index.js        # 单次 CLI 入口：npm run ask
    ├── askagent.js     # 单次/多轮 CLI 入口：npm run askagent
    ├── chat.js         # 多轮终端入口：npm run chat
    └── server.js       # HTTP 服务入口：npm run server
```

## 安装

```bash
npm install
```

## 环境变量

在 `.env` 中配置：

```env
OPENAI_API_KEY=你的第三方_API_KEY
OPENAI_BASE_URL=你的第三方_API_地址
OPENAI_MODEL=gpt-5.5

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
npm run chat -- -C /home/segzix/Projects/xinyuan
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
