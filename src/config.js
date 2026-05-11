import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const PROJECT_ROOT = path.resolve(__dirname, "..");
export const MCP_CONFIG_PATH = path.join(PROJECT_ROOT, "mcp.config.json");
export const AGENT_CONFIG_PATH = path.join(PROJECT_ROOT, "agent.config.json");
export const MODEL_CONFIG_PATH = path.join(PROJECT_ROOT, "model.config.json");

const defaultModelConfig = {
  collaborationMode: "dynamic",
  activeProvider: "codex",
  activeStrategy: "codex-only",
  providers: {
    codex: {
      label: "Codex / OpenAI-compatible code model",
      apiKeyEnv: "CODEX_API_KEY",
      baseUrlEnv: "CODEX_BASE_URL",
      modelEnv: "CODEX_MODEL",
      defaultModel: "gpt-5.5",
      role: "工程实现、代码修改、测试修复、工具调用落地",
    },
  },
  strategies: {
    "codex-only": {
      description: "只调用 Codex/OpenAI-compatible 模型。",
      order: ["codex"],
    },
  },
  recommendedStrategies: [],
};

export const defaultAgentConfig = {
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
      "parse_pdf",
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
  return loadJsonFile(MCP_CONFIG_PATH, null);
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

export async function loadModelConfig() {
  const loaded = await loadJsonFile(MODEL_CONFIG_PATH, {});

  return {
    ...defaultModelConfig,
    ...loaded,
    collaborationMode:
      loaded.collaborationMode || defaultModelConfig.collaborationMode,
    activeProvider: loaded.activeProvider || defaultModelConfig.activeProvider,
    providers: {
      ...defaultModelConfig.providers,
      ...(loaded.providers || {}),
    },
    strategies: {
      ...defaultModelConfig.strategies,
      ...(loaded.strategies || {}),
    },
    recommendedStrategies:
      loaded.recommendedStrategies || defaultModelConfig.recommendedStrategies,
  };
}
