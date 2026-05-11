import { askAgent, resolveWorkdir } from "./agent-core.js";

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
    question: questionParts.join(" ")
  };
}
async function run() {
  const { question, workdir } = parseArgs(process.argv.slice(2));
  const resolvedWorkdir = await resolveWorkdir(workdir);
  await askAgent({
    question: question || "请先查看你被授权访问的目录，然后列出该目录下的文件。",
    workdir: resolvedWorkdir,
    interactive: true,
    logger: console
  });
}
run().catch((error) => {
  console.error("程序出错：");
  console.error(error);
  process.exit(1);
});
