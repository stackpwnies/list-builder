import { Command } from 'commander';
import { registerSearch } from './search.js';
import { registerUpdate } from './update.js';
import { registerUser } from './user.js';
import { registerBackfill } from './backfill.js';

export function tiktokCommand() {
  const cmd = new Command('tiktok')
    .description('TikTok source commands');

  registerSearch(cmd);
  registerUpdate(cmd);
  registerUser(cmd);
  registerBackfill(cmd);

  return cmd;
}
