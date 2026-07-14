import Link from "next/link";
import { notFound } from "next/navigation";
import { Share2 } from "lucide-react";
import { AppShell, PageHeader } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { shellUser } from "@/lib/view-data";

type PageProps = { params: Promise<{ id: string }> };

export default async function DeckSharePage({ params }: PageProps) {
  const user = await requireUser();
  const { id } = await params;
  const deck = await prisma.deck.findFirst({
    where: { id, userId: user.id },
    include: { shareLinks: { orderBy: { createdAt: "desc" }, take: 5 } },
  });
  if (!deck) notFound();

  return (
    <AppShell user={shellUser(user)}>
      <PageHeader title="Share Deck" body={deck.title} />
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Share2 className="h-4 w-4 text-emerald-700" />
            Local share links
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {deck.shareLinks.map((share) => (
            <Link key={share.id} href={`/share/${share.token}`} className="block rounded-md border border-slate-200 p-3 text-sm hover:bg-slate-50">
              /share/{share.token}
            </Link>
          ))}
          {deck.shareLinks.length === 0 ? <p className="text-sm text-slate-600">Create a link from the deck page.</p> : null}
          <Button asChild>
            <Link href={`/decks/${deck.id}`}>Back to deck</Link>
          </Button>
        </CardContent>
      </Card>
    </AppShell>
  );
}
