# Discord RoPrime Version Bot

Posts a message in a Discord channel when `walway/RoPrime` publishes a new GitHub Release.

## Setup

1. Install deps:

```bash
npm install
```

2. Create `.env` (the bot **only** reads `.env`, not `.env.example`):

```bash
copy .env.example .env
```

3. Fill in:

- `DISCORD_TOKEN`: your bot token
- `ANNOUNCE_CHANNEL_ID`: the channel to post announcements into

4. Run:

```bash
npm start
```

## Notes

- Uses the GitHub Releases API for `walway/RoPrime`.
- Persists last announced version to `data/state.json`.
- Initial baseline is `1.1.3` (the current latest you mentioned) so it won't spam on first run.

