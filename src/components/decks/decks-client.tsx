"use client";

import { FormEvent, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BookOpen, Plus, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/shared/empty-state";
import { parseJsonArray } from "@/lib/utils";

export type DeckListItem = {
  id: string;
  title: string;
  description: string;
  subject: string;
  tagsJson: string;
  color: string;
  isPublic: boolean;
  dueCount: number;
  _count: { cards: number };
};

export function DecksClient({ decks }: { decks: DeckListItem[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const filtered = useMemo(() => {
    return decks.filter((deck) => {
      const haystack = `${deck.title} ${deck.subject} ${deck.description} ${parseJsonArray(deck.tagsJson).join(" ")}`;
      return haystack.toLowerCase().includes(query.toLowerCase());
    });
  }, [decks, query]);

  async function createDeck(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/decks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: form.get("title"),
        subject: form.get("subject") || "General",
        description: form.get("description") || "",
        tags: String(form.get("tags") || "")
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
        color: form.get("color") || "#1f9d8a",
      }),
    });
    const data = await response.json();
    setLoading(false);
    if (!response.ok) {
      setError(data.error?.message || "Could not create deck.");
      return;
    }
    router.push(`/decks/${data.deck.id}`);
    router.refresh();
  }

  async function deleteDeck(id: string) {
    if (!confirm("Delete this deck and its cards?")) return;
    await fetch(`/api/decks/${id}`, { method: "DELETE" });
    router.refresh();
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Plus className="h-4 w-4 text-emerald-700" />
            Create deck
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={createDeck} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="title">Title</Label>
              <Input id="title" name="title" placeholder="Organic chemistry sprint" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="subject">Subject</Label>
              <Input id="subject" name="subject" placeholder="Chemistry" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Input id="description" name="description" placeholder="Exam-ready reactions and terms" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tags">Tags</Label>
              <Input id="tags" name="tags" placeholder="exam, chapter 4" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="color">Deck color</Label>
              <Input id="color" name="color" type="color" defaultValue="#1f9d8a" />
            </div>
            {error ? <p className="rounded-md bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
            <Button disabled={loading} className="w-full">
              {loading ? "Creating..." : "Create Deck"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <div className="space-y-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
          <Input className="pl-9" placeholder="Search decks, subjects, tags" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        {filtered.length === 0 ? (
          <EmptyState title="No decks found" body="Create a deck or import notes to start building your study loop." />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {filtered.map((deck) => (
              <Card key={deck.id} className="overflow-hidden">
                <div className="h-2" style={{ background: deck.color }} />
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <Link href={`/decks/${deck.id}`} className="group">
                      <CardTitle className="group-hover:text-emerald-800">{deck.title}</CardTitle>
                      <p className="mt-1 text-sm text-slate-500">{deck.subject}</p>
                    </Link>
                    <Button variant="ghost" size="icon" onClick={() => deleteDeck(deck.id)} title="Delete deck">
                      <Trash2 className="h-4 w-4 text-rose-600" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="min-h-10 text-sm text-slate-600">{deck.description || "No description yet."}</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {parseJsonArray(deck.tagsJson).slice(0, 3).map((tag) => (
                      <Badge key={tag}>{tag}</Badge>
                    ))}
                  </div>
                  <div className="mt-5 grid grid-cols-3 gap-2 text-center text-sm">
                    <div className="rounded-md bg-slate-50 p-2">
                      <p className="font-bold">{deck._count.cards}</p>
                      <p className="text-xs text-slate-500">Cards</p>
                    </div>
                    <div className="rounded-md bg-slate-50 p-2">
                      <p className="font-bold">{deck.dueCount}</p>
                      <p className="text-xs text-slate-500">Due</p>
                    </div>
                    <div className="rounded-md bg-slate-50 p-2">
                      <p className="font-bold">{deck.isPublic ? "On" : "Off"}</p>
                      <p className="text-xs text-slate-500">Share</p>
                    </div>
                  </div>
                  <Button asChild variant="secondary" className="mt-4 w-full">
                    <Link href={`/study/${deck.id}`}>
                      <BookOpen className="h-4 w-4" />
                      Review
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
