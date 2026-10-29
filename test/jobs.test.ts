import assert from "node:assert/strict";
import test from "node:test";

import { DONE, JobStore } from "../server/jobs.ts";
import type { Job, JobParams } from "../server/jobs.ts";
import type { Video } from "../server/plan.ts";

const VIDEOS: Video[] = [{ videoId: "aaaaaaaaaaa", durationMs: 600000 }];
const PARAMS: JobParams = { totalLengthMs: 60000, excerptLengthMs: 2000 };

// The job the store holds under an id, so a test can read it back.
const held = (store: JobStore, id: string): Job => {
  const job = store.get(id);
  if (!job) throw new Error(`no job ${id}`);
  return job;
};

test("a new job is queued and pollable by id", () => {
  const store = new JobStore();
  const job = store.create({ videos: VIDEOS, params: PARAMS });
  assert.ok(job.id);
  assert.equal(job.status, "queued");
  assert.equal(job.progress, 0);
  assert.equal(store.get(job.id), job);
  assert.equal(store.get("nope"), null);
});

test("progress updates land on the job, and unknown ids are ignored", () => {
  const store = new JobStore();
  const job = store.create({ videos: VIDEOS, params: PARAMS });
  store.update(job.id, { status: "running", phase: "fetching excerpts (1/30)", progress: 0.5 });
  const updated = held(store, job.id);
  assert.equal(updated.phase, "fetching excerpts (1/30)");
  assert.equal(updated.progress, 0.5);
  assert.equal(store.update("nope", { progress: 1 }), null);
});

test("a failed job carries the reason", () => {
  const store = new JobStore();
  const job = store.create({ videos: [], params: PARAMS });
  store.fail(job.id, new Error("yt-dlp failed: HTTP Error 403"));
  assert.equal(job.status, "failed");
  assert.equal(job.error, "yt-dlp failed: HTTP Error 403");
});

test("a finished job reports the download url and not the path", () => {
  const store = new JobStore();
  const job = store.create({ videos: [], params: PARAMS });
  store.finish(job.id, {
    resultPath: "/tmp/mutterings-jobs/abc/abc.wav",
    resultUrl: "/api/jobs/abc/result.wav",
    excerpts: 30,
  });
  const finished = held(store, job.id);
  const view = store.toView(finished);
  assert.equal(view.status, DONE);
  assert.equal(view.progress, 1);
  assert.equal(view.excerpts, 30);
  assert.equal(view.resultUrl, "/api/jobs/abc/result.wav");
  assert.ok(!JSON.stringify(view).includes("/tmp/"));
});
