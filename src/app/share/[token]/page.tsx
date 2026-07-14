import Link from "next/link";
import { notFound } from "next/navigation";
import { Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { prisma } from "@/lib/db";
import { parseJsonArray } from "@/lib/utils";

type PageProps = { params: Promise<{ token: string }> };

export default async function PublicSharePage({ params }: PageProps) {
  const { token } = await params;
  const share = await prisma.shareLink.findUnique({
    where: { token },
    include: {
      deck: { include: { cards: { orderBy: { createdAt: "asc" } }, user: { select: { name: true } } } },
    },
  });
  if (!share || !share.deck.isPublic || (share.expiresAt && share.expiresAt < new Date())) notFound();

  return (
    <div className="min-h-screen bg-[#f7fbf8]">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-4 py-5">
        <Link href="/" className="flex items-center gap-2 font-bold">
          <Sparkles className="h-5 w-5 text-emerald-700" />
          StudyForge AI
        </Link>
        <Button asChild variant="secondary">
          <Link href="/register">Create workspace</Link>
        </Button>
      </header>
      <main className="mx-auto max-w-5xl px-4 pb-12">
        <div className="mb-6 rounded-lg border border-slate-200 bg-white p-6">
          <p className="text-sm text-slate-500">Shared by {share.deck.user.name}</p>
          <h1 className="mt-2 text-3xl font-bold">{share.deck.title}</h1>
          <p className="mt-2 text-slate-600">{share.deck.description}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Badge>{share.deck.subject}</Badge>
            {parseJsonArray(share.deck.tagsJson).map((tag) => (
              <Badge key={tag} className="bg-slate-50 text-slate-700 ring-slate-200">
                {tag}
              </Badge>
            ))}
          </div>
        </div>
        <div className="grid gap-4">
          {share.deck.cards.map((card, index) => (
            <Card key={card.id}>
              <CardHeader>
                <CardTitle className="text-base">
                  {index + 1}. {card.question}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm leading-7 text-slate-700">{card.answer}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </main>
    </div>
  );
}
