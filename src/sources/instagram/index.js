import { SourceAdapter } from '../types.js';

export class InstagramSource extends SourceAdapter {
  get platformName() {
    return 'instagram';
  }

  buildProfileUrl(handle) {
    return `https://instagram.com/${handle}`;
  }
}
