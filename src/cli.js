#!/usr/bin/env bun
import { Command } from 'commander';
import { tiktokCommand } from './commands/tiktok/index.js';
import { exportCommand } from './commands/export/index.js';
import { configCommand } from './commands/config/index.js';
import { registerTally } from './commands/tally.js';
import { registerBenchmark } from './commands/benchmark.js';

const program = new Command();

program
  .name('list-builder')
  .description('Influencer list builder — search, qualify, and export creator lists')
  .version('1.0.0');

program.addCommand(tiktokCommand());
program.addCommand(exportCommand());
program.addCommand(configCommand());
registerTally(program);
registerBenchmark(program);

program.parse(process.argv);
