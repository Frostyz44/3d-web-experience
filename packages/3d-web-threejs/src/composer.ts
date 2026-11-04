import {
  AdaptiveQualityMonitor,
  advanceHour,
  computeTimeOfDay,
  detectQualityTier,
  DeviceInfo,
  ENVIRONMENT_DEFAULTS,
  EnvironmentConfiguration as CoreEnvironmentConfiguration,
  lowerQualityTier,
  parseQualityTier,
  QualitySettings,
  QualityTier,
  QualityTierSetting,
  resolveBloomSettings,
  resolveQualitySettings,
  TimeOfDayLighting,
} from "@mml-io/3d-web-client-core";
import { HDRJPGLoader } from "@monogrid/gainmap-js";
import {
  ACESFilmicToneMapping,
  AgXToneMapping,
  CineonToneMapping,
  Color,
  EquirectangularReflectionMapping,
  Euler,
  Fog,
  HemisphereLight,
  LinearSRGBColorSpace,
  LinearToneMapping,
  LoadingManager,
  MathUtils,
  NeutralToneMapping,
  PerspectiveCamera,
  PMREMGenerator,
  ReinhardToneMapping,
  Scene,
  ShadowMapType,
  SRGBColorSpace,
  Texture,
  ToneMapping,
  WebGLRenderer,
} from "three";
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader.js";

import { ThreeJSCameraManager } from "./camera/ThreeJSCameraManager";
import { HOLE_PUNCH_ATTRIBUTE, HoleAlphaApplier } from "./post-effects/HolePunchCompositor";
import { PostProcessingManager } from "./post-effects/PostProcessingManager";
import { ProceduralSky } from "./sky/ProceduralSky";
import { LocalShadowBudget } from "./sun/LocalShadowBudget";
import { Sun } from "./sun/Sun";
import {
  createDefaultEnvValues,
  createDefaultSunValues,
  EnvValues,
  SunValues,
} from "./tweakpane/blades/environmentFolder";
import { createDefaultRendererValues, RendererValues } from "./tweakpane/blades/rendererFolder";

type ComposerContructorArgs = {
  scene: Scene;
  cameraManager: ThreeJSCameraManager;
  spawnSun: boolean;
  environmentConfiguration?: EnvironmentConfiguration;
  postProcessingEnabled?: boolean;
};

/** Same type as `EnvironmentConfiguration` in `@mml-io/3d-web-client-core`. */
export type EnvironmentConfiguration = CoreEnvironmentConfiguration;

const TONE_MAPPINGS: Record<string, ToneMapping> = {
  aces: ACESFilmicToneMapping,
  agx: AgXToneMapping,
  neutral: NeutralToneMapping,
  reinhard: ReinhardToneMapping,
  cineon: CineonToneMapping,
  linear: LinearToneMapping,
};

const tempColor = new Color();
const tempColor2 = new Color();
const tempColor3 = new Color();

/** Reads the facts used to choose a quality tier from the browser. */
function readDeviceInfo(renderer: WebGLRenderer | null): DeviceInfo {
  const nav = (typeof navigator !== "undefined" ? navigator : {}) as Navigator & {
    deviceMemory?: number;
    userAgentData?: { mobile?: boolean };
  };
  let gpuRenderer: string | null = null;
  if (renderer) {
    try {
      const gl = renderer.getContext();
      const ext = gl.getExtension("WEBGL_debug_renderer_info");
      gpuRenderer = ext
        ? (gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) as string)
        : (gl.getParameter(gl.RENDERER) as string);
    } catch {
      gpuRenderer = null;
    }
  }
  return {
    gpuRenderer,
    userAgent: nav.userAgent,
    mobile: nav.userAgentData?.mobile,
    maxTouchPoints: nav.maxTouchPoints,
    hardwareConcurrency: nav.hardwareConcurrency,
    deviceMemory: nav.deviceMemory,
    screenWidth: typeof screen !== "undefined" ? screen.width : undefined,
    screenHeight: typeof screen !== "undefined" ? screen.height : undefined,
    devicePixelRatio: typeof window !== "undefined" ? window.devicePixelRatio : undefined,
  };
}

/** Testing aids: `?quality=low|medium|high|auto` and `?hour=0..24`. */
function readUrlOverrides(): { quality: QualityTierSetting | null; hour: number | null } {
  if (typeof window === "undefined" || !window.location) {
    return { quality: null, hour: null };
  }
  const params = new URLSearchParams(window.location.search);
  const hourParam = params.get("hour");
  const hour = hourParam !== null && hourParam !== "" ? Number(hourParam) : NaN;
  return {
    quality: parseQualityTier(params.get("quality")),
    hour: Number.isFinite(hour) ? hour : null,
  };
}

export class Composer {
  private width: number = 1;
  private height: number = 1;
  private resizeListener: () => void;

  private readonly scene: Scene;
  public postPostScene: Scene;
  private threeJSCameraManager: ThreeJSCameraManager;
  public readonly renderer: WebGLRenderer;

  private postProcessingManager: PostProcessingManager;
  private currentCamera: PerspectiveCamera;

  private hemisphereLight: HemisphereLight;
  private environmentConfiguration?: EnvironmentConfiguration;

  private skyboxState: {
    src: {
      hdrJpgUrl?: string;
      hdrUrl?: string;
    };
    latestPromise: Promise<unknown> | null;
  } = { src: {}, latestPromise: null };

  public sun: Sun | null = null;
  private localShadowBudget: LocalShadowBudget;
  public spawnSun: boolean;
  private sky: ProceduralSky | null = null;
  private secondsSinceEnvUpdate = Infinity;

  private currentAzimuthalAngle: number = 0;
  private currentPolarAngle: number = 0;
  private currentIntensity: number = 0;
  private readonly lerpSpeed: number = 0.05;

  private postProcessingEnabled: boolean | undefined;

  // DOM content (such as MML m-youtube players) shown through holes in the canvas, see HolePunchCompositor
  private domOverlayContainer: HTMLElement | null = null;
  private readonly holeAlphaApplier = new HoleAlphaApplier();

  // quality
  private qualitySetting: QualityTierSetting = "auto";
  private qualityTier: QualityTier = "high";
  private quality: QualitySettings;
  private adaptiveMonitor: AdaptiveQualityMonitor | null = null;
  private urlOverrides = readUrlOverrides();

  // time of day
  private timeOfDay: TimeOfDayLighting | null = null;
  private lastConfiguredHour: number | null = null;

  public readonly sunValues: SunValues;
  public readonly envValues: EnvValues;
  public readonly rendererValues: RendererValues;

  constructor({
    scene,
    cameraManager,
    spawnSun = false,
    environmentConfiguration,
    postProcessingEnabled,
  }: ComposerContructorArgs) {
    this.scene = scene;
    this.threeJSCameraManager = cameraManager;
    this.postPostScene = new Scene();
    this.spawnSun = spawnSun;
    this.postProcessingEnabled = postProcessingEnabled;
    this.environmentConfiguration = environmentConfiguration;

    this.sunValues = createDefaultSunValues();
    this.envValues = createDefaultEnvValues();
    this.rendererValues = createDefaultRendererValues();

    // A first guess from the user agent decides anti-aliasing, which cannot change after creation.
    this.qualitySetting = this.resolveQualitySetting();
    const preliminaryTier =
      this.qualitySetting === "auto"
        ? detectQualityTier(readDeviceInfo(null))
        : this.qualitySetting;
    this.quality = resolveQualitySettings(preliminaryTier, environmentConfiguration?.quality);

    this.renderer = new WebGLRenderer({
      powerPreference: "high-performance",
      antialias: this.quality.antialias,
      // The canvas is transparent so DOM content behind it (MML m-youtube) can show through holes. Everything else is
      // kept opaque: the clear alpha is 1 and render() forces alpha 1 wherever there is no hole.
      alpha: true,
    });
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.info.autoReset = false;
    this.renderer.setSize(this.width, this.height);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = this.rendererValues.shadowMap as ShadowMapType;
    this.renderer.toneMapping = this.rendererValues.toneMapping as ToneMapping;
    this.renderer.toneMappingExposure = this.rendererValues.exposure;

    this.currentCamera = this.threeJSCameraManager.getActiveCamera();
    const bloom = resolveBloomSettings(environmentConfiguration?.postProcessing);
    this.postProcessingManager = new PostProcessingManager(
      this.renderer,
      this.scene,
      this.currentCamera,
      this.width,
      this.height,
      {
        enabled: this.postProcessingEnabled,
        bloom,
      },
    );

    this.updateBloomValues();
    this.localShadowBudget = new LocalShadowBudget(this.scene, this.quality.shadows.localLights);

    this.hemisphereLight = new HemisphereLight(0xffffff, 0x444444, 1);
    this.hemisphereLight.name = "AmbientHemisphereLight";
    this.scene.add(this.hemisphereLight);

    this.applyConfigurationToValues();

    this.currentAzimuthalAngle = MathUtils.degToRad(this.sunValues.sunPosition.sunAzimuthalAngle);
    this.currentPolarAngle = MathUtils.degToRad(this.sunValues.sunPosition.sunPolarAngle);
    this.currentIntensity = this.sunValues.sunIntensity;

    if (this.spawnSun === true) {
      this.sun = new Sun(this.sunValues);
      this.scene.add(this.sun);
    }

    if (this.environmentConfiguration?.skybox) {
      if ("hdrJpgUrl" in this.environmentConfiguration.skybox) {
        this.useHDRJPG(this.environmentConfiguration.skybox.hdrJpgUrl);
      } else if ("hdrUrl" in this.environmentConfiguration.skybox) {
        this.useHDRI(this.environmentConfiguration.skybox.hdrUrl);
      }
    }

    this.setupSkyShader();
    this.applyToneMapping();
    this.setFog();

    // Now that a WebGL context exists the GPU can be identified.
    this.setQualityTier(this.pickTier(), false);
    if (this.qualitySetting === "auto" && environmentConfiguration?.quality?.adaptive !== false) {
      this.adaptiveMonitor = new AdaptiveQualityMonitor();
    }

    this.resizeListener = () => {
      this.fitContainer();
    };

    window.addEventListener("resize", this.resizeListener, false);

    this.fitContainer();
  }

  /* ------------------------------------------------------------------------------------------ */
  /* Quality                                                                                    */
  /* ------------------------------------------------------------------------------------------ */

  private resolveQualitySetting(): QualityTierSetting {
    return (
      this.urlOverrides.quality ??
      parseQualityTier(this.environmentConfiguration?.quality?.tier) ??
      ENVIRONMENT_DEFAULTS.quality.tier
    );
  }

  private pickTier(): QualityTier {
    if (this.qualitySetting !== "auto") {
      return this.qualitySetting;
    }
    return detectQualityTier(readDeviceInfo(this.renderer));
  }

  public get currentQualityTier(): QualityTier {
    return this.qualityTier;
  }

  /** Applies a quality tier to pixel ratio, shadows, SSAO, bloom and the sky environment map. */
  public setQualityTier(tier: QualityTier, resize: boolean = true) {
    this.qualityTier = tier;
    this.quality = resolveQualitySettings(tier, this.environmentConfiguration?.quality);
    this.envValues.qualityTier = this.qualitySetting;
    this.postProcessingManager.applyQuality(this.quality);
    this.sky?.setEnvironmentSize(this.quality.envMapSize);
    this.localShadowBudget.setBudget(this.quality.shadows.localLights);
    this.applyShadowSettings();
    if (resize) {
      this.fitContainer();
    }
    console.log(`[3d-web-threejs] rendering quality: ${tier} (setting: ${this.qualitySetting})`);
  }

  /** Changes the quality setting ("auto" re-detects and re-enables adaptive quality). */
  public setQualitySetting(setting: QualityTierSetting) {
    this.qualitySetting = setting;
    this.adaptiveMonitor =
      setting === "auto" && this.environmentConfiguration?.quality?.adaptive !== false
        ? new AdaptiveQualityMonitor()
        : null;
    this.setQualityTier(this.pickTier());
  }

  private applyShadowSettings() {
    if (!this.sun) {
      return;
    }
    const shadows = this.sunValues.shadows;
    const distance = shadows.distance > 0 ? shadows.distance : this.quality.shadows.distance;
    this.sun.setShadowQuality(this.quality.shadows.mapSize, distance);
    this.sun.setShadowSoftness(shadows.softness);
    this.sun.setShadowIntensity(shadows.intensity);
    this.sun.setCastShadow(shadows.enabled);
  }

  /* ------------------------------------------------------------------------------------------ */
  /* Configuration                                                                              */
  /* ------------------------------------------------------------------------------------------ */

  /** Copies the environment configuration into the (tweakable) value objects. */
  private applyConfigurationToValues() {
    const c = this.environmentConfiguration;

    // sun
    if (typeof c?.sun?.intensity === "number") {
      this.sunValues.sunIntensity = c.sun.intensity;
    }
    if (typeof c?.sun?.azimuthalAngle === "number") {
      this.sunValues.sunPosition.sunAzimuthalAngle = c.sun.azimuthalAngle;
    }
    if (typeof c?.sun?.polarAngle === "number") {
      this.sunValues.sunPosition.sunPolarAngle = c.sun.polarAngle;
    }
    if (c?.sun?.color) {
      this.sunValues.sunColor = { ...c.sun.color };
    }

    // sky
    const sky = c?.sky;
    if (sky) {
      if (typeof sky.turbidity === "number") this.sunValues.skyTurbidity = sky.turbidity;
      if (typeof sky.rayleigh === "number") this.sunValues.skyRayleigh = sky.rayleigh;
      if (typeof sky.mieCoefficient === "number")
        this.sunValues.skyMieCoefficient = sky.mieCoefficient;
      if (typeof sky.mieDirectionalG === "number")
        this.sunValues.skyMieDirectionalG = sky.mieDirectionalG;
      if (typeof sky.exposure === "number") this.sunValues.skyExposure = sky.exposure;
      if (sky.nightColor) this.sunValues.skyNightColor = { ...sky.nightColor };
      if (typeof sky.stars === "number") this.sunValues.skyStars = sky.stars;
      if (typeof sky.horizonBlend === "number") this.sunValues.skyHorizonBlend = sky.horizonBlend;
    }

    // time of day (the URL ?hour= override wins, for testing)
    const tod = c?.timeOfDay;
    const tv = this.sunValues.timeOfDay;
    const hour = this.urlOverrides.hour ?? (typeof tod?.hour === "number" ? tod.hour : null);
    if (hour !== null) {
      tv.enabled = true;
      // only reset the running clock when the configured hour itself changed
      if (hour !== this.lastConfiguredHour) {
        tv.hour = hour;
        this.lastConfiguredHour = hour;
      }
      tv.cycleMinutes = this.urlOverrides.hour !== null ? 0 : (tod?.cycleMinutes ?? 0);
      tv.azimuthalAngle = tod?.azimuthalAngle ?? ENVIRONMENT_DEFAULTS.timeOfDay.azimuthalAngle;
      tv.maxElevation = tod?.maxElevation ?? ENVIRONMENT_DEFAULTS.timeOfDay.maxElevation;
    } else if (c && "timeOfDay" in c) {
      tv.enabled = false;
      this.lastConfiguredHour = null;
    }

    // shadows
    const shadows = c?.shadows;
    if (shadows) {
      if (typeof shadows.enabled === "boolean") this.sunValues.shadows.enabled = shadows.enabled;
      if (typeof shadows.distance === "number") this.sunValues.shadows.distance = shadows.distance;
      if (typeof shadows.softness === "number") this.sunValues.shadows.softness = shadows.softness;
      if (typeof shadows.intensity === "number")
        this.sunValues.shadows.intensity = shadows.intensity;
    }

    // env map / skybox
    if (typeof c?.envMap?.intensity === "number") {
      this.envValues.envMapIntensity = c.envMap.intensity;
    }
    this.scene.environmentIntensity = this.envValues.envMapIntensity;
    if (typeof c?.skybox?.intensity === "number") {
      this.envValues.skyboxIntensity = c.skybox.intensity;
    }
    this.scene.backgroundIntensity = this.envValues.skyboxIntensity;
    if (typeof c?.skybox?.blurriness === "number") {
      this.envValues.skyboxBlurriness = c.skybox.blurriness;
    }
    this.scene.backgroundBlurriness = this.envValues.skyboxBlurriness;
    if (typeof c?.skybox?.azimuthalAngle === "number") {
      this.envValues.skyboxAzimuthalAngle = c.skybox.azimuthalAngle;
    }
    if (typeof c?.skybox?.polarAngle === "number") {
      this.envValues.skyboxPolarAngle = c.skybox.polarAngle;
    }
    this.updateSkyboxRotation();

    // ambient
    const ambient = c?.ambientLight;
    if (typeof ambient?.intensity === "number") {
      this.envValues.ambientLight.ambientLightIntensity = ambient.intensity;
    }
    if (ambient?.color) {
      this.envValues.ambientLight.ambientLightColor = { ...ambient.color };
    }
    if (ambient?.groundColor) {
      this.envValues.ambientLight.ambientLightGroundColor = { ...ambient.groundColor };
    }

    // fog
    const fog = c?.fog;
    if (typeof fog?.fogNear === "number") {
      this.envValues.fog.fogNear = fog.fogNear;
    }
    if (typeof fog?.fogFar === "number") {
      this.envValues.fog.fogFar = fog.fogFar;
    }
    if (
      typeof fog?.fogColor?.r === "number" &&
      typeof fog?.fogColor?.g === "number" &&
      typeof fog?.fogColor?.b === "number"
    ) {
      this.envValues.fog.fogColor = { ...fog.fogColor };
      this.envValues.fog.fogColorFromSky = false;
    }

    // post-processing values that live on the renderer
    const pp = c?.postProcessing;
    if (pp?.toneMapping && TONE_MAPPINGS[pp.toneMapping] !== undefined) {
      this.rendererValues.toneMapping = TONE_MAPPINGS[pp.toneMapping];
    }
    if (typeof pp?.exposure === "number") {
      this.rendererValues.exposure = pp.exposure;
    }
  }

  public updateEnvironmentConfiguration(environmentConfiguration: EnvironmentConfiguration) {
    this.environmentConfiguration = environmentConfiguration;

    if (environmentConfiguration.skybox) {
      if ("hdrJpgUrl" in environmentConfiguration.skybox) {
        this.useHDRJPG(environmentConfiguration.skybox.hdrJpgUrl);
      } else if ("hdrUrl" in environmentConfiguration.skybox) {
        this.useHDRI(environmentConfiguration.skybox.hdrUrl);
      }
    }

    this.applyConfigurationToValues();
    this.applyToneMapping();
    this.updateBloomValues();
    this.setFog();

    const setting = this.resolveQualitySetting();
    if (setting !== this.qualitySetting) {
      this.setQualitySetting(setting);
    } else {
      this.setQualityTier(this.qualityTier);
    }
  }

  private applyToneMapping() {
    this.renderer.toneMapping = this.rendererValues.toneMapping as ToneMapping;
    this.postProcessingManager.setRendererToneMapping(this.renderer.toneMapping);
  }

  private updateBloomValues() {
    const pp = this.environmentConfiguration?.postProcessing;
    const bloom = resolveBloomSettings(pp);
    this.postProcessingManager.updateEffectConfiguration({
      bloom,
      grain: typeof pp?.grain === "number" ? { amount: pp.grain } : undefined,
      ssao:
        typeof pp?.ambientOcclusion === "number"
          ? { intensity: pp.ambientOcclusion * 0.7 }
          : undefined,
    });
  }

  /**
   * Sets the element behind the canvas that holds DOM content shown through holes in the canvas (for MML m-youtube).
   */
  public setDOMOverlayContainer(container: HTMLElement | null) {
    this.domOverlayContainer = container;
  }

  public dispose() {
    window.removeEventListener("resize", this.resizeListener);
    this.sky?.dispose();
    this.renderer.dispose();
    this.postProcessingManager.dispose();
    this.holeAlphaApplier.dispose();
  }

  public fitContainer() {
    const parentElement = this.renderer.domElement.parentNode as HTMLElement;
    if (!parentElement) {
      return;
    }
    this.width = parentElement.clientWidth;
    this.height = parentElement.clientHeight;
    this.threeJSCameraManager.updateAspect(this.width / this.height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.quality.maxPixelRatio));

    // the renderer size must be set first: the post-processing sizes come from its drawing buffer
    this.renderer.setSize(this.width, this.height);
    this.postProcessingManager.resizeActiveEffects(this.width, this.height);
  }

  /* ------------------------------------------------------------------------------------------ */
  /* Per frame                                                                                  */
  /* ------------------------------------------------------------------------------------------ */

  public render(deltaTimeSeconds: number = 1 / 60): void {
    // check if camera has changed and update PostProcessingManager
    if (this.currentCamera !== this.threeJSCameraManager.getActiveCamera()) {
      this.currentCamera = this.threeJSCameraManager.getActiveCamera();
      this.postProcessingManager.updateCamera(this.currentCamera);
    }

    this.updateAdaptiveQuality(deltaTimeSeconds);
    this.updateTimeOfDay(deltaTimeSeconds);
    this.updateSun();
    this.updateLighting();
    this.updateSkyAndEnvironment(deltaTimeSeconds);
    this.localShadowBudget.update(this.currentCamera.position, deltaTimeSeconds);

    this.renderer.info.reset();
    const holeShown = this.domOverlayContainer?.hasAttribute(HOLE_PUNCH_ATTRIBUTE) ?? false;
    if (this.postProcessingManager.isGloballyEnabled) {
      this.postProcessingManager.setHoleMaskEnabled(holeShown);
      this.postProcessingManager.render(deltaTimeSeconds);
      const mask = holeShown ? this.postProcessingManager.getHoleMaskTexture() : null;
      if (!holeShown || mask) {
        // Put the scene's alpha (captured before the effects) back, or make the canvas opaque
        this.holeAlphaApplier.apply(this.renderer, mask);
      }
    } else {
      this.renderer.render(this.scene, this.threeJSCameraManager.getActiveCamera());
      if (!holeShown) {
        this.holeAlphaApplier.apply(this.renderer, null);
      }
    }
    this.renderer.clearDepth();
    this.renderer.render(this.postPostScene, this.threeJSCameraManager.getActiveCamera());
  }

  private updateAdaptiveQuality(deltaTimeSeconds: number) {
    if (!this.adaptiveMonitor) {
      return;
    }
    if (this.adaptiveMonitor.addFrame(deltaTimeSeconds)) {
      const lower = lowerQualityTier(this.qualityTier);
      if (lower) {
        console.warn(`[3d-web-threejs] frames are slow, lowering quality to ${lower}`);
        this.setQualityTier(lower);
        this.adaptiveMonitor.reset();
      } else {
        this.adaptiveMonitor = null;
      }
    }
  }

  private updateTimeOfDay(deltaTimeSeconds: number) {
    const tv = this.sunValues.timeOfDay;
    if (!tv.enabled) {
      this.timeOfDay = null;
      return;
    }
    tv.hour = advanceHour(tv.hour, deltaTimeSeconds, tv.cycleMinutes);
    this.timeOfDay = computeTimeOfDay(tv.hour, {
      azimuthalAngle: tv.azimuthalAngle,
      maxElevation: tv.maxElevation,
    });
  }

  public updateSun() {
    const tod = this.timeOfDay;
    const targetAzimuthalAngle = MathUtils.degToRad(
      tod ? tod.lightAzimuthalAngle : this.sunValues.sunPosition.sunAzimuthalAngle,
    );
    const targetPolarAngle = MathUtils.degToRad(
      tod ? tod.lightPolarAngle : this.sunValues.sunPosition.sunPolarAngle,
    );
    const targetIntensity = this.sunValues.sunIntensity * (tod ? tod.lightIntensityScale : 1);

    if (tod) {
      // time of day already moves smoothly; follow it exactly
      this.currentAzimuthalAngle = targetAzimuthalAngle;
      this.currentPolarAngle = targetPolarAngle;
      this.currentIntensity = targetIntensity;
    } else {
      // configuration changes glide into place
      this.currentAzimuthalAngle = this.lerpAngle(
        this.currentAzimuthalAngle,
        targetAzimuthalAngle,
        this.lerpSpeed,
      );
      if (Math.abs(this.currentAzimuthalAngle - targetAzimuthalAngle) < 0.001) {
        this.currentAzimuthalAngle = targetAzimuthalAngle;
      }
      this.currentPolarAngle = this.lerpAngle(
        this.currentPolarAngle,
        targetPolarAngle,
        this.lerpSpeed,
      );
      if (Math.abs(this.currentPolarAngle - targetPolarAngle) < 0.001) {
        this.currentPolarAngle = targetPolarAngle;
      }
      this.currentIntensity = this.lerp(this.currentIntensity, targetIntensity, this.lerpSpeed);
      if (Math.abs(this.currentIntensity - targetIntensity) < 0.001) {
        this.currentIntensity = targetIntensity;
      }
    }

    if (!this.sun) {
      return;
    }
    this.sun.setAzimuthalAngle(this.currentAzimuthalAngle);
    this.sun.setPolarAngle(this.currentPolarAngle);
    this.sun.setIntensity(this.currentIntensity);
    const c = this.sunValues.sunColor;
    if (tod) {
      this.sun.setColorRGB(c.r * tod.lightColor.r, c.g * tod.lightColor.g, c.b * tod.lightColor.b);
    } else {
      this.sun.setColorRGB(c.r, c.g, c.b);
    }
  }

  /** Ambient, fog colour, exposure and bloom for the current time of day. */
  private updateLighting() {
    const tod = this.timeOfDay;
    const amb = this.envValues.ambientLight;

    // hemisphere ambient light
    let intensity = amb.ambientLightIntensity;
    const sky = amb.ambientLightColor;
    const ground = amb.ambientLightGroundColor;
    if (tod) {
      intensity *= tod.ambientScale;
      // the time of day tints the configured colours (default colours are the daytime ones)
      const daySky = ENVIRONMENT_DEFAULTS.ambientLight.color;
      const dayGround = ENVIRONMENT_DEFAULTS.ambientLight.groundColor;
      this.hemisphereLight.color.setRGB(
        (sky.r * tod.ambientSkyColor.r) / daySky.r,
        (sky.g * tod.ambientSkyColor.g) / daySky.g,
        (sky.b * tod.ambientSkyColor.b) / daySky.b,
      );
      this.hemisphereLight.groundColor.setRGB(
        (ground.r * tod.ambientGroundColor.r) / dayGround.r,
        (ground.g * tod.ambientGroundColor.g) / dayGround.g,
        (ground.b * tod.ambientGroundColor.b) / dayGround.b,
      );
    } else {
      this.hemisphereLight.color.setRGB(sky.r, sky.g, sky.b);
      this.hemisphereLight.groundColor.setRGB(ground.r, ground.g, ground.b);
    }
    this.hemisphereLight.intensity = intensity;

    // fog colour
    const fog = this.scene.fog as Fog | null;
    if (fog) {
      this.getFogColor(fog.color);
    }

    // exposure and bloom
    this.renderer.toneMappingExposure = this.rendererValues.exposure * (tod?.exposureScale ?? 1);
    this.postProcessingManager.setBloomScale(tod?.bloomScale ?? 1);
  }

  /** The fog colour: explicit, or the sky's horizon colour for the procedural sky. */
  private getFogColor(target: Color): Color {
    const fogValues = this.envValues.fog;
    if (fogValues.fogColorFromSky && !this.hasHDR()) {
      const c = this.timeOfDay?.fogColor ?? ENVIRONMENT_DEFAULTS.fog.dayColor;
      return target.setRGB(c.r, c.g, c.b);
    }
    return target.setRGB(fogValues.fogColor.r, fogValues.fogColor.g, fogValues.fogColor.b);
  }

  private updateSkyAndEnvironment(deltaTimeSeconds: number) {
    if (!this.sky) {
      return;
    }
    const tod = this.timeOfDay;
    const sunPolar = tod ? tod.sunPolarAngle : MathUtils.radToDeg(this.currentPolarAngle);
    const sunAzimuth = tod ? tod.sunAzimuthalAngle : MathUtils.radToDeg(this.currentAzimuthalAngle);
    const night = tod ? 1 - tod.daylight : 0;
    const nightColor = this.sunValues.skyNightColor;
    const ground = this.hemisphereLight.groundColor;
    this.sky.setParameters({
      turbidity: this.sunValues.skyTurbidity,
      rayleigh: this.sunValues.skyRayleigh,
      mieCoefficient: this.sunValues.skyMieCoefficient,
      mieDirectionalG: this.sunValues.skyMieDirectionalG,
      exposure: this.sunValues.skyExposure,
      sunPolarAngle: MathUtils.degToRad(sunPolar),
      sunAzimuthalAngle: MathUtils.degToRad(sunAzimuth),
      horizonColor: this.getFogColor(tempColor),
      horizonBlend: this.sunValues.skyHorizonBlend,
      nightColor: tempColor2.setRGB(nightColor.r, nightColor.g, nightColor.b),
      night,
      stars: (tod?.stars ?? 0) * this.sunValues.skyStars,
      groundColor: tempColor3.copy(ground).multiplyScalar(0.35),
    });

    // Regenerating the environment map costs a few milliseconds, so while the sky keeps changing
    // (time-of-day cycle) do it at most every 2 s (5 s on the low tier).
    this.secondsSinceEnvUpdate += deltaTimeSeconds;
    const interval = this.qualityTier === "low" ? 5 : 2;
    if (
      this.sky.needsEnvironmentUpdate &&
      (this.secondsSinceEnvUpdate >= interval || !this.sky.environmentTexture)
    ) {
      this.secondsSinceEnvUpdate = 0;
      this.scene.environment = this.sky.updateEnvironment(this.renderer);
    }
    this.scene.environmentIntensity = this.envValues.envMapIntensity;
  }

  /* ------------------------------------------------------------------------------------------ */
  /* Sky, skybox, fog, ambient (also called from the tweakpane)                                 */
  /* ------------------------------------------------------------------------------------------ */

  private setupSkyShader() {
    if (this.hasHDR()) {
      return;
    }
    this.sky = new ProceduralSky();
    this.sky.setEnvironmentSize(this.quality.envMapSize);
    this.scene.add(this.sky.mesh);
  }

  private hasHDR(): boolean {
    if (!this.environmentConfiguration?.skybox) {
      return false;
    } else {
      const hasHDRJPG = "hdrJpgUrl" in this.environmentConfiguration.skybox;
      const hasHDRi = "hdrUrl" in this.environmentConfiguration.skybox;
      return hasHDRJPG || hasHDRi;
    }
  }

  public updateSkyboxRotation() {
    if (this.sky) {
      return;
    }
    this.scene.backgroundRotation = new Euler(
      MathUtils.degToRad(this.envValues.skyboxPolarAngle),
      MathUtils.degToRad(this.envValues.skyboxAzimuthalAngle),
      0,
    );
    this.scene.environmentRotation = new Euler(
      MathUtils.degToRad(this.envValues.skyboxPolarAngle),
      MathUtils.degToRad(this.envValues.skyboxAzimuthalAngle),
      0,
    );
  }

  private async loadHDRJPG(url: string): Promise<Texture> {
    return new Promise((resolve, reject) => {
      const pmremGenerator = new PMREMGenerator(this.renderer);
      const hdrJpg = new HDRJPGLoader(this.renderer).load(url, () => {
        const hdrJpgEquirectangularMap = hdrJpg.renderTarget.texture;
        hdrJpgEquirectangularMap.mapping = EquirectangularReflectionMapping;
        hdrJpgEquirectangularMap.needsUpdate = true;

        const envMap = pmremGenerator!.fromEquirectangular(hdrJpgEquirectangularMap).texture;
        hdrJpgEquirectangularMap.dispose();
        pmremGenerator!.dispose();
        hdrJpg.dispose();
        if (envMap) {
          envMap.colorSpace = LinearSRGBColorSpace;
          envMap.needsUpdate = true;
          resolve(envMap);
        } else {
          reject("Failed to generate environment map");
        }
      });
    });
  }

  private async loadHDRi(url: string): Promise<Texture> {
    return new Promise((resolve, reject) => {
      const pmremGenerator = new PMREMGenerator(this.renderer);
      new RGBELoader(new LoadingManager()).load(url, (texture) => {
        const envMap = pmremGenerator!.fromEquirectangular(texture).texture;
        texture.dispose();
        pmremGenerator!.dispose();
        if (envMap) {
          envMap.colorSpace = LinearSRGBColorSpace;
          envMap.needsUpdate = true;
          resolve(envMap);
        } else {
          reject("Failed to generate environment map");
        }
      });
    });
  }

  public useHDRJPG(url: string): void {
    if (this.skyboxState.src.hdrJpgUrl === url) {
      return;
    }

    const hdrJPGPromise = this.loadHDRJPG(url);
    this.skyboxState.src = { hdrJpgUrl: url };
    this.skyboxState.latestPromise = hdrJPGPromise;
    hdrJPGPromise.then((envMap) => {
      if (this.skyboxState.latestPromise !== hdrJPGPromise) {
        return;
      }
      this.applyEnvMap(envMap);
    });
  }

  public useHDRI(url: string): void {
    if (this.skyboxState.src.hdrUrl === url) {
      return;
    }
    const hdrPromise = this.loadHDRi(url);
    this.skyboxState.src = { hdrUrl: url };
    this.skyboxState.latestPromise = hdrPromise;
    hdrPromise.then((envMap) => {
      if (this.skyboxState.latestPromise !== hdrPromise) {
        return;
      }
      this.applyEnvMap(envMap);
    });
  }

  public setHDRIFromFile(): void {
    if (!this.renderer) return;
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = ".hdr,.jpg";
    fileInput.addEventListener("change", () => {
      const file = fileInput.files?.[0];
      if (!file) {
        console.log("no file");
        return;
      }
      const extension = file.name.split(".").pop();
      const fileURL = URL.createObjectURL(file);
      if (fileURL) {
        if (extension === "hdr") {
          this.useHDRI(fileURL);
        } else if (extension === "jpg") {
          this.useHDRJPG(fileURL);
        } else {
          console.error(`Unrecognized extension for HDR file ${file.name}`);
        }
        URL.revokeObjectURL(fileURL);
        document.body.removeChild(fileInput);
      }
    });
    document.body.appendChild(fileInput);
    fileInput.click();
  }

  /** (Re)creates the fog from the current values. fogFar 0 disables fog. */
  public setFog(): void {
    if (this.envValues.fog.fogFar === 0) {
      this.scene.fog = null;
      return;
    }
    const color = this.getFogColor(new Color());
    const fog = this.scene.fog as Fog | null;
    if (fog && (fog as Fog).isFog) {
      fog.color.copy(color);
      fog.near = this.envValues.fog.fogNear;
      fog.far = this.envValues.fog.fogFar;
    } else {
      this.scene.fog = new Fog(color, this.envValues.fog.fogNear, this.envValues.fog.fogFar);
    }
  }

  /** Kept for the tweakpane: the hemisphere light is updated every frame from the values. */
  public setAmbientLight(): void {
    this.updateLighting();
  }

  /** Called by the tweakpane after values changed. */
  public updateSkyShaderValues() {
    this.applyShadowSettings();
    this.applyToneMapping();
  }

  public togglePostProcessing(enabled: boolean) {
    this.postProcessingManager.toggleGlobalPostProcessing(enabled);
  }

  private lerp(current: number, target: number, speed: number): number {
    return current + (target - current) * speed;
  }

  private lerpAngle(current: number, target: number, speed: number): number {
    // Calculate the shortest angular distance
    let diff = target - current;

    // Normalize the difference to [-π, π]
    while (diff > Math.PI) {
      diff -= 2 * Math.PI;
    }
    while (diff < -Math.PI) {
      diff += 2 * Math.PI;
    }

    // Lerp using the shortest path
    return current + diff * speed;
  }

  private applyEnvMap(envMap: Texture) {
    if (this.sky) {
      return;
    }
    this.scene.environment = envMap;
    this.scene.environmentIntensity = this.envValues.envMapIntensity;
    this.scene.environmentRotation = new Euler(
      MathUtils.degToRad(this.envValues.skyboxPolarAngle),
      MathUtils.degToRad(this.envValues.skyboxAzimuthalAngle),
      0,
    );
    this.scene.background = envMap;
    this.scene.backgroundIntensity = this.envValues.skyboxIntensity;
    this.scene.backgroundBlurriness = this.envValues.skyboxBlurriness;
    this.scene.backgroundRotation = new Euler(
      MathUtils.degToRad(this.envValues.skyboxPolarAngle),
      MathUtils.degToRad(this.envValues.skyboxAzimuthalAngle),
      0,
    );
  }
}
