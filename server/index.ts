// The HTTP entry point: a small JSON API over the generation pipeline.
//
//   npm start   listens on PORT (5179 by default)
//
// A job carries the videos it draws from, each with its length, so the pipeline
// needs no API key and no network beyond the audio it fetches. Working out a
// channel and reading its video lengths is a separate step, filed as its own
// issue.

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import http from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";

import { DEFAULT_EXCERPT_LENGTH_MS, DEFAULT_TOTAL_LENGTH_MS } from "./plan.ts";
import type { Video } from "./plan.ts";
import { JobStore } from "./jobs.ts";
import type { Job, JobParams } from "./jobs.ts";
import { startGeneration } from "./generate.ts";
import type { GenerationDeps } from "./generate.ts";
import { renderPage } from "./page.ts";

export const DEFAULT_PORT = 5179;
const BODY_LIMIT = 64 * 1024;

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

// A request body, before anything in it is trusted. Each field is narrowed on
// the way out.
type JobRequest = { videos?: unknown; totalLengthMs?: unknown; excerptLengthMs?: unknown };

export type AppOptions = {
  store?: JobStore;
  start?: (generation: { job: Job; store: JobStore; deps: GenerationDeps }) => unknown;
  deps?: GenerationDeps;
};

export const createApp = ({
  store = new JobStore(),
  start = startGeneration,
  deps = {},
}: AppOptions = {}) => {
  const body = async (request: IncomingMessage): Promise<unknown> => {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
      size += chunk.length;
      if (size > BODY_LIMIT) throw new HttpError(413, "Request body is too large.");
      chunks.push(chunk);
    }
    const text = Buffer.concat(chunks).toString("utf-8");
    if (!text.trim()) return {};
    try {
      return JSON.parse(text);
    } catch {
      throw new HttpError(400, "Request body is not valid JSON.");
    }
  };

  const startJob = (input: unknown): Job => {
    const videos = videosFrom(input);
    const params = paramsFrom(input);
    const job = store.create({ videos, params });
    Promise.resolve()
      .then(() => start({ job, store, deps }))
      .catch((error: unknown) => store.fail(job.id, error));
    return job;
  };

  const serveResult = async (response: ServerResponse, job: Job): Promise<void> => {
    if (!job.resultPath) return send(response, 404, { error: "That job has no result." });
    try {
      await stat(job.resultPath);
    } catch {
      return send(response, 404, { error: "The result file is gone." });
    }
    response.writeHead(200, {
      ...CORS,
      "content-type": "audio/wav",
      "content-disposition": `attachment; filename="${job.id}.wav"`,
    });
    createReadStream(job.resultPath).pipe(response);
  };

  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const route = `${request.method} ${url.pathname}`;

    try {
      if (request.method === "OPTIONS") {
        response.writeHead(204, CORS);
        return response.end();
      }

      if (route === "GET /") {
        return send(response, 200, renderPage(), "text/html; charset=utf-8");
      }

      if (route === "GET /api/health") {
        return send(response, 200, {
          ok: true,
          defaults: {
            totalLengthMs: DEFAULT_TOTAL_LENGTH_MS,
            excerptLengthMs: DEFAULT_EXCERPT_LENGTH_MS,
          },
        });
      }

      if (route === "POST /api/jobs") {
        const job = startJob(await body(request));
        return send(response, 202, store.toView(job));
      }

      const jobMatch = url.pathname.match(/^\/api\/jobs\/([\w-]+)(\/result\.wav)?$/);
      if (jobMatch && request.method === "GET") {
        const job = store.get(jobMatch[1]);
        if (!job) return send(response, 404, { error: "No such job." });
        if (jobMatch[2]) return serveResult(response, job);
        return send(response, 200, store.toView(job));
      }

      return send(response, 404, { error: `No route for ${route}.` });
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      const status = failure instanceof HttpError ? failure.status : 400;
      if (status >= 500) deps.log?.(failure.stack ?? failure.message);
      return send(response, status, { error: failure.message });
    }
  };
};

// The videos a job draws from: an id and a length each. The length is what lets
// the plan choose offsets without downloading anything.
const videosFrom = (input: unknown): Video[] => {
  const { videos } = (input ?? {}) as JobRequest;
  if (!Array.isArray(videos) || videos.length === 0) {
    throw new HttpError(400, "Send a videos list of { videoId, durationMs }.");
  }
  return videos.map((video) => {
    const { videoId, durationMs } = (video ?? {}) as { videoId?: unknown; durationMs?: unknown };
    const id = typeof videoId === "string" ? videoId.trim() : "";
    if (!id) throw new HttpError(400, "Every video needs a videoId.");
    if (typeof durationMs !== "number" || !Number.isInteger(durationMs) || durationMs <= 0) {
      throw new HttpError(400, "Every video needs a positive whole durationMs.");
    }
    return { videoId: id, durationMs };
  });
};

const paramsFrom = (input: unknown): JobParams => {
  const { totalLengthMs, excerptLengthMs } = (input ?? {}) as JobRequest;
  return {
    totalLengthMs: positiveInt(totalLengthMs, DEFAULT_TOTAL_LENGTH_MS, "totalLengthMs"),
    excerptLengthMs: positiveInt(excerptLengthMs, DEFAULT_EXCERPT_LENGTH_MS, "excerptLengthMs"),
  };
};

const positiveInt = (value: unknown, fallback: number, name: string): number => {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new HttpError(400, `${name} must be a positive whole number of milliseconds.`);
  }
  return value;
};

const send = (
  response: ServerResponse,
  status: number,
  body: unknown,
  type = "application/json",
): void => {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  response.writeHead(status, {
    ...CORS,
    "content-type": type,
    "content-length": Buffer.byteLength(text),
  });
  response.end(text);
};

class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const startServer = ({
  port = Number(process.env.PORT ?? DEFAULT_PORT),
  host = process.env.HOST ?? "127.0.0.1",
  deps = {},
}: { port?: number; host?: string; deps?: GenerationDeps } = {}): Server => {
  const store = new JobStore();
  const log = (message: string): void => console.log(`[${new Date().toISOString()}] ${message}`);
  const server = http.createServer(createApp({ store, deps: { ...deps, log } }));
  server.listen(port, host, () => {
    log(`mutterings backend on http://${host}:${port}`);
  });
  return server;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer();
}
