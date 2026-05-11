#!/usr/bin/env node

import { runCli } from "./cli-utils.js";

runCli({
  commandName: "askchat",
  argv: process.argv.slice(2),
}).catch((error) => {
  console.error("程序出错：");
  console.error(error);
  process.exit(1);
});
