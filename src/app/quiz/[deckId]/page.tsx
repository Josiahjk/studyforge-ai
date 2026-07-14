import { notFound } from "next/navigation";
import { AppShell, PageHeader } from "@/components/layout/app-shell";
import { QuizClient } from "@/components/quiz/quiz-client";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { shellUser } from "@/lib/view-data";

type PageProps = { params: Promise<{ deckId: string }> };

export default async function QuizPage({ params }: PageProps) {
  const user = await requireUser();
  const { deckId } = await params;
  const deck = await prisma.deck.findFirst({
    where: { id: deckId, userId: user.id },
    include: { cards: { orderBy: { createdAt: "asc" } } },
  });
  if (!deck) notFound();

  return (
    <AppShell user={shellUser(user)}>
      <PageHeader title="Quiz" body={deck.title} />
      <QuizClient
        deckId={deck.id}
        deckTitle={deck.title}
        cards={deck.cards.map((card) => ({
          id: card.id,
          question: card.question,
          answer: card.answer,
          optionsJson: card.optionsJson,
          explanation: card.explanation,
        }))}
      />
    </AppShell>
  );
}
