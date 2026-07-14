import Link from "next/link";
import { notFound } from "next/navigation";
import { FileText, Image as ImageIcon, WandSparkles } from "lucide-react";
import { AppShell, PageHeader } from "@/components/layout/app-shell";
import { GenerateSourceNotesButton } from "@/components/notes/generate-source-notes-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { shellUser } from "@/lib/view-data";

type PageProps = { params: Promise<{ id: string }> };

export default async function SourceNotePage({ params }: PageProps) {
  const user = await requireUser();
  const { id } = await params;
  const file = await prisma.uploadedFile.findFirst({
    where: { id, userId: user.id },
    include: {
      chunks: { orderBy: { chunkIndex: "asc" } },
      images: { orderBy: { imageIndex: "asc" } },
      generations: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  if (!file) notFound();

  const generation = file.generations[0];

  return (
    <AppShell user={shellUser(user)}>
      <PageHeader
        title={file.originalName}
        body={`${file.chunks.length} extracted chunks / ${file.images.length} source images`}
        action={
          <div className="flex flex-wrap gap-2">
            {generation ? (
              <Button asChild>
                <Link href={`/notes/${generation.id}`}>
                  <WandSparkles className="h-4 w-4" />
                  Open AI Notes
                </Link>
              </Button>
            ) : (
              <GenerateSourceNotesButton fileId={file.id} />
            )}
          </div>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          {file.warning ? <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">{file.warning}</p> : null}
          {file.chunks.map((chunk) => (
            <Card key={chunk.id}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <FileText className="h-4 w-4 text-emerald-700" />
                  Chunk {chunk.chunkIndex + 1}
                  {chunk.pageNumber ? <Badge>Page {chunk.pageNumber}</Badge> : null}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap text-sm leading-7 text-slate-700">{chunk.cleanedText}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Source details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-slate-600">
              <p>Type: {file.extension}</p>
              <p>Size: {(file.size / 1024 / 1024).toFixed(2)} MB</p>
              <p>Imported: {file.createdAt.toLocaleString()}</p>
            </CardContent>
          </Card>

          {file.images.length ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ImageIcon className="h-4 w-4 text-sky-700" />
                  Images
                </CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-3">
                {file.images.map((image) => (
                  <figure key={image.id} className="overflow-hidden rounded-md bg-slate-50 ring-1 ring-slate-200">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={image.dataUrl} alt={image.altText || file.originalName} className="h-28 w-full object-cover" />
                    <figcaption className="px-2 py-1 text-xs text-slate-500">{image.pageNumber ? `Page ${image.pageNumber}` : `Image ${image.imageIndex + 1}`}</figcaption>
                  </figure>
                ))}
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </AppShell>
  );
}
