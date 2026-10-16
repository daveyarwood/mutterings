// Choosing the excerpts. Pure: durations in, a list of excerpts out, with all
// randomness behind the `random` argument so a caller can make it reproducible.

// The two numbers a job gets when the request names neither.
export const DEFAULT_TOTAL_LENGTH_MS = 60000;
export const DEFAULT_EXCERPT_LENGTH_MS = 2000;

// Offsets land on whole seconds, so two excerpts never request the same
// yt-dlp section range for one video and their output files never collide.
function freeStarts(durationMs, excerptLengthMs) {
  const lastStartSecond = Math.floor((durationMs - excerptLengthMs) / 1000);
  if (lastStartSecond < 0) return [];
  return Array.from({ length: lastStartSecond + 1 }, (_, second) => second);
}

export function planExcerpts({
  videos,
  totalLengthMs = DEFAULT_TOTAL_LENGTH_MS,
  excerptLengthMs = DEFAULT_EXCERPT_LENGTH_MS,
  random = Math.random,
} = {}) {
  if (excerptLengthMs <= 0) throw new Error("Excerpt length must be positive.");
  if (totalLengthMs <= 0) throw new Error("Total length must be positive.");

  const sources = (videos ?? [])
    .filter((video) => Number.isFinite(video.durationMs) && video.durationMs >= excerptLengthMs)
    .map((video) => ({
      videoId: video.videoId,
      starts: freeStarts(video.durationMs, excerptLengthMs),
    }))
    .filter((source) => source.starts.length > 0);

  const excerpts = [];
  let elapsedMs = 0;

  while (elapsedMs < totalLengthMs) {
    const source = pick(sources, random);
    if (!source) break; // every source is used up, or there were none
    const startSecond = take(source.starts, random);
    excerpts.push({
      index: excerpts.length,
      videoId: source.videoId,
      startMs: startSecond * 1000,
      lengthMs: excerptLengthMs,
    });
    elapsedMs += excerptLengthMs;
  }

  return excerpts;
}

// Picks a source that still has a free start, or nothing if none has.
function pick(sources, random) {
  const available = sources.filter((source) => source.starts.length > 0);
  if (available.length === 0) return null;
  return available[Math.floor(random() * available.length)];
}

// Removes and returns a random element, so one start is never planned twice.
function take(starts, random) {
  const index = Math.floor(random() * starts.length);
  const [value] = starts.splice(index, 1);
  return value;
}

export function groupByVideo(excerpts) {
  const groups = new Map();
  for (const excerpt of excerpts) {
    if (!groups.has(excerpt.videoId)) groups.set(excerpt.videoId, []);
    groups.get(excerpt.videoId).push(excerpt);
  }
  return groups;
}
