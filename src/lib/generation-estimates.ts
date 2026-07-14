function formatSeconds(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} min`;
}

export function estimateBatchedGeneration(totalCount: number, batchSize: number, lowSecondsPerBatch = 20, highSecondsPerBatch = 90) {
  const batches = Math.max(1, Math.ceil(totalCount / Math.max(1, batchSize)));
  return `Est. ${formatSeconds(batches * lowSecondsPerBatch)}-${formatSeconds(batches * highSecondsPerBatch)}`;
}

export function estimateSingleGeneration(lowSeconds = 30, highSeconds = 90) {
  return `Est. ${formatSeconds(lowSeconds)}-${formatSeconds(highSeconds)}`;
}
