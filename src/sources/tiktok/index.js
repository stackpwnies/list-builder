import { SourceAdapter } from '../types.js';
import * as api from './api.js';
import { normalizeUserDetails } from './transforms.js';

export class TikTokSource extends SourceAdapter {
  get platformName() {
    return 'tiktok';
  }

  buildProfileUrl(handle) {
    return `https://tiktok.com/@${handle}`;
  }

  async searchHashtags(tags, count, pages) {
    const all = [];
    for (const tag of tags) {
      const users = await api.searchHashtag(tag, count, pages);
      all.push(...users);
    }
    return all;
  }

  async getUserDetails(handle) {
    const raw = await api.getUserDetails(handle);
    return normalizeUserDetails(raw);
  }

  async getUserPosts(handle, count = 10) {
    return api.getUserPosts(handle, count);
  }

  async searchByMusic(musicId, count = 20, cursor = 0) {
    return api.searchByMusic(musicId, count, cursor);
  }

  async resolveUserId(handle) {
    return api.searchUserId(handle);
  }
}
