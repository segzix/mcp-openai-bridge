#!/usr/bin/env node

import { runCli } from "./cli-utils.js";

async function main() {
  await runCli({
    commandName: "askagent",
    argv: process.argv.slice(2),
  });
}

main().catch((error) => {
  console.error("程序出错：");
  console.error(error);
  process.exit(1);
});
