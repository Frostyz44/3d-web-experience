import { AnimationWeights, AnimationTimes } from "../character/AnimationMixer";
import { AnimationState, CharacterState } from "../character/CharacterState";
import { AnimationConfig } from "../character/types";
import { EulXYZ, Vect3 } from "../math";

export type CharacterDescription =
  | {
      meshFileUrl: string;
      mmlCharacterString?: null;
      mmlCharacterUrl?: null;
    }
  | {
      meshFileUrl?: null;
      mmlCharacterString: string;
      mmlCharacterUrl?: null;
    }
  | {
      meshFileUrl?: null;
      mmlCharacterString?: null;
      mmlCharacterUrl: string;
    };

export type CameraTransform = {
  position: Vect3;
  rotation: {
    x: number;
    y: number;
    z: number;
  };
  fov: number;
};

export type CharacterRenderState = {
  id: number;
  position: Vect3;
  rotation: EulXYZ;
  animationState: AnimationState;
  animationWeights: AnimationWeights;
  animationTimes: AnimationTimes;
  username: string;
  characterDescription: CharacterDescription | null;
  colors: Array<[number, number, number]> | null;
  isLocal: boolean;
};

export type RenderState = {
  characters: Map<number, CharacterRenderState>;
  updatedCharacterDescriptions: number[];
  removedConnectionIds: number[];
  cameraTransform: CameraTransform;
  /** null before the local character has spawned. */
  localCharacterId: number | null;
  deltaTimeSeconds: number;
  /** Network-truth map for renderers that drive their own remote-character pipeline. */
  remoteUserStates?: ReadonlyMap<number, CharacterState>;
  /** Stable identity-resolver callback; safe to pointer-compare across frames. */
  getRemoteCharacterInfo?: (id: number) => {
    userId: string;
    username: string | null;
    characterDescription: CharacterDescription | null;
    colors: Array<[number, number, number]> | null;
  };
};

/** A linear RGB colour with channels from 0 to 1. */
export type EnvironmentColor = {
  r: number;
  g: number;
  b: number;
};

/** Rendering quality tier. "auto" picks one from the device and steps down if frames are slow. */
export type QualityTierSetting = "auto" | "high" | "medium" | "low";

/**
 * Environment settings (sky, sun, fog, lighting, post-processing, quality).
 *
 * Every field is optional. Defaults are listed on each field and in `ENVIRONMENT_DEFAULTS`
 * (`rendering/EnvironmentSettings.ts`).
 */
export type EnvironmentConfiguration = {
  /** Show the checkerboard ground plane. Default true. */
  groundPlane?: boolean;
  /** An HDR skybox. When set it replaces the procedural sky and lights the scene. */
  skybox?: {
    intensity?: number;
    blurriness?: number;
    azimuthalAngle?: number;
    polarAngle?: number;
  } & (
    | {
        hdrJpgUrl: string;
      }
    | {
        hdrUrl: string;
      }
  );
  /** Image-based lighting from the sky or skybox. Default intensity 0.6. */
  envMap?: {
    intensity?: number;
  };
  /**
   * The sun (directional light with shadows). Angles are in degrees. polarAngle is measured from straight
   * up (0 = overhead, 90 = on the horizon). Ignored for position when `timeOfDay` is set.
   */
  sun?: {
    /** Default 2.6. */
    intensity?: number;
    /** Default 50 (40 degrees above the horizon). */
    polarAngle?: number;
    /** Default 30 (behind and to the right of a player facing -z at spawn). */
    azimuthalAngle?: number;
    /** Sun light colour. Default {r: 1, g: 0.96, b: 0.9}. With `timeOfDay` it is warmed near the horizon. */
    color?: EnvironmentColor;
  };
  /** The procedural sky, used when no `skybox` is set. */
  sky?: {
    /** Haze. Default 2.5. */
    turbidity?: number;
    /** Blue scattering. Default 1.2. */
    rayleigh?: number;
    /** Default 0.005. */
    mieCoefficient?: number;
    /** Size of the glow around the sun, 0 to 0.999. Default 0.8. */
    mieDirectionalG?: number;
    /** Sky brightness multiplier. Default 0.45. */
    exposure?: number;
    /** Colour of the night sky (when the sun is below the horizon). Default {r: 0.012, g: 0.02, b: 0.05}. */
    nightColor?: EnvironmentColor;
    /** Star brightness at night, 0 disables stars. Default 1. */
    stars?: number;
    /** Degrees above the horizon over which the sky blends into the fog colour. Default 8. */
    horizonBlend?: number;
  };
  /**
   * Time of day. When set, the hour moves the sun (and a moon at night) and adjusts sun colour, ambient light,
   * fog colour, exposure and bloom.
   */
  timeOfDay?: {
    /** Hour, 0 to 24 (6 = sunrise, 12 = noon, 18 = sunset). */
    hour: number;
    /** Real minutes per in-world day. 0 (default) keeps the hour fixed. */
    cycleMinutes?: number;
    /** Compass direction (degrees) of the sun at noon, same convention as sun.azimuthalAngle. Default 20. */
    azimuthalAngle?: number;
    /** Sun elevation at noon in degrees. Default 55. */
    maxElevation?: number;
  };
  fog?: {
    /** Linear fog start distance. Default 30. */
    fogNear?: number;
    /** Linear fog end distance. 0 disables fog. Default 210. */
    fogFar?: number;
    /** Fog colour. When omitted with the procedural sky, the fog follows the sky's horizon colour. */
    fogColor?: EnvironmentColor;
  };
  postProcessing?: {
    /** Deprecated alias of `bloom.intensity`. */
    bloomIntensity?: number;
    bloom?: {
      /**
       * "emissive" (default): only emissive surfaces and additive particles glow, by how bright they are.
       * "luminance": anything brighter than `threshold` in the rendered image glows (classic bloom).
       */
      mode?: "emissive" | "luminance";
      /** Default 1.8. */
      intensity?: number;
      /** Brightness (linear) below which nothing blooms. Default 0.05 (emissive) / 1.2 (luminance). */
      threshold?: number;
      /** Softness of the threshold. Default 0.3. */
      smoothing?: number;
      /** Spread of the glow, 0 to 1. Default 0.7. */
      radius?: number;
    };
    /** "aces" (default), "agx", "neutral", "reinhard", "cineon" or "linear". */
    toneMapping?: "aces" | "agx" | "neutral" | "reinhard" | "cineon" | "linear";
    /** Tone mapping exposure. Default 1. */
    exposure?: number;
    /** Screen-space ambient occlusion intensity (only on tiers with SSAO). Default 1. */
    ambientOcclusion?: number;
    /** Film grain amount. Default 0.02. */
    grain?: number;
  };
  /**
   * Ambient light. Rendered as a hemisphere light (sky colour from above, ground colour from below) so
   * shapes keep some definition in shadow.
   */
  ambientLight?: {
    /** Default 0.6. */
    intensity?: number;
    /** Light from above. Default {r: 0.75, g: 0.85, b: 1}. */
    color?: EnvironmentColor;
    /** Light from below. Default {r: 0.42, g: 0.38, b: 0.33}. */
    groundColor?: EnvironmentColor;
  };
  /** Sun shadows. The shadow area follows the player. Resolution and distance come from the quality tier. */
  shadows?: {
    /** Default true. */
    enabled?: boolean;
    /** Half the width (metres) of the shadowed area around the player. Default from the quality tier. */
    distance?: number;
    /** Blur radius of shadow edges in shadow-map texels. Default 2.5. */
    softness?: number;
    /** Shadow darkness, 0 to 1. Default 1. */
    intensity?: number;
  };
  quality?: {
    /** Default "auto". The URL parameter `?quality=low|medium|high` overrides it for testing. */
    tier?: QualityTierSetting;
    /** With tier "auto", step down a tier when frames are consistently slow. Default true. */
    adaptive?: boolean;
    /** Upper limit for the device pixel ratio, on top of the tier's own limit. */
    maxPixelRatio?: number;
  };
};

export type MMLDocumentConfiguration = {
  url: string;
  position?: {
    x: number;
    y: number;
    z: number;
  };
  rotation?: {
    x: number;
    y: number;
    z: number;
  };
  scale?: {
    x: number;
    y: number;
    z: number;
  };
  passAuthToken?: boolean;
};

export interface IRenderer {
  /**
   * Render a frame with the complete game state
   */
  render(state: RenderState): void;

  /**
   * Resize the renderer to fit its container
   */
  fitContainer(): void;

  /**
   * Clean up and dispose of all resources
   */
  dispose(): void;

  /**
   * Add a chat bubble to a character
   */
  addChatBubble(characterId: number, message: string): void;

  /**
   * Set MML documents configuration and auth token
   */
  setMMLConfiguration(
    mmlDocuments: { [key: string]: MMLDocumentConfiguration },
    authToken: string | null,
  ): void;

  /**
   * Handle chat message for MML chat probes
   */
  onChatMessage(message: string): void;

  /**
   * Update renderer configuration
   */
  updateConfig(config: Partial<RendererConfig>): void;
}

export type RendererConfig = {
  animationConfig: AnimationConfig;
  environmentConfiguration?: EnvironmentConfiguration;
  postProcessingEnabled?: boolean;
  spawnSun?: boolean;
  enableTweakPane?: boolean;
};
