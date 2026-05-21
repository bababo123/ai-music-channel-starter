import type { SeriesConfig } from "./series";

export type TrackPlan = {
  index: number;
  title: string;
  role: string;
  durationTargetSeconds: number;
  prompt: string;
};

export type EpisodePlan = {
  seriesId: string;
  seriesName: string;
  subtitle: string;
  title: string;
  thumbnailText: string;
  trackCount: number;
  totalTargetSeconds: number;
  tracks: TrackPlan[];
  metadata: {
    description: string;
    tags: string[];
    chapters: string;
    pinnedComment: string;
  };
  visualPrompt: string;
  thumbnailPrompt: string;
};

const trackRoles = [
  "opening_hook",
  "focus_ramp",
  "stable_focus",
  "stable_focus",
  "deep_work",
  "deep_work",
  "sustain",
  "sustain",
  "reset",
  "stable_focus",
  "deep_work",
  "deep_work",
  "final_push",
  "final_push",
  "cooldown",
  "cooldown",
  "closing_drift",
  "closing_fade"
];

const focusListeningRules = [
  "Quiet background work listening, not foreground entertainment.",
  "Restrained lo-fi hip hop influence: soft dusty drums, relaxed swing, warm chords, muted bass, and a simple mellow motif are allowed.",
  "Beat stays low-volume, slow, soft-edged, and supportive.",
  "No strong beat, bass drop, trap hi-hats, sharp snare, busy percussion, loud kick, dance groove, alarms, impacts, risers, trailer hits, pings, beeps, chimes, bells, tonal clicks, or bright digital tones.",
  "Avoid loud or bright repeating motifs.",
  "Keep dynamics restrained, high end soft, and volume steady."
];

const subtleEmotionalBuildRules = [
  "Very slow understated emotional build across several minutes.",
  "Build through pad layering, harmonic warmth, tiny texture changes, and a soft lo-fi groove that settles in.",
  "A small memorable melody is good if warm, sparse, low-contrast, and never a solo.",
  "No climax, drop, loud beat, flashy lead, or trailer arc."
];

export function buildEpisodePlan(series: SeriesConfig, subtitle: string): EpisodePlan {
  const title = buildTitle(series, subtitle);
  const durationPerTrack = 200;
  const tracks = trackRoles.map((role, index) => {
    const trackIndex = index + 1;
    const trackTitle = series.trackTitles[index] ?? `${series.name} ${trackIndex}`;

    return {
      index: trackIndex,
      title: trackTitle,
      role,
      durationTargetSeconds: durationPerTrack,
      prompt: buildTrackPrompt(series, trackTitle, role, durationPerTrack, trackIndex)
    };
  });

  return {
    seriesId: series.id,
    seriesName: series.name,
    subtitle,
    title,
    thumbnailText: series.thumbnailText,
    trackCount: tracks.length,
    totalTargetSeconds: tracks.reduce((total, track) => total + track.durationTargetSeconds, 0),
    tracks,
    metadata: {
      description: buildDescription(series, subtitle, tracks),
      tags: buildTags(series),
      chapters: buildChapters(tracks),
      pinnedComment: `What did you work on during ${subtitle}?`
    },
    visualPrompt: buildVisualPrompt(series, subtitle),
    thumbnailPrompt: buildThumbnailPrompt(series, subtitle)
  };
}

function buildTitle(series: SeriesConfig, subtitle: string) {
  if (series.titleTemplate) {
    return series.titleTemplate.replaceAll("{series}", series.name).replaceAll("{subtitle}", subtitle);
  }

  return `${subtitle} | 1 Hour ${series.name} Music for Deep Work, Coding & Focus`;
}

function buildTrackPrompt(
  series: SeriesConfig,
  trackTitle: string,
  role: string,
  durationSeconds: number,
  trackIndex: number
) {
  return [
    `${series.name}: "${trackTitle}" as track ${trackIndex} in a one-hour quiet lo-fi ambient background mix for coding and deep work.`,
    `Role: ${role.replace(/_/g, " ")}.`,
    `Approximate duration can be several minutes; longer is acceptable if the texture stays calm and useful for focus.`,
    `Instrumental only, no vocals, no lyrics, no spoken words.`,
    `Atmosphere: ${series.metadataTone.adjectives.join(", ")}.`,
    `Texture palette: ${series.soundBrand.musicLanguage.join(", ")}.`,
    `Focus rules: ${focusListeningRules.join(" ")}`,
    `Emotional build: ${subtleEmotionalBuildRules.join(" ")}`,
    `Feel: calm ambient space with a tasteful lo-fi hip hop undercurrent for low-volume coding.`,
    `Fade in gently; if rhythm appears, let it enter softly, not as a hook.`
  ]
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildDescription(series: SeriesConfig, subtitle: string, tracks: TrackPlan[]) {
  const intro =
    subtitle.trim().toLowerCase() === series.name.trim().toLowerCase()
      ? `${series.name} is a one-hour space lofi session built for ${series.metadataTone.useCases
          .slice(0, 3)
          .join(", ")}.`
      : `${subtitle} is a one-hour ${series.name} session built for ${series.metadataTone.useCases
          .slice(0, 3)
          .join(", ")}.`;

  return [
    intro,
    `The mix stays ${series.metadataTone.adjectives
      .slice(0, 4)
      .join(", ")} with a cinematic ambient tone for long focus blocks.`,
    "",
    "Chapters:",
    buildChapters(tracks),
    "",
    "#deepwork #codingmusic #ambientmusic #focusmusic"
  ].join("\n");
}

function buildTags(series: SeriesConfig) {
  return uniqueStrings([
    series.name,
    "deep work music",
    "coding music",
    "focus music",
    "ambient music",
    "cinematic ambient",
    "study music",
    ...series.metadataTone.useCases.map((useCase) => `${useCase} music`)
  ]);
}

function uniqueStrings(values: string[]) {
  return [...new Set(values)];
}

function buildChapters(tracks: TrackPlan[]) {
  let elapsed = 0;

  return tracks
    .map((track) => {
      const chapter = `${formatTimestamp(elapsed)} ${track.title}`;
      elapsed += track.durationTargetSeconds;
      return chapter;
    })
    .join("\n");
}

function formatTimestamp(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours.toString().padStart(2, "0")}:${minutes
      .toString()
      .padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }

  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

function buildVisualPrompt(series: SeriesConfig, subtitle: string) {
  return [
    `Create a 16:9 cinematic ambient background for "${subtitle}" in the ${series.name} series.`,
    `Composition: ${series.visualTemplate.composition.join(", ")}.`,
    `Palette: ${series.visualTemplate.palette.join(", ")}.`,
    `Avoid: ${series.visualTemplate.avoid.join(", ")}.`,
    "No text, no logos, no people looking at camera. Leave clean negative space for motion and cropping."
  ].join(" ");
}

function buildThumbnailPrompt(series: SeriesConfig, subtitle: string) {
  return [
    `Create a high-contrast 16:9 YouTube thumbnail background for "${subtitle}" in the ${series.name} series.`,
    `Use the same visual identity: ${series.visualTemplate.composition.join(", ")}.`,
    `Leave strong readable negative space for large programmed text: ${series.thumbnailText}.`,
    `Avoid generated text and avoid clutter: ${series.visualTemplate.avoid.join(", ")}.`
  ].join(" ");
}
