CREATE TABLE "DocumentImage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fileId" TEXT NOT NULL,
    "imageIndex" INTEGER NOT NULL,
    "pageNumber" INTEGER,
    "contentType" TEXT NOT NULL,
    "dataUrl" TEXT NOT NULL,
    "altText" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DocumentImage_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "UploadedFile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "DocumentImage_fileId_imageIndex_idx" ON "DocumentImage"("fileId", "imageIndex");
CREATE INDEX "DocumentImage_fileId_pageNumber_idx" ON "DocumentImage"("fileId", "pageNumber");
