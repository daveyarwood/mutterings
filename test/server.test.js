import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createApp } from "../server/index.js";
import { JobStore } from "../server/jobs.js";

const VIDEOS = [{ videoId: "aaaaaaaaaaa", durationMs: 600000 }];

// No excerpt fits inside these, so the pipeline settles them before it reaches
// for anything on the network.
const TOO_SHORT = [{ videoId: "tooshort1", durationMs: 500 }];

// A real server on a real port over the real app, with a work directory of its
// own. The pipeline is the real one too.
async function listen() {
  const store = new JobStore();
  const jobsDir = await mkdtemp(path.join(os.tmpdir(), "mutterings-jobs-"));
  const server = http.createServer(createApp({ store, deps: { jobsDir } }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    store,
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

// Polls the job the way the UI will, until it settles.
async function poll(app, jobId) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const job = await (await app.get(`/api/jobs/${jobId}`)).json();
    if (job.status === "done" || job.status === "failed") return job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("the job never finished");
}

async function startJob(app, videos) {
  const started = await app.post("/api/jobs", { videos });
  assert.equal(started.status, 202);
  return started.json();
}

test("the page is served at the root, wired to the routes it needs", async () => {
  const app = await listen();
  try {
    const response = await app.get("/");
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /^text\/html/);

    const html = await response.text();
    assert.match(html, /<textarea[^>]*id="videos"/);
    assert.match(html, /fetch\('\/api\/jobs'/);
    assert.match(html, /fetch\('\/api\/jobs\/' \+ id\)/);
    assert.match(html, /resultUrl/);
  } finally {
    await app.close();
  }
});

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

test("a job that cannot be planned reports the reason instead of hanging", async () => {
  const app = await listen();
  try {
    const job = await startJob(app, TOO_SHORT);
    assert.ok(job.id);
    assert.equal(job.status, "queued");
    assert.deepEqual(job.videos, TOO_SHORT);
    assert.equal(job.params.totalLengthMs, 60000);

    const failed = await poll(app, job.id);
    assert.equal(failed.status, "failed");
    assert.match(failed.error, /long enough/);
  } finally {
    await app.close();
  }
});

test("a job with no result has nothing to download", async () => {
  const app = await listen();
  try {
    const job = await startJob(app, TOO_SHORT);
    await poll(app, job.id);

    const download = await app.get(`/api/jobs/${job.id}/result.wav`);
    assert.equal(download.status, 404);
    assert.match((await download.json()).error, /no result/);
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
