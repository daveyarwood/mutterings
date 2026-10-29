// The job registry the UI polls. One process, so one Map is enough.

import { randomUUID } from "node:crypto";

import type { Video } from "./plan.ts";

export const QUEUED = "queued";
export const RUNNING = "running";
export const DONE = "done";
export const FAILED = "failed";

export type Status = typeof QUEUED | typeof RUNNING | typeof DONE | typeof FAILED;

// The lengths a job runs to. The API fills in the defaults.
export type JobParams = { totalLengthMs: number; excerptLengthMs: number };

export type Job = {
  id: string;
  status: Status;
  phase: string;
  progress: number;
  videos: Video[];
  params: JobParams;
  excerpts: number;
  error: string | null;
  resultPath: string | null;
  resultUrl: string | null;
  createdAt: number;
  updatedAt: number;
};

// What a client is told. The path on disk stays here.
export type JobView = Omit<Job, "resultPath">;

export class JobStore {
  #jobs = new Map<string, Job>();
  readonly now: () => number;

  constructor({ now = Date.now }: { now?: () => number } = {}) {
    this.now = now;
  }

  create({ videos, params }: { videos: Video[]; params: JobParams }): Job {
    const job: Job = {
      id: randomUUID(),
      status: QUEUED,
      phase: "queued",
      progress: 0,
      videos,
      params,
      excerpts: 0,
      error: null,
      resultPath: null,
      resultUrl: null,
      createdAt: this.now(),
      updatedAt: this.now(),
    };
    this.#jobs.set(job.id, job);
    return job;
  }

  get(id: string): Job | null {
    return this.#jobs.get(id) ?? null;
  }

  update(id: string, patch: Partial<Job>): Job | null {
    const job = this.#jobs.get(id);
    if (!job) return null;
    Object.assign(job, patch, { updatedAt: this.now() });
    return job;
  }

  fail(id: string, error: unknown): Job | null {
    return this.update(id, {
      status: FAILED,
      phase: "failed",
      error: error instanceof Error ? error.message : String(error),
    });
  }

  finish(
    id: string,
    {
      resultPath,
      resultUrl,
      excerpts,
    }: { resultPath: string; resultUrl: string; excerpts: number },
  ): Job | null {
    return this.update(id, {
      status: DONE,
      phase: "done",
      progress: 1,
      resultPath,
      resultUrl,
      excerpts,
    });
  }

  toView(job: Job): JobView {
    return {
      id: job.id,
      status: job.status,
      phase: job.phase,
      progress: job.progress,
      videos: job.videos,
      params: job.params,
      excerpts: job.excerpts,
      error: job.error,
      resultUrl: job.resultUrl,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    };
  }
}
