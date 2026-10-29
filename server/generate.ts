// One generation job, start to finish: choose the excerpts from the videos the
// job carries, fetch and join them, hand back a WAV. Every step reports
// progress to the job so the UI has something to show while it waits.

import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { assemble, fetchExcerpts } from "./audio.ts";
import type { Exec } from "./audio.ts";
import { planExcerpts } from "./plan.ts";
import type { Job, JobStore } from "./jobs.ts";

export const DEFAULT_JOBS_DIR = path.join(os.tmpdir(), "mutterings-jobs");

// What a job needs to run: where the work lands, and the two seams a test can
// stand in for. Every field has a default.
export type GenerationDeps = {
  jobsDir?: string;
  random?: () => number;
  exec?: Exec;
  log?: (message: string) => void;
};

type Generation = { job: Job; store: JobStore; deps?: GenerationDeps };

// Runs in the background, so a failure belongs on the job rather than in a
// rejected promise nobody is watching.
export const startGeneration = ({ job, store, deps = {} }: Generation): Promise<void> =>
  runGeneration({ job, store, deps }).catch((error) => {
    const reason = error instanceof Error ? error.message : String(error);
    deps.log?.(`job ${job.id} failed: ${reason}`);
    store.fail(job.id, error);
  });

export const runGeneration = async ({
  job,
  store,
  deps = {},
}: Generation): Promise<Job | null> => {
  const {
    jobsDir = DEFAULT_JOBS_DIR,
    random = Math.random,
    exec,
    log = () => {},
  } = deps;

  const report = (patch: Partial<Job>) => store.update(job.id, patch);
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
    exec,
    onProgress: (done, total) => report({ progress: 0.88 + 0.1 * (done / total) }),
  });

  log(`wrote ${outFile}`);
  return store.finish(job.id, {
    resultPath: outFile,
    resultUrl: `/api/jobs/${job.id}/result.wav`,
    excerpts: excerpts.length,
  });
};
