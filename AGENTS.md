# Mutterings

A small Node backend that turns brief excerpts of the audio of a set of YouTube
videos into one WAV. The README is the summary; this file is the part that
reading the code cannot tell you: how it deploys and how a preview is stood up.

No dependencies, no build step, and no lockfile, so the image is the source and
`npm` is the entry point. The code is TypeScript, and Node strips the types as
it runs them, so nothing compiles: an import carries the `.ts` extension and
`npm start` points straight at `server/index.ts`. That is what `engines.node`
asks for 22.18 or newer for, the version where type stripping stopped needing a
flag.

## How it deploys

Railway, in the workspace `Dave Yarwood's Projects`
(`d96028a4-62f8-4bd0-a635-4b05e462d4bc`), as the project `mutterings` with one
service of the same name in the `production` environment, built from this repo's
`Dockerfile`. `.railway/railway.ts` names the build and the healthcheck, which is
`/api/health`.

That file is Railway's Infrastructure as Code format, and it replaced
`railway.json` on 2026-10-28, before Config as Code stops being read on
2026-12-01. Railway refuses a plan while a service is still managed by
`railway.json`, so the two files cannot sit together: the migration was a
cutover, and `railway config migrate undo` reverses it. The settings now live on
the service instance, `railway config plan` should report no changes, and
`railway up` no longer supplies the builder or the healthcheck.

Evaluating the file needs the TypeScript SDK, which this repo does not depend on.
Run `npm install --no-save railway` in the checkout before `railway config plan`
or `railway config apply`, and leave `package.json` and the lockfile alone.

The image is `node:22-bookworm-slim` plus `ffmpeg` from Debian and the `yt-dlp`
release binary fetched at build time, with its published checksum verified. Both
binaries are there because `npm start` shells out to both. `yt-dlp` is not a
distro package: YouTube changes faster than a distro's package cycle, and a stale
`yt-dlp` starts answering `HTTP Error 403: Forbidden`.

Deploys are pushed from a working copy with the CLI, not by connecting the repo
to Railway's GitHub app:

```bash
RAILWAY_API_TOKEN=$(cat /opt/data/.config/railway/api-token) \
  /opt/data/.railway/bin/railway up --project <project id> --environment production \
  --service mutterings -d -y
```

`--environment` is not optional when `--project` is given. The token the line
reads is a workspace token, scoped to the workspace above; if Railway answers
`Not Authorized`, it needs refreshing before the line works. The GraphQL API at
`https://backboard.railway.com/graphql/v2` needs a `User-Agent` header: without
one the request comes back as Cloudflare error 1010.

## Standing a preview up

A preview is an environment named `pr-<number>` cloned from `production`, with
the service deployed at the branch head, and the domain it answers on goes into
the pull request body as `Preview: https://<domain>`, written out so GitHub links
it.

Tearing a preview down belongs to Exchequer's sweep, which deletes one whose pull
request has merged or closed. A night never touches an environment other than the
one it made.

## Delivery

Changes ship as pull requests from a `hermes/` branch, opened as a draft and left
for Dave. Nothing pushes to `master`, and an autonomous night never marks a pull
request ready: that belongs to the last pass of the night.
