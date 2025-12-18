#!/usr/bin/env node

import { runCli } from "./cli/run-cli";

await runCli({ argv: process.argv });
