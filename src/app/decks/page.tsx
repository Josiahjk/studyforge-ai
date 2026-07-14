import { AppShell, PageHeader } from "@/components/layout/app-shell";
import { DecksClient, type DeckListItem } from "@/components/decks/decks-client";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { shellUser } from "@/lib/view-data";

export default async function DecksPage() {
  const user = await requireUser();
  const decks = await prisma.deck.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: "desc" },
    include: { cards: { select: { dueAt: true } }, _count: { select: { cards: true } } },
  });

  const list: DeckListItem[] = decks.map((deck) => ({
    id: deck.id,
    title: deck.title,
    description: deck.description,
    subject: deck.subject,
    tagsJson: deck.tagsJson,
    color: deck.color,
    isPublic: deck.isPublic,
    dueCount: deck.cards.filter((card) => card.dueAt <= new Date()).length,
    _count: deck._count,
  }));

  return (
    <AppShell user={shellUser(user)}>
      <PageHeader title="Decks" body="Create, search, share, export, and review your local flashcard decks." />
      <DecksClient decks={list} />
    </AppShell>
  );
}
