import readline from "node:readline/promises";
import path from "node:path";
import { stdin as input, stdout as output } from "node:process";
import { askAgent, loadAgentConfig, resolveWorkdir } from "./agent-core.js";
function parseArgs(argv) {
  let workdir;
  const questionParts = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--workdir" || arg === "-C") {
      workdir = argv[++i];
      continue;
    }
    if (arg.startsWith("--workdir=")) {
      workdir = arg.slice("--workdir=".length);
      continue;
    }
    questionParts.push(arg);
  }
  return {
    workdir,
    question: questionParts.join(" ").trim()
  };
}
function printHelp() {
  console.log(`
askagent 使用方式：
单次模式：
  askagent -C /path/to/project 请分析这个项目
  askagent --workdir /path/to/project 请列出文件
多轮终端模式：
  askagent
  askagent -C /path/to/project
终端内命令：
  /help               显示帮助
  /pwd                显示当前工作目录
  /cd <目录>          切换工作目录，后续 MCP 文件操作仅限新目录
  /clear              清空本会话上下文
  /exit 或 /quit      退出
说明：
  1. 不传 -C 时使用 agent.config.json 的 defaultWorkdir。
  2. 所有文件操作都限制在当前工作目录内。
  3. 写文件、编辑文件、创建目录是否自动允许，由 agent.config.json 控制。
  4. 需要确认的操作会提示输入 yes。
`);
}
async function runSingleQuestion({ question, workdir }) {
  const resolvedWorkdir = await resolveWorkdir(workdir);
  await askAgent({
    question,
    workdir: resolvedWorkdir,
    history: [],
    interactive: true,
    logger: console
  });
}
async function runInteractiveShell({ workdir }) {
  const agentConfig = await loadAgentConfig();
  let currentWorkdir = await resolveWorkdir(workdir ||agentConfig.defaultWorkdir);
  let history = [];
  const maxHistory = agentConfig.limits?.maxSessionHistoryMessages || 8;
  console.log("askagent 多轮终端模式");
  console.log("输入 /help 查看命令，输入 /exit 退出。");
  console.log(`当前工作目录：${currentWorkdir}`);
  console.log("提示：后续所有 MCP 文件操作都只限定在当前工作目录内。");
  const rl = readline.createInterface({ input, output });
  try {
    while (true) {
      const line = (await rl.question(`\naskagent:${currentWorkdir}$`)).trim();
      if (!line) {
        continue;
      }
      if (line === "/exit" || line === "/quit") {
        break;
      }
      if (line === "/help") {
        printHelp();
        continue;
      }
      if (line === "/pwd") {
        console.log(currentWorkdir);
        continue;
      }
      if (line === "/clear") {
        history = [];
        console.log("已清空本会话上下文。");
        continue;
      }
      if (line.startsWith("/cd ")) {
        const target = line.slice(4).trim();
        if (!target) {
          console.log("用法：/cd <目录>");
          continue;
        }
        try {
          const nextWorkdir = path.isAbsolute(target)
            ? target
            : path.resolve(currentWorkdir, target);
          currentWorkdir = await resolveWorkdir(nextWorkdir);
          history = [];
          console.log(`已切换工作目录：${currentWorkdir}`);
          console.log("已清空本会话上下文。后续 MCP 权限仅限该目录。");
        } catch (error) {
          console.error(`切换失败：${error.message}`);
        }
        continue;
      }
      try {
        const result = await askAgent({
          question: line,
          workdir: currentWorkdir,
          history,
          interactive: true,
          logger: console
        });
        history.push({
          question: line,
          answer: result.answer
        });
        if (history.length > maxHistory) {
          history = history.slice(-maxHistory);
        }
      } catch (error) {
        console.error("执行失败：");
        console.error(error);
      }
    }
  } finally {
    rl.close();
  }
}

async function run() {
  const { question, workdir } = parseArgs(process.argv.slice(2));
  if (question) {
    await runSingleQuestion({
      question,
      workdir
    });
    return;
  }
  await runInteractiveShell({
    workdir
  });
}

run().catch((error) => {
  console.error("程序出错：");
  console.error(error);
  process.exit(1);
});