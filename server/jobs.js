// The job registry the UI polls. One process, so one Map is enough.

import { randomUUID } from "node:crypto";

export const QUEUED = "queued";
export const RUNNING = "running";
export const DONE = "done";
export const FAILED = "failed";

export class JobStore {
  #jobs = new Map();

  constructor({ now = Date.now } = {}) {
    this.now = now;
  }

  create({ channel, params }) {
    const job = {
      id: randomUUID(),
      status: QUEUED,
      phase: "queued",
      progress: 0,
      channel,
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

  get(id) {
    return this.#jobs.get(id) ?? null;
  }

  update(id, patch) {
    const job = this.#jobs.get(id);
    if (!job) return null;
    Object.assign(job, patch, { updatedAt: this.now() });
    return job;
  }

  fail(id, error) {
    return this.update(id, {
      status: FAILED,
      phase: "failed",
      error: error instanceof Error ? error.message : String(error),
    });
  }

  finish(id, { resultPath, resultUrl, excerpts }) {
    return this.update(id, {
      status: DONE,
      phase: "done",
      progress: 1,
      resultPath,
      resultUrl,
      excerpts,
    });
  }

  // What a client is told. The path on disk stays here.
  toView(job) {
    return {
      id: job.id,
      status: job.status,
      phase: job.phase,
      progress: job.progress,
      channel: job.channel,
      params: job.params,
      excerpts: job.excerpts,
      error: job.error,
      resultUrl: job.resultUrl,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    };
  }
}
