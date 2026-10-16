import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { startGeneration } from "../server/generate.js";
import { JobStore } from "../server/jobs.js";

// The videos a job carries: two, both long enough to cut from.
const VIDEOS = [
  { videoId: "aaaaaaaaaaa", durationMs: 600000 },
  { videoId: "bbbbbbbbbbb", durationMs: 300000 },
];

// Stands in for yt-dlp and ffmpeg: writes the file each call was asked for.
function fakeBinaries(calls) {
  return async (bin, args) => {
    calls.push({ bin, args });
    if (bin === "yt-dlp") {
      const template = args[args.indexOf("--output") + 1];
      const videoId = args.at(-1).split("=").pop();
      for (let index = 0; index < args.length; index += 1) {
        if (args[index] !== "--download-sections") continue;
        const start = args[index + 1].slice(1).split("-")[0];
        await writeFile(
          template
            .replace("%(id)s", videoId)
            .replace("%(section_start)s", start)
            .replace("%(ext)s", "wav"),
          `RIFF ${videoId} ${start}`,
        );
      }
    } else {
      await writeFile(args.at(-1), "RIFF");
    }
    return { stdout: "", stderr: "" };
  };
}

function seededRandom(seed) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

async function generate({ videos = VIDEOS, totalLengthMs = 6000, seed = 9 } = {}) {
  const store = new JobStore();
  const job = store.create({ videos, params: { totalLengthMs, excerptLengthMs: 2000 } });
  const calls = [];
  const jobsDir = await mkdtemp(path.join(os.tmpdir(), "mutterings-jobs-"));

  await startGeneration({
    job,
    store,
    deps: { jobsDir, random: seededRandom(seed), exec: fakeBinaries(calls) },
  });

  return { store, job, calls };
}

test("a generation request runs to a wav, reporting progress as it goes", async () => {
  const { store, job, calls } = await generate();

  assert.equal(job.status, "done");
  assert.equal(job.phase, "done");
  assert.equal(job.progress, 1);
  assert.equal(job.error, null);
  assert.equal(job.excerpts, 3);
  assert.equal(job.resultUrl, `/api/jobs/${job.id}/result.wav`);

  const wav = await readFile(job.resultPath);
  assert.equal(wav.toString(), "RIFF");

  // The join is the last thing that runs, and it runs after every excerpt.
  assert.equal(calls.at(-1).bin, "ffmpeg");
  assert.ok(calls.at(-1).args.includes("concat"));
  assert.equal(store.toView(job).resultUrl, `/api/jobs/${job.id}/result.wav`);
});

test("only the requested sections are fetched, one yt-dlp call per video", async () => {
  const { job, calls } = await generate({ totalLengthMs: 8000 });

  const downloads = calls.filter((call) => call.bin === "yt-dlp");
  const videos = new Set(downloads.map((call) => call.args.at(-1)));
  assert.equal(downloads.length, videos.size, "one call per video, not one per excerpt");

  const sections = downloads.flatMap((call) =>
    call.args.filter((arg) => arg.startsWith("*")).map((arg) => call.args.at(-1) + arg),
  );
  assert.equal(sections.length, job.excerpts);
  assert.equal(new Set(sections).size, sections.length);
});

test("videos too short to cut from fail with a reason the UI can show", async () => {
  const { job, calls } = await generate({ videos: [{ videoId: "tooshort", durationMs: 500 }] });
  assert.equal(job.status, "failed");
  assert.match(job.error, /long enough/);
  assert.deepEqual(calls, []);
});
