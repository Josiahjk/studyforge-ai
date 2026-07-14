import { AppShell, PageHeader } from "@/components/layout/app-shell";
import { SettingsClient } from "@/components/settings/settings-client";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { shellUser } from "@/lib/view-data";

export default async function SettingsPage() {
  const user = await requireUser();
  const [setting, stats] = await Promise.all([
    prisma.userSetting.upsert({
      where: { userId: user.id },
      update: {},
      create: { userId: user.id },
    }),
    prisma.userStats.upsert({
      where: { userId: user.id },
      update: {},
      create: { userId: user.id },
    }),
  ]);

  return (
    <AppShell user={shellUser(user)}>
      <PageHeader title="Settings" body="Tune your account, theme, color, study language, and study target." />
      <SettingsClient
        setting={{ theme: setting.theme, accentColor: setting.accentColor, studyLanguage: setting.studyLanguage }}
        stats={{ dailyGoal: stats.dailyGoal }}
        account={{ name: user.name, email: user.email }}
      />
    </AppShell>
  );
}
