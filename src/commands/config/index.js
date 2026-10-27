import { Command } from 'commander';
import { registerShow } from './show.js';
import { registerInit } from './init.js';

export function configCommand() {
  const cmd = new Command('config')
    .description('Manage configuration files');

  registerShow(cmd);
  registerInit(cmd);

  return cmd;
}
