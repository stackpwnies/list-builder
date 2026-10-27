export function qualify(user, analysis, cfg) {
  const meetsFollowers = user.followers >= cfg.min_followers && user.followers <= cfg.max_followers;
  const meetsCountry = !cfg.country || analysis.country === cfg.country;
  const meetsEmail = !cfg.email_required || analysis.email;
  
  return meetsFollowers && meetsCountry && meetsEmail;
}

export function isOnlyCountryDisqualified(user, analysis, cfg) {
  if (!cfg.country) return false;
  if (analysis.country === cfg.country) return false;
  
  const meetsFollowers = user.followers >= cfg.min_followers && user.followers <= cfg.max_followers;
  const meetsEmail = !cfg.email_required || analysis.email;
  
  return meetsFollowers && meetsEmail;
}
