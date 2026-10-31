// The one page: hand it the videos to draw from, it starts a job, shows the
// job's progress, and plays the WAV that comes out. No build step and no
// styling, so the page is a string and the script inside it is inline. That
// script is written without backticks, because the page itself is one.

export const renderPage = (): string => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>mutterings</title>
  </head>
  <body>
    <h1>mutterings</h1>
    <p>A job needs the videos it draws from, each with its length, as JSON:</p>
    <p><code>[{"videoId": "dQw4w9WgXcQ", "durationMs": 212000}]</code></p>
    <form id="start">
      <label for="videos">Videos</label><br>
      <textarea id="videos" name="videos" rows="8" cols="60"
        placeholder='[{"videoId": "dQw4w9WgXcQ", "durationMs": 212000}]'></textarea><br>
      <button type="submit">Start</button>
    </form>
    <p id="status"></p>
    <audio id="result" controls></audio>
    <script>
      const form = document.querySelector('#start');
      const videos = document.querySelector('#videos');
      const status = document.querySelector('#status');
      const result = document.querySelector('#result');

      const show = (text) => {
        status.textContent = text;
      };

      const poll = async (id) => {
        const response = await fetch('/api/jobs/' + id);
        const job = await response.json();
        if (!response.ok) return show(job.error);
        if (job.status === 'failed') return show(job.error);
        if (job.status === 'done') {
          show('done, ' + job.excerpts + ' excerpts');
          result.src = job.resultUrl;
          return;
        }
        show(job.phase + ' ' + Math.round(job.progress * 100) + '%');
        setTimeout(() => poll(id), 500);
      };

      const start = async (event) => {
        event.preventDefault();
        result.removeAttribute('src');
        show('starting');
        try {
          const response = await fetch('/api/jobs', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ videos: JSON.parse(videos.value) }),
          });
          const job = await response.json();
          if (!response.ok) return show(job.error);
          poll(job.id);
        } catch (error) {
          show(error.message);
        }
      };

      form.addEventListener('submit', start);
    </script>
  </body>
</html>
`;
