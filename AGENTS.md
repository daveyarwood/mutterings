# Mutterings

A small Node backend that turns brief excerpts of the audio of a set of YouTube
videos into one WAV. The README is the summary; this file is the part that
reading the code cannot tell you.

No dependencies, no build step, and no lockfile, so the image is the source and
`npm` is the entry point. The code is TypeScript, and Node strips the types as
it runs them, so nothing compiles: an import carries the `.ts` extension and
`npm start` points straight at `server/index.ts`. That is what `engines.node`
asks for 22.18 or newer for, the version where type stripping stopped needing a
flag.

The build recipe is `.railway/railway.ts`, Railway's Infrastructure as Code
file, which replaced `railway.json` on 2026-10-28 ahead of Config as Code being
read for the last time on 2026-12-01. Railway refuses a plan while a service is
still managed by `railway.json`, so the two files cannot sit together: the
migration was a cutover, and `railway config migrate undo` reverses it.

Deployment is Hermes's own business, not this repo's, so this file does not
describe it: no Railway project, no service, no token, no deploy command.

## Delivery

Changes ship as pull requests from a `hermes/` branch, opened as a draft and left
for Dave. Nothing pushes to `master`, and an autonomous night never marks a pull
request ready: that belongs to the last pass of the night.
