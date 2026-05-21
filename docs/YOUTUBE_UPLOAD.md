# YouTube Upload Setup

This pipeline uploads approved episodes as private videos by default.

## Required Environment

```env
YOUTUBE_CLIENT_ID=
YOUTUBE_CLIENT_SECRET=
YOUTUBE_REFRESH_TOKEN=
YOUTUBE_CHANNEL_ID=
YOUTUBE_REDIRECT_URI=http://localhost:53682/oauth2callback
```

`YOUTUBE_CHANNEL_ID` is stored for channel bookkeeping. The upload itself uses the OAuth refresh token and uploads to the authenticated channel.

## Multi-Channel Environment

Use channel profiles when operating multiple YouTube channels. The active channel is selected by `YOUTUBE_ACTIVE_CHANNEL`, and individual commands can override it with `--channel`.

```env
YOUTUBE_ACTIVE_CHANNEL=orbital_focus
YOUTUBE_CHANNELS_JSON={"orbital_focus":{"name":"Orbital Focus","channelId":"","refreshToken":"","defaultPlaylistId":"","playlists":{"Lunar Night Shift":"","Orbital Systems":"","Deep Space Focus":""}},"channel_2":{"name":"","channelId":"","refreshToken":"","defaultPlaylistId":"","playlists":{}},"channel_3":{"name":"","channelId":"","refreshToken":"","defaultPlaylistId":"","playlists":{}}}
```

Profiles inherit these legacy/global values when omitted:

- `YOUTUBE_CLIENT_ID`
- `YOUTUBE_CLIENT_SECRET`
- `YOUTUBE_REDIRECT_URI`

That means each channel usually only needs its own `channelId`, `refreshToken`, and playlist IDs.

For stricter separation, put `clientId`, `clientSecret`, and `redirectUri` inside each profile object.

Playlist resolution order:

1. `--playlist-id`
2. `playlist.id` or `playlistId` in the publish package
3. `playlists[series]` in the active channel profile
4. `defaultPlaylistId` in the active channel profile

## OAuth Flow

Generate an authorization URL:

```bash
npm run youtube:auth-url -- --channel orbital_focus
```

Open the returned URL, approve access, then copy the `code` query parameter from the redirect URL.

Exchange the code and write the refresh token into `.env`:

```bash
npm run youtube:exchange-code -- --channel orbital_focus --code "PASTE_CODE_HERE" --write-env
```

Repeat the OAuth flow once per channel. Make sure the browser is logged into the Google account or Brand Channel that owns the target YouTube channel before approving access.

The auth URL requests both upload and channel-management scopes:

- `https://www.googleapis.com/auth/youtube.upload`
- `https://www.googleapis.com/auth/youtube`

Existing refresh tokens that were created with upload-only scope must be re-authorized before status checks or playlist management will work.

## Dry Run

Preview the upload request without calling YouTube:

```bash
npm run youtube:upload -- --channel orbital_focus --episode-id 2026-05-04-lunar-night-shift-quiet-moonbase-systems --dry-run
```

## Upload

Upload the approved episode as a private video:

```bash
npm run youtube:upload -- --channel orbital_focus --episode-id 2026-05-04-lunar-night-shift-quiet-moonbase-systems
```

The upload command:

- Requires SQLite episode status `approved`
- Defaults to `privacyStatus: private`
- Sets `selfDeclaredMadeForKids: false`
- Sets `containsSyntheticMedia: true`
- Sets category ID `10` for Music
- Uploads the final thumbnail after the video upload
- Checks the uploaded video's YouTube status
- Adds the video to the resolved playlist when a playlist ID is available
- Saves upload records in SQLite
- Records the publish experiment metadata in SQLite
- Saves the first YouTube performance snapshot when post-upload status is available

Skip playlist insertion for a one-off upload:

```bash
npm run youtube:upload -- --channel orbital_focus --episode-id 2026-05-04-lunar-night-shift-quiet-moonbase-systems --skip-playlist
```

Force a specific playlist:

```bash
npm run youtube:upload -- --channel orbital_focus --episode-id 2026-05-04-lunar-night-shift-quiet-moonbase-systems --playlist-id "PLAYLIST_ID"
```

## Post-Publish Management

Check the latest uploaded video for an episode:

```bash
npm run youtube:status -- --channel orbital_focus --episode-id 2026-05-04-lunar-night-shift-quiet-moonbase-systems
```

Check an explicit video ID:

```bash
npm run youtube:status -- --channel orbital_focus --video-id "YOUTUBE_VIDEO_ID"
```

Add the latest uploaded video for an episode to the resolved playlist:

```bash
npm run youtube:add-to-playlist -- --channel orbital_focus --episode-id 2026-05-04-lunar-night-shift-quiet-moonbase-systems
```

Add an explicit video to an explicit playlist:

```bash
npm run youtube:add-to-playlist -- --channel orbital_focus --video-id "YOUTUBE_VIDEO_ID" --playlist-id "PLAYLIST_ID"
```

## Performance Tracking

The project stores YouTube performance data in the same SQLite database as the rest of the pipeline:

- `youtube_publish_experiments` stores the creative setup for each published video.
- `youtube_performance_snapshots` stores timestamped YouTube Data API snapshots.

On normal upload, the pipeline automatically records:

- video ID
- channel key
- title
- thumbnail path
- thumbnail concept
- visual style
- music style
- duration
- track count
- whether telemetry overlay is used
- whether each track has its own scene
- first available status/performance snapshot

Manually record or update the creative experiment metadata:

```bash
npm run youtube:record-experiment -- --channel orbital_focus --episode-id 2026-05-19-orbital-systems-orbital-systems
```

Capture one performance snapshot for a single episode:

```bash
npm run youtube:track-performance -- --channel orbital_focus --episode-id 2026-05-19-orbital-systems-orbital-systems
```

Capture performance snapshots for every uploaded video in a channel:

```bash
npm run youtube:track-all-performance -- --channel orbital_focus
```

Limit all-channel tracking to one series:

```bash
npm run youtube:track-all-performance -- --channel orbital_focus --series "Orbital Systems"
```

Print the stored report for one episode:

```bash
npm run youtube:performance-report -- --channel orbital_focus --episode-id 2026-05-19-orbital-systems-orbital-systems
```

Recommended tracking cadence:

- Immediately after upload: automatic first snapshot.
- Daily after publish while early performance is volatile.
- Weekly after the first week for longer-term comparison.
- Add YouTube Analytics API later when the channel has enough traffic to evaluate impressions, CTR, watch time, and retention.

## API Notes

- `videos.insert` costs 100 quota units and supports media uploads up to 256GB.
- `thumbnails.set` costs about 50 quota units and has a 2MB image size limit.
- `videos.list` is used for post-upload status snapshots.
- `videos.list` is also used for lightweight performance snapshots.
- `playlistItems.insert` is used for playlist insertion.
- YouTube notes that uploads from unverified API projects created after July 28, 2020 can be restricted to private visibility.
