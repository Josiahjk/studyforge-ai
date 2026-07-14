import { AppShell, PageHeader } from "@/components/layout/app-shell";
import { TutorClient } from "@/components/tutor/tutor-client";
import { requireUser } from "@/lib/auth";
import { shellUser } from "@/lib/view-data";

export default async function TutorPage() {
  const user = await requireUser();
  return (
    <AppShell user={shellUser(user)}>
      <PageHeader title="AI Tutor" body="Ask for explanations, examples, quizzes, and guided reasoning." />
      <TutorClient />
    </AppShell>
  );
}
