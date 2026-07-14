import { AppShell, PageHeader } from "@/components/layout/app-shell";
import { ImportClient } from "@/components/import/import-client";
import { requireUser } from "@/lib/auth";
import { shellUser } from "@/lib/view-data";

export default async function ImportPage() {
  const user = await requireUser();
  return (
    <AppShell user={shellUser(user)}>
      <PageHeader title="Import Notes" body="Paste material, upload text/PDF files, generate draft flashcards, and save reviewed cards." />
      <ImportClient currentUserId={user.id} />
    </AppShell>
  );
}
