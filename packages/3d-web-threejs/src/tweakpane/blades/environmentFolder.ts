import { ENVIRONMENT_DEFAULTS } from "@mml-io/3d-web-client-core";
import { BladeController, View } from "@tweakpane/core";
import { Scene } from "three";
import { BladeApi, ButtonApi, FolderApi, TpChangeEvent } from "tweakpane";

export type SunValues = {
  sunIntensity: number;
  sunPosition: {
    sunAzimuthalAngle: number;
    sunPolarAngle: number;
  };
  skyTurbidity: number;
  skyRayleigh: number;
  skyMieCoefficient: number;
  skyMieDirectionalG: number;
  sunColor: { r: number; g: number; b: number };
  /** Procedural sky brightness. */
  skyExposure: number;
  /** Night sky colour and star brightness. */
  skyNightColor: { r: number; g: number; b: number };
  skyStars: number;
  /** Degrees above the horizon over which the sky fades into the fog colour. */
  skyHorizonBlend: number;
  timeOfDay: {
    enabled: boolean;
    hour: number;
    /** Real minutes per in-world day, 0 = fixed hour. */
    cycleMinutes: number;
    azimuthalAngle: number;
    maxElevation: number;
  };
  shadows: {
    enabled: boolean;
    /** Half-width of the shadowed area in metres; 0 = from the quality tier. */
    distance: number;
    softness: number;
    intensity: number;
  };
};

export type EnvValues = {
  skyboxAzimuthalAngle: number;
  skyboxPolarAngle: number;
  envMapIntensity: number;
  skyboxIntensity: number;
  skyboxBlurriness: number;
  ambientLight: {
    ambientLightIntensity: number;
    ambientLightColor: { r: number; g: number; b: number };
    ambientLightGroundColor: { r: number; g: number; b: number };
  };
  fog: {
    fogNear: number;
    fogFar: number;
    fogColor: { r: number; g: number; b: number };
    /** Follow the sky's horizon colour instead of fogColor (procedural sky only). */
    fogColorFromSky: boolean;
  };
  /** Quality tier setting: "auto", "high", "medium" or "low". */
  qualityTier: string;
};

export function createDefaultSunValues(): SunValues {
  const d = ENVIRONMENT_DEFAULTS;
  return {
    sunIntensity: d.sun.intensity,
    sunPosition: {
      sunAzimuthalAngle: d.sun.azimuthalAngle,
      sunPolarAngle: d.sun.polarAngle,
    },
    skyTurbidity: d.sky.turbidity,
    skyRayleigh: d.sky.rayleigh,
    skyMieCoefficient: d.sky.mieCoefficient,
    skyMieDirectionalG: d.sky.mieDirectionalG,
    sunColor: { ...d.sun.color },
    skyExposure: d.sky.exposure,
    skyNightColor: { ...d.sky.nightColor },
    skyStars: d.sky.stars,
    skyHorizonBlend: d.sky.horizonBlend,
    timeOfDay: {
      enabled: false,
      hour: 12,
      cycleMinutes: d.timeOfDay.cycleMinutes,
      azimuthalAngle: d.timeOfDay.azimuthalAngle,
      maxElevation: d.timeOfDay.maxElevation,
    },
    shadows: {
      enabled: d.shadows.enabled,
      distance: 0,
      softness: d.shadows.softness,
      intensity: d.shadows.intensity,
    },
  };
}

export function createDefaultEnvValues(): EnvValues {
  const d = ENVIRONMENT_DEFAULTS;
  return {
    skyboxAzimuthalAngle: 0,
    skyboxPolarAngle: 0,
    envMapIntensity: d.envMap.intensity,
    skyboxIntensity: 0.9,
    skyboxBlurriness: 0.0,
    ambientLight: {
      ambientLightIntensity: d.ambientLight.intensity,
      ambientLightColor: { ...d.ambientLight.color },
      ambientLightGroundColor: { ...d.ambientLight.groundColor },
    },
    fog: {
      fogNear: d.fog.fogNear,
      fogFar: d.fog.fogFar,
      fogColor: { r: 0.6, g: 0.6, b: 0.6 },
      fogColorFromSky: true,
    },
    qualityTier: d.quality.tier,
  };
}

const sunOptions = {
  sunPosition: {
    sunAzimuthalAngle: { min: 0, max: 360, step: 1 },
    sunPolarAngle: { min: -180, max: 180, step: 1 },
  },
  sunIntensity: { min: 0, max: 10, step: 0.1 },
  skyTurbidity: { min: 1, max: 30, step: 0.1 },
  skyRayleigh: { min: 0, max: 4, step: 0.01 },
  skyMieCoefficient: { min: 0.001, max: 0.02, step: 0.001 },
  skyMieDirectionalG: { min: 0, max: 0.999, step: 0.001 },
  skyExposure: { min: 0, max: 3, step: 0.01 },
  skyStars: { min: 0, max: 3, step: 0.01 },
  skyHorizonBlend: { min: 0.1, max: 30, step: 0.1 },
  hour: { min: 0, max: 24, step: 0.05 },
  cycleMinutes: { min: 0, max: 120, step: 0.5 },
  maxElevation: { min: 5, max: 89, step: 1 },
  shadowDistance: { min: 0, max: 100, step: 1 },
  shadowSoftness: { min: 0, max: 8, step: 0.1 },
  shadowIntensity: { min: 0, max: 1, step: 0.01 },
};

const envOptions = {
  skyboxAzimuthalAngle: { min: 0, max: 360, step: 1 },
  skyboxPolarAngle: { min: 0, max: 360, step: 1 },
  skyboxIntensity: { min: 0, max: 1.3, step: 0.01 },
  skyboxBlurriness: { min: 0, max: 0.1, step: 0.001 },
  ambientLight: {
    ambientLightIntensity: { min: 0, max: 3, step: 0.01 },
  },
  fog: {
    fogNear: { min: 0, max: 80, step: 1 },
    fogFar: { min: 0, max: 300, step: 1 },
  },
};

export class EnvironmentFolder {
  public folder: FolderApi;
  private sun: FolderApi;
  private envMap: FolderApi;
  private hdrButton: ButtonApi;
  private skybox: FolderApi;
  private ambient: FolderApi;
  private fog: FolderApi;
  private timeOfDay: FolderApi;
  private shadows: FolderApi;
  private quality: FolderApi;

  constructor(
    parentFolder: FolderApi,
    private sunValues: SunValues,
    private envValues: EnvValues,
    expand: boolean = false,
  ) {
    this.folder = parentFolder.addFolder({ title: "environment", expanded: expand });
    this.ambient = this.folder.addFolder({ title: "ambient", expanded: true });
    this.sun = this.folder.addFolder({ title: "sun", expanded: true });
    this.envMap = this.folder.addFolder({ title: "envMap", expanded: true });
    this.fog = this.folder.addFolder({ title: "fog", expanded: true });
    this.skybox = this.folder.addFolder({ title: "skybox", expanded: true });
    this.timeOfDay = this.folder.addFolder({ title: "time of day", expanded: true });
    this.shadows = this.folder.addFolder({ title: "shadows", expanded: true });
    this.quality = this.folder.addFolder({ title: "quality", expanded: true });

    this.timeOfDay.addBinding(this.sunValues.timeOfDay, "enabled");
    this.timeOfDay.addBinding(this.sunValues.timeOfDay, "hour", sunOptions.hour);
    this.timeOfDay.addBinding(this.sunValues.timeOfDay, "cycleMinutes", sunOptions.cycleMinutes);
    this.timeOfDay.addBinding(
      this.sunValues.timeOfDay,
      "azimuthalAngle",
      sunOptions.sunPosition.sunAzimuthalAngle,
    );
    this.timeOfDay.addBinding(this.sunValues.timeOfDay, "maxElevation", sunOptions.maxElevation);

    this.shadows.addBinding(this.sunValues.shadows, "enabled");
    this.shadows.addBinding(this.sunValues.shadows, "distance", sunOptions.shadowDistance);
    this.shadows.addBinding(this.sunValues.shadows, "softness", sunOptions.shadowSoftness);
    this.shadows.addBinding(this.sunValues.shadows, "intensity", sunOptions.shadowIntensity);

    this.quality.addBinding(this.envValues, "qualityTier", {
      options: { auto: "auto", high: "high", medium: "medium", low: "low" },
    });

    this.sun.addBinding(this.sunValues, "sunIntensity", sunOptions.sunIntensity);
    this.sun.addBinding(
      this.sunValues.sunPosition,
      "sunAzimuthalAngle",
      sunOptions.sunPosition.sunAzimuthalAngle,
    );
    this.sun.addBinding(
      this.sunValues.sunPosition,
      "sunPolarAngle",
      sunOptions.sunPosition.sunPolarAngle,
    );
    this.sun.addBinding(this.sunValues, "skyTurbidity", sunOptions.skyTurbidity);
    this.sun.addBinding(this.sunValues, "skyRayleigh", sunOptions.skyRayleigh);
    this.sun.addBinding(this.sunValues, "skyMieCoefficient", sunOptions.skyMieCoefficient);
    this.sun.addBinding(this.sunValues, "skyMieDirectionalG", sunOptions.skyMieDirectionalG);
    this.sun.addBinding(this.sunValues, "sunColor", {
      color: { type: "float" },
    });
    this.sun.addBinding(this.sunValues, "skyExposure", sunOptions.skyExposure);
    this.sun.addBinding(this.sunValues, "skyStars", sunOptions.skyStars);
    this.sun.addBinding(this.sunValues, "skyHorizonBlend", sunOptions.skyHorizonBlend);
    this.sun.addBinding(this.sunValues, "skyNightColor", {
      color: { type: "float" },
    });

    this.hdrButton = this.skybox.addButton({ title: "Set HDRI" });
    this.skybox.addBinding(this.envValues, "skyboxIntensity", envOptions.skyboxIntensity);
    this.skybox.addBinding(this.envValues, "skyboxBlurriness", envOptions.skyboxBlurriness);
    this.skybox.addBinding(this.envValues, "skyboxAzimuthalAngle", envOptions.skyboxAzimuthalAngle);
    this.skybox.addBinding(this.envValues, "skyboxPolarAngle", envOptions.skyboxPolarAngle);

    this.envMap.addBinding(this.envValues, "envMapIntensity", envOptions.skyboxIntensity);

    this.ambient.addBinding(
      this.envValues.ambientLight,
      "ambientLightIntensity",
      envOptions.ambientLight.ambientLightIntensity,
    );
    this.ambient.addBinding(this.envValues.ambientLight, "ambientLightColor", {
      color: { type: "float" },
    });
    this.ambient.addBinding(this.envValues.ambientLight, "ambientLightGroundColor", {
      color: { type: "float" },
    });

    this.fog.addBinding(this.envValues.fog, "fogNear", envOptions.fog.fogNear);
    this.fog.addBinding(this.envValues.fog, "fogFar", envOptions.fog.fogFar);
    this.fog.addBinding(this.envValues.fog, "fogColor", {
      color: { type: "float" },
    });
    this.fog.addBinding(this.envValues.fog, "fogColorFromSky");
  }

  public setupChangeEvent(
    scene: Scene,
    onUpdate: () => void,
    setHDR: () => void,
    onQualityChange: (tier: string) => void = () => {},
  ): void {
    this.timeOfDay.on("change", () => onUpdate());
    this.shadows.on("change", () => onUpdate());
    this.quality.on("change", () => onQualityChange(this.envValues.qualityTier));

    this.sun.on("change", () => {
      onUpdate();
    });

    this.hdrButton.on("click", () => {
      setHDR();
    });

    this.envMap.on("change", (e: TpChangeEvent<unknown, BladeApi<BladeController<View>>>) => {
      const target = (e.target as any).key;
      if (target === "envMapIntensity") {
        scene.environmentIntensity = e.value as number;
      }
    });

    this.skybox.on("change", (e: TpChangeEvent<unknown, BladeApi<BladeController<View>>>) => {
      const target = (e.target as any).key;
      if (!target) return;
      switch (target) {
        case "skyboxAzimuthalAngle":
        case "skyboxPolarAngle":
          onUpdate();
          break;
        case "skyboxIntensity":
          scene.backgroundIntensity = e.value as number;
          break;
        case "skyboxBlurriness":
          scene.backgroundBlurriness = e.value as number;
          break;
      }
    });

    this.ambient.on("change", () => {
      onUpdate();
    });

    this.fog.on("change", () => {
      onUpdate();
    });
  }
}
