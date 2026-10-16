// One generation job, start to finish: choose the excerpts from the videos the
// job carries, fetch and join them, hand back a WAV. Every step reports
// progress to the job so the UI has something to show while it waits.

import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { assemble, fetchExcerpts } from "./audio.js";
import { planExcerpts } from "./plan.js";

export const DEFAULT_JOBS_DIR = path.join(os.tmpdir(), "mutterings-jobs");

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
    ytDlpBin = "yt-dlp",
    ffmpegBin = "ffmpeg",
    jobsDir = DEFAULT_JOBS_DIR,
    random = Math.random,
    exec,
    log = () => {},
  } = deps;

  const report = (patch) => store.update(job.id, patch);
  const workDir = path.join(jobsDir, job.id);
  await mkdir(workDir, { recursive: true });

  report({ status: "running", phase: "planning the excerpts", progress: 0.02 });
  const excerpts = planExcerpts({
    videos: job.videos,
    totalLengthMs: job.params.totalLengthMs,
    excerptLengthMs: job.params.excerptLengthMs,
    random,
  });
  if (excerpts.length === 0) {
    throw new Error("None of those videos was long enough for an excerpt.");
  }
  log(`planned ${excerpts.length} excerpts from ${job.videos.length} videos`);
  report({ excerpts: excerpts.length, phase: "fetching excerpts", progress: 0.1 });

  const parts = await fetchExcerpts({
    excerpts,
    dir: workDir,
    ytDlpBin,
    exec,
    onProgress: (done, total) =>
      report({
        phase: `fetching excerpts (${done}/${total})`,
        progress: 0.1 + 0.75 * (done / total),
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
