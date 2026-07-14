"use client";

import { FormEvent, useState } from "react";
import { Brain, Lightbulb, MessageSquare, Send, Sigma, WandSparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type TutorMode = "default" | "eli5" | "example" | "quiz" | "step";
type ChatMessage = { role: "user" | "assistant"; content: string };

const modes: Array<{ value: TutorMode; label: string; icon: typeof Brain }> = [
  { value: "default", label: "Tutor", icon: Brain },
  { value: "eli5", label: "ELI5", icon: Lightbulb },
  { value: "example", label: "Example", icon: MessageSquare },
  { value: "quiz", label: "Quiz me", icon: WandSparkles },
  { value: "step", label: "Steps", icon: Sigma },
];

export function TutorClient() {
  const [subject, setSubject] = useState("General");
  const [mode, setMode] = useState<TutorMode>("default");
  const [threadId, setThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const message = String(form.get("message") || "").trim();
    if (!message) return;
    setMessages((state) => [...state, { role: "user", content: message }]);
    setLoading(true);
    setError("");
    const response = await fetch("/api/ai/tutor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ threadId, subject, mode, message }),
    });
    const data = await response.json();
    setLoading(false);
    if (!response.ok) {
      setError(data.error?.message || "Tutor is unavailable.");
      return;
    }
    setThreadId(data.threadId);
    setMessages((state) => [...state, { role: "assistant", content: data.message }]);
    formElement.reset();
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
      <Card>
        <CardHeader>
          <CardTitle>Tutor controls</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Subject</Label>
            <Input value={subject} onChange={(event) => setSubject(event.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            {modes.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => setMode(item.value)}
                  className={cn(
                    "flex h-20 flex-col items-center justify-center gap-2 rounded-md border border-slate-200 bg-white text-sm font-semibold transition hover:bg-slate-50",
                    mode === item.value && "border-emerald-300 bg-emerald-50 text-emerald-900",
                  )}
                >
                  <Icon className="h-5 w-5" />
                  {item.label}
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card className="min-h-[560px]">
        <CardHeader>
          <CardTitle>AI tutor</CardTitle>
        </CardHeader>
        <CardContent className="flex min-h-[470px] flex-col">
          <div className="flex-1 space-y-3 overflow-y-auto rounded-lg bg-slate-50 p-4">
            {messages.length === 0 ? (
              <p className="text-sm text-slate-600">Ask about a concept, confusing step, or study topic.</p>
            ) : null}
            {messages.map((message, index) => (
              <div
                key={`${message.role}-${index}`}
                className={cn(
                  "max-w-[85%] rounded-lg p-3 text-sm leading-6",
                  message.role === "user" ? "ml-auto bg-emerald-700 text-white" : "bg-white text-slate-800 ring-1 ring-slate-200",
                )}
              >
                {message.content}
              </div>
            ))}
            {loading ? <p className="text-sm text-slate-500">Tutor is thinking...</p> : null}
          </div>
          {error ? <p className="mt-3 rounded-md bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
          <form onSubmit={submit} className="mt-4 flex flex-col gap-3 sm:flex-row">
            <Textarea name="message" className="min-h-20 flex-1" placeholder="What do you want to understand?" />
            <Button className="h-20 sm:w-28" disabled={loading}>
              <Send className="h-4 w-4" />
              Send
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
