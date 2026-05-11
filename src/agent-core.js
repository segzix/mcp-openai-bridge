import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { fileURLToPath } from "node:url";

import OpenAI from "openai";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..");

const MCP_CONFIG_PATH = path.join(PROJECT_ROOT, "mcp.config.json");
const AGENT_CONFIG_PATH = path.join(PROJECT_ROOT, "agent.config.json");

if (!process.env.OPENAI_API_KEY) {
  throw new Error("Missing OPENAI_API_KEY in .env");
}

if (!process.env.OPENAI_BASE_URL) {
  throw new Error("Missing OPENAI_BASE_URL in .env");
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL,
  timeout: 60000,
  maxRetries: 2,
});

const model = process.env.OPENAI_MODEL || "gpt-5.5";

const defaultAgentConfig = {
  defaultWorkdir: PROJECT_ROOT,
  allowedWorkdirRoots: ["/home/segzix"],
  permissions: {
    autoAllowTools: [
      "list_allowed_directories",
      "list_directory",
      "list_directory_with_sizes",
      "directory_tree",
      "get_file_info",
      "search_files",
      "read_file",
      "read_text_file",
      "read_media_file",
      "read_multiple_files",
    ],
    askBeforeTools: [
      "write_file",
      "edit_file",
      "create_directory",
      "move_file",
    ],
    denyTools: [],
  },
  limits: {
    maxAgentSteps: 12,
    maxSessionHistoryMessages: 8,
  },
};

async function loadJsonFile(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export async function loadMcpConfig() {
  return await loadJsonFile(MCP_CONFIG_PATH, null);
}

export async function loadAgentConfig() {
  const loaded = await loadJsonFile(AGENT_CONFIG_PATH, {});

  return {
    ...defaultAgentConfig,
    ...loaded,
    permissions: {
      ...defaultAgentConfig.permissions,
      ...(loaded.permissions || {}),
    },
    limits: {
      ...defaultAgentConfig.limits,
      ...(loaded.limits || {}),
    },
  };
}

function isPathInside(child, parent) {
  const relative = path.relative(parent, child);

  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

export async function resolveWorkdir(requestedWorkdir) {
  const agentConfig = await loadAgentConfig();
  const rawWorkdir = requestedWorkdir || agentConfig.defaultWorkdir;

  const resolvedWorkdir = path.resolve(rawWorkdir);
  const allowedRoots = agentConfig.allowedWorkdirRoots || [PROJECT_ROOT];

  const resolvedAllowedRoots = allowedRoots.map((root) => path.resolve(root));

  const isAllowed = resolvedAllowedRoots.some((root) =>
    isPathInside(resolvedWorkdir, root),
  );

  if (!isAllowed) {
    throw new Error(
      `工作目录不在允许范围内：${resolvedWorkdir}\n允许范围：${resolvedAllowedRoots.join(
        ", ",
      )}`,
    );
  }

  return resolvedWorkdir;
}

function buildFilesystemServerArgs(originalArgs, workdir) {
  const markerIndex = originalArgs.findIndex((arg) =>
    String(arg).includes("@modelcontextprotocol/server-filesystem"),
  );

  if (markerIndex === -1) {
    return [...originalArgs, workdir];
  }

  return [...originalArgs.slice(0, markerIndex + 1), workdir];
}

export async function connectFilesystemMcpServer(options = {}) {
  const { workdir } = options;
  const resolvedWorkdir = await resolveWorkdir(workdir);
  const config = await loadMcpConfig();

  const serverConfig = config?.mcpServers?.filesystem;

  if (!serverConfig) {
    throw new Error("mcp.config.json 中没有找到 mcpServers.filesystem 配置");
  }

  const transport = new StdioClientTransport({
    command: serverConfig.command,
    args: buildFilesystemServerArgs(serverConfig.args || [], resolvedWorkdir),
  });

  const client = new Client({
    name: "openai-mcp-filesystem-json-bridge",
    version: "1.0.0",
  });

  await client.connect(transport);

  return {
    client,
    workdir: resolvedWorkdir,
  };
}

function buildToolDescriptions(mcpTools) {
  return mcpTools
    .map((tool) => {
      return [
        `工具名: ${tool.name}`,
        `描述: ${tool.description || ""}`,
        `参数Schema: ${JSON.stringify(tool.inputSchema || {}, null, 2)}`,
      ].join("\n");
    })
    .join("\n\n");
}

function extractJson(text) {
  let cleaned = String(text || "").trim();

  if (cleaned.startsWith("```json")) {
    cleaned = cleaned
      .replace(/^```json\s*/i, "")
      .replace(/```$/i, "")
      .trim();
  } else if (cleaned.startsWith("```")) {
    cleaned = cleaned
      .replace(/^```\s*/i, "")
      .replace(/```$/i, "")
      .trim();
  }

  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");

  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }

  return JSON.parse(cleaned);
}

async function callModel(conversation) {
  const response = await openai.responses.create({
    model,
    input: conversation,
  });

  return response.output_text || "";
}

async function confirmToolCallInteractive(toolName, args) {
  console.log("\nAI 请求执行需要确认的操作：");
  console.log("Tool:", toolName);
  console.log("Args:", JSON.stringify(args, null, 2));

  const rl = readline.createInterface({ input, output });
  const answer = await rl.question("是否允许执行？输入 yes 继续：");
  rl.close();

  return answer.trim().toLowerCase() === "yes";
}

async function checkToolPermission(toolName, args, options = {}) {
  const { interactive = true, logger = console } = options;

  const agentConfig = await loadAgentConfig();

  const autoAllowTools = new Set(
    agentConfig.permissions?.autoAllowTools || [],
  );
  const askBeforeTools = new Set(
    agentConfig.permissions?.askBeforeTools || [],
  );
  const denyTools = new Set(agentConfig.permissions?.denyTools || []);

  if (denyTools.has(toolName)) {
    logger.log(`\n工具被 agent.config.json 配置为拒绝执行：${toolName}`);

    return {
      allowed: false,
      reason: "denied_by_config",
    };
  }

  if (autoAllowTools.has(toolName)) {
    return {
      allowed: true,
      reason: "auto_allowed_by_config",
    };
  }

  if (askBeforeTools.has(toolName)) {
    if (!interactive) {
      logger.log(`\n工具需要确认，但当前是非交互模式，已拒绝：${toolName}`);

      return {
        allowed: false,
        reason: "requires_confirmation_in_non_interactive_mode",
      };
    }

    const confirmed = await confirmToolCallInteractive(toolName, args);

    return {
      allowed: confirmed,
      reason: confirmed ? "confirmed_by_user" : "rejected_by_user",
    };
  }

  logger.log(`\n未知工具，默认拒绝执行：${toolName}`);

  return {
    allowed: false,
    reason: "unknown_tool_default_deny",
  };
}

function normalizeToolResult(toolResult) {
  return toolResult?.content ?? toolResult;
}

function truncateText(text, maxLength = 500) {
  const value = String(text || "");

  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength)}...（已省略 ${value.length - maxLength} 字符）`;
}

function summarizeForLog(value, maxLength = 800) {
  if (typeof value === "string") {
    return truncateText(value, maxLength);
  }

  return truncateText(JSON.stringify(value, null, 2), maxLength);
}

function summarizeToolResultForLog(result) {
  if (Array.isArray(result)) {
    return result
      .map((item) => {
        if (item?.type === "text") {
          return {
            ...item,
            text: truncateText(item.text, 500),
          };
        }

        return item;
      })
      .slice(0, 3);
  }

  return result;
}

function buildAgentStep(step, type, details = {}) {
  return {
    step,
    type,
    ...details,
  };
}

function stripAgentOnlyArgs(args = {}) {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    return args;
  }

  const { purpose, _purpose, ...toolArgs } = args;

  return toolArgs;
}

function describeToolPurpose(toolName, args = {}) {
  const explicitPurpose = args.purpose || args._purpose;

  if (explicitPurpose) {
    return String(explicitPurpose);
  }

  const target = args.path || args.source || args.destination;

  const purposeByTool = {
    list_allowed_directories: "查看当前 MCP filesystem server 允许访问哪些目录，确认后续文件操作范围",
    list_directory: target ? `列出目录内容：${target}` : "列出指定目录内容，了解当前文件结构",
    list_directory_with_sizes: target ? `列出目录内容和大小：${target}` : "列出指定目录内容和大小",
    directory_tree: target ? `查看目录树结构：${target}` : "递归查看目录树结构，定位相关文件",
    get_file_info: target ? `查看文件或目录元信息：${target}` : "查看文件或目录元信息",
    search_files: args.pattern ? `按模式搜索文件：${args.pattern}` : "搜索匹配条件的文件或目录",
    read_file: target ? `读取文件内容：${target}` : "读取文件内容以便分析",
    read_text_file: target ? `读取文本文件内容：${target}` : "读取文本文件内容以便分析",
    read_media_file: target ? `读取媒体文件内容：${target}` : "读取图片或音频文件内容",
    read_multiple_files: Array.isArray(args.paths)
      ? `批量读取 ${args.paths.length} 个文件内容以便分析`
      : "批量读取多个文件内容以便分析",
    write_file: target ? `写入文件：${target}` : "创建或覆盖写入文件",
    edit_file: target ? `编辑文件：${target}` : "修改文本文件内容",
    create_directory: target ? `创建或确保目录存在：${target}` : "创建或确保目录存在",
    move_file: args.source && args.destination
      ? `移动或重命名：${args.source} -> ${args.destination}`
      : "移动或重命名文件或目录",
  };

  return purposeByTool[toolName] || `使用 ${toolName} 完成当前任务所需的下一步操作`;
}

function logAgentStep(logger, step, message) {
  logger.log(`\n==================== Agent Step ${step} ====================\n ${message}`);
}

function buildHistoryText(history) {
  if (!Array.isArray(history) || history.length === 0) {
    return "";
  }

  return history
    .map((item, index) => {
      return [
        `历史消息 ${index + 1}`,
        `用户: ${item.question || ""}`,
        `助手: ${item.answer || ""}`,
      ].join("\n");
    })
    .join("\n\n");
}

export async function askAgent(options = {}) {
  const {
    question,
    workdir,
    history = [],
    interactive = true,
    logger = console,
  } = options;

  const userQuestion =
    question || "请先查看你被授权访问的目录，然后列出该目录下的文件。";

  logger.log("正在连接本地 MCP filesystem server...");

  const { client: mcp, workdir: resolvedWorkdir } =
    await connectFilesystemMcpServer({ workdir });

  try {
    logger.log(`当前工作目录：${resolvedWorkdir}`);

    const mcpToolsResult = await mcp.listTools();
    const mcpTools = mcpToolsResult.tools || [];

    logger.log("\nMCP tools:");
    for (const tool of mcpTools) {
      logger.log("-", tool.name);
    }

    const agentConfig = await loadAgentConfig();
    const maxAgentSteps = agentConfig.limits?.maxAgentSteps || 12;

    const toolDescriptions = buildToolDescriptions(mcpTools);
    const availableToolNames = new Set(mcpTools.map((tool) => tool.name));
    const historyText = buildHistoryText(history);

    let conversation = `
你是一个本地文件助手，工作方式类似终端中的 coding agent。

重要背景：
你不能直接访问本地文件系统。
但是，外部程序已经给你提供了一组 MCP 工具。
你必须通过输出 JSON 指令来请求外部程序调用 MCP 工具。

当前工作目录：
${resolvedWorkdir}

当前可用 MCP 工具如下：

${toolDescriptions}

${historyText ? `以下是本会话历史上下文：\n\n${historyText}\n` : ""}

你只能输出以下两种 JSON 之一。

第一种：调用工具

{
  "action": "call_tool",
  "tool": "工具名",
  "arguments": {}
}

调用工具时，必须在 arguments 中尽量包含 purpose 字段，用一句中文说明当前为什么要用这个工具、它用于完成哪一步任务。

第二种：最终回答

{
  "action": "final",
  "answer": "你的最终回答"
}

严格规则：
1. 只输出 JSON，不要输出 Markdown。
2. 不要使用代码块。
3. 不要解释 JSON。
4. 不要说“我没有工具”。
5. 你有工具，工具列表已经在上方给出。
6. 如果用户问你能访问哪里，先调用 list_allowed_directories。
7. 如果用户要你列文件，先调用 list_allowed_directories，再调用 list_directory。
8. 只能使用工具列表中存在的工具名。
9. JSON 必须能被 JSON.parse 解析。
10. 如果工具返回结果足够回答用户，就输出 final JSON。
11. 所有文件操作都应以当前工作目录为上下文，不要假设可以访问未授权目录。
12. 写入、编辑、创建目录、移动操作属于高风险操作，只有被外部程序允许后才会执行。

用户问题：
${userQuestion}
`;

    const steps = [];

    for (let step = 1; step <= maxAgentSteps; step += 1) {
      const text = await callModel(conversation);

      let command;

      try {
        command = extractJson(text);
      } catch (error) {
        conversation += `

你的上一次输出不是合法 JSON：

${text}

错误：
${error.message}

请重新输出合法 JSON。
只能输出：
{
  "action": "call_tool",
  "tool": "工具名",
  "arguments": {}
}
或者：
{
  "action": "final",
  "answer": "最终回答"
}
`;

        logAgentStep(logger, step, "模型输出不是合法 JSON，已要求重试");

        steps.push(buildAgentStep(step, "invalid_json", {
          error: error.message,
        }));

        continue;
      }

      if (command.action === "final") {
        logAgentStep(logger, step, "生成最终回复");
        logger.log("\nAI 回复：\n");
        logger.log(command.answer);

        return {
          answer: command.answer,
          steps,
        };
      }

      if (command.action !== "call_tool") {
        conversation += `

你的 action 无效：

${JSON.stringify(command, null, 2)}

action 只能是 call_tool 或 final。
请重新输出合法 JSON。
`;

        logAgentStep(logger, step, `无效 action：${command.action || "unknown"}`);

        steps.push(buildAgentStep(step, "invalid_action", {
          action: command.action,
        }));

        continue;
      }

      const toolName = command.tool;
      const args = command.arguments || {};
      const toolArgs = stripAgentOnlyArgs(args);

      if (!availableToolNames.has(toolName)) {
        conversation += `

你请求了不存在的工具：

${toolName}

可用工具只有：

${Array.from(availableToolNames).join(", ")}

请重新选择正确工具。
`;

        logAgentStep(logger, step, `请求了不存在的工具：${toolName}`);

        steps.push(buildAgentStep(step, "unknown_tool", {
          toolName,
        }));

        continue;
      }

      const permission = await checkToolPermission(toolName, toolArgs, {
        interactive,
        logger,
      });

      if (!permission.allowed) {
        conversation += `

工具调用被拒绝：

工具：
${toolName}

使用这个工具的目的：
${describeToolPurpose(toolName, args)}

拒绝原因：
${permission.reason}

请基于这个情况继续。
如果不能完成任务，请输出 final JSON 说明原因。
`;

        logAgentStep(logger, step, `工具调用被拒绝：${toolName}（${permission.reason}）`);

        steps.push(buildAgentStep(step, "tool_denied", {
          toolName,
          purpose: describeToolPurpose(toolName, args),
          reason: permission.reason,
        }));

        continue;
      }

      const toolPurpose = describeToolPurpose(toolName, args);

      logAgentStep(logger, step, `正在使用工具 ${toolName}：${toolPurpose}`);

      let toolResult;

      try {
        toolResult = await mcp.callTool({
          name: toolName,
          arguments: toolArgs,
        });
      } catch (error) {
        toolResult = {
          error: error.message || String(error),
        };
      }

      const normalizedToolResult = normalizeToolResult(toolResult);

      steps.push(buildAgentStep(step, "tool_call", {
        toolName,
        purpose: toolPurpose,
        permission: permission.reason,
      }));

      conversation += `

你刚才使用工具：
${toolName}

使用这个工具的目的：
${toolPurpose}

工具返回结果：

${JSON.stringify(normalizedToolResult, null, 2)}

请继续。
如果还需要调用工具，输出 call_tool JSON。
如果已经可以回答用户，输出 final JSON。
`;
    }

    const fallbackAnswer = "达到最大步骤数，已停止。";

    logger.log("\n" + fallbackAnswer);

    return {
      answer: fallbackAnswer,
      steps,
    };
  } finally {
    try {
      await mcp.close();
    } catch {
      // ignore close errors
    }
  }
}
