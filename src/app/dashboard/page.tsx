import Link from "next/link";
import { ArrowRight, BookOpen, Brain, CalendarCheck, Flame, Target, Trophy } from "lucide-react";
import { AppShell, PageHeader } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { shellUser } from "@/lib/view-data";

export default async function DashboardPage() {
  const user = await requireUser();
  const now = new Date();
  const [decks, dueCards, attempts, leaderboard] = await Promise.all([
    prisma.deck.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: "desc" },
      take: 4,
      include: { _count: { select: { cards: true } } },
    }),
    prisma.card.count({ where: { deck: { userId: user.id }, dueAt: { lte: now } } }),
    prisma.quizAttempt.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 8 }),
    prisma.userStats.findMany({
      orderBy: { xp: "desc" },
      take: 6,
      include: { user: { select: { name: true } } },
    }),
  ]);

  const accuracy =
    attempts.length > 0
      ? Math.round((attempts.reduce((sum, attempt) => sum + attempt.score / attempt.total, 0) / attempts.length) * 100)
      : user.stats?.accuracyAvg || 0;
  const dailyGoal = user.stats?.dailyGoal || 20;
  const dailyReviewed = user.stats?.dailyReviewed || 0;

  return (
    <AppShell user={shellUser(user)}>
      <PageHeader
        title={`Today, ${user.name.split(" ")[0]}`}
        body="Your study loop is ready across decks, AI drafts, tutor sessions, and reviews."
        action={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="secondary">
              <Link href="/import">Import Notes</Link>
            </Button>
            <Button asChild>
              <Link href="/decks">Create Deck</Link>
            </Button>
          </div>
        }
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Study streak", value: `${user.stats?.streak ?? 0} days`, icon: Flame, tone: "text-orange-600" },
          { label: "Due today", value: dueCards, icon: CalendarCheck, tone: "text-emerald-700" },
          { label: "Accuracy", value: `${accuracy}%`, icon: Target, tone: "text-sky-700" },
          { label: "Level", value: user.stats?.level ?? 1, icon: Trophy, tone: "text-yellow-600" },
        ].map((item) => {
          const Icon = item.icon;
          return (
            <Card key={item.label}>
              <CardContent className="flex items-center justify-between pt-5">
                <div>
                  <p className="text-sm text-slate-500">{item.label}</p>
                  <p className="mt-1 text-2xl font-bold">{item.value}</p>
                </div>
                <Icon className={`h-6 w-6 ${item.tone}`} />
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Recent decks</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {decks.map((deck) => (
              <Link key={deck.id} href={`/decks/${deck.id}`} className="flex items-center justify-between rounded-lg border border-slate-200 p-4 transition hover:bg-slate-50">
                <div className="flex items-center gap-3">
                  <span className="h-10 w-2 rounded-full" style={{ background: deck.color }} />
                  <div>
                    <p className="font-semibold">{deck.title}</p>
                    <p className="text-sm text-slate-500">
                      {deck.subject} / {deck._count.cards} cards
                    </p>
                  </div>
                </div>
                <ArrowRight className="h-4 w-4 text-slate-400" />
              </Link>
            ))}
            {decks.length === 0 ? <p className="text-sm text-slate-600">Create or import a deck to populate this view.</p> : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Daily goal</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mb-3 flex justify-between text-sm">
              <span>{dailyReviewed} reviews</span>
              <span>{dailyGoal} target</span>
            </div>
            <div className="h-3 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-emerald-700" style={{ width: `${Math.min(100, (dailyReviewed / dailyGoal) * 100)}%` }} />
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <Button asChild variant="secondary">
                <Link href="/tutor">
                  <Brain className="h-4 w-4" />
                  Tutor
                </Link>
              </Button>
              <Button asChild variant="secondary">
                <Link href="/decks">
                  <BookOpen className="h-4 w-4" />
                  Review
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Badges</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {user.badges.map((badge) => (
              <Badge key={badge.id} className="bg-yellow-50 text-yellow-800 ring-yellow-100">
                {badge.label}
              </Badge>
            ))}
            {user.badges.length === 0 ? <p className="text-sm text-slate-600">Badges appear as review milestones are reached.</p> : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Local leaderboard</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {leaderboard.map((entry, index) => (
              <div key={entry.id} className="flex items-center justify-between rounded-md bg-slate-50 px-3 py-2 text-sm">
                <span>
                  {index + 1}. {entry.user.name}
                </span>
                <span className="font-semibold">{entry.xp} XP</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
