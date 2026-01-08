#!/usr/bin/env node

import { runCli } from "./cli/runner";

await runCli({ argv: process.argv });
