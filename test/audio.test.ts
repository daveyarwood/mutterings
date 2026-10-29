import assert from "node:assert/strict";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { BINARIES, missingBinaries } from "../server/audio.ts";

// A throwaway PATH directory holding the named files, each executable unless it
// is named in `plain`.
const dirWith = async (names: string[], plain: string[] = []): Promise<string> => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mutterings-path-"));
  for (const name of names) {
    const file = path.join(dir, name);
    await writeFile(file, "");
    await chmod(file, plain.includes(name) ? 0o644 : 0o755);
  }
  return dir;
};

test("a PATH carrying both binaries is missing nothing", async () => {
  const dir = await dirWith(BINARIES);
  assert.deepEqual(missingBinaries(dir), []);
});

test("the binaries are named in order, and those absent come back", () => {
  assert.deepEqual(BINARIES, ["yt-dlp", "ffmpeg"]);
  assert.deepEqual(missingBinaries("/nowhere/here"), ["yt-dlp", "ffmpeg"]);
});

test("a binary present in one PATH directory counts, wherever it sits", async () => {
  const first = await dirWith(["ffmpeg"]);
  const second = await dirWith(["yt-dlp"]);
  assert.deepEqual(missingBinaries([first, second].join(path.delimiter)), []);
});

test("a file that is not executable does not count", async () => {
  const dir = await dirWith(["ffmpeg"], ["ffmpeg"]);
  assert.deepEqual(missingBinaries(dir, ["ffmpeg"]), ["ffmpeg"]);
});

test("an empty PATH entry is skipped rather than read as the working directory", () => {
  assert.deepEqual(missingBinaries(path.delimiter, ["yt-dlp"]), ["yt-dlp"]);
});
