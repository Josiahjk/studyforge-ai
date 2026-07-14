import { notFound } from "next/navigation";
import { AppShell, PageHeader } from "@/components/layout/app-shell";
import { StudyClient } from "@/components/study/study-client";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { shellUser } from "@/lib/view-data";

type PageProps = { params: Promise<{ deckId: string }> };

export default async function StudyPage({ params }: PageProps) {
  const user = await requireUser();
  const { deckId } = await params;
  const deck = await prisma.deck.findFirst({
    where: { id: deckId, userId: user.id },
    include: {
      cards: {
        where: { dueAt: { lte: new Date() } },
        orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
      },
    },
  });
  if (!deck) notFound();

  return (
    <AppShell user={shellUser(user)}>
      <PageHeader title="Review" body={deck.title} />
      <StudyClient
        deckId={deck.id}
        deckTitle={deck.title}
        cards={deck.cards.map((card) => ({
          id: card.id,
          type: card.type,
          question: card.question,
          answer: card.answer,
          explanation: card.explanation,
          difficulty: card.difficulty,
          optionsJson: card.optionsJson,
        }))}
      />
    </AppShell>
  );
}
