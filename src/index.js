import { askAgent, resolveWorkdir } from "./agent-core.js";
import { parseCliArgs } from "./cli-utils.js";

async function run() {
  const { question, workdir } = parseCliArgs(process.argv.slice(2));
  const resolvedWorkdir = await resolveWorkdir(workdir);

  await askAgent({
    question: question || "请先查看你被授权访问的目录，然后列出该目录下的文件。",
    workdir: resolvedWorkdir,
    interactive: true,
    logger: console,
  });
}

run().catch((error) => {
  console.error("程序出错：");
  console.error(error);
  process.exit(1);
});
