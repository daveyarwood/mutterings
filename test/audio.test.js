import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { assemble, fetchExcerpts, ytDlpArgs } from "../server/audio.js";

async function tempDir() {
  return mkdtemp(path.join(os.tmpdir(), "mutterings-audio-"));
}

test("one call per video asks for each excerpt as a section", () => {
  const args = ytDlpArgs({
    videoId: "aaaaaaaaaaa",
    excerpts: [
      { startMs: 120000, lengthMs: 2000 },
      { startMs: 30000, lengthMs: 2000 },
    ],
    template: "/tmp/parts/part-%(id)s-%(section_start)s.%(ext)s",
  });
  assert.deepEqual(args.slice(0, 2), ["-f", "bestaudio"]);
  const sections = args.filter((arg) => arg.startsWith("*"));
  assert.deepEqual(sections, ["*120-122", "*30-32"]);
  assert.equal(args[args.indexOf("--output") + 1], "/tmp/parts/part-%(id)s-%(section_start)s.%(ext)s");
  assert.equal(args.at(-1), "https://www.youtube.com/watch?v=aaaaaaaaaaa");
  // The parts have to be cut exactly, and wav is what the joiner copies.
  assert.ok(args.includes("--force-keyframes-at-cuts"));
  assert.deepEqual(args.slice(args.indexOf("--audio-format"), args.indexOf("--audio-format") + 2), [
    "--audio-format",
    "wav",
  ]);
});

// Stands in for yt-dlp: writes exactly the files the real one would, from the
// sections in its own arguments.
function fakeYtDlp(calls) {
  return async (bin, args) => {
    calls.push({ bin, args });
    const template = args[args.indexOf("--output") + 1];
    const videoId = args.at(-1).split("=").pop();
    for (let index = 0; index < args.length; index += 1) {
      if (args[index] !== "--download-sections") continue;
      const start = args[index + 1].slice(1).split("-")[0];
      const name = template
        .replace("%(id)s", videoId)
        .replace("%(section_start)s", start)
        .replace("%(ext)s", "wav");
      await writeFile(name, "RIFF");
    }
    return { stdout: "", stderr: "" };
  };
}

test("the files yt-dlp wrote are matched back to their excerpts, in order", async () => {
  const dir = await tempDir();
  const excerpts = [
    { index: 0, videoId: "aaaaaaaaaaa", startMs: 1000, lengthMs: 2000 },
    { index: 1, videoId: "bbbbbbbbbbb", startMs: 12000, lengthMs: 2000 },
    { index: 2, videoId: "aaaaaaaaaaa", startMs: 10000, lengthMs: 2000 },
  ];
  const calls = [];
  const seen = [];
  const parts = await fetchExcerpts({
    excerpts,
    dir,
    exec: fakeYtDlp(calls),
    onProgress: (done, total) => seen.push(`${done}/${total}`),
  });

  assert.equal(calls.length, 2, "one yt-dlp call per video");
  assert.equal(parts.length, 3);
  assert.match(parts[0], /part-aaaaaaaaaaa-1\.wav$/);
  assert.match(parts[1], /part-bbbbbbbbbbb-12\.wav$/);
  assert.match(parts[2], /part-aaaaaaaaaaa-10\.wav$/);
  assert.deepEqual(seen, ["1/3", "2/3", "3/3"]);
});

test("a missing excerpt file fails the fetch instead of passing silently", async () => {
  const dir = await tempDir();
  await assert.rejects(
    fetchExcerpts({
      excerpts: [{ index: 0, videoId: "aaaaaaaaaaa", startMs: 1000, lengthMs: 2000 }],
      dir,
      exec: async () => ({ stdout: "", stderr: "" }),
    }),
    /produced no audio/,
  );
});

test("the excerpts are made uniform and then joined in order", async () => {
  const dir = await tempDir();
  const calls = [];
  const exec = async (bin, args) => {
    calls.push({ bin, args });
    await writeFile(args.at(-1), "RIFF");
    return { stdout: "", stderr: "" };
  };
  const outFile = path.join(dir, "out.wav");
  const parts = [path.join(dir, "one.wav"), path.join(dir, "two.wav")];

  await assemble({ parts, outFile, workDir: dir, exec });

  const normalizeCalls = calls.filter((call) => call.args.includes("-ar"));
  assert.equal(normalizeCalls.length, 2);
  for (const call of normalizeCalls) {
    assert.deepEqual(call.args.slice(call.args.indexOf("-ar"), call.args.indexOf("-ar") + 4), [
      "-ar",
      "48000",
      "-ac",
      "2",
    ]);
  }

  const list = await readFile(path.join(dir, "concat.txt"), "utf-8");
  const lines = list.trim().split("\n");
  assert.equal(lines.length, 2);
  assert.match(lines[0], /part-0000\.wav'$/);
  assert.match(lines[1], /part-0001\.wav'$/);

  const join = calls.at(-1);
  assert.deepEqual(join.args.slice(0, 6), ["-hide_banner", "-loglevel", "error", "-y", "-f", "concat"]);
  assert.equal(join.args.at(-1), outFile);
});
