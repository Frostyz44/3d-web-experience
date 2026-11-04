import type { EnvironmentColor, EnvironmentConfiguration, QualityTierSetting } from "./IRenderer";

/**
 * Renderer-independent environment logic: defaults, quality tiers and time of day. Kept free of any
 * rendering library so it can be unit tested and shared by renderers.
 */

export type QualityTier = "high" | "medium" | "low";

export const QUALITY_TIERS: ReadonlyArray<QualityTier> = ["low", "medium", "high"];

/** What each quality tier controls. */
export type QualitySettings = {
  tier: QualityTier;
  /** Upper limit for the renderer pixel ratio. */
  maxPixelRatio: number;
  /** Multisampled anti-aliasing on the canvas (only used when post-processing is off). */
  antialias: boolean;
  ssao: { enabled: boolean; halfRes: boolean; aoSamples: number; denoiseSamples: number };
  shadows: {
    mapSize: number;
    distance: number;
    /**
     * How many shadow-casting point/spot lights (from MML content) update their shadows every frame, nearest
     * first. Each point light shadow re-renders the scene six times, so the others only refresh in turns.
     */
    localLights: number;
  };
  /** Bloom source resolution relative to the screen, and number of blur mip levels. */
  bloom: { resolutionScale: number; levels: number };
  /** Size (pixels per cube face) of the environment map made from the procedural sky. */
  envMapSize: number;
  /** Film grain costs little but is invisible on small screens. */
  grain: boolean;
};

export const QUALITY_PRESETS: Readonly<Record<QualityTier, QualitySettings>> = {
  high: {
    tier: "high",
    maxPixelRatio: 2,
    antialias: true,
    ssao: { enabled: true, halfRes: false, aoSamples: 16, denoiseSamples: 8 },
    shadows: { mapSize: 4096, distance: 40, localLights: 2 },
    bloom: { resolutionScale: 0.5, levels: 8 },
    envMapSize: 256,
    grain: true,
  },
  medium: {
    tier: "medium",
    maxPixelRatio: 1.5,
    antialias: true,
    ssao: { enabled: true, halfRes: true, aoSamples: 8, denoiseSamples: 4 },
    shadows: { mapSize: 2048, distance: 30, localLights: 1 },
    bloom: { resolutionScale: 0.5, levels: 6 },
    envMapSize: 128,
    grain: true,
  },
  low: {
    tier: "low",
    maxPixelRatio: 1,
    antialias: false,
    ssao: { enabled: false, halfRes: true, aoSamples: 4, denoiseSamples: 4 },
    shadows: { mapSize: 1024, distance: 22, localLights: 0 },
    bloom: { resolutionScale: 0.25, levels: 5 },
    envMapSize: 64,
    grain: false,
  },
};

/** Device facts used to pick a quality tier. Every field is optional; unknown means "not a constraint". */
export type DeviceInfo = {
  /** WebGL UNMASKED_RENDERER string, e.g. "ANGLE (NVIDIA GeForce RTX 3060 ...)" or "Adreno (TM) 640". */
  gpuRenderer?: string | null;
  userAgent?: string;
  /** navigator.userAgentData.mobile when available. */
  mobile?: boolean;
  maxTouchPoints?: number;
  hardwareConcurrency?: number;
  /** navigator.deviceMemory in GB (Chromium only). */
  deviceMemory?: number;
  screenWidth?: number;
  screenHeight?: number;
  devicePixelRatio?: number;
};

const SOFTWARE_GPU = /swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/i;
const MOBILE_UA = /android|iphone|ipad|ipod|mobile|silk|kindle|opera mini/i;
// Phone and tablet GPUs that comfortably run the medium tier.
const STRONG_MOBILE_GPU =
  /apple (m\d|a1[5-9])|apple gpu|adreno \(tm\) (7[3-9]\d|8\d\d)|adreno (7[3-9]\d|8\d\d)|mali-g(7[1-9]|[89]\d|\d{3})|immortalis|xclipse/i;
const WEAK_DESKTOP_GPU =
  /intel.*(hd graphics|uhd graphics [56]\d\d|iris\(tm\) graphics [56]\d\d)|mali|adreno|powervr|videocore/i;

export function isMobileDevice(info: DeviceInfo): boolean {
  if (info.mobile !== undefined) {
    return info.mobile;
  }
  if (info.userAgent && MOBILE_UA.test(info.userAgent)) {
    return true;
  }
  // iPadOS reports a desktop user agent but has touch points
  if (info.userAgent && /macintosh/i.test(info.userAgent) && (info.maxTouchPoints ?? 0) > 1) {
    return true;
  }
  return false;
}

/** Picks a starting quality tier for a device. */
export function detectQualityTier(info: DeviceInfo): QualityTier {
  const gpu = info.gpuRenderer ?? "";
  if (SOFTWARE_GPU.test(gpu)) {
    return "low";
  }
  const lowMemory = info.deviceMemory !== undefined && info.deviceMemory <= 2;
  const fewCores = info.hardwareConcurrency !== undefined && info.hardwareConcurrency <= 2;
  if (lowMemory || fewCores) {
    return "low";
  }
  if (isMobileDevice(info)) {
    if (
      STRONG_MOBILE_GPU.test(gpu) &&
      (info.deviceMemory === undefined || info.deviceMemory >= 4)
    ) {
      return "medium";
    }
    return "low";
  }
  if (WEAK_DESKTOP_GPU.test(gpu)) {
    return "medium";
  }
  if (info.deviceMemory !== undefined && info.deviceMemory <= 4) {
    return "medium";
  }
  return "high";
}

/** Parses "low" | "medium" | "high" | "auto" (case-insensitive), or returns null. */
export function parseQualityTier(value: unknown): QualityTierSetting | null {
  if (typeof value !== "string") {
    return null;
  }
  const lower = value.trim().toLowerCase();
  if (lower === "low" || lower === "medium" || lower === "high" || lower === "auto") {
    return lower;
  }
  return null;
}

export function lowerQualityTier(tier: QualityTier): QualityTier | null {
  const index = QUALITY_TIERS.indexOf(tier);
  return index > 0 ? QUALITY_TIERS[index - 1] : null;
}

/** The settings for a tier, with the configuration's own limits applied. */
export function resolveQualitySettings(
  tier: QualityTier,
  config?: EnvironmentConfiguration["quality"],
): QualitySettings {
  const preset = QUALITY_PRESETS[tier];
  const settings: QualitySettings = {
    ...preset,
    ssao: { ...preset.ssao },
    shadows: { ...preset.shadows },
    bloom: { ...preset.bloom },
  };
  if (typeof config?.maxPixelRatio === "number" && config.maxPixelRatio > 0) {
    settings.maxPixelRatio = Math.min(settings.maxPixelRatio, config.maxPixelRatio);
  }
  return settings;
}

/**
 * Watches frame times and asks for a lower quality tier when frames stay slow. Each decision needs a full
 * window of samples, and the first seconds after a change are ignored (shader compiles and loading cause
 * spikes that are not representative).
 */
export class AdaptiveQualityMonitor {
  private samples: number[] = [];
  private ignoreUntilSeconds: number;
  private elapsedSeconds = 0;

  constructor(
    private readonly options: {
      /** Frames slower than this (ms, median over the window) trigger a step down. Default 26 (~38 fps). */
      slowFrameMs?: number;
      /** Seconds of frames per decision. Default 4. */
      windowSeconds?: number;
      /** Seconds to ignore at start and after a change. Default 6. */
      settleSeconds?: number;
    } = {},
  ) {
    this.ignoreUntilSeconds = this.settleSeconds;
  }

  private get slowFrameMs() {
    return this.options.slowFrameMs ?? 26;
  }
  private get windowSeconds() {
    return this.options.windowSeconds ?? 4;
  }
  private get settleSeconds() {
    return this.options.settleSeconds ?? 6;
  }

  /** Call after a tier change so the new tier gets a fresh evaluation. */
  public reset(): void {
    this.samples = [];
    this.ignoreUntilSeconds = this.elapsedSeconds + this.settleSeconds;
  }

  /**
   * Records one frame. Returns true when the recent frames were slow enough that the tier should drop.
   * Hidden-tab pauses (frames over 250 ms) are ignored.
   */
  public addFrame(deltaSeconds: number): boolean {
    if (!(deltaSeconds > 0) || deltaSeconds > 0.25) {
      return false;
    }
    this.elapsedSeconds += deltaSeconds;
    if (this.elapsedSeconds < this.ignoreUntilSeconds) {
      return false;
    }
    this.samples.push(deltaSeconds * 1000);
    const total = this.samples.reduce((sum, ms) => sum + ms, 0);
    if (total < this.windowSeconds * 1000) {
      return false;
    }
    const sorted = [...this.samples].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    this.samples = [];
    return median > this.slowFrameMs;
  }
}

/* ------------------------------------------------------------------------------------------------ */
/* Time of day                                                                                       */
/* ------------------------------------------------------------------------------------------------ */

export type TimeOfDayLighting = {
  /** Hour after wrapping into [0, 24). */
  hour: number;
  /** Sun elevation above the horizon in degrees (negative at night). */
  sunElevation: number;
  /** Direction of the directional light (sun by day, moon by night) as polar/azimuthal degrees. */
  lightPolarAngle: number;
  lightAzimuthalAngle: number;
  /** Sun position for the sky shader (it may be below the horizon). */
  sunPolarAngle: number;
  sunAzimuthalAngle: number;
  /** Multiplier for the configured sun intensity, and the light colour. */
  lightIntensityScale: number;
  lightColor: EnvironmentColor;
  /** 1 by day, 0 at night, smooth through twilight. */
  daylight: number;
  /** Multiplier for the ambient (hemisphere) light. */
  ambientScale: number;
  /** Sky and ground colours for the hemisphere light. */
  ambientSkyColor: EnvironmentColor;
  ambientGroundColor: EnvironmentColor;
  /** Fog / horizon colour. */
  fogColor: EnvironmentColor;
  /** Multipliers for exposure and bloom. Night is brightened a little and glow is stronger. */
  exposureScale: number;
  bloomScale: number;
  /** 0 to 1 star visibility. */
  stars: number;
};

function clamp01(x: number) {
  return Math.min(1, Math.max(0, x));
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function mix(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

export function mixColor(a: EnvironmentColor, b: EnvironmentColor, t: number): EnvironmentColor {
  return { r: mix(a.r, b.r, t), g: mix(a.g, b.g, t), b: mix(a.b, b.b, t) };
}

export function wrapHour(hour: number): number {
  return ((hour % 24) + 24) % 24;
}

const DAY_FOG: EnvironmentColor = { r: 0.42, g: 0.5, b: 0.62 };
const SUNSET_FOG: EnvironmentColor = { r: 0.55, g: 0.36, b: 0.25 };
const NIGHT_FOG: EnvironmentColor = { r: 0.012, g: 0.017, b: 0.035 };
const NOON_LIGHT: EnvironmentColor = { r: 1.0, g: 0.96, b: 0.9 };
const LOW_SUN_LIGHT: EnvironmentColor = { r: 1.0, g: 0.58, b: 0.32 };
const MOON_LIGHT: EnvironmentColor = { r: 0.6, g: 0.7, b: 1.0 };
const DAY_AMBIENT_SKY: EnvironmentColor = { r: 0.75, g: 0.85, b: 1.0 };
const NIGHT_AMBIENT_SKY: EnvironmentColor = { r: 0.35, g: 0.45, b: 0.8 };
const DAY_AMBIENT_GROUND: EnvironmentColor = { r: 0.42, g: 0.38, b: 0.33 };
const NIGHT_AMBIENT_GROUND: EnvironmentColor = { r: 0.1, g: 0.1, b: 0.14 };

/** Moonlight intensity relative to the configured sun intensity. */
export const MOON_INTENSITY_SCALE = 0.1;

/**
 * Lighting for an hour of the day. The sun rises at 6, peaks at `maxElevation` at 12 in direction
 * `azimuthalAngle`, and sets at 18. At night a dim, cool moon on the opposite side lights the scene so
 * shadows stay readable.
 */
export function computeTimeOfDay(
  hourInput: number,
  options: { azimuthalAngle?: number; maxElevation?: number } = {},
): TimeOfDayLighting {
  const hour = wrapHour(hourInput);
  const noonAzimuth = options.azimuthalAngle ?? 20;
  const maxElevation = Math.min(89, Math.max(5, options.maxElevation ?? 55));

  // Elevation follows a sine through the day: 0 at 6 and 18, max at 12, -max at 0.
  const dayAngle = ((hour - 6) / 12) * Math.PI;
  const sunElevation = maxElevation * Math.sin(dayAngle);
  // The sun sweeps 180 degrees between sunrise and sunset (east -> noon direction -> west).
  const sunAzimuth = noonAzimuth + ((hour - 12) / 12) * 180;

  const daylight = smoothstep(-6, 8, sunElevation);
  const sunUp = smoothstep(-1, 12, sunElevation);
  const moonUp = 1 - smoothstep(-8, 1, sunElevation);

  // The moon mirrors the sun but stays reasonably high so its shadows are not endless.
  const moonElevation = Math.max(25, Math.min(maxElevation, -sunElevation));
  const useSun = sunElevation > -1;

  const lightElevation = useSun ? Math.max(sunElevation, 2) : moonElevation;
  const lightAzimuth = useSun ? sunAzimuth : sunAzimuth + 180;
  const warmth = 1 - smoothstep(4, 35, sunElevation);
  const lightColor = useSun ? mixColor(NOON_LIGHT, LOW_SUN_LIGHT, warmth) : MOON_LIGHT;
  const lightIntensityScale = useSun ? sunUp : moonUp * MOON_INTENSITY_SCALE;

  // Fog: daylight colour, warm band around sunrise/sunset, dark blue at night.
  const sunsetAmount =
    (1 - smoothstep(0, 14, Math.abs(sunElevation))) * smoothstep(-8, 0, sunElevation);
  let fogColor = mixColor(NIGHT_FOG, DAY_FOG, daylight);
  fogColor = mixColor(fogColor, SUNSET_FOG, sunsetAmount * 0.75);

  return {
    hour,
    sunElevation,
    lightPolarAngle: 90 - lightElevation,
    lightAzimuthalAngle: ((lightAzimuth % 360) + 360) % 360,
    sunPolarAngle: 90 - sunElevation,
    sunAzimuthalAngle: ((sunAzimuth % 360) + 360) % 360,
    lightIntensityScale,
    lightColor,
    daylight,
    ambientScale: mix(0.16, 1, daylight),
    ambientSkyColor: mixColor(NIGHT_AMBIENT_SKY, DAY_AMBIENT_SKY, daylight),
    ambientGroundColor: mixColor(NIGHT_AMBIENT_GROUND, DAY_AMBIENT_GROUND, daylight),
    fogColor,
    exposureScale: mix(1.35, 1, daylight),
    bloomScale: mix(1.25, 1, daylight),
    stars: 1 - smoothstep(-12, -2, sunElevation),
  };
}

/** Advances an hour by elapsed real time for a day cycle of `cycleMinutes` (0 = no change). */
export function advanceHour(hour: number, elapsedSeconds: number, cycleMinutes: number): number {
  if (!(cycleMinutes > 0)) {
    return wrapHour(hour);
  }
  return wrapHour(hour + (elapsedSeconds / (cycleMinutes * 60)) * 24);
}

/** Documented defaults for the options in `EnvironmentConfiguration`. */
export const ENVIRONMENT_DEFAULTS = {
  envMap: { intensity: 0.6 },
  sun: {
    intensity: 2.6,
    polarAngle: 50,
    azimuthalAngle: 30,
    color: NOON_LIGHT,
  },
  sky: {
    turbidity: 2.5,
    rayleigh: 1.2,
    mieCoefficient: 0.005,
    mieDirectionalG: 0.8,
    exposure: 0.45,
    nightColor: { r: 0.012, g: 0.02, b: 0.05 },
    stars: 1,
    horizonBlend: 8,
  },
  timeOfDay: { cycleMinutes: 0, azimuthalAngle: 20, maxElevation: 55 },
  fog: { fogNear: 30, fogFar: 210, dayColor: DAY_FOG },
  postProcessing: {
    bloom: {
      mode: "emissive" as const,
      intensity: 1.8,
      emissiveThreshold: 0.05,
      luminanceThreshold: 1.2,
      smoothing: 0.3,
      radius: 0.7,
    },
    toneMapping: "aces" as const,
    exposure: 1,
    ambientOcclusion: 1,
    grain: 0.02,
  },
  ambientLight: {
    intensity: 0.6,
    color: DAY_AMBIENT_SKY,
    groundColor: DAY_AMBIENT_GROUND,
  },
  shadows: { enabled: true, softness: 2.5, intensity: 1 },
  quality: { tier: "auto" as const, adaptive: true },
};

/** The bloom settings that apply, with the deprecated `bloomIntensity` honoured. */
export function resolveBloomSettings(postProcessing: EnvironmentConfiguration["postProcessing"]): {
  mode: "emissive" | "luminance";
  intensity: number;
  threshold: number;
  smoothing: number;
  radius: number;
} {
  const defaults = ENVIRONMENT_DEFAULTS.postProcessing.bloom;
  const bloom = postProcessing?.bloom;
  const mode = bloom?.mode === "luminance" ? "luminance" : "emissive";
  return {
    mode,
    intensity: bloom?.intensity ?? postProcessing?.bloomIntensity ?? defaults.intensity,
    threshold:
      bloom?.threshold ??
      (mode === "luminance" ? defaults.luminanceThreshold : defaults.emissiveThreshold),
    smoothing: bloom?.smoothing ?? defaults.smoothing,
    radius: bloom?.radius ?? defaults.radius,
  };
}
