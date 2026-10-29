// Getting audio: yt-dlp for the excerpts, ffmpeg to make them uniform and to
// join them.

import { execFile } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { groupByVideo } from "./plan.ts";
import type { Excerpt } from "./plan.ts";

export const OUTPUT_SAMPLE_RATE = 48000;
export const OUTPUT_CHANNELS = 2;

// The two binaries the pipeline shells out to, both expected on the PATH. The
// image builds them there, so nothing here configures a path: see the Dockerfile.
export const YT_DLP_BIN = "yt-dlp";
export const FFMPEG_BIN = "ffmpeg";
export const BINARIES = [YT_DLP_BIN, FFMPEG_BIN];

// Which of the binaries are not on the PATH. The server checks this before it
// listens, so an image missing one fails on boot rather than on the first job.
// The PATH comes in as an argument, which is what makes the lookup testable.
export const missingBinaries = (
  pathValue: string = process.env.PATH ?? "",
  binaries: string[] = BINARIES,
): string[] => binaries.filter((bin) => !onPath(bin, pathValue));

const onPath = (bin: string, pathValue: string): boolean =>
  pathValue.split(path.delimiter).some((dir) => {
    if (!dir) return false;
    try {
      accessSync(path.join(dir, bin), constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });

// Runs a binary and hands back what it wrote. The seam tests run the pipeline
// through, so the real one is `run` below.
export type Exec = (
  bin: string,
  args: string[],
) => Promise<{ stdout: string; stderr: string }>;

const seconds = (ms: number): number => ms / 1000;

// One yt-dlp call per video, carrying every excerpt asked of it: the video's
// metadata is fetched once rather than once per excerpt, and each section is
// the only audio it downloads.
export const ytDlpArgs = ({
  videoId,
  excerpts,
  template,
}: {
  videoId: string;
  excerpts: Excerpt[];
  template: string;
}): string[] => {
  const sections = excerpts.flatMap((excerpt) => [
    "--download-sections",
    `*${seconds(excerpt.startMs)}-${seconds(excerpt.startMs + excerpt.lengthMs)}`,
  ]);
  return [
    "-f",
    "bestaudio",
    ...sections,
    "--force-keyframes-at-cuts",
    "--extract-audio",
    "--audio-format",
    "wav",
    "--no-warnings",
    "--no-progress",
    "--output",
    template,
    `https://www.youtube.com/watch?v=${videoId}`,
  ];
};

const run: Exec = (bin, args) =>
  new Promise((resolve, reject) => {
    execFile(bin, args, { maxBuffer: 1 << 24 }, (error, stdout, stderr) => {
      if (error) {
        const detail = (stderr || "").trim().split("\n").slice(-3).join(" ").trim();
        reject(new Error(`${path.basename(bin)} failed: ${detail || error.message}`));
      } else {
        resolve({ stdout, stderr });
      }
    });
  });

// The files yt-dlp writes, matched back to the excerpts that asked for them.
// The name carries the video id and the section start, which is what makes the
// match possible without a guess.
const excerptFile = (names: string[], excerpt: Excerpt): string | null => {
  const prefix = `part-${excerpt.videoId}-${seconds(excerpt.startMs)}.`;
  return names.find((name) => name.startsWith(prefix) && name.endsWith(".wav")) ?? null;
};

export const fetchExcerpts = async ({
  excerpts,
  dir,
  onProgress = () => {},
  exec = run,
}: {
  excerpts: Excerpt[];
  dir: string;
  onProgress?: (done: number, total: number) => void;
  exec?: Exec;
}): Promise<string[]> => {
  await mkdir(dir, { recursive: true });
  const parts = new Map<number, string>();
  let done = 0;

  for (const [videoId, group] of groupByVideo(excerpts)) {
    const template = path.join(dir, "part-%(id)s-%(section_start)s.%(ext)s");
    await exec(YT_DLP_BIN, ytDlpArgs({ videoId, excerpts: group, template }));
    const names = await readdir(dir);
    for (const excerpt of group) {
      const name = excerptFile(names, excerpt);
      if (!name) {
        throw new Error(
          `yt-dlp produced no audio for ${seconds(excerpt.startMs)}s of ${videoId}.`,
        );
      }
      parts.set(excerpt.index, path.join(dir, name));
      onProgress(++done, excerpts.length);
    }
  }

  // Every excerpt got a path in the loop above, and this puts them back in plan
  // order.
  return excerpts.map((excerpt) => parts.get(excerpt.index)!);
};

// ffmpeg takes one input format, so the excerpts are made uniform first and
// then joined with a copy, which is the cheap half of the work.
export const assemble = async ({
  parts,
  outFile,
  workDir,
  onProgress = () => {},
  exec = run,
}: {
  parts: string[];
  outFile: string;
  workDir: string;
  onProgress?: (done: number, total: number) => void;
  exec?: Exec;
}): Promise<string> => {
  const uniformDir = path.join(workDir, "uniform");
  await mkdir(uniformDir, { recursive: true });

  const uniform: string[] = [];
  for (const [index, part] of parts.entries()) {
    const target = path.join(uniformDir, `part-${String(index).padStart(4, "0")}.wav`);
    await exec(FFMPEG_BIN, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      part,
      "-ar",
      String(OUTPUT_SAMPLE_RATE),
      "-ac",
      String(OUTPUT_CHANNELS),
      "-c:a",
      "pcm_s16le",
      target,
    ]);
    uniform.push(target);
    onProgress(index + 1, parts.length);
  }

  const listFile = path.join(workDir, "concat.txt");
  await writeFile(
    listFile,
    uniform.map((file) => `file '${file.replace(/'/g, "'\\''")}'`).join("\n") + "\n",
    "utf-8",
  );

  await exec(FFMPEG_BIN, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    listFile,
    "-c",
    "copy",
    outFile,
  ]);

  return outFile;
};
