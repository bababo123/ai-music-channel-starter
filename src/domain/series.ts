export type SeriesConfig = {
  id: string;
  name: string;
  thumbnailText: string;
  soundBrand: {
    signature: string[];
    musicLanguage: string[];
    openingHook: string[];
  };
  visualTemplate: {
    composition: string[];
    palette: string[];
    avoid: string[];
  };
  metadataTone: {
    adjectives: string[];
    useCases: string[];
    titleNouns: string[];
  };
  titleTemplate?: string;
  trackTitles: string[];
};

export const seriesConfigs: SeriesConfig[] = [
  {
    id: "lunar-night-shift",
    name: "Lunar Night Shift",
    thumbnailText: "LUNAR NIGHT SHIFT",
    soundBrand: {
      signature: ["soft lunar radio ping", "distant airlock thump"],
      musicLanguage: [
        "slow low-energy ambient synth beds",
        "soft warm-cold pads with minimal movement",
        "smooth low room resonance",
        "cold air circulation texture kept low in the mix",
        "very gradual harmonic warmth over time",
        "soft lo-fi hip hop undercurrent with muted drums and warm keys"
      ],
      openingHook: [
        "0-3s very soft lunar radio ping, distant and non-startling",
        "3-8s muted airlock thump blended under air circulation",
        "8-15s glassy pad fades in without a lead melody",
        "15-30s settle into an extremely steady background focus bed"
      ]
    },
    visualTemplate: {
      composition: [
        "moonbase night-shift interior",
        "window view toward the lunar horizon or Earth",
        "quiet workstation lighting",
        "negative space reserved for thumbnail typography"
      ],
      palette: ["cold white moonlight", "deep blue-black sky", "muted workstation amber"],
      avoid: ["generated text", "busy astronaut faces", "bright neon city tropes"]
    },
    metadataTone: {
      adjectives: ["quiet", "cold", "isolated", "technical", "late-night"],
      useCases: ["coding", "debugging", "studying", "writing", "deep work"],
      titleNouns: ["Moonbase", "Systems", "Relay", "Orbit", "Oxygen Loop"]
    },
    trackTitles: [
      "Lunar Boot Signal",
      "Quiet Moonbase Systems",
      "Crater Relay",
      "Oxygen Loop",
      "Dark Side Calculations",
      "Habitat Light Cycle",
      "Low Gravity Console",
      "Telemetry Frost",
      "Silent Rover Path",
      "Pressure Door Echo",
      "Mare Imbrium Drift",
      "Night Shift Protocol",
      "Glass Pad Coordinates",
      "Earthrise Monitor",
      "Dust Field Memory",
      "Return Window",
      "Cold Module Sleep",
      "Final Airlock Fade"
    ]
  },
  {
    id: "orbital-systems",
    name: "Orbital Systems",
    thumbnailText: "ORBITAL FOCUS",
    titleTemplate: "{subtitle} | 1 Hour Space Lofi for Coding & Deep Focus",
    soundBrand: {
      signature: ["low spacecraft room tone", "soft instrument-room pulse"],
      musicLanguage: [
        "76-84 BPM light lo-fi coding groove kept low in the mix",
        "muted kick, soft rimshot, dusty closed hats, and relaxed swing",
        "warm synth pads and restrained electric piano chords",
        "deep spacecraft HVAC hum and low mechanical room resonance",
        "subtle non-bright telemetry texture blended as ambience, not a repeating beep",
        "wide cinematic space with no lead melody demanding attention"
      ],
      openingHook: [
        "0-4s low spacecraft room tone, quiet and steady",
        "4-10s soft instrument-room pulse fades in below the pad",
        "10-20s warm synth pad and restrained keys establish the chord bed",
        "20-35s light lo-fi groove enters gently for coding focus"
      ]
    },
    visualTemplate: {
      composition: [
        "colossal orbital station exterior and engineered megastructure scale",
        "clean NASA-like engineering control room with panoramic window",
        "tiny human silhouettes or maintenance craft used only as scale markers",
        "huge empty architecture, white-gray hard-surface modules, service rings, docking arms",
        "negative space reserved for thumbnail typography"
      ],
      palette: [
        "near-black space",
        "graphite shadows",
        "white-gray engineered metal",
        "soft cyan instrument light",
        "muted Earth or planet limb glow"
      ],
      avoid: [
        "generated text",
        "real NASA logos",
        "anime lo-fi room",
        "colorful fantasy nebula",
        "cyberpunk street scenes",
        "busy holographic UI",
        "hero astronaut portrait",
        "space battle or weapons"
      ]
    },
    metadataTone: {
      adjectives: ["vast", "clean", "technical", "weightless", "quiet", "monumental"],
      useCases: ["coding", "deep work", "programming", "study", "systems work"],
      titleNouns: ["Orbital Systems", "Dockyard", "Relay", "Station Window", "Control Room"]
    },
    trackTitles: [
      "Orbital Login",
      "Systems Wake",
      "Docking Array",
      "Telemetry Desk",
      "Quiet Control Room",
      "Station Window",
      "Low Orbit Compile",
      "Service Ring Drift",
      "Maintenance Lights",
      "Dockyard Geometry",
      "Earthshadow Loop",
      "Module Pressure",
      "Cyan Instrument Glow",
      "Long Range Build",
      "Silent Gantry",
      "Outer Ring Focus",
      "Return Vector",
      "Final Systems Idle"
    ]
  },
  {
    id: "deep-space-focus",
    name: "Deep Space Focus",
    thumbnailText: "DEEP SPACE FOCUS",
    soundBrand: {
      signature: ["very soft deep sub swell", "faint telemetry beeps"],
      musicLanguage: [
        "dark cinematic drones",
        "evolving textures",
        "very slow harmonic movement",
        "wide low-frequency ambience without rhythmic pulse",
        "soft muted high end",
        "subtle emotional depth that grows slowly",
        "quiet lo-fi groove blended under the ambient field"
      ],
      openingHook: [
        "0-3s very soft deep sub swell, not a hit or drop",
        "3-10s faint telemetry beeps kept distant and sparse",
        "10-20s widening dark drone with no melodic lead",
        "20-30s settle into weightless background focus"
      ]
    },
    visualTemplate: {
      composition: [
        "starship cabin or observation window",
        "distant planet, nebula, or dark starfield",
        "large negative space",
        "cinematic scale with low contrast"
      ],
      palette: ["near-black space", "dim starfield white", "subtle blue-grey instrument light"],
      avoid: ["busy sci-fi battle scenes", "laser weapons", "crowded cockpit details"]
    },
    metadataTone: {
      adjectives: ["vast", "slow", "weightless", "dark", "cinematic"],
      useCases: ["deep work", "coding", "reading", "thinking", "long focus sessions"],
      titleNouns: ["Orbit", "Signal", "Voyage", "Starfield", "Deep Drift"]
    },
    trackTitles: [
      "Far Signal Wake",
      "Low Orbit Drift",
      "Telemetry Bloom",
      "Dark Star Window",
      "Event Horizon Notes",
      "Gravity Well Focus",
      "Signal Lock",
      "Outer Belt Silence",
      "Sleep Mode Engines",
      "Wideband Memory",
      "Black Nebula Path",
      "Cryo Deck Lights",
      "Long Range Scan",
      "Zero-G Calculations",
      "Starless Corridor",
      "Return Vector",
      "Distant Beacon",
      "Final Transmission"
    ]
  },
  {
    id: "midnight-terminal",
    name: "Midnight Terminal",
    thumbnailText: "MIDNIGHT TERMINAL",
    soundBrand: {
      signature: ["terminal boot tone", "mechanical keyboard texture"],
      musicLanguage: [
        "minimal electronic ambient",
        "slow static synth beds",
        "low analog bass",
        "subtle screen hum",
        "slowly deepening harmonic texture",
        "muted lo-fi coding beat with warm keys"
      ],
      openingHook: [
        "0-3s soft terminal boot tone, quiet and non-startling",
        "3-8s sparse keystroke texture kept low in the mix",
        "8-15s soft arpeggio texture enters without becoming a lead",
        "15-30s settle into a restrained non-rhythmic coding bed"
      ]
    },
    visualTemplate: {
      composition: [
        "cold-light terminal desk",
        "dark screen environment",
        "minimal workstation silhouette",
        "abstract terminal room with readable shape, not readable generated text"
      ],
      palette: ["black", "cool cyan", "dim grey", "low analog green accents"],
      avoid: ["readable fake code", "busy hacker cliches", "bright cyberpunk streets"]
    },
    metadataTone: {
      adjectives: ["minimal", "technical", "quiet", "focused", "late-night"],
      useCases: ["debugging", "coding", "writing", "systems work", "deep focus"],
      titleNouns: ["Terminal", "Console", "Runtime", "Kernel", "Debug Loop"]
    },
    trackTitles: [
      "Boot Tone",
      "Cold Console Light",
      "Runtime Drift",
      "Keyboard Room",
      "Null Pointer Calm",
      "Low Analog Stack",
      "Debug Loop",
      "Midnight Build",
      "Silent Commit",
      "Cursor Pulse",
      "Process Monitor",
      "Blue Screen Glow",
      "Log Tail",
      "Kernel Sleep",
      "Memory Map",
      "Final Compile",
      "Quiet Deployment",
      "Session End"
    ]
  }
];

export function findSeriesConfig(seriesId: string) {
  return seriesConfigs.find((series) => series.id === seriesId);
}
