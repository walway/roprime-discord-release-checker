import dotenv from "dotenv";
import { Client, GatewayIntentBits } from "discord.js";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, "..");
dotenv.config({ path: join(PROJECT_ROOT, ".env") });

const OWNER = "walway"; // Repo owner
const REPO = "RoPrime"; // Repo name

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const ANNOUNCE_CHANNEL_ID = process.env.ANNOUNCE_CHANNEL_ID;
const CHECK_INTERVAL_MINUTES = Number(process.env.CHECK_INTERVAL_MINUTES ?? "10");
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

/** Matches `Version: **1.2.3**` */
const VERSION_IN_MESSAGE = /Version:\s*\*\*([^*]+)\*\*/i;

if (!DISCORD_TOKEN) {
  throw new Error(
    "Missing DISCORD_TOKEN. Copy .env.example to .env in the project folder and set DISCORD_TOKEN=... (not in .env.example)."
  );
}
if (!ANNOUNCE_CHANNEL_ID) {
  throw new Error(
    "Missing ANNOUNCE_CHANNEL_ID. Add it to .env (right‑click a channel in Discord → Copy channel ID, with Developer Mode on)."
  );
}
if (!Number.isFinite(CHECK_INTERVAL_MINUTES) || CHECK_INTERVAL_MINUTES <= 0) {
  throw new Error("CHECK_INTERVAL_MINUTES must be a positive number");
}

function normalizeTag(tag) {
  if (typeof tag !== "string") return "";
  return tag.trim().replace(/^v/i, "");
}

function formatReleaseMessage(release) {
  const title =
    release.name && release.name !== release.rawTag ? release.name : `RoPrime ${release.rawTag}`;
  return (
    `**New ${REPO} release:** ${title}\n` +
    `Version: **${release.tag}**\n` +
    `Release: ${release.htmlUrl}`
    ``
    `@Releases`
  );
}

async function fetchAllReleases() {
  const perPage = 100;
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "discord-roprime-version-bot"
  };
  if (GITHUB_TOKEN) headers.Authorization = `Bearer ${GITHUB_TOKEN}`;

  const all = [];
  for (let page = 1; ; page++) {
    const url = `https://api.github.com/repos/${OWNER}/${REPO}/releases?per_page=${perPage}&page=${page}`;
    const res = await fetch(url, { headers });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`GitHub API error ${res.status}: ${text || res.statusText}`);
    }
    const batch = await res.json();
    if (!Array.isArray(batch) || batch.length === 0) break;

    for (const json of batch) {
      const rawTag = String(json.tag_name ?? "");
      const tag = normalizeTag(rawTag);
      if (!tag) continue;
      all.push({
        tag,
        rawTag,
        name: String(json.name ?? ""),
        htmlUrl: String(json.html_url ?? `https://github.com/${OWNER}/${REPO}/releases`),
        publishedAt: String(json.published_at ?? "")
      });
    }

    if (batch.length < perPage) break;
  }

  all.sort((a, b) => {
    const ta = Date.parse(a.publishedAt) || 0;
    const tb = Date.parse(b.publishedAt) || 0;
    return ta - tb;
  });

  const seenTags = new Set();
  const unique = [];
  for (const r of all) {
    if (seenTags.has(r.tag)) continue;
    seenTags.add(r.tag);
    unique.push(r);
  }
  return unique;
}

/**
 * Checks channel history for each version until new
 */
async function collectAnnouncedVersionsFromChannel(channel, botUserId, required) {
  const requiredSet = new Set(required);
  const found = new Set();
  let before;

  while (requiredSet.size > 0 && [...requiredSet].some((t) => !found.has(t))) {
    const batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
    if (batch.size === 0) break;

    for (const msg of batch.values()) {
      if (msg.author?.id !== botUserId) continue;
      const m = msg.content.match(VERSION_IN_MESSAGE);
      if (m) found.add(normalizeTag(m[1]));
    }

    if ([...requiredSet].every((t) => found.has(t))) break;

    const oldest = [...batch.values()].reduce((a, b) =>
      a.createdTimestamp < b.createdTimestamp ? a : b
    );
    before = oldest.id;
    if (batch.size < 100) break;
  }

  return found;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function syncReleasesToChannel(client) {
  const [releases, channel] = await Promise.all([
    fetchAllReleases(),
    client.channels.fetch(ANNOUNCE_CHANNEL_ID)
  ]);

  if (releases.length === 0) {
    throw new Error("No GitHub releases returned (or all had empty tag_name)");
  }
  if (!channel || !("send" in channel)) {
    throw new Error("ANNOUNCE_CHANNEL_ID did not resolve to a text-capable channel");
  }

  const botUserId = client.user?.id;
  if (!botUserId) throw new Error("Bot user not available yet");

  const allTags = releases.map((r) => r.tag);
  const alreadyInChannel = await collectAnnouncedVersionsFromChannel(
    channel,
    botUserId,
    allTags
  );

  const toSend = releases.filter((r) => !alreadyInChannel.has(r.tag));
  if (toSend.length === 0) return;

  if (alreadyInChannel.size === 0) {
    console.log(
      "No version announcements in this channel yet — every GitHub release will be posted (oldest first). This is expected for a new channel."
    );
  }

  for (const release of toSend) {
    await channel.send({ content: formatReleaseMessage(release) });
    const label = release.rawTag || `v${release.tag}`;
    console.log(`Message successfully sent! (${label})`);
    // Calling back sleep for rate limit after sending message
    await sleep(1100);
  }
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

client.once("ready", async () => {
  const intervalMs = CHECK_INTERVAL_MINUTES * 60 * 1000;

  try {
    await syncReleasesToChannel(client);
  } catch (e) {
    console.error("[startup sync failed]", e);
  }

  setInterval(async () => {
    try {
      await syncReleasesToChannel(client);
    } catch (e) {
      console.error("[poll failed]", e);
    }
  }, intervalMs);

  console.log(`Logged in as ${client.user?.tag}. Checking every ${CHECK_INTERVAL_MINUTES} minutes.`);
});

client.login(DISCORD_TOKEN);
