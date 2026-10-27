import { TikTokSource } from '../../sources/tiktok/index.js';
import { sleep } from '../../utils/rate-limit.js';

export function registerUser(program) {
  return program
    .command('user <handle>')
    .description('Show details for a TikTok user')
    .action(async (handle) => {
      const source = new TikTokSource();
      const h = handle.replace(/^@/, '');
      const details = await source.getUserDetails(h);

      if (!details) {
        console.error(`User @${h} not found`);
        process.exit(1);
      }

      console.log(`@${details.handle || h} (${details.nickname})`);
      console.log(`  User ID:   ${details.user_id || '?'}`);
      console.log(`  Followers: ${details.followers?.toLocaleString() || '?'}`);
      console.log(`  Following: ${details.following?.toLocaleString() || '?'}`);
      console.log(`  Verified:  ${details.verified ? 'yes' : 'no'}`);
      console.log(`  Bio:       ${details.bio || '(none)'}`);
      console.log(`  Link:      ${details.bio_link || '(none)'}`);
      console.log(`  URL:       ${source.buildProfileUrl(details.handle || h)}`);
    });
}
