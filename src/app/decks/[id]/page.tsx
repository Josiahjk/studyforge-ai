import { notFound } from "next/navigation";
import { AppShell, PageHeader } from "@/components/layout/app-shell";
import { DeckDetailClient, type DeckDetail } from "@/components/decks/deck-detail-client";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { shellUser } from "@/lib/view-data";

type PageProps = { params: Promise<{ id: string }> };

export default async function DeckDetailPage({ params }: PageProps) {
  const user = await requireUser();
  const { id } = await params;
  const deck = await prisma.deck.findFirst({
    where: { id, userId: user.id },
    include: { cards: { orderBy: { createdAt: "desc" } } },
  });
  if (!deck) notFound();

  const serialized: DeckDetail = {
    id: deck.id,
    title: deck.title,
    description: deck.description,
    subject: deck.subject,
    tagsJson: deck.tagsJson,
    color: deck.color,
    isPublic: deck.isPublic,
    cards: deck.cards.map((card) => ({
      id: card.id,
      type: card.type,
      question: card.question,
      answer: card.answer,
      clozeText: card.clozeText,
      optionsJson: card.optionsJson,
      correctOption: card.correctOption,
      explanation: card.explanation,
      difficulty: card.difficulty,
      tagsJson: card.tagsJson,
      dueAt: card.dueAt.toISOString(),
    })),
  };

  return (
    <AppShell user={shellUser(user)}>
      <PageHeader title={deck.title} body={`${deck.subject} / ${deck.cards.length} cards`} />
      <DeckDetailClient deck={serialized} />
    </AppShell>
  );
}
