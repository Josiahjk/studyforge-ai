import Image from "next/image";
import Link from "next/link";
import { ArrowRight, BookOpen, Brain, Layers3, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/auth";

export default async function Home() {
  const user = await getCurrentUser();
  return (
    <div className="min-h-screen bg-[#f7fbf8]">
      <header className="mx-auto flex max-w-7xl items-center justify-between px-4 py-5 sm:px-6 lg:px-8">
        <Link href="/" className="flex items-center gap-2 text-sm font-bold text-slate-950">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-700 text-white">
            <Sparkles className="h-4 w-4" />
          </span>
          StudyForge AI
        </Link>
        <div className="flex items-center gap-2">
          {user ? (
            <Button asChild>
              <Link href="/dashboard">Dashboard</Link>
            </Button>
          ) : (
            <>
              <Button asChild variant="ghost">
                <Link href="/login">Log in</Link>
              </Button>
              <Button asChild>
                <Link href="/register">Start</Link>
              </Button>
            </>
          )}
        </div>
      </header>

      <main>
        <section className="mx-auto grid min-h-[calc(100vh-88px)] max-w-7xl items-center gap-10 px-4 pb-10 pt-4 sm:px-6 lg:grid-cols-[0.95fr_1.05fr] lg:px-8">
          <div>
            <p className="mb-4 inline-flex rounded-full bg-emerald-50 px-3 py-1 text-sm font-semibold text-emerald-800 ring-1 ring-emerald-100">
              Flashcards, quizzes, tutor, and review rhythm
            </p>
            <h1 className="max-w-3xl text-4xl font-bold tracking-tight text-slate-950 sm:text-6xl">
              Forge study material from notes into daily recall practice.
            </h1>
            <p className="mt-5 max-w-2xl text-lg leading-8 text-slate-600">
              A local-first learning app with server-side free-model AI calls, real persistence, deck sharing, and a review system built for repeated practice.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg">
                <Link href={user ? "/dashboard" : "/register"}>
                  Open StudyForge
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="secondary">
                <Link href="/login">Try demo account</Link>
              </Button>
            </div>
          </div>
          <div className="relative">
            <Image
              src="/studyforge-hero.png"
              alt="Study workspace with flashcards and quiz panels"
              width={1200}
              height={900}
              priority
              className="aspect-[4/3] w-full rounded-lg object-cover shadow-2xl ring-1 ring-slate-200"
            />
          </div>
        </section>
        <section className="mx-auto grid max-w-7xl gap-4 px-4 pb-12 sm:px-6 md:grid-cols-3 lg:px-8">
          {[
            { icon: Layers3, title: "Decks", body: "Build private decks with tags, subjects, exports, and local share links." },
            { icon: Brain, title: "Tutor", body: "Ask for examples, ELI5 explanations, quizzes, and step-by-step guidance." },
            { icon: BookOpen, title: "Review", body: "Use SM-2 style scheduling with Again, Hard, Good, and Easy ratings." },
          ].map((item) => {
            const Icon = item.icon;
            return (
              <Card key={item.title}>
                <CardContent className="pt-5">
                  <Icon className="h-5 w-5 text-emerald-700" />
                  <h2 className="mt-4 font-semibold text-slate-950">{item.title}</h2>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{item.body}</p>
                </CardContent>
              </Card>
            );
          })}
        </section>
      </main>
    </div>
  );
}
