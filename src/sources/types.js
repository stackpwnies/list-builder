export class SourceAdapter {
  async searchHashtags(tags, count, pages) {
    throw new Error('searchHashtags not implemented');
  }

  async getUserDetails(handle) {
    throw new Error('getUserDetails not implemented');
  }

  async getUserPosts(handle, count) {
    throw new Error('getUserPosts not implemented');
  }

  async searchByMusic(musicId, count, cursor) {
    throw new Error('searchByMusic not implemented');
  }

  async resolveUserId(handle) {
    throw new Error('resolveUserId not implemented');
  }

  get platformName() {
    throw new Error('platformName not implemented');
  }

  buildProfileUrl(handle) {
    throw new Error('buildProfileUrl not implemented');
  }
}
