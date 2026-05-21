# Automated AI Music Channel MVP PRD and Implementation Plan

## 1. Product Goal

Build a semi-automated YouTube music channel pipeline that generates one-hour cinematic ambient music videos for deep work, coding, and late-night focus.

The MVP should produce a complete review package for one episode from a manual CLI command. Daily scheduling, approval polling, and YouTube upload automation come after the single-episode pipeline is stable.

## 2. Channel Positioning

Core positioning:

> 1-hour cinematic ambient music for deep work, coding, and late-night focus

The channel will use a consistent brand system with multiple recurring themed series.

MVP series:

1. Lunar Night Shift
2. Deep Space Focus
3. Midnight Terminal

First MVP test episode:

- Series: Lunar Night Shift
- Subtitle: Quiet Moonbase Systems
- Length: approximately 60 minutes
- Structure: 15-20 generated instrumental tracks
- Title: Quiet Moonbase Systems | 1 Hour Lunar Night Shift Music for Deep Work, Coding & Focus
- Thumbnail text: LUNAR NIGHT SHIFT

## 3. Series Design

### Lunar Night Shift

Sound brand:

- Soft lunar radio ping
- Distant airlock thump
- Cold air circulation texture
- Slow ambient synths
- Glassy pads
- Sparse piano fragments

Visual template:

- Moonbase night-shift interior
- Window view toward lunar horizon or Earth
- Cold white moonlight
- Dark blue-black sky
- Quiet workstation lighting
- Leave negative space for thumbnail text

Tone:

- Isolated
- Calm
- Technical
- Night-shift focus

### Deep Space Focus

Sound brand:

- Deep sub pulse
- Faint telemetry beeps
- Dark cinematic drone
- Evolving textures
- Slow harmonic movement

Visual template:

- Starship cabin or observation window
- Distant planet, nebula, or dark starfield
- Large negative space
- Low contrast, cinematic scale

Tone:

- Vast
- Slow
- Weightless
- Long-duration concentration

### Midnight Terminal

Sound brand:

- Terminal boot tone
- Mechanical keyboard texture
- Minimal electronic ambient
- Soft arps
- Low analog bass

Visual template:

- Cold-light terminal desk
- Dark screen environment
- Abstract terminal room or workstation
- Avoid small unreadable generated text

Tone:

- Minimal
- Technical
- Late-night debugging
- Quiet momentum

## 4. Music Generation

Primary provider:

- MiniMax Music Generation API
- Docs: https://platform.minimax.io/docs/api-reference/music-generation

Pipeline design:

- Use a replaceable `MusicProvider` interface.
- Start with MiniMax as the first implementation.
- Keep provider config isolated from episode planning logic.

MVP generation settings:

- Model: `music-2.6`
- Instrumental only: `is_instrumental: true`
- No lyrics
- No vocals
- `lyrics_optimizer: false`
- `output_format: url`
- Audio format: MP3
- Sample rate: 44100
- Bitrate: 256000

Important handling:

- MiniMax output URLs should be downloaded immediately because generated URLs may expire.
- Store original generated files locally.
- Record prompt, provider response, duration, file path, and hash in SQLite.

Episode structure:

- Generate 15-20 tracks.
- Target total duration: 60 minutes.
- Acceptable final duration range: 55-65 minutes.
- Each track should have a role in the overall energy curve.
- Individual track duration is flexible. Do not reject tracks only because they are longer than expected.
- MVP minimum track duration is 90 seconds.

Confirmed prompt direction:

- Prioritize quiet concentration over series sound branding.
- Do not require signature pings, beeps, notification sounds, chimes, or other repeated cues.
- Keep the track calm enough for low-volume coding or deep work.
- Include a very slow, understated emotional build.
- Blend quiet ambient focus with a restrained Lo-Fi Hip Hop undercurrent.
- Soft dusty drums, relaxed swing, muted bass, warm keys, and a small mellow motif are allowed when they stay low-volume and supportive.
- The build should come from gradual pad layering, gentle harmonic warmth, tiny texture changes, and a soft groove that settles in slowly.
- Avoid strong beats, bass drops, trap hi-hats, sharp snares, busy percussion, loud kicks, dance grooves, flashy leads, arpeggios, dramatic chord changes, sudden transitions, risers, trailer hits, bright digital tones, and annoying repeating motifs.
- Longer tracks are acceptable when the texture remains calm and useful for focus.

Energy curve:

- 0-10 min: opening hook and focus ramp
- 10-30 min: stable concentration
- 30-45 min: deeper, slower focus
- 45-55 min: restrained forward motion
- 55-60 min: cooldown and natural ending

Opening hook:

- First 15 seconds are critical.
- Each series has a fixed sound brand.
- Hook should catch attention without becoming trailer-like.

Lunar Night Shift hook:

- 0-3s: lunar radio ping
- 3-8s: distant airlock thump and cold air circulation
- 8-15s: glassy pad and sparse melodic fragment
- 15-30s: transition into stable focus loop

## 5. Audio QC

MVP should include minimum technical checks only.

Required checks:

- File downloaded successfully
- Duration is within acceptable range
- No near-silent full track
- Peak level is not clipping
- Loudness is not extremely low or high
- Total final duration is within 55-65 minutes
- Final combined audio exports successfully
- Crossfades render successfully

Out of scope for MVP:

- Vocal detection
- Audio embedding similarity checks
- Advanced music quality scoring
- Automated taste judgment

## 6. Video and Visual System

Video style:

- Minimal ambient dynamic background
- No heavy informational player UI
- No persistent progress bars or distracting overlays
- Occasional chapter title fade-ins are allowed

Renderer:

- HyperFrames
- Repo: https://github.com/heygen-com/hyperframes

HyperFrames role:

- Compose the 1-hour video
- Animate the main visual subtly
- Handle intro title animation
- Handle chapter title overlays
- Produce final video output through its render pipeline and FFmpeg

MVP animation scope:

- 15-30 second intro treatment
- Slow zoom / pan / parallax on the main image
- Subtle grain or light pulse
- Chapter title fades for 5-8 seconds at transitions
- Final fade-out

Avoid in MVP:

- Heavy 3D
- Complex motion graphics
- AI video generation
- Full-length animated scenes

## 7. Image Generation

Primary provider:

- OpenAI GPT Image

Current recommended model:

- `gpt-image-1.5`

Note:

- The user referred to "GPT image 2", but current OpenAI docs list `gpt-image-1.5`, `gpt-image-1`, and `gpt-image-1-mini`. Use `gpt-image-1.5` unless availability changes.

Pipeline design:

- Use a replaceable `ImageProvider` interface.
- Generate visual assets via provider abstraction.

MVP assets:

- `hero_image`: 16:9 background image for video
- `thumbnail_base`: thumbnail background
- `thumbnail_final`: final thumbnail with programmatically rendered text

Rules:

- Do not ask the image model to render text.
- Add thumbnail text with code to avoid misspellings.
- Store prompt, model, response metadata, and output paths.

Thumbnail formula:

- Large text: series name only
- Subtitle details go in the YouTube title
- Each day may have a different subtitle, but the thumbnail stays brand-consistent

Example thumbnail:

- Large text: LUNAR NIGHT SHIFT
- Title subtitle: Quiet Moonbase Systems

## 8. YouTube Metadata

Metadata should be generated automatically in MVP.

Each episode should produce:

- Title
- Description
- Chapters
- Tags
- Thumbnail text
- Pinned comment
- Playlist
- Series
- Episode ID
- Upload schedule
- Visibility

Title formula:

```text
{Subtitle} | 1 Hour {Series} Music for Deep Work, Coding & Focus
```

Description structure:

1. Short mood and use-case description
2. Suitable contexts: coding, studying, writing, late-night focus
3. Chapters
4. Hashtags and light subscribe wording

Metadata strategy:

- Use one shared metadata structure.
- Give each series its own vocabulary and tone.
- Avoid keyword stuffing.
- Avoid spammy claims.

## 9. Storage and Data Model

Use both SQLite and Notion.

Source of truth:

- SQLite

Human review and operations dashboard:

- Notion

SQLite responsibilities:

- Episode state machine
- Track records
- Prompts
- QC results
- Asset paths
- Render jobs
- Upload records
- Retry counts
- Error logs

Notion responsibilities:

- Human-readable planning dashboard
- Review package link
- Approval status
- Thumbnail preview
- Metadata preview
- Publish schedule
- Performance notes

Approval states:

- Pending
- Approved
- Regenerate

MVP does not need granular edit requests. If `Regenerate` is selected, regenerate the whole episode.

## 10. Episode Status Flow

Suggested statuses:

1. `planned`
2. `music_generating`
3. `music_ready`
4. `audio_qc_failed`
5. `audio_ready`
6. `images_generating`
7. `images_ready`
8. `rendering`
9. `needs_approval`
10. `approved`
11. `regenerate_requested`
12. `uploading`
13. `uploaded`
14. `scheduled`
15. `failed`

MVP stops at:

- `needs_approval`

Later phases continue through:

- `approved`
- `uploading`
- `scheduled`

## 11. Review Package

The manual single-episode MVP should output a review package containing:

- Final video path
- Final thumbnail path
- 60-second preview path
- Combined audio path
- Track list
- Track durations
- QC report
- Title
- Description
- Chapters
- Tags
- Prompts used
- Notion page URL, if Notion sync is configured

## 12. Technical Stack

Primary stack:

- Node.js >= 22
- TypeScript
- SQLite
- FFmpeg / ffprobe
- HyperFrames
- Notion API
- OpenAI API
- MiniMax API
- YouTube Data API in later phase

Recommended packages:

- `typescript`
- `tsx`
- `zod`
- `dotenv`
- `better-sqlite3`
- `openai`
- `@notionhq/client`
- `googleapis`
- `execa`
- `pino`

## 13. CLI Design

MVP should be a CLI-first tool.

Suggested commands:

```bash
npm run episode:create -- --series lunar-night-shift --subtitle "Quiet Moonbase Systems"
npm run episode:generate -- --episode-id 2026-05-04-lunar-night-shift
npm run episode:render -- --episode-id 2026-05-04-lunar-night-shift
npm run youtube:package -- --episode-id 2026-05-04-lunar-night-shift --video-path video/renders/lunar-night-shift-final.mp4
npm run episode:approve -- --episode-id 2026-05-04-lunar-night-shift --reviewer "pooh7"
npm run youtube:upload-check -- --episode-id 2026-05-04-lunar-night-shift
npm run notion:sync -- --episode-id 2026-05-04-lunar-night-shift
npm run youtube:upload -- --episode-id 2026-05-04-lunar-night-shift --dry-run
npm run episode:sync-notion -- --episode-id 2026-05-04-lunar-night-shift
npm run episode:run -- --series lunar-night-shift --subtitle "Quiet Moonbase Systems"
```

Later commands:

```bash
npm run youtube:auth-url
npm run youtube:exchange-code -- --code "PASTE_CODE_HERE" --write-env
npm run episode:upload -- --episode-id 2026-05-04-lunar-night-shift
npm run approvals:poll
npm run scheduler:daily
```

## 14. API Credentials Needed

Required for single-episode MVP:

- MiniMax API key
- OpenAI API key
- Notion API key
- Notion database ID

Required after MVP:

- YouTube OAuth client ID
- YouTube OAuth client secret
- YouTube refresh token
- YouTube channel ID

Local `.env` shape:

```env
MINIMAX_API_KEY=
MINIMAX_GROUP_ID=
OPENAI_API_KEY=
NOTION_API_KEY=
NOTION_DATABASE_ID=
YOUTUBE_CLIENT_ID=
YOUTUBE_CLIENT_SECRET=
YOUTUBE_REFRESH_TOKEN=
YOUTUBE_CHANNEL_ID=
YOUTUBE_REDIRECT_URI=http://localhost:53682/oauth2callback
```

## 15. Cost and Failure Guardrails

Daily and per-episode limits:

- Maximum 22 music generations per episode
- Maximum 2 retries per track
- Maximum 4 image generations per episode
- Maximum 2 render attempts per episode
- Fail if final duration is below 55 minutes or above 65 minutes
- Stop pipeline after 3 critical step failures
- Never upload if QC failed
- Never upload without human approval

## 16. Upload Strategy

Later phase upload behavior:

- Upload as private
- Set scheduled publish time to 21:00 Taiwan time
- Keep at least 24 hours between generation and public release
- Maintain a 3-7 day content buffer once daily automation starts

MVP does not include automatic upload.

## 17. MVP Milestones

### Milestone 1: Project Scaffold

- Initialize Node.js + TypeScript project
- Add env loading
- Add config validation
- Add logger
- Add basic CLI structure
- Add SQLite migration setup

### Milestone 2: Data Model

- Create SQLite schema
- Add episode repository
- Add track repository
- Add asset repository
- Add QC result repository

### Milestone 3: Planning Engine

- Define series configs
- Generate episode plan
- Generate track prompts
- Generate metadata draft
- Save plan to SQLite

### Milestone 4: MiniMax Music Provider

- Implement `MusicProvider`
- Generate instrumental tracks
- Download output URLs immediately
- Store files locally
- Save provider metadata

### Milestone 5: Audio Pipeline

- Probe durations with ffprobe
- Run minimum QC
- Normalize and combine tracks
- Add crossfades
- Export final 60-minute audio
- Export 60-second preview

### Milestone 6: Image Pipeline

- Implement `ImageProvider`
- Generate hero image
- Generate thumbnail base
- Render thumbnail text programmatically
- Store asset metadata

### Milestone 7: HyperFrames Render

- Create minimal ambient composition
- Use hero image as animated background
- Add intro title animation
- Add chapter title fades
- Render final MP4

### Milestone 8: Notion Sync

- Create/update episode page
- Attach review package details
- Add approval fields
- Sync current status
- Store final video path, thumbnail path, publish package path, preview path, runtime, title, and episode status
- Support schema inspection and adding missing dashboard properties

### Milestone 8A: YouTube Publish Package

- Generate title, description, chapters, tags, pinned comment, and upload checklist
- Link final MP4, thumbnail, final audio, and preview audio
- Mark the episode as `needs_approval`
- Require human approval before any upload command can run

### Milestone 8B: Approval Gate

- Record manual approve/regenerate decisions in SQLite
- Validate required local files before approval
- Mark approved episodes as `approved`
- Block upload checks unless an episode is `approved`

### Milestone 9: End-to-End MVP

- Implement `episode:run`
- Produce complete review package for Lunar Night Shift / Quiet Moonbase Systems
- Stop at `needs_approval`

### Milestone 10: Private YouTube Upload

- Generate Google OAuth URL
- Exchange OAuth code for refresh token
- Require `approved` before upload
- Upload final MP4 with metadata as private
- Set custom thumbnail
- Save YouTube video ID and URL in SQLite

## 18. Out of Scope for First MVP

- Fully automatic daily scheduler
- Notion approval polling
- YouTube upload
- YouTube scheduling
- Monetization setup
- End screens and cards
- Vocal detection
- Similarity detection
- Advanced dashboard
- Cloud deployment
- Multi-provider fallback

## 19. Main Risks

MiniMax output length and quality:

- Tracks may be shorter or less consistent than expected.
- Mitigation: generate 15-20 tracks with guardrails and total duration checks.

Generated music may include unwanted vocals:

- MVP uses instrumental-only settings but does not detect vocals.
- Mitigation: final human review.

One-hour render time may be slow:

- HyperFrames and FFmpeg rendering may take significant time on Windows.
- Mitigation: minimal animation design.

Thumbnail quality may vary:

- Image generation may produce inconsistent framing.
- Mitigation: fixed series templates and programmatic text layout.

API cost overrun:

- Mitigation: strict per-episode generation limits and retry caps.

YouTube policy risk:

- Fully automated AI music channels can look low-effort if repetitive.
- Mitigation: strong series identity, human approval, metadata quality, and content history tracking.

## 20. Next Step

Start implementation with Milestone 1 and Milestone 2:

1. Initialize the TypeScript project.
2. Add environment configuration.
3. Add SQLite schema.
4. Add the first CLI command: `episode:create`.
5. Seed the three series configs.
