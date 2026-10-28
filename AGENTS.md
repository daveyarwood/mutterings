# Mutterings

A small Node backend that turns brief excerpts of the audio of a set of YouTube
videos into one WAV. The README is the summary; this file is the part that
reading the code cannot tell you: how it deploys, how a preview is stood up, and
what the suite is for.

No dependencies, no build step, and no lockfile, so the image is the source and
`npm` is the entry point. The code is plain JavaScript ESM rather than
TypeScript for the same reason: a build step is exactly what this repo does not
have. `package.json` is the manifest: `engines.node` is 20 or newer, `npm start`
runs `server/index.js`, and `npm test` runs `node --test`.

## How it deploys

Railway, in the workspace `Dave Yarwood's Projects`
(`d96028a4-62f8-4bd0-a635-4b05e462d4bc`), as the project `mutterings` with one
service of the same name in the `production` environment, built from this repo's
`Dockerfile`. `railway.json` names the build and the healthcheck, which is
`/api/health`.

The image is `node:22-bookworm-slim` plus `ffmpeg` from Debian and the `yt-dlp`
release binary fetched at build time. Both binaries are there because `npm start`
shells out to both. `yt-dlp` is not a distro package: YouTube changes faster than
a distro's package cycle, and a stale `yt-dlp` starts answering
`HTTP Error 403: Forbidden`. The build default is the current release, so a
rebuild picks up whatever is newest.

Deploys are pushed from a working copy with the CLI, not by connecting the repo
to Railway's GitHub app:

```bash
RAILWAY_API_TOKEN=$(cat /opt/data/.config/railway/api-token) \
  /opt/data/.railway/bin/railway up --project <project id> --environment production \
  --service mutterings -d -y
```

`--environment` is not optional when `--project` is given.

As of 2026-10-28 that workspace token is rejected as `Not Authorized` by both the
CLI and the GraphQL API at `https://backboard.railway.com/graphql/v2`, for
reading projects and for `projectCreate`, so the CLI path needs a fresh token
before it can be used. The GraphQL endpoint needs a `User-Agent` header: without
one the request comes back as Cloudflare error 1010. The workspace is on the
Hobby plan, so 50 projects and 50 services per project, with $5 of included
usage.

## Standing a preview up

A preview is an environment named `pr-<number>` cloned from `production` with
the service deployed at the branch head. It runs through the hosted Railway
connector's `connectors__railway__*` tools, not through the token:

- `LIST_PROJECTS` for the workspace above, and take the project named
  `mutterings`.
- `LIST_ENVIRONMENTS` for that project, and take `production`.
- `LIST_SERVICES` for that project, and take `mutterings`.
- `CREATE_ENVIRONMENT` named `pr-<number>`, with `source_environment_id` set to
  production, `ephemeral: true`, and `skip_initial_deploys: true`.
- `DEPLOY_SERVICE` into that environment with `commit_sha` set to the branch
  head, `git rev-parse HEAD` in the worktree.
- Wait for that deployment to reach SUCCESS, then `LIST_DOMAINS`. The preview's
  domain is the one whose suffix is `up.railway.app`.

The line for the pull request body is `Preview: https://<domain>`, written out
so GitHub links it.

Tearing a preview down belongs to Exchequer's sweep, which deletes one whose pull
request has merged or closed. A night never touches an environment other than the
one it made.

The project itself does not exist yet: as of 2026-10-28 the workspace token
cannot create one and the bot cannot sign in to the Railway UI, so a night that
finds no `mutterings` project reports that rather than inventing a workaround.

## Runtime config

Everything comes from the environment, and there is very little of it. Railway
sets `PORT` and the app reads it, defaulting to 5179. `HOST` defaults to
`127.0.0.1` for a local run and the Dockerfile sets `0.0.0.0`, because Railway
routes to the container rather than to its loopback. `RAILWAY_ENVIRONMENT_NAME`
is Railway's own variable and is there if the app ever needs to tell a preview
from production.

Job files are written under the system temp directory, so they live in the
container and a restart loses them along with the job registry, which is one
`Map` in one process.

## The routes

| Route | What it does |
| --- | --- |
| `GET /` | The one page: a videos list, a start button, the job's progress, the WAV |
| `GET /api/health` | The default lengths |
| `POST /api/jobs` | `{ videos, totalLengthMs?, excerptLengthMs? }` to a job id |
| `GET /api/jobs/:id` | Its status, phase, and progress, for polling |
| `GET /api/jobs/:id/result.wav` | The finished file |

A job carries the videos it draws from, each with its length, so the pipeline
holds no API key and reaches nothing but the audio itself. Working a channel out
and reading the lengths of its videos is a separate issue; until it lands the
caller supplies the list.

The page is `server/page.js`, one string returned by `renderPage()` and served
from the route table in `server/index.js`. It has no styling and no build step on
purpose, and its inline script talks to the same routes the API exposes.

## Tests

`npm test` is `node --test` over `test/`, and it covers what is deterministic:
the excerpt planner, the job registry, and the HTTP surface handling real
requests against a real server on a real port. There is no mock, no stub, no
fake server, and no assertion about the arguments a call received.

Anything that reaches YouTube, a binary or the filesystem is proved by a real
run, and the output of that run is written up in the pull request. That is the
rule for `yt-dlp`, `ffmpeg`, and the container.

## Delivery

Changes ship as pull requests from a `hermes/` branch, opened as a draft and left
for Dave. Nothing pushes to `master`, and an autonomous night never marks a pull
request ready: that belongs to the last pass of the night.
