import { NextResponse } from "next/server";
import { jsonError, requireApiUser } from "@/lib/api";
import { prisma } from "@/lib/db";
import { settingsSchema } from "@/lib/validators";

export async function GET() {
  const { user, response } = await requireApiUser();
  if (!user) return response;

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

  return NextResponse.json({ setting, stats });
}

export async function PATCH(request: Request) {
  const { user, response } = await requireApiUser();
  if (!user) return response;

  const parsed = settingsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message || "Invalid settings.", 422);

  const [setting, stats] = await Promise.all([
    prisma.userSetting.upsert({
      where: { userId: user.id },
      create: { userId: user.id, studyLanguage: parsed.data.studyLanguage },
      update: {
        theme: parsed.data.theme,
        accentColor: parsed.data.accentColor,
        studyLanguage: parsed.data.studyLanguage,
      },
    }),
    parsed.data.dailyGoal
      ? prisma.userStats.upsert({
          where: { userId: user.id },
          create: { userId: user.id, dailyGoal: parsed.data.dailyGoal },
          update: { dailyGoal: parsed.data.dailyGoal },
        })
      : prisma.userStats.upsert({
          where: { userId: user.id },
          update: {},
          create: { userId: user.id },
        }),
  ]);

  return NextResponse.json({ setting, stats });
}
