export function shellUser(user: {
  name: string;
  email: string;
  stats?: { level: number; xp: number; streak: number } | null;
  setting?: { theme: string; accentColor: string } | null;
}) {
  return {
    name: user.name,
    email: user.email,
    setting: user.setting
      ? {
          theme: user.setting.theme,
          accentColor: user.setting.accentColor,
        }
      : null,
    stats: user.stats
      ? {
          level: user.stats.level,
          xp: user.stats.xp,
          streak: user.stats.streak,
        }
      : null,
  };
}
