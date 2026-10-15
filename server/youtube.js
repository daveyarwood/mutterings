// YouTube Data API v3 calls: resolving a channel, listing its uploads, and
// reading video lengths.
//
// Every call reads the key from the environment itself, so there is no way to
// reach the API without one and no key travelling through a call signature.

const API_BASE = "https://www.googleapis.com/youtube/v3";
const CHANNEL_ID = /^UC[\w-]{22}$/;
const PAGE_SIZE = 50;
const SEARCH_RESULTS = 10;

export function requireApiKey(env = process.env) {
  const key = env.GOOGLE_API_KEY;
  if (!key) {
    throw new Error(
      "GOOGLE_API_KEY is not set. Create a key with YouTube Data API v3 access and set it in the environment.",
    );
  }
  return key;
}

// A pasted channel ID, a channel URL, or else a search query.
export function parseChannelReference(input) {
  const raw = (input ?? "").trim();
  if (!raw) return { kind: "empty", value: "" };
  if (CHANNEL_ID.test(raw)) return { kind: "channel-id", value: raw };
  if (raw.startsWith("@")) return { kind: "handle", value: raw };

  const url = raw.match(
    /^(?:https?:\/\/)?(?:www\.|m\.)?youtube\.com\/(?:channel\/(UC[\w-]{22})|@([\w.-]+)|c\/([\w.-]+)|user\/([\w.-]+))/i,
  );
  if (url) {
    const [, id, handle, custom, user] = url;
    if (id) return { kind: "channel-id", value: id };
    if (handle) return { kind: "handle", value: `@${handle}` };
    if (user) return { kind: "handle", value: `@${user}` };
    // A /c/ custom URL is not a handle, so a search is the only way to it.
    return { kind: "search", value: custom };
  }
  if (/^(?:https?:\/\/)?[\w.-]*youtu\.?be/.test(raw)) {
    return { kind: "unsupported", value: raw };
  }
  return { kind: "search", value: raw };
}

async function getJson(url, fetchImpl) {
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(await apiError(response));
  }
  return response.json();
}

// Google puts the reason in the body. The request URL carries the key, so it is
// deliberately not part of the message.
async function apiError(response) {
  let detail = "";
  try {
    const body = await response.json();
    detail = body?.error?.message ?? "";
  } catch {
    detail = "";
  }
  return `YouTube API responded ${response.status}${detail ? `: ${detail}` : ""}`;
}

function apiUrl(path, params) {
  const url = new URL(`${API_BASE}/${path}`);
  for (const [name, value] of Object.entries(params)) {
    url.searchParams.set(name, value);
  }
  return url.toString();
}

export async function searchChannels(query, { env = process.env, fetchImpl = fetch } = {}) {
  const body = await getJson(
    apiUrl("search", {
      part: "snippet",
      type: "channel",
      maxResults: String(SEARCH_RESULTS),
      q: query,
      key: requireApiKey(env),
    }),
    fetchImpl,
  );
  return (body.items ?? []).map((item) => ({
    id: item.id?.channelId ?? item.snippet?.channelId,
    title: item.snippet?.title ?? "",
    description: item.snippet?.description ?? "",
  }));
}

// The snippets and the uploads playlist are what the rest of the pipeline
// needs, and both come from the same call.
async function channel(parameters, { env, fetchImpl }) {
  const body = await getJson(
    apiUrl("channels", { part: "snippet,contentDetails", ...parameters, key: requireApiKey(env) }),
    fetchImpl,
  );
  const found = body.items?.[0];
  if (!found) throw new Error("No channel matched that reference.");
  return {
    id: found.id,
    title: found.snippet?.title ?? "",
    uploadsPlaylistId: found.contentDetails?.relatedPlaylists?.uploads ?? null,
    url: `https://www.youtube.com/channel/${found.id}`,
  };
}

// Anything the user can paste or type becomes a channel with its uploads
// playlist, which is what the download step reads.
export async function resolveChannel(input, { env = process.env, fetchImpl = fetch } = {}) {
  const reference = parseChannelReference(input);
  switch (reference.kind) {
    case "channel-id":
      return channel({ id: reference.value }, { env, fetchImpl });
    case "handle":
      return channel({ forHandle: reference.value }, { env, fetchImpl });
    case "search": {
      const [match] = await searchChannels(reference.value, { env, fetchImpl });
      if (!match?.id) throw new Error(`No channel matched "${reference.value}".`);
      return channel({ id: match.id }, { env, fetchImpl });
    }
    case "unsupported":
      throw new Error("Paste a channel URL, a channel ID, or a search query.");
    default:
      throw new Error("Enter a channel to search for.");
  }
}

export async function channelById(channelId, { env = process.env, fetchImpl = fetch } = {}) {
  return channel({ id: channelId }, { env, fetchImpl });
}

export async function listVideoIds(
  uploadsPlaylistId,
  { max = PAGE_SIZE, env = process.env, fetchImpl = fetch } = {},
) {
  const key = requireApiKey(env);
  const ids = [];
  let pageToken;
  while (ids.length < max) {
    const body = await getJson(
      apiUrl("playlistItems", {
        part: "contentDetails",
        maxResults: String(Math.min(PAGE_SIZE, max - ids.length)),
        playlistId: uploadsPlaylistId,
        ...(pageToken ? { pageToken } : {}),
        key,
      }),
      fetchImpl,
    );
    for (const item of body.items ?? []) {
      const id = item.contentDetails?.videoId;
      if (id) ids.push(id);
    }
    pageToken = body.nextPageToken;
    if (!pageToken) break;
  }
  return ids;
}

// Lengths come from the API rather than from yt-dlp, so that choosing an offset
// costs no download.
export async function videoDurations(videoIds, { env = process.env, fetchImpl = fetch } = {}) {
  const key = requireApiKey(env);
  const durations = [];
  for (let start = 0; start < videoIds.length; start += PAGE_SIZE) {
    const batch = videoIds.slice(start, start + PAGE_SIZE);
    const body = await getJson(
      apiUrl("videos", { part: "contentDetails", id: batch.join(","), key }),
      fetchImpl,
    );
    for (const item of body.items ?? []) {
      const durationMs = parseIsoDuration(item.contentDetails?.duration ?? "");
      if (durationMs > 0) durations.push({ videoId: item.id, durationMs });
    }
  }
  return durations;
}

// PT#H#M#S, which is the only shape the API returns for a video length.
export function parseIsoDuration(value) {
  const match = (value ?? "").match(
    /^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/,
  );
  if (!match) return 0;
  const [, days, hours, minutes, seconds] = match;
  return (
    Number(days ?? 0) * 86400000 +
    Number(hours ?? 0) * 3600000 +
    Number(minutes ?? 0) * 60000 +
    Math.round(Number(seconds ?? 0) * 1000)
  );
}
