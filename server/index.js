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
import { pathToFileURL } from "node:url";

import { DEFAULT_EXCERPT_LENGTH_MS, DEFAULT_TOTAL_LENGTH_MS } from "./plan.js";
import { JobStore } from "./jobs.js";
import { startGeneration } from "./generate.js";
import { renderPage } from "./page.js";

export const DEFAULT_PORT = 5179;
const BODY_LIMIT = 64 * 1024;

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

export function createApp({ store = new JobStore(), start = startGeneration, deps = {} } = {}) {
  async function body(request) {
    const chunks = [];
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
  }

  function startJob(input) {
    const videos = videosFrom(input);
    const params = paramsFrom(input);
    const job = store.create({ videos, params });
    Promise.resolve()
      .then(() => start({ job, store, deps }))
      .catch((error) => store.fail(job.id, error));
    return job;
  }

  async function serveResult(response, job) {
    if (!job?.resultPath) return send(response, 404, { error: "That job has no result." });
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
  }

  return async function handle(request, response) {
    const url = new URL(request.url, "http://localhost");
    const route = `${request.method} ${url.pathname}`;

    try {
      if (request.method === "OPTIONS") {
        response.writeHead(204, CORS);
        return response.end();
      }

      if (route === "GET /") {
        return sendHtml(response, renderPage());
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
      const status = error instanceof HttpError ? error.status : 400;
      if (status >= 500) deps.log?.(error.stack ?? String(error));
      return send(response, status, { error: error.message });
    }
  };
}

// The videos a job draws from: an id and a length each. The length is what lets
// the plan choose offsets without downloading anything.
function videosFrom(input) {
  const videos = input?.videos;
  if (!Array.isArray(videos) || videos.length === 0) {
    throw new HttpError(400, "Send a videos list of { videoId, durationMs }.");
  }
  return videos.map((video) => {
    const videoId = typeof video?.videoId === "string" ? video.videoId.trim() : "";
    const durationMs = video?.durationMs;
    if (!videoId) throw new HttpError(400, "Every video needs a videoId.");
    if (!Number.isInteger(durationMs) || durationMs <= 0) {
      throw new HttpError(400, "Every video needs a positive whole durationMs.");
    }
    return { videoId, durationMs };
  });
}

function paramsFrom(input) {
  return {
    totalLengthMs: positiveInt(input?.totalLengthMs, DEFAULT_TOTAL_LENGTH_MS, "totalLengthMs"),
    excerptLengthMs: positiveInt(
      input?.excerptLengthMs,
      DEFAULT_EXCERPT_LENGTH_MS,
      "excerptLengthMs",
    ),
  };
}

function positiveInt(value, fallback, name) {
  if (value === undefined || value === null) return fallback;
  if (!Number.isInteger(value) || value <= 0) {
    throw new HttpError(400, `${name} must be a positive whole number of milliseconds.`);
  }
  return value;
}

function sendHtml(response, html) {
  response.writeHead(200, {
    ...CORS,
    "content-type": "text/html; charset=utf-8",
    "content-length": Buffer.byteLength(html),
  });
  response.end(html);
}

function send(response, status, payload) {
  const text = JSON.stringify(payload);
  response.writeHead(status, {
    ...CORS,
    "content-type": "application/json",
    "content-length": Buffer.byteLength(text),
  });
  response.end(text);
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function startServer({
  port = Number(process.env.PORT ?? DEFAULT_PORT),
  host = process.env.HOST ?? "127.0.0.1",
  deps = {},
} = {}) {
  const store = new JobStore();
  const log = (message) => console.log(`[${new Date().toISOString()}] ${message}`);
  const server = http.createServer(createApp({ store, deps: { ...deps, log } }));
  server.listen(port, host, () => {
    log(`mutterings backend on http://${host}:${port}`);
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer();
}
