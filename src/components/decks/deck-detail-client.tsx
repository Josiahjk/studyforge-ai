"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Download, Plus, Save, Share2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { parseJsonArray } from "@/lib/utils";

export type DeckDetail = {
  id: string;
  title: string;
  description: string;
  subject: string;
  tagsJson: string;
  color: string;
  isPublic: boolean;
  cards: Array<{
    id: string;
    type: string;
    question: string;
    answer: string;
    clozeText: string | null;
    optionsJson: string | null;
    correctOption: number | null;
    explanation: string | null;
    difficulty: string;
    tagsJson: string;
    dueAt: string;
  }>;
};

export function DeckDetailClient({ deck }: { deck: DeckDetail }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [shareUrl, setShareUrl] = useState("");

  async function saveDeck(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const response = await fetch(`/api/decks/${deck.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: form.get("title"),
        description: form.get("description"),
        subject: form.get("subject"),
        color: form.get("color"),
        isPublic: form.get("isPublic") === "on",
        tags: String(form.get("tags") || "")
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
      }),
    });
    const data = await response.json();
    if (!response.ok) setError(data.error?.message || "Could not save deck.");
    router.refresh();
  }

  async function addCard(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setError("");
    const form = new FormData(formElement);
    const options = String(form.get("options") || "")
      .split("\n")
      .map((option) => option.trim())
      .filter(Boolean);
    const response = await fetch(`/api/decks/${deck.id}/cards`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: form.get("type"),
        question: form.get("question"),
        answer: form.get("answer"),
        clozeText: form.get("clozeText") || undefined,
        options: options.length ? options : undefined,
        correctOption: form.get("correctOption") ? Number(form.get("correctOption")) : undefined,
        explanation: form.get("explanation") || undefined,
        difficulty: form.get("difficulty"),
        tags: String(form.get("tags") || "")
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      setError(data.error?.message || "Could not add card.");
      return;
    }
    formElement.reset();
    router.refresh();
  }

  async function deleteCard(id: string) {
    await fetch(`/api/cards/${id}`, { method: "DELETE" });
    router.refresh();
  }

  async function shareDeck() {
    const response = await fetch(`/api/decks/${deck.id}/share`, { method: "POST" });
    const data = await response.json();
    if (!response.ok) {
      setError(data.error?.message || "Could not create share link.");
      return;
    }
    setShareUrl(`${window.location.origin}${data.url}`);
    router.refresh();
  }

  async function exportDeck() {
    const response = await fetch(`/api/decks/${deck.id}/export`);
    const data = await response.json();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${deck.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[380px_1fr]">
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Deck settings</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={saveDeck} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="title">Title</Label>
                <Input id="title" name="title" defaultValue={deck.title} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="subject">Subject</Label>
                <Input id="subject" name="subject" defaultValue={deck.subject} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea id="description" name="description" defaultValue={deck.description} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="tags">Tags</Label>
                <Input id="tags" name="tags" defaultValue={parseJsonArray(deck.tagsJson).join(", ")} />
              </div>
              <div className="grid grid-cols-[1fr_120px] gap-3">
                <div className="space-y-2">
                  <Label htmlFor="color">Color</Label>
                  <Input id="color" name="color" type="color" defaultValue={deck.color} />
                </div>
                <label className="flex items-end gap-2 pb-2 text-sm font-medium text-slate-700">
                  <input name="isPublic" type="checkbox" defaultChecked={deck.isPublic} className="h-4 w-4" />
                  Public
                </label>
              </div>
              {error ? <p className="rounded-md bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
              <Button className="w-full">
                <Save className="h-4 w-4" />
                Save deck
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Sharing and export</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button variant="secondary" className="w-full" onClick={exportDeck}>
              <Download className="h-4 w-4" />
              Export JSON
            </Button>
            <Button variant="secondary" className="w-full" onClick={shareDeck}>
              <Share2 className="h-4 w-4" />
              Share Deck
            </Button>
            {shareUrl ? (
              <Input readOnly value={shareUrl} onFocus={(event) => event.currentTarget.select()} />
            ) : null}
          </CardContent>
        </Card>
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Plus className="h-4 w-4 text-emerald-700" />
              Add flashcard
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={addCard} className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Type</Label>
                <Select name="type" defaultValue="qa">
                  <option value="qa">Question / Answer</option>
                  <option value="mcq">Multiple choice</option>
                  <option value="cloze">Cloze deletion</option>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Difficulty</Label>
                <Select name="difficulty" defaultValue="medium">
                  <option value="easy">Easy</option>
                  <option value="medium">Medium</option>
                  <option value="hard">Hard</option>
                </Select>
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>Question</Label>
                <Textarea name="question" required />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>Answer</Label>
                <Textarea name="answer" required />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>Cloze text</Label>
                <Input name="clozeText" placeholder="The powerhouse is {{c1::mitochondrion}}" />
              </div>
              <div className="space-y-2">
                <Label>MCQ options</Label>
                <Textarea name="options" placeholder={"One option per line"} />
              </div>
              <div className="space-y-2">
                <Label>Correct option index</Label>
                <Input name="correctOption" type="number" min="0" max="5" placeholder="0" />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>Explanation</Label>
                <Input name="explanation" />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>Tags</Label>
                <Input name="tags" placeholder="definition, exam" />
              </div>
              <Button className="md:col-span-2">Add card</Button>
            </form>
          </CardContent>
        </Card>

        <div className="grid gap-4">
          {deck.cards.map((card, index) => (
            <Card key={card.id}>
              <CardContent className="pt-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="mb-2 flex flex-wrap gap-2">
                      <Badge>{card.type}</Badge>
                      <Badge className="bg-amber-50 text-amber-800 ring-amber-100">{card.difficulty}</Badge>
                      {parseJsonArray(card.tagsJson).map((tag) => (
                        <Badge key={tag} className="bg-slate-50 text-slate-700 ring-slate-200">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                    <h3 className="font-semibold text-slate-950">
                      {index + 1}. {card.question}
                    </h3>
                    <p className="mt-2 text-sm text-slate-600">{card.answer}</p>
                    {card.explanation ? <p className="mt-2 text-sm text-slate-500">{card.explanation}</p> : null}
                  </div>
                  <Button variant="ghost" size="icon" title="Delete card" onClick={() => deleteCard(card.id)}>
                    <Trash2 className="h-4 w-4 text-rose-600" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
          {deck.cards.length === 0 ? (
            <Card>
              <CardContent className="pt-5 text-sm text-slate-600">
                No cards yet. Add one here or use the import page to generate a draft set.
              </CardContent>
            </Card>
          ) : null}
        </div>

        <div className="flex flex-col gap-3 sm:flex-row">
          <Button asChild variant="ink">
            <Link href={`/study/${deck.id}`}>Start Review</Link>
          </Button>
          <Button asChild variant="secondary">
            <Link href={`/quiz/${deck.id}`}>Multiple-Choice Quiz</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
