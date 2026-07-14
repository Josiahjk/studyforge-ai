-- Add optional timing metadata for video transcripts and sampled frames.
ALTER TABLE "DocumentChunk" ADD COLUMN "startSeconds" REAL;
ALTER TABLE "DocumentChunk" ADD COLUMN "endSeconds" REAL;
ALTER TABLE "DocumentImage" ADD COLUMN "timestampSeconds" REAL;
