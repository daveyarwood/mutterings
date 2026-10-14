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

## License

Copyright © 2020-2026 Dave Yarwood

Distributed under the Eclipse Public License version 2.0.

[curl]: https://curl.haxx.se/
[jq]: https://jqlang.github.io/jq/
[yt-dlp]: https://github.com/yt-dlp/yt-dlp
[yt-dlp-releases]: https://github.com/yt-dlp/yt-dlp/releases
[ffmpeg]: https://ffmpeg.org/
[sox]: https://sox.sourceforge.net/
