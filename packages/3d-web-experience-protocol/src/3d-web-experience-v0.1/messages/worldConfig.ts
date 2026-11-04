import { isRecord } from "./utils";

/**
 * Environment settings (skybox, fog, sun, ambient light, etc.).
 *
 * Structurally compatible with `EnvironmentConfiguration` from
 * `@mml-io/3d-web-client-core`.
 */
export type WorldConfigEnvironment = {
  groundPlane?: boolean;
  skybox?: {
    intensity?: number;
    blurriness?: number;
    azimuthalAngle?: number;
    polarAngle?: number;
  } & ({ hdrJpgUrl: string; hdrUrl?: undefined } | { hdrJpgUrl?: undefined; hdrUrl: string });
  envMap?: {
    intensity?: number;
  };
  sun?: {
    intensity?: number;
    polarAngle?: number;
    azimuthalAngle?: number;
    color?: WorldConfigColor;
  };
  sky?: {
    turbidity?: number;
    rayleigh?: number;
    mieCoefficient?: number;
    mieDirectionalG?: number;
    exposure?: number;
    nightColor?: WorldConfigColor;
    stars?: number;
    horizonBlend?: number;
  };
  timeOfDay?: {
    hour: number;
    cycleMinutes?: number;
    azimuthalAngle?: number;
    maxElevation?: number;
  };
  fog?: {
    fogNear?: number;
    fogFar?: number;
    fogColor?: WorldConfigColor;
  };
  postProcessing?: {
    /** Deprecated alias of `bloom.intensity`. */
    bloomIntensity?: number;
    bloom?: {
      mode?: "emissive" | "luminance";
      intensity?: number;
      threshold?: number;
      smoothing?: number;
      radius?: number;
    };
    toneMapping?: "aces" | "agx" | "neutral" | "reinhard" | "cineon" | "linear";
    exposure?: number;
    ambientOcclusion?: number;
    grain?: number;
  };
  ambientLight?: {
    intensity?: number;
    color?: WorldConfigColor;
    groundColor?: WorldConfigColor;
  };
  shadows?: {
    enabled?: boolean;
    distance?: number;
    softness?: number;
    intensity?: number;
  };
  quality?: {
    tier?: "auto" | "high" | "medium" | "low";
    adaptive?: boolean;
    maxPixelRatio?: number;
  };
};

/** A linear RGB colour, channels 0 to 1. */
export type WorldConfigColor = {
  r: number;
  g: number;
  b: number;
};

/**
 * Spawn position, variance, rotation, and respawn triggers.
 *
 * Structurally compatible with `SpawnConfiguration` from
 * `@mml-io/3d-web-client-core`.
 */
export type WorldConfigSpawn = {
  spawnPosition?: { x?: number; y?: number; z?: number };
  spawnPositionVariance?: { x?: number; y?: number; z?: number };
  spawnYRotation?: number;
  respawnTrigger?: {
    minX?: number;
    maxX?: number;
    minY?: number;
    maxY?: number;
    minZ?: number;
    maxZ?: number;
  };
};

/**
 * A single avatar entry describing one of three avatar source formats.
 *
 * Structurally compatible with `AvatarType` from
 * `@mml-io/3d-web-experience-client`.
 */
export type WorldConfigAvatarType = {
  thumbnailUrl?: string;
  name?: string;
  isDefaultAvatar?: boolean;
} & (
  | { meshFileUrl: string; mmlCharacterString?: null; mmlCharacterUrl?: null }
  | { meshFileUrl?: null; mmlCharacterString: string; mmlCharacterUrl?: null }
  | { meshFileUrl?: null; mmlCharacterString?: null; mmlCharacterUrl: string }
);

/**
 * Available avatars and custom avatar policy.
 *
 * Structurally compatible with `AvatarConfiguration` from
 * `@mml-io/3d-web-experience-client`.
 */
export type WorldConfigAvatar = {
  availableAvatars: Array<WorldConfigAvatarType>;
  allowCustomAvatars?: boolean;
};

/**
 * The shape of the world config payload sent via `FROM_SERVER_WORLD_CONFIG_MESSAGE_TYPE`.
 *
 * Defined in `@mml-io/3d-web-experience-protocol`. On the client side this
 * corresponds to the `UpdatableConfig` type from `@mml-io/3d-web-experience-client`
 * which uses the full concrete types from `@mml-io/3d-web-client-core`.
 */
export type WorldConfigPayload = {
  /** Chat toggle */
  enableChat?: boolean;
  /** MML document sources keyed by name. URLs can use the `ws:///` relative scheme. */
  mmlDocuments?: {
    [key: string]: {
      url: string;
      position?: { x: number; y: number; z: number };
      rotation?: { x: number; y: number; z: number };
      scale?: { x: number; y: number; z: number };
      passAuthToken?: boolean;
    };
  };
  /** Environment settings (skybox, fog, sun, ambient light, etc.). */
  environmentConfiguration?: WorldConfigEnvironment;
  /** Spawn position, variance, rotation, respawn triggers. */
  spawnConfiguration?: WorldConfigSpawn;
  /** Available avatars and custom avatar policy. */
  avatarConfiguration?: WorldConfigAvatar;
  /** Whether users can set a custom display name */
  allowCustomDisplayName?: boolean;
  /** Show the tweakpane debug UI */
  enableTweakPane?: boolean;
  /** Allow orbital/fly camera toggle */
  allowOrbitalCamera?: boolean;
  /** Enable post-processing effects */
  postProcessingEnabled?: boolean;
  /** HUD visibility. `false` disables all HUD elements; an object toggles individual elements. */
  hud?:
    | false
    | {
        minimap?: boolean;
        playerList?: boolean;
        respawnButton?: boolean;
        [key: string]: boolean | undefined;
      };
};

function isXYZ(value: unknown): value is { x: number; y: number; z: number } {
  return (
    isRecord(value) &&
    typeof value.x === "number" &&
    Number.isFinite(value.x) &&
    typeof value.y === "number" &&
    Number.isFinite(value.y) &&
    typeof value.z === "number" &&
    Number.isFinite(value.z)
  );
}

function isOptionalFiniteNumber(value: unknown): value is number | undefined {
  return value === undefined || (typeof value === "number" && Number.isFinite(value));
}

function isOptionalBoolean(value: unknown): value is boolean | undefined {
  return value === undefined || typeof value === "boolean";
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

function isOptionalXYZ(
  value: unknown,
): value is { x?: number; y?: number; z?: number } | undefined {
  if (value === undefined) return true;
  if (!isRecord(value)) return false;
  return (
    isOptionalFiniteNumber(value.x) &&
    isOptionalFiniteNumber(value.y) &&
    isOptionalFiniteNumber(value.z)
  );
}

function validateColor(value: unknown, path: string) {
  if (!isRecord(value)) {
    throw new Error(`${path} must be an object`);
  }
  for (const channel of ["r", "g", "b"] as const) {
    const c = value[channel];
    if (typeof c !== "number" || !Number.isFinite(c)) {
      throw new Error(`${path}.${channel} must be a finite number`);
    }
  }
}

/** Checks that `section` is an object whose listed keys are optional finite numbers. */
function validateNumberFields(section: unknown, path: string, keys: string[]): void {
  if (!isRecord(section)) {
    throw new Error(`${path} must be an object`);
  }
  for (const key of keys) {
    if (!isOptionalFiniteNumber(section[key])) {
      throw new Error(`${path}.${key} must be a finite number`);
    }
  }
}

function validateOptionalEnum(value: unknown, path: string, allowed: readonly string[]) {
  if (value !== undefined && (typeof value !== "string" || !allowed.includes(value))) {
    throw new Error(`${path} must be one of ${allowed.map((a) => `"${a}"`).join(", ")}`);
  }
}

function validateEnvironmentConfiguration(value: unknown): asserts value is WorldConfigEnvironment {
  if (!isRecord(value)) {
    throw new Error("environmentConfiguration must be an object");
  }
  if ("groundPlane" in value && typeof value.groundPlane !== "boolean") {
    throw new Error("environmentConfiguration.groundPlane must be a boolean");
  }
  if ("skybox" in value) {
    if (!isRecord(value.skybox)) {
      throw new Error("environmentConfiguration.skybox must be an object");
    }
    const skybox = value.skybox;
    if (!isOptionalFiniteNumber(skybox.intensity)) {
      throw new Error("environmentConfiguration.skybox.intensity must be a finite number");
    }
    if (!isOptionalFiniteNumber(skybox.blurriness)) {
      throw new Error("environmentConfiguration.skybox.blurriness must be a finite number");
    }
    if (!isOptionalFiniteNumber(skybox.azimuthalAngle)) {
      throw new Error("environmentConfiguration.skybox.azimuthalAngle must be a finite number");
    }
    if (!isOptionalFiniteNumber(skybox.polarAngle)) {
      throw new Error("environmentConfiguration.skybox.polarAngle must be a finite number");
    }
    const hasHdrJpg = "hdrJpgUrl" in skybox && skybox.hdrJpgUrl !== undefined;
    const hasHdr = "hdrUrl" in skybox && skybox.hdrUrl !== undefined;
    if (hasHdrJpg && typeof skybox.hdrJpgUrl !== "string") {
      throw new Error("environmentConfiguration.skybox.hdrJpgUrl must be a string");
    }
    if (hasHdr && typeof skybox.hdrUrl !== "string") {
      throw new Error("environmentConfiguration.skybox.hdrUrl must be a string");
    }
    if (hasHdrJpg && hasHdr) {
      throw new Error(
        "environmentConfiguration.skybox must have either hdrJpgUrl or hdrUrl, not both",
      );
    }
  }
  if ("envMap" in value) {
    if (!isRecord(value.envMap)) {
      throw new Error("environmentConfiguration.envMap must be an object");
    }
    if (!isOptionalFiniteNumber(value.envMap.intensity)) {
      throw new Error("environmentConfiguration.envMap.intensity must be a finite number");
    }
  }
  if ("sun" in value) {
    if (!isRecord(value.sun)) {
      throw new Error("environmentConfiguration.sun must be an object");
    }
    if (!isOptionalFiniteNumber(value.sun.intensity)) {
      throw new Error("environmentConfiguration.sun.intensity must be a finite number");
    }
    if (!isOptionalFiniteNumber(value.sun.polarAngle)) {
      throw new Error("environmentConfiguration.sun.polarAngle must be a finite number");
    }
    if (!isOptionalFiniteNumber(value.sun.azimuthalAngle)) {
      throw new Error("environmentConfiguration.sun.azimuthalAngle must be a finite number");
    }
    if (value.sun.color !== undefined) {
      validateColor(value.sun.color, "environmentConfiguration.sun.color");
    }
  }
  if ("sky" in value) {
    validateNumberFields(value.sky, "environmentConfiguration.sky", [
      "turbidity",
      "rayleigh",
      "mieCoefficient",
      "mieDirectionalG",
      "exposure",
      "stars",
      "horizonBlend",
    ]);
    const sky = value.sky as Record<string, unknown>;
    if (sky.nightColor !== undefined) {
      validateColor(sky.nightColor, "environmentConfiguration.sky.nightColor");
    }
  }
  if ("timeOfDay" in value) {
    validateNumberFields(value.timeOfDay, "environmentConfiguration.timeOfDay", [
      "hour",
      "cycleMinutes",
      "azimuthalAngle",
      "maxElevation",
    ]);
    if (typeof (value.timeOfDay as Record<string, unknown>).hour !== "number") {
      throw new Error("environmentConfiguration.timeOfDay.hour must be a finite number");
    }
  }
  if ("shadows" in value) {
    validateNumberFields(value.shadows, "environmentConfiguration.shadows", [
      "distance",
      "softness",
      "intensity",
    ]);
    if (!isOptionalBoolean((value.shadows as Record<string, unknown>).enabled)) {
      throw new Error("environmentConfiguration.shadows.enabled must be a boolean");
    }
  }
  if ("quality" in value) {
    validateNumberFields(value.quality, "environmentConfiguration.quality", ["maxPixelRatio"]);
    const quality = value.quality as Record<string, unknown>;
    validateOptionalEnum(quality.tier, "environmentConfiguration.quality.tier", [
      "auto",
      "high",
      "medium",
      "low",
    ]);
    if (!isOptionalBoolean(quality.adaptive)) {
      throw new Error("environmentConfiguration.quality.adaptive must be a boolean");
    }
  }
  if ("fog" in value) {
    if (!isRecord(value.fog)) {
      throw new Error("environmentConfiguration.fog must be an object");
    }
    if (!isOptionalFiniteNumber(value.fog.fogNear)) {
      throw new Error("environmentConfiguration.fog.fogNear must be a finite number");
    }
    if (!isOptionalFiniteNumber(value.fog.fogFar)) {
      throw new Error("environmentConfiguration.fog.fogFar must be a finite number");
    }
    if ("fogColor" in value.fog) {
      if (!isRecord(value.fog.fogColor)) {
        throw new Error("environmentConfiguration.fog.fogColor must be an object");
      }
      const c = value.fog.fogColor;
      if (typeof c.r !== "number" || !Number.isFinite(c.r)) {
        throw new Error("environmentConfiguration.fog.fogColor.r must be a finite number");
      }
      if (typeof c.g !== "number" || !Number.isFinite(c.g)) {
        throw new Error("environmentConfiguration.fog.fogColor.g must be a finite number");
      }
      if (typeof c.b !== "number" || !Number.isFinite(c.b)) {
        throw new Error("environmentConfiguration.fog.fogColor.b must be a finite number");
      }
    }
  }
  if ("postProcessing" in value) {
    if (!isRecord(value.postProcessing)) {
      throw new Error("environmentConfiguration.postProcessing must be an object");
    }
    if (!isOptionalFiniteNumber(value.postProcessing.bloomIntensity)) {
      throw new Error(
        "environmentConfiguration.postProcessing.bloomIntensity must be a finite number",
      );
    }
    validateNumberFields(value.postProcessing, "environmentConfiguration.postProcessing", [
      "exposure",
      "ambientOcclusion",
      "grain",
    ]);
    validateOptionalEnum(
      value.postProcessing.toneMapping,
      "environmentConfiguration.postProcessing.toneMapping",
      ["aces", "agx", "neutral", "reinhard", "cineon", "linear"],
    );
    if (value.postProcessing.bloom !== undefined) {
      validateNumberFields(
        value.postProcessing.bloom,
        "environmentConfiguration.postProcessing.bloom",
        ["intensity", "threshold", "smoothing", "radius"],
      );
      validateOptionalEnum(
        (value.postProcessing.bloom as Record<string, unknown>).mode,
        "environmentConfiguration.postProcessing.bloom.mode",
        ["emissive", "luminance"],
      );
    }
  }
  if ("ambientLight" in value) {
    if (!isRecord(value.ambientLight)) {
      throw new Error("environmentConfiguration.ambientLight must be an object");
    }
    if (!isOptionalFiniteNumber(value.ambientLight.intensity)) {
      throw new Error("environmentConfiguration.ambientLight.intensity must be a finite number");
    }
    if (value.ambientLight.color !== undefined) {
      validateColor(value.ambientLight.color, "environmentConfiguration.ambientLight.color");
    }
    if (value.ambientLight.groundColor !== undefined) {
      validateColor(
        value.ambientLight.groundColor,
        "environmentConfiguration.ambientLight.groundColor",
      );
    }
  }
}

function validateSpawnConfiguration(value: unknown): asserts value is WorldConfigSpawn {
  if (!isRecord(value)) {
    throw new Error("spawnConfiguration must be an object");
  }
  if ("spawnPosition" in value && !isOptionalXYZ(value.spawnPosition)) {
    throw new Error("spawnConfiguration.spawnPosition must be an object with optional {x,y,z}");
  }
  if ("spawnPositionVariance" in value && !isOptionalXYZ(value.spawnPositionVariance)) {
    throw new Error(
      "spawnConfiguration.spawnPositionVariance must be an object with optional {x,y,z}",
    );
  }
  if ("spawnYRotation" in value && !isOptionalFiniteNumber(value.spawnYRotation)) {
    throw new Error("spawnConfiguration.spawnYRotation must be a finite number");
  }
  if ("respawnTrigger" in value) {
    if (!isRecord(value.respawnTrigger)) {
      throw new Error("spawnConfiguration.respawnTrigger must be an object");
    }
    const rt = value.respawnTrigger;
    for (const key of ["minX", "maxX", "minY", "maxY", "minZ", "maxZ"] as const) {
      if (key in rt && !isOptionalFiniteNumber(rt[key])) {
        throw new Error(`spawnConfiguration.respawnTrigger.${key} must be a finite number`);
      }
    }
  }
}

function validateAvatarType(value: unknown, index: number): asserts value is WorldConfigAvatarType {
  if (!isRecord(value)) {
    throw new Error(`avatarConfiguration.availableAvatars[${index}] must be an object`);
  }
  if (!isOptionalString(value.thumbnailUrl)) {
    throw new Error(`avatarConfiguration.availableAvatars[${index}].thumbnailUrl must be a string`);
  }
  if (!isOptionalString(value.name)) {
    throw new Error(`avatarConfiguration.availableAvatars[${index}].name must be a string`);
  }
  if (!isOptionalBoolean(value.isDefaultAvatar)) {
    throw new Error(
      `avatarConfiguration.availableAvatars[${index}].isDefaultAvatar must be a boolean`,
    );
  }
  const hasMesh = "meshFileUrl" in value && value.meshFileUrl != null;
  const hasMmlString = "mmlCharacterString" in value && value.mmlCharacterString != null;
  const hasMmlUrl = "mmlCharacterUrl" in value && value.mmlCharacterUrl != null;
  const sourceCount = [hasMesh, hasMmlString, hasMmlUrl].filter(Boolean).length;
  if (sourceCount !== 1) {
    throw new Error(
      `avatarConfiguration.availableAvatars[${index}] must have exactly one of meshFileUrl, mmlCharacterString, or mmlCharacterUrl`,
    );
  }
  if (hasMesh && typeof value.meshFileUrl !== "string") {
    throw new Error(`avatarConfiguration.availableAvatars[${index}].meshFileUrl must be a string`);
  }
  if (hasMmlString && typeof value.mmlCharacterString !== "string") {
    throw new Error(
      `avatarConfiguration.availableAvatars[${index}].mmlCharacterString must be a string`,
    );
  }
  if (hasMmlUrl && typeof value.mmlCharacterUrl !== "string") {
    throw new Error(
      `avatarConfiguration.availableAvatars[${index}].mmlCharacterUrl must be a string`,
    );
  }
}

function validateAvatarConfiguration(value: unknown): asserts value is WorldConfigAvatar {
  if (!isRecord(value)) {
    throw new Error("avatarConfiguration must be an object");
  }
  if ("availableAvatars" in value) {
    if (!Array.isArray(value.availableAvatars)) {
      throw new Error("avatarConfiguration.availableAvatars must be an array");
    }
    for (let i = 0; i < value.availableAvatars.length; i++) {
      validateAvatarType(value.availableAvatars[i], i);
    }
  }
  if ("allowCustomAvatars" in value && !isOptionalBoolean(value.allowCustomAvatars)) {
    throw new Error("avatarConfiguration.allowCustomAvatars must be a boolean");
  }
}

/**
 * Parses a JSON string into a validated `WorldConfigPayload`.
 *
 * Returns an `Error` if the string is not valid JSON or the resulting value
 * does not conform to the expected shape.
 */
export function parseWorldConfigPayload(contents: string): WorldConfigPayload | Error {
  try {
    const parsed: unknown = JSON.parse(contents);
    if (!isRecord(parsed)) {
      throw new Error("expected a plain object");
    }

    if ("enableChat" in parsed && typeof parsed.enableChat !== "boolean") {
      throw new Error("enableChat must be a boolean");
    }

    if ("mmlDocuments" in parsed) {
      if (!isRecord(parsed.mmlDocuments)) {
        throw new Error("mmlDocuments must be an object");
      }
      for (const [key, doc] of Object.entries(parsed.mmlDocuments)) {
        if (!isRecord(doc)) {
          throw new Error(`mmlDocuments["${key}"] must be an object`);
        }
        if (typeof doc.url !== "string") {
          throw new Error(`mmlDocuments["${key}"].url must be a string`);
        }
        if ("position" in doc && !isXYZ(doc.position)) {
          throw new Error(`mmlDocuments["${key}"].position must be {x,y,z}`);
        }
        if ("rotation" in doc && !isXYZ(doc.rotation)) {
          throw new Error(`mmlDocuments["${key}"].rotation must be {x,y,z}`);
        }
        if ("scale" in doc && !isXYZ(doc.scale)) {
          throw new Error(`mmlDocuments["${key}"].scale must be {x,y,z}`);
        }
        if ("passAuthToken" in doc && typeof doc.passAuthToken !== "boolean") {
          throw new Error(`mmlDocuments["${key}"].passAuthToken must be a boolean`);
        }
      }
    }

    if ("environmentConfiguration" in parsed) {
      validateEnvironmentConfiguration(parsed.environmentConfiguration);
    }

    if ("spawnConfiguration" in parsed) {
      validateSpawnConfiguration(parsed.spawnConfiguration);
    }

    if ("avatarConfiguration" in parsed) {
      validateAvatarConfiguration(parsed.avatarConfiguration);
    }

    if ("allowCustomDisplayName" in parsed && typeof parsed.allowCustomDisplayName !== "boolean") {
      throw new Error("allowCustomDisplayName must be a boolean");
    }

    if ("enableTweakPane" in parsed && typeof parsed.enableTweakPane !== "boolean") {
      throw new Error("enableTweakPane must be a boolean");
    }

    if ("allowOrbitalCamera" in parsed && typeof parsed.allowOrbitalCamera !== "boolean") {
      throw new Error("allowOrbitalCamera must be a boolean");
    }

    if ("postProcessingEnabled" in parsed && typeof parsed.postProcessingEnabled !== "boolean") {
      throw new Error("postProcessingEnabled must be a boolean");
    }

    if ("hud" in parsed) {
      if (parsed.hud !== false) {
        if (!isRecord(parsed.hud)) {
          throw new Error("hud must be false or an object");
        }
        if ("minimap" in parsed.hud && typeof parsed.hud.minimap !== "boolean") {
          throw new Error("hud.minimap must be a boolean");
        }
        if ("playerList" in parsed.hud && typeof parsed.hud.playerList !== "boolean") {
          throw new Error("hud.playerList must be a boolean");
        }
        if ("respawnButton" in parsed.hud && typeof parsed.hud.respawnButton !== "boolean") {
          throw new Error("hud.respawnButton must be a boolean");
        }
        for (const [key, value] of Object.entries(parsed.hud as Record<string, unknown>)) {
          if (typeof value !== "boolean") {
            throw new Error(`hud.${key} must be a boolean`);
          }
        }
      }
    }

    // All fields have been validated above including nested structures.
    // Cast `parsed` once to avoid repeated `as` casts on each field access.
    const validated = parsed as Record<string, any>;

    const result: WorldConfigPayload = {};
    if ("enableChat" in validated) result.enableChat = validated.enableChat;
    if ("mmlDocuments" in validated) {
      const cleanDocs: NonNullable<WorldConfigPayload["mmlDocuments"]> = {};
      for (const [key, doc] of Object.entries(validated.mmlDocuments as Record<string, any>)) {
        const cleanDoc: NonNullable<WorldConfigPayload["mmlDocuments"]>[string] = {
          url: doc.url,
        };
        if ("position" in doc) cleanDoc.position = doc.position;
        if ("rotation" in doc) cleanDoc.rotation = doc.rotation;
        if ("scale" in doc) cleanDoc.scale = doc.scale;
        if ("passAuthToken" in doc) cleanDoc.passAuthToken = doc.passAuthToken;
        cleanDocs[key] = cleanDoc;
      }
      result.mmlDocuments = cleanDocs;
    }
    if ("environmentConfiguration" in validated)
      result.environmentConfiguration = validated.environmentConfiguration;
    if ("spawnConfiguration" in validated) result.spawnConfiguration = validated.spawnConfiguration;
    if ("avatarConfiguration" in validated) {
      const avatarConfig = validated.avatarConfiguration as WorldConfigAvatar;
      result.avatarConfiguration = {
        ...avatarConfig,
        availableAvatars: avatarConfig.availableAvatars ?? [],
      };
    }
    if ("allowCustomDisplayName" in validated)
      result.allowCustomDisplayName = validated.allowCustomDisplayName;
    if ("enableTweakPane" in validated) result.enableTweakPane = validated.enableTweakPane;
    if ("allowOrbitalCamera" in validated) result.allowOrbitalCamera = validated.allowOrbitalCamera;
    if ("postProcessingEnabled" in validated)
      result.postProcessingEnabled = validated.postProcessingEnabled;
    if ("hud" in validated) result.hud = validated.hud;
    return result;
  } catch (error) {
    return error instanceof Error ? error : new Error(`Invalid world config: ${error}`);
  }
}

/** Serializes a world config payload to JSON for sending over the wire. */
export function serializeWorldConfigPayload(config: WorldConfigPayload): string {
  return JSON.stringify(config);
}
