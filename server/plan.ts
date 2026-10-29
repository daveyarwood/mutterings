// Choosing the excerpts. Pure: durations in, a list of excerpts out, with all
// randomness behind the `random` argument so a caller can make it reproducible.

// A video a job draws from: an id and a length.
export type Video = { videoId: string; durationMs: number };

// One excerpt to take, and where it falls in the output.
export type Excerpt = { index: number; videoId: string; startMs: number; lengthMs: number };

// The two numbers a job gets when the request names neither.
export const DEFAULT_TOTAL_LENGTH_MS = 60000;
export const DEFAULT_EXCERPT_LENGTH_MS = 2000;

// One video and the start seconds of its that no excerpt has taken yet.
type Source = { videoId: string; starts: number[] };

// Offsets land on whole seconds, so two excerpts never request the same
// yt-dlp section range for one video and their output files never collide.
const freeStarts = (durationMs: number, excerptLengthMs: number): number[] => {
  const lastStartSecond = Math.floor((durationMs - excerptLengthMs) / 1000);
  if (lastStartSecond < 0) return [];
  return Array.from({ length: lastStartSecond + 1 }, (_, second) => second);
};

export const planExcerpts = ({
  videos = [],
  totalLengthMs = DEFAULT_TOTAL_LENGTH_MS,
  excerptLengthMs = DEFAULT_EXCERPT_LENGTH_MS,
  random = Math.random,
}: {
  videos?: Video[];
  totalLengthMs?: number;
  excerptLengthMs?: number;
  random?: () => number;
} = {}): Excerpt[] => {
  if (excerptLengthMs <= 0) throw new Error("Excerpt length must be positive.");
  if (totalLengthMs <= 0) throw new Error("Total length must be positive.");

  const sources = videos
    .filter((video) => Number.isFinite(video.durationMs) && video.durationMs >= excerptLengthMs)
    .map((video) => ({
      videoId: video.videoId,
      starts: freeStarts(video.durationMs, excerptLengthMs),
    }))
    .filter((source) => source.starts.length > 0);

  const excerpts: Excerpt[] = [];
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
};

// Picks a source that still has a free start, or nothing if none has.
const pick = (sources: Source[], random: () => number): Source | null => {
  const available = sources.filter((source) => source.starts.length > 0);
  if (available.length === 0) return null;
  return available[Math.floor(random() * available.length)] ?? null;
};

// Removes and returns a random element, so one start is never planned twice.
const take = (starts: number[], random: () => number): number => {
  const [value] = starts.splice(Math.floor(random() * starts.length), 1);
  return value;
};

export const groupByVideo = (excerpts: Excerpt[]): Map<string, Excerpt[]> => {
  const groups = new Map<string, Excerpt[]>();
  for (const excerpt of excerpts) {
    if (!groups.has(excerpt.videoId)) groups.set(excerpt.videoId, []);
    groups.get(excerpt.videoId)?.push(excerpt);
  }
  return groups;
};
