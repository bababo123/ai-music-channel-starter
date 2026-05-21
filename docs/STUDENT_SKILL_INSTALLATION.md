# Student Skill Installation

This project includes a course helper skill at:

```text
skills/ai-music-channel-coach/
```

The skill is meant to guide students through setup, API configuration, episode production, review, YouTube upload, and performance tracking.

## Recommended Distribution

For private students, distribute two things together:

1. A clean starter repo.
2. The `ai-music-channel-coach` skill.

The repo contains runnable code. The skill teaches the agent how to guide the student through that code.

## Install Option A: Bundled With Starter Repo

Keep the skill folder inside the repo:

```text
skills/ai-music-channel-coach/
```

Then the student can ask Codex:

```text
Use the ai-music-channel-coach skill to help me set up this project.
```

The doctor script can be run from the project root:

```powershell
node skills/ai-music-channel-coach/scripts/project-doctor.mjs
```

## Install Option B: Copy To Codex Skills Folder

Copy the folder:

```text
skills/ai-music-channel-coach/
```

into the student's local Codex skills directory, for example:

```text
C:\Users\<student>\.codex\skills\ai-music-channel-coach\
```

Then restart Codex so the skill list refreshes.

## First Student Prompt

Recommended first prompt:

```text
Use ai-music-channel-coach. I want to set up the AI music channel starter project. Please guide me through the intake and setup checks.
```

## Safety Notes

- Do not paste API keys or OAuth tokens into chat.
- Put secrets in `.env`.
- Use dry-run commands before real API calls or YouTube upload.
- Upload as private by default.
- Use the publish package and approval gate before any real upload.
