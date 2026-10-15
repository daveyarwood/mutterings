import assert from "node:assert/strict";
import test from "node:test";

import {
  listVideoIds,
  parseChannelReference,
  parseIsoDuration,
  requireApiKey,
  resolveChannel,
  searchChannels,
  videoDurations,
} from "../server/youtube.js";

const ENV = { GOOGLE_API_KEY: "test-key" };
const CHANNEL_ID = "UCaaaaaaaaaaaaaaaaaaaaaa";

function fakeFetch(routes) {
  const requests = [];
  const fetchImpl = async (url) => {
    requests.push(url);
    const path = new URL(url).pathname.split("/").pop();
    const body = routes[path];
    if (body === undefined) throw new Error(`unexpected request for ${path}`);
    return { ok: true, status: 200, json: async () => body };
  };
  return { fetchImpl, requests };
}

const CHANNEL = {
  items: [
    {
      id: CHANNEL_ID,
      snippet: { title: "A Channel" },
      contentDetails: { relatedPlaylists: { uploads: "UUaaaaaaaaaaaaaaaaaaaaaa" } },
    },
  ],
};

test("reads a channel ID, a handle, and every channel URL shape", () => {
  assert.deepEqual(parseChannelReference(CHANNEL_ID), { kind: "channel-id", value: CHANNEL_ID });
  assert.deepEqual(parseChannelReference("@somebody"), { kind: "handle", value: "@somebody" });
  assert.deepEqual(parseChannelReference(`https://www.youtube.com/channel/${CHANNEL_ID}`), {
    kind: "channel-id",
    value: CHANNEL_ID,
  });
  assert.deepEqual(parseChannelReference("https://youtube.com/@somebody/videos"), {
    kind: "handle",
    value: "@somebody",
  });
  assert.deepEqual(parseChannelReference("https://www.youtube.com/user/somebody"), {
    kind: "handle",
    value: "@somebody",
  });
  assert.deepEqual(parseChannelReference("https://www.youtube.com/c/Somebody"), {
    kind: "search",
    value: "Somebody",
  });
});

test("anything that is not a channel reference is a search query", () => {
  assert.deepEqual(parseChannelReference("  ambient drone  "), {
    kind: "search",
    value: "ambient drone",
  });
  assert.deepEqual(parseChannelReference(""), { kind: "empty", value: "" });
  assert.deepEqual(parseChannelReference("https://www.youtube.com/watch?v=aaaaaaaaaaa"), {
    kind: "unsupported",
    value: "https://www.youtube.com/watch?v=aaaaaaaaaaa",
  });
});

test("reads the video lengths the API returns", () => {
  assert.equal(parseIsoDuration("PT1M34S"), 94000);
  assert.equal(parseIsoDuration("PT2H"), 7200000);
  assert.equal(parseIsoDuration("PT1.5S"), 1500);
  assert.equal(parseIsoDuration("P1DT2H3M4S"), 93784000);
  assert.equal(parseIsoDuration("PT0S"), 0);
  assert.equal(parseIsoDuration("garbage"), 0);
  assert.equal(parseIsoDuration(undefined), 0);
});

test("a missing key is refused before any request", async () => {
  assert.throws(() => requireApiKey({}), /GOOGLE_API_KEY/);
  const never = async () => {
    throw new Error("no request should have been made");
  };
  await assert.rejects(resolveChannel(CHANNEL_ID, { env: {}, fetchImpl: never }), /GOOGLE_API_KEY/);
  await assert.rejects(searchChannels("anything", { env: {}, fetchImpl: never }), /GOOGLE_API_KEY/);
  await assert.rejects(
    listVideoIds("UUaaaaaaaaaaaaaaaaaaaaaa", { env: {}, fetchImpl: never }),
    /GOOGLE_API_KEY/,
  );
  await assert.rejects(
    videoDurations(["aaaaaaaaaaa"], { env: {}, fetchImpl: never }),
    /GOOGLE_API_KEY/,
  );
});

test("resolves a channel ID with one call", async () => {
  const { fetchImpl, requests } = fakeFetch({ channels: CHANNEL });
  const channel = await resolveChannel(CHANNEL_ID, { env: ENV, fetchImpl });
  assert.equal(channel.title, "A Channel");
  assert.equal(channel.uploadsPlaylistId, "UUaaaaaaaaaaaaaaaaaaaaaa");
  assert.equal(requests.length, 1);
  assert.match(requests[0], /\/channels\?/);
});

test("resolves a handle, and a search query through a search first", async () => {
  const handle = fakeFetch({ channels: CHANNEL });
  await resolveChannel("@somebody", { env: ENV, fetchImpl: handle.fetchImpl });
  assert.match(handle.requests[0], /forHandle=%40somebody/);

  const search = fakeFetch({
    search: {
      items: [{ id: { channelId: CHANNEL_ID }, snippet: { title: "A Channel" } }],
    },
    channels: CHANNEL,
  });
  const channel = await resolveChannel("ambient drone", { env: ENV, fetchImpl: search.fetchImpl });
  assert.equal(channel.id, CHANNEL_ID);
  assert.equal(search.requests.length, 2);
  assert.match(search.requests[0], /\/search\?/);

  const found = await searchChannels("ambient drone", { env: ENV, fetchImpl: search.fetchImpl });
  assert.equal(found[0].title, "A Channel");
});

test("a reference that matches nothing says so", async () => {
  const empty = fakeFetch({ search: { items: [] } });
  await assert.rejects(
    resolveChannel("nobody at all", { env: ENV, fetchImpl: empty.fetchImpl }),
    /No channel matched/,
  );
  const gone = fakeFetch({ channels: { items: [] } });
  await assert.rejects(
    resolveChannel(CHANNEL_ID, { env: ENV, fetchImpl: gone.fetchImpl }),
    /No channel matched/,
  );
  await assert.rejects(
    resolveChannel("https://www.youtube.com/watch?v=aaaaaaaaaaa", {
      env: ENV,
      fetchImpl: gone.fetchImpl,
    }),
    /Paste a channel URL/,
  );
});

test("an API failure names the status and the reason, and never the key", async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 403,
    json: async () => ({
      error: { message: "The request cannot be completed because you have exceeded your quota." },
    }),
  });
  await assert.rejects(
    resolveChannel(CHANNEL_ID, { env: ENV, fetchImpl }),
    (error) => {
      assert.match(error.message, /403/);
      assert.match(error.message, /quota/);
      assert.ok(!error.message.includes(ENV.GOOGLE_API_KEY));
      return true;
    },
  );
});

test("lists uploads page by page up to the limit, then the lengths", async () => {
  const page = (ids, nextPageToken) => ({
    items: ids.map((id) => ({ contentDetails: { videoId: id } })),
    ...(nextPageToken ? { nextPageToken } : {}),
  });
  let pageNumber = 0;
  const fetchImpl = async (url) => {
    const path = new URL(url).pathname.split("/").pop();
    if (path === "playlistItems") {
      pageNumber += 1;
      return { ok: true, json: async () => (pageNumber === 1 ? page(["aaaaaaaaaaa"], "next") : page(["bbbbbbbbbbb"])) };
    }
    return {
      ok: true,
      json: async () => ({
        items: [
          { id: "aaaaaaaaaaa", contentDetails: { duration: "PT1M" } },
          { id: "bbbbbbbbbbb", contentDetails: { duration: "PT2M" } },
        ],
      }),
    };
  };

  assert.deepEqual(
    await listVideoIds("UUaaaaaaaaaaaaaaaaaaaaaa", { env: ENV, max: 1, fetchImpl }),
    ["aaaaaaaaaaa"],
  );
  assert.deepEqual(await videoDurations(["aaaaaaaaaaa", "bbbbbbbbbbb"], { env: ENV, fetchImpl }), [
    { videoId: "aaaaaaaaaaa", durationMs: 60000 },
    { videoId: "bbbbbbbbbbb", durationMs: 120000 },
  ]);
});
