import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createApp } from "../server/index.js";
import { JobStore } from "../server/jobs.js";

const VIDEOS = [{ videoId: "aaaaaaaaaaa", durationMs: 600000 }];

// A real server on a real port, with the pipeline stubbed so the test is about
// the HTTP surface.
async function listen({ start, deps = {} } = {}) {
  const store = new JobStore();
  const server = http.createServer(createApp({ store, start, deps }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    store,
    base,
    close: () => new Promise((resolve) => server.close(resolve)),
    get: (route) => fetch(`${base}${route}`),
    post: (route, payload) =>
      fetch(`${base}${route}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }),
  };
}

// Writes a WAV-shaped file and finishes the job, standing in for the pipeline.
function finishingPipeline(wavPath) {
  return async ({ job, store }) => {
    await writeFile(wavPath, "RIFF result");
    store.finish(job.id, {
      resultPath: wavPath,
      resultUrl: `/api/jobs/${job.id}/result.wav`,
      excerpts: 30,
    });
  };
}

// Polls the job the way the UI will, until it settles.
async function poll(app, jobId) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const job = await (await app.get(`/api/jobs/${jobId}`)).json();
    if (job.status === "done" || job.status === "failed") return job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("the job never finished");
}

test("health reports the default lengths", async () => {
  const app = await listen();
  try {
    const body = await (await app.get("/api/health")).json();
    assert.equal(body.ok, true);
    assert.deepEqual(body.defaults, { totalLengthMs: 60000, excerptLengthMs: 2000 });
  } finally {
    await app.close();
  }
});

test("a job can be started, polled, and then downloaded", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mutterings-jobs-"));
  const wavPath = path.join(dir, "result.wav");
  const app = await listen({ start: finishingPipeline(wavPath) });
  try {
    const started = await app.post("/api/jobs", { videos: VIDEOS });
    assert.equal(started.status, 202);
    const job = await started.json();
    assert.ok(job.id);
    assert.deepEqual(job.videos, VIDEOS);
    assert.equal(job.params.totalLengthMs, 60000);

    const finished = await poll(app, job.id);
    assert.equal(finished.status, "done");
    assert.equal(finished.resultUrl, `/api/jobs/${job.id}/result.wav`);
    assert.equal(finished.excerpts, 30);

    const download = await app.get(finished.resultUrl);
    assert.equal(download.status, 200);
    assert.equal(download.headers.get("content-type"), "audio/wav");
    assert.match(download.headers.get("content-disposition"), /attachment; filename=".*\.wav"/);
    assert.equal(await download.text(), "RIFF result");
  } finally {
    await app.close();
  }
});

test("a failing job reports the reason instead of hanging", async () => {
  const app = await listen({
    start: async ({ job, store }) => store.fail(job.id, new Error("yt-dlp failed: HTTP Error 403")),
  });
  try {
    const job = await (await app.post("/api/jobs", { videos: VIDEOS })).json();
    const failed = await poll(app, job.id);
    assert.equal(failed.status, "failed");
    assert.match(failed.error, /403/);
  } finally {
    await app.close();
  }
});

test("the request has to name at least one video, with a length each", async () => {
  const app = await listen();
  try {
    const payloads = [
      [{}, /videos/],
      [{ videos: [] }, /videos/],
      [{ videos: "aaaaaaaaaaa" }, /videos/],
      [{ videos: [{ durationMs: 1000 }] }, /videoId/],
      [{ videos: [{ videoId: "aaaaaaaaaaa" }] }, /durationMs/],
      [{ videos: [{ videoId: "aaaaaaaaaaa", durationMs: 0 }] }, /durationMs/],
      [{ videos: [{ videoId: "aaaaaaaaaaa", durationMs: "60000" }] }, /durationMs/],
    ];
    for (const [payload, expected] of payloads) {
      const response = await app.post("/api/jobs", payload);
      assert.equal(response.status, 400);
      assert.match((await response.json()).error, expected);
    }
  } finally {
    await app.close();
  }
});

test("the lengths have to be positive whole milliseconds", async () => {
  const app = await listen();
  try {
    const response = await app.post("/api/jobs", { videos: VIDEOS, excerptLengthMs: "2000" });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /excerptLengthMs/);

    const zero = await app.post("/api/jobs", { videos: VIDEOS, totalLengthMs: 0 });
    assert.equal(zero.status, 400);
  } finally {
    await app.close();
  }
});

test("unknown routes and unknown jobs are 404s", async () => {
  const app = await listen();
  try {
    assert.equal((await app.get("/api/nope")).status, 404);
    assert.equal((await app.get("/api/channels?q=anything")).status, 404);
    assert.equal((await app.get(`/api/jobs/does-not-exist`)).status, 404);
  } finally {
    await app.close();
  }
});
