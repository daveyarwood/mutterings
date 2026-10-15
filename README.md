# mutterings

A set of scripts where the end goal is to produce a WAV file consisting of a
bunch of randomly selected very brief (50-2000ms) excerpts of the audio of a
bunch of YouTube videos, played back to back.

## Requirements

The scripts are bash and call these tools:

* [curl] and [jq], for collecting video URLs
* [yt-dlp] plus [ffmpeg] to extract the audio, for downloading it. Install
  `yt-dlp` somewhere you can update it yourself, such as `uv tool install
  yt-dlp` or a [release binary][yt-dlp-releases], not from a distro package.
  YouTube changes often enough that a months-old `yt-dlp` starts failing with
  `HTTP Error 403: Forbidden` until it is updated. A JavaScript runtime such as
  `deno` or `node` on `PATH` is optional but recommended for full support.
* [sox], including the `soxi` it ships with, for producing the output
* `awk` and the GNU coreutils (`find`, `mktemp`, `shuf`), for the arithmetic and
  the temporary files

## Procedure

### Collect a bunch of YouTube URLs into a file

* Obtain a Google API key with access to YouTube, and set the API key in the
  environment variable `GOOGLE_API_KEY`.

* Figure out the ID of the YouTube channel you want.

* Run `./channel-videos $channel_id > /tmp/video-urls`

### Download audio files

> Disclaimer: The legality of this depends on what you are downloading. Don't
> download anything the content creator might object to you downloading.

* If the channel you chose has a bajillion videos, edit the file down to a more
  sensible number of videos, otherwise you are going to blow through all of your
  hard drive space with this next step.

* Run `./download-audio-files /tmp/video-urls /tmp/audio-files`

### Produce mutterings

* If desired, tweak the `total_length_ms` and `muttering_length_ms` parameters
  in the `produce-mutterings` script.

* Run `produce-mutterings /tmp/audio-files /tmp/out.wav`

## The app backend

`server/` is the local backend behind the app: it resolves a channel, works out
which excerpts to take, fetches only those, and hands back a WAV. It is Node
with no dependencies, and it calls the same two external tools as the scripts,
`yt-dlp` to fetch audio and `ffmpeg` to join it.

```sh
GOOGLE_API_KEY=... npm start   # listens on PORT, 5179 by default
npm test                       # node --test, no dependencies
```

The API, all JSON except the download:

| Route | What it does |
| --- | --- |
| `GET /api/health` | Whether the API key is set, and the default lengths |
| `GET /api/channels?q=` | Channel search results for the UI to offer |
| `POST /api/channels/resolve` | `{ input }`: a URL, an ID, a handle, or a query, to one channel |
| `POST /api/jobs` | `{ channel, totalLengthMs?, excerptLengthMs? }` to a job id |
| `GET /api/jobs/:id` | Its status, phase, and progress, for polling |
| `GET /api/jobs/:id/result.wav` | The finished file |

`GOOGLE_API_KEY` is read server side from the environment and never sent to the
browser.

## License

Copyright © 2020-2026 Dave Yarwood

Distributed under the Eclipse Public License version 2.0.

[curl]: https://curl.haxx.se/
[jq]: https://jqlang.github.io/jq/
[yt-dlp]: https://github.com/yt-dlp/yt-dlp
[yt-dlp-releases]: https://github.com/yt-dlp/yt-dlp/releases
[ffmpeg]: https://ffmpeg.org/
[sox]: https://sox.sourceforge.net/
