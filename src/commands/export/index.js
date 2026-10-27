import { Command } from 'commander';
import { registerCsv } from './csv.js';

export function exportCommand() {
  const cmd = new Command('export')
    .description('Export results in various formats');

  registerCsv(cmd);

  return cmd;
}
