export function normalizeUserDetails(raw) {
  if (!raw) return null;
  const userData = raw.user || {};
  const statsData = raw.stats || {};
  return {
    user_id: raw.user_id || userData.id || null,
    handle: userData.uniqueId || '',
    nickname: userData.nickname || '',
    bio: userData.signature || '',
    avatar_url: userData.avatarMedium || userData.avatarLarger || '',
    bio_link: userData.bioLink?.link || null,
    followers: statsData.followerCount || 0,
    following: statsData.followingCount || 0,
    verified: userData.verified || false,
  };
}
