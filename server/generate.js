// One generation job, start to finish: resolve the channel, choose the
// excerpts, fetch and join them, hand back a WAV. Every step reports progress
// to the job so the UI has something to show while it waits.

import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { assemble, fetchExcerpts } from "./audio.js";
import { planExcerpts } from "./plan.js";
import { channelById, listVideoIds, resolveChannel, videoDurations } from "./youtube.js";

export const DEFAULT_JOBS_DIR = path.join(os.tmpdir(), "mutterings-jobs");
export const DEFAULT_MAX_SOURCE_VIDEOS = 50;

// Runs in the background, so a failure belongs on the job rather than in a
// rejected promise nobody is watching.
export function startGeneration({ job, store, deps = {} }) {
  return runGeneration({ job, store, deps }).catch((error) => {
    deps.log?.(`job ${job.id} failed: ${error.message}`);
    store.fail(job.id, error);
  });
}

export async function runGeneration({ job, store, deps = {} }) {
  const {
    env = process.env,
    fetchImpl = fetch,
    ytDlpBin = "yt-dlp",
    ffmpegBin = "ffmpeg",
    jobsDir = DEFAULT_JOBS_DIR,
    maxSourceVideos = DEFAULT_MAX_SOURCE_VIDEOS,
    random = Math.random,
    exec,
    log = () => {},
  } = deps;

  const api = { env, fetchImpl };
  const report = (patch) => store.update(job.id, patch);
  const workDir = path.join(jobsDir, job.id);
  await mkdir(workDir, { recursive: true });

  report({ status: "running", phase: "resolving the channel", progress: 0.02 });
  const channel = job.channel.id
    ? await channelById(job.channel.id, api)
    : await resolveChannel(job.channel.input, api);
  if (!channel.uploadsPlaylistId) {
    throw new Error(`${channel.title} has no uploads playlist.`);
  }
  log(`resolved ${channel.title} (${channel.id})`);
  report({ channel: { id: channel.id, title: channel.title, url: channel.url } });

  report({ phase: "listing uploads", progress: 0.08 });
  const videoIds = await listVideoIds(channel.uploadsPlaylistId, { ...api, max: maxSourceVideos });
  if (videoIds.length === 0) {
    throw new Error(`${channel.title} has no videos to draw from.`);
  }

  report({ phase: "reading video lengths", progress: 0.12 });
  const durations = await videoDurations(videoIds, api);

  const excerpts = planExcerpts({
    videos: durations,
    totalLengthMs: job.params.totalLengthMs,
    excerptLengthMs: job.params.excerptLengthMs,
    random,
  });
  if (excerpts.length === 0) {
    throw new Error("No video from that channel was long enough for an excerpt.");
  }
  log(`planned ${excerpts.length} excerpts from ${durations.length} videos`);
  report({ excerpts: excerpts.length, phase: "fetching excerpts", progress: 0.15 });

  const parts = await fetchExcerpts({
    excerpts,
    dir: workDir,
    ytDlpBin,
    exec,
    onProgress: (done, total) =>
      report({
        phase: `fetching excerpts (${done}/${total})`,
        progress: 0.15 + 0.7 * (done / total),
      }),
  });

  report({ phase: "stitching", progress: 0.88 });
  const outFile = path.join(workDir, `${job.id}.wav`);
  await assemble({
    parts,
    outFile,
    workDir,
    ffmpegBin,
    exec,
    onProgress: (done, total) => report({ progress: 0.88 + 0.1 * (done / total) }),
  });

  log(`wrote ${outFile}`);
  return store.finish(job.id, {
    resultPath: outFile,
    resultUrl: `/api/jobs/${job.id}/result.wav`,
    excerpts: excerpts.length,
  });
}
