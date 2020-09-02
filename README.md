# mutterings

A set of scripts where the end goal is to produce a WAV file consisting of a
bunch of randomly selected very brief (50-2000ms) excerpts of the audio of a
bunch of YouTube videos, played back to back.

## Procedure

### Collect a bunch of YouTube URLs into a file

* Install [curl], [jo] and [jq].

* Obtain a Google API key with access to YouTube, and set the API key in the
  environment variable `GOOGLE_API_KEY`.

* Figure out the ID of the YouTube channel you want.

* Run `./channel-videos $channel_id > /tmp/video-urls`

### Download audio files

> Disclaimer: The legality of this depends on what you are downloading. Don't
> download anything the content creator might object to you downloading.

* Install [youtube-dl].

* If the channel you chose has a bajillion videos, edit the file down to a more
  sensible number of videos, otherwise you are going to blow through all of your
  hard drive space with this next step.

* Run `./download-audio-files /tmp/video-urls /tmp/audio-files`

### Produce mutterings

* If desired, tweak the `total_length_ms` and `muttering_length_ms` parameters
  in the `produce-mutterings` script.

* Run `produce-mutterings /tmp/audio-files /tmp/out.wav`

## License

Copyright © 2020 Dave Yarwood

Distributed under the Eclipse Public License version 2.0.

[curl]: https://curl.haxx.se/
[jo]: https://github.com/jpmens/jo
[jq]: https://stedolan.github.io/jq/
[youtube-dl]: https://github.com/ytdl-org/youtube-dl

