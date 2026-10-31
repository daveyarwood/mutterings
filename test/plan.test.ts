import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_EXCERPT_LENGTH_MS,
  DEFAULT_TOTAL_LENGTH_MS,
  groupByVideo,
  planExcerpts,
} from "../server/plan.ts";
import type { Excerpt, Video } from "../server/plan.ts";

// A stand-in for Math.random, so a plan can be stated exactly.
const seededRandom = (seed: number): (() => number) => {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
};

const videos: Video[] = [
  { videoId: "aaaaaaaaaaa", durationMs: 600000 },
  { videoId: "bbbbbbbbbbb", durationMs: 300000 },
];

// The indices of a group, in the order they were planned.
const indexes = (excerpts: Excerpt[]): number[] => excerpts.map((excerpt) => excerpt.index);

test("a job that names no lengths gets the defaults", () => {
  assert.equal(DEFAULT_TOTAL_LENGTH_MS, 60000);
  assert.equal(DEFAULT_EXCERPT_LENGTH_MS, 2000);
});

test("plans one excerpt per excerpt length until the total length is reached", () => {
  const excerpts = planExcerpts({ videos, random: seededRandom(1) });
  assert.equal(excerpts.length, DEFAULT_TOTAL_LENGTH_MS / DEFAULT_EXCERPT_LENGTH_MS);
  assert.deepEqual(indexes(excerpts), excerpts.map((_, index) => index));
});

test("the same random sequence plans the same excerpts", () => {
  const first = planExcerpts({ videos, random: seededRandom(7) });
  const second = planExcerpts({ videos, random: seededRandom(7) });
  assert.deepEqual(first, second);
});

test("every excerpt fits inside its video and starts on a whole second", () => {
  const excerpts = planExcerpts({ videos, totalLengthMs: 20000, random: seededRandom(42) });
  for (const excerpt of excerpts) {
    const video = videos.find((candidate) => candidate.videoId === excerpt.videoId);
    assert.ok(video);
    assert.equal(excerpt.startMs % 1000, 0);
    assert.ok(excerpt.startMs + excerpt.lengthMs <= video.durationMs);
  }
});

test("two excerpts never ask one video for the same section", () => {
  const single: Video[] = [{ videoId: "aaaaaaaaaaa", durationMs: 40000 }];
  const excerpts = planExcerpts({ videos: single, totalLengthMs: 20000, random: seededRandom(3) });
  const starts = excerpts.map((excerpt) => excerpt.startMs);
  assert.equal(new Set(starts).size, starts.length);
});

test("a video too short to hold an excerpt is not used", () => {
  const excerpts = planExcerpts({
    videos: [
      { videoId: "shortshort1", durationMs: 1500 },
      { videoId: "longlonglon", durationMs: 60000 },
    ],
    totalLengthMs: 6000,
    random: seededRandom(5),
  });
  assert.ok(excerpts.length > 0);
  assert.ok(excerpts.every((excerpt) => excerpt.videoId === "longlonglon"));
});

test("planning stops when the source material runs out", () => {
  const excerpts = planExcerpts({
    videos: [{ videoId: "aaaaaaaaaaa", durationMs: 2500 }],
    totalLengthMs: 60000,
    random: seededRandom(11),
  });
  assert.equal(excerpts.length, 1);
});

test("no usable source means no excerpts", () => {
  assert.deepEqual(planExcerpts({ videos: [] }), []);
  assert.deepEqual(planExcerpts({ videos: [{ videoId: "aaaaaaaaaaa", durationMs: 100 }] }), []);
});

test("lengths have to be positive", () => {
  assert.throws(() => planExcerpts({ videos, totalLengthMs: 0 }), /positive/);
  assert.throws(() => planExcerpts({ videos, excerptLengthMs: -1 }), /positive/);
});

test("excerpts are grouped by video, in the order they were planned", () => {
  const groups = groupByVideo([
    { index: 0, videoId: "aaaaaaaaaaa", startMs: 1000, lengthMs: 2000 },
    { index: 1, videoId: "bbbbbbbbbbb", startMs: 2000, lengthMs: 2000 },
    { index: 2, videoId: "aaaaaaaaaaa", startMs: 5000, lengthMs: 2000 },
  ]);
  assert.deepEqual([...groups.keys()], ["aaaaaaaaaaa", "bbbbbbbbbbb"]);
  assert.deepEqual(indexes(groups.get("aaaaaaaaaaa") ?? []), [0, 2]);
  assert.deepEqual(indexes(groups.get("bbbbbbbbbbb") ?? []), [1]);
  assert.deepEqual(groupByVideo([]).size, 0);
});
