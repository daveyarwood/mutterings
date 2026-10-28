# mutterings

A local Node backend that produces a WAV file: a bunch of randomly selected very
brief excerpts, 50 to 2000 milliseconds each, of the audio of a bunch of YouTube
videos, played back to back.

## Requirements

* [node] 20 or newer
* [yt-dlp], for fetching the audio. Install `yt-dlp` somewhere you can update it
  yourself, such as `uv tool install yt-dlp` or a [release binary][yt-dlp-releases],
  not from a distro package. YouTube changes often enough that a months-old
  `yt-dlp` starts failing with `HTTP Error 403: Forbidden` until it is updated. A
  JavaScript runtime such as `deno` or `node` on `PATH` is optional but
  recommended for full support.
* [ffmpeg], for cutting the excerpts out and joining them

## Running it

```sh
npm start   # listens on PORT, 5179 by default
npm test    # node --test, no dependencies
```

A job is handed the videos it draws from, each with its length, so the pipeline
holds no API key and reaches nothing but the audio itself:

```json
{
  "videos": [{ "videoId": "dQw4w9WgXcQ", "durationMs": 212000 }],
  "totalLengthMs": 60000,
  "excerptLengthMs": 2000
}
```

Working a channel out and reading the lengths of its videos is a separate piece
of work, filed as its own issue. Until it lands, the caller supplies the list.

The routes:

| Route | What it does |
| --- | --- |
| `GET /` | The one page: a videos list, a start button, the job's progress, the WAV |
| `GET /api/health` | The default lengths |
| `POST /api/jobs` | `{ videos, totalLengthMs?, excerptLengthMs? }` to a job id |
| `GET /api/jobs/:id` | Its status, phase, and progress, for polling |
| `GET /api/jobs/:id/result.wav` | The finished file |

The API answers JSON, and the page and the download are the two exceptions.

The pipeline asks yt-dlp for each excerpt by section, so a 60 second output
downloads a few seconds of audio per video rather than the whole thing.

## Testing

`npm test` covers the parts whose output is deterministic: the excerpt planner,
the job registry, and the HTTP surface handling real requests and real jobs.
Nothing in it reaches the network or stands in for yt-dlp or ffmpeg.

The parts that have to talk to YouTube are checked end to end by hand against
the real binaries, and the runs are written up in the pull request. There is no
fake server and no fake binary in the suite.

> Disclaimer: The legality of this depends on what you are downloading. Don't
> download anything the content creator might object to you downloading.

## License

Copyright © 2020-2026 Dave Yarwood

Distributed under the Eclipse Public License version 2.0.

[node]: https://nodejs.org/
[yt-dlp]: https://github.com/yt-dlp/yt-dlp
[yt-dlp-releases]: https://github.com/yt-dlp/yt-dlp/releases
[ffmpeg]: https://ffmpeg.org/
