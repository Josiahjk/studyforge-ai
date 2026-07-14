import { prisma } from "@/lib/db";

function startOfLocalDay(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export async function recordStudyResult(userId: string, correct: boolean) {
  const stats = await prisma.userStats.upsert({
    where: { userId },
    update: {},
    create: { userId },
  });

  const today = startOfLocalDay();
  const last = stats.lastStudiedAt ? startOfLocalDay(stats.lastStudiedAt) : null;
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const streak = !last
    ? 1
    : last.getTime() === today.getTime()
      ? stats.streak
      : last.getTime() === yesterday.getTime()
        ? stats.streak + 1
        : 1;

  const dailyReviewed = last?.getTime() === today.getTime() ? stats.dailyReviewed + 1 : 1;
  const xp = stats.xp + (correct ? 12 : 4);
  const level = Math.max(1, Math.floor(xp / 150) + 1);
  const recentLogs = await prisma.reviewLog.findMany({
    where: { userId },
    orderBy: { reviewedAt: "desc" },
    take: 50,
    select: { correct: true },
  });
  const sample = [{ correct }, ...recentLogs];
  const accuracyAvg = Math.round((sample.filter((log) => log.correct).length / sample.length) * 100);

  await prisma.userStats.update({
    where: { userId },
    data: {
      streak,
      dailyReviewed,
      xp,
      level,
      accuracyAvg,
      lastStudiedAt: new Date(),
    },
  });

  if (dailyReviewed >= stats.dailyGoal) {
    await prisma.badge.upsert({
      where: { userId_code: { userId, code: "daily-goal" } },
      update: {},
      create: {
        userId,
        code: "daily-goal",
        label: "Daily Goal",
        description: "Met a daily review target.",
      },
    });
  }
}
