import { QualitySettings } from "@mml-io/3d-web-client-core";
import {
  Effect,
  EffectAttribute,
  EffectComposer,
  EffectPass,
  FXAAEffect,
  RenderPass,
  ToneMappingEffect,
  ToneMappingMode,
} from "postprocessing";
import {
  ACESFilmicToneMapping,
  AgXToneMapping,
  CineonToneMapping,
  CustomToneMapping,
  HalfFloatType,
  LinearToneMapping,
  NeutralToneMapping,
  NoToneMapping,
  PerspectiveCamera,
  ReinhardToneMapping,
  Scene,
  ToneMapping,
  Vector2,
  WebGLRenderer,
} from "three";

import { BCSValues, createDefaultBCSValues } from "../tweakpane/blades/effects/bcsFolder";
import {
  BloomAndGrainValues,
  createDefaultBloomAndGrainValues,
} from "../tweakpane/blades/effects/bloomAndGrain";
import { N8SSAOValues, createDefaultN8SSAOValues } from "../tweakpane/blades/effects/ssaoFolder";
import {
  ToneMappingValues,
  createDefaultToneMappingValues,
} from "../tweakpane/blades/effects/toneMappingFolder";
import {
  PostProcessingGlobalValues,
  createDefaultPostProcessingGlobalValues,
} from "../tweakpane/blades/postProcessingFolder";

import { BrightnessContrastSaturation } from "./bright-contrast-sat";
import { ColorGradeEffect } from "./ColorGradeEffect";
import { BloomMode, EmissiveBloomEffect } from "./EmissiveBloomEffect";
import { GaussGrainEffect } from "./gauss-grain";
import { N8SSAOPass } from "./n8-ssao/N8SSAOPass";

export const PP_GLOBALLY_ENABLED = false;

export interface EffectState {
  name: string;
  enabled: boolean;
  wasEnabledBeforeGlobalDisable: boolean;
  instance: any; // Effect or Pass
  passIndex?: number;
}

export interface PostProcessingConfig {
  enabled?: boolean;
  bloom?: {
    intensity?: number;
    mode?: BloomMode;
    threshold?: number;
    smoothing?: number;
    radius?: number;
  };
  bcs?: {
    brightness?: number;
    contrast?: number;
    saturation?: number;
  };
  grain?: { amount?: number };
  ssao?: {
    enabled?: boolean;
    halfRes?: boolean;
    aoRadius?: number;
    distanceFalloff?: number;
    intensity?: number;
    aoSamples?: number;
    denoiseSamples?: number;
    denoiseRadius?: number;
  };
  toneMapping?: {
    mode?: number;
    resolution?: number;
    whitePoint?: number;
    middleGrey?: number;
    minLuminance?: number;
    averageLuminance?: number;
    adaptationRate?: number;
  };
}

/** Maps a three.js renderer tone mapping to the postprocessing ToneMappingEffect mode. */
export function toneMappingModeFor(toneMapping: ToneMapping): ToneMappingMode | null {
  switch (toneMapping) {
    case NoToneMapping:
    case LinearToneMapping:
      return ToneMappingMode.LINEAR;
    case ReinhardToneMapping:
      return ToneMappingMode.REINHARD;
    case CineonToneMapping:
      return ToneMappingMode.OPTIMIZED_CINEON;
    case ACESFilmicToneMapping:
      return ToneMappingMode.ACES_FILMIC;
    case AgXToneMapping:
      return ToneMappingMode.AGX;
    case NeutralToneMapping:
      return ToneMappingMode.NEUTRAL;
    case CustomToneMapping:
    default:
      return null;
  }
}

/**
 * EffectPass orders merged effects by their attribute flags (highest first). FXAA re-reads the input buffer
 * and replaces the colour of any earlier effect, so it must run first: it is flagged as a convolution
 * effect that also uses depth, which sorts it ahead of the bloom (depth only). FXAA does not read depth.
 */
class FirstFXAAEffect extends FXAAEffect {
  constructor() {
    super();
    this.setAttributes(EffectAttribute.CONVOLUTION | EffectAttribute.DEPTH);
  }
}

// Effects merged into the single full-screen EffectPass, in order. FXAA samples its neighbours from the
// input buffer, so it has to come first.
const MERGED_EFFECT_ORDER = ["fxaa", "bloom", "toneMapping", "bcs", "grain"];

/**
 * Post-processing pipeline:
 *   RenderPass -> (N8 SSAO) -> one EffectPass [FXAA, emissive bloom, tone mapping, colour grade + grain]
 *
 * Merging the screen-space effects into one EffectPass means one full-screen pass at full resolution
 * instead of five, which matters most on phones (fill rate and memory bandwidth).
 */
export class PostProcessingManager {
  public isGloballyEnabled: boolean = PP_GLOBALLY_ENABLED;
  public effectComposer: EffectComposer;

  private effectStates = new Map<string, EffectState>();
  private renderPass: RenderPass;
  private mergedPass: EffectPass | null = null;

  private fxaaEffect: FXAAEffect;
  private bloomEffect: EmissiveBloomEffect;
  private toneMappingEffect: ToneMappingEffect;
  private colorGradeEffect: ColorGradeEffect;
  private n8aopass: N8SSAOPass;
  private bcs = BrightnessContrastSaturation;
  private gaussGrainEffect = GaussGrainEffect;

  private quality: QualitySettings | null = null;
  /** Scales the configured bloom intensity (e.g. stronger glow at night). */
  private bloomScale = 1;

  public resolution: Vector2;

  public readonly postProcessingGlobalValues: PostProcessingGlobalValues;
  public readonly bcsValues: BCSValues;
  public readonly bloomAndGrainValues: BloomAndGrainValues;
  public readonly n8ssaoValues: N8SSAOValues;
  public readonly toneMappingValues: ToneMappingValues;

  // Compatibility shim for code that toggled the old separate tone mapping pass.
  private readonly toneMappingPassShim: { enabled: boolean };

  constructor(
    private renderer: WebGLRenderer,
    private scene: Scene,
    private camera: PerspectiveCamera,
    private width: number,
    private height: number,
    initialConfig?: PostProcessingConfig,
  ) {
    this.postProcessingGlobalValues = createDefaultPostProcessingGlobalValues();
    this.bcsValues = createDefaultBCSValues();
    this.bloomAndGrainValues = createDefaultBloomAndGrainValues();
    this.n8ssaoValues = createDefaultN8SSAOValues();
    this.toneMappingValues = createDefaultToneMappingValues();

    this.isGloballyEnabled = initialConfig?.enabled ?? PP_GLOBALLY_ENABLED;
    this.resolution = new Vector2(this.width, this.height);

    this.effectComposer = new EffectComposer(this.renderer, {
      frameBufferType: HalfFloatType,
    });

    const isEnabled = () => this.isEffectEnabled("toneMapping");
    const setEnabled = (value: boolean) =>
      value ? this.enableEffect("toneMapping") : this.disableEffect("toneMapping");
    this.toneMappingPassShim = {
      get enabled() {
        return isEnabled();
      },
      set enabled(value: boolean) {
        setEnabled(value);
      },
    };

    this.initializeEffects(initialConfig);
    this.setupPipeline();
  }

  private initializeEffects(config?: PostProcessingConfig) {
    this.fxaaEffect = new FirstFXAAEffect();

    this.bloomAndGrainValues.bloom = config?.bloom?.intensity ?? this.bloomAndGrainValues.bloom;
    this.bloomAndGrainValues.bloomMode = config?.bloom?.mode ?? this.bloomAndGrainValues.bloomMode;
    this.bloomAndGrainValues.bloomThreshold =
      config?.bloom?.threshold ?? this.bloomAndGrainValues.bloomThreshold;
    this.bloomAndGrainValues.bloomSmoothing =
      config?.bloom?.smoothing ?? this.bloomAndGrainValues.bloomSmoothing;
    this.bloomAndGrainValues.bloomRadius =
      config?.bloom?.radius ?? this.bloomAndGrainValues.bloomRadius;
    this.bloomEffect = new EmissiveBloomEffect(this.scene, this.camera, {
      mode: this.bloomAndGrainValues.bloomMode,
      intensity: this.bloomAndGrainValues.bloom,
      threshold: this.bloomAndGrainValues.bloomThreshold,
      smoothing: this.bloomAndGrainValues.bloomSmoothing,
      radius: this.bloomAndGrainValues.bloomRadius,
      levels: 8,
      resolutionScale: 0.5,
    });

    this.toneMappingEffect = new ToneMappingEffect({
      mode: config?.toneMapping?.mode ?? this.toneMappingValues.mode,
      resolution: config?.toneMapping?.resolution ?? this.toneMappingValues.resolution,
      whitePoint: config?.toneMapping?.whitePoint ?? this.toneMappingValues.whitePoint,
      middleGrey: config?.toneMapping?.middleGrey ?? this.toneMappingValues.middleGrey,
      minLuminance: config?.toneMapping?.minLuminance ?? this.toneMappingValues.minLuminance,
      averageLuminance:
        config?.toneMapping?.averageLuminance ?? this.toneMappingValues.averageLuminance,
      adaptationRate: config?.toneMapping?.adaptationRate ?? this.toneMappingValues.adaptationRate,
    });

    this.n8aopass = new N8SSAOPass(this.scene, this.camera, this.width, this.height);

    this.n8aopass.configuration.halfRes = config?.ssao?.halfRes ?? this.n8ssaoValues.halfRes;
    this.n8aopass.configuration.aoRadius = config?.ssao?.aoRadius ?? this.n8ssaoValues.aoRadius;
    this.n8aopass.configuration.distanceFalloff =
      config?.ssao?.distanceFalloff ?? this.n8ssaoValues.distanceFalloff;
    this.n8aopass.configuration.intensity = config?.ssao?.intensity ?? this.n8ssaoValues.intensity;
    this.n8aopass.configuration.aoSamples = config?.ssao?.aoSamples ?? this.n8ssaoValues.aoSamples;
    this.n8aopass.configuration.denoiseSamples =
      config?.ssao?.denoiseSamples ?? this.n8ssaoValues.denoiseSamples;
    this.n8aopass.configuration.denoiseRadius =
      config?.ssao?.denoiseRadius ?? this.n8ssaoValues.denoiseRadius;

    this.colorGradeEffect = new ColorGradeEffect();
    this.bcs.uniforms.brightness.value = config?.bcs?.brightness ?? this.bcsValues.brightness;
    this.bcs.uniforms.contrast.value = config?.bcs?.contrast ?? this.bcsValues.contrast;
    this.bcs.uniforms.saturation.value = config?.bcs?.saturation ?? this.bcsValues.saturation;
    this.gaussGrainEffect.uniforms.amount.value =
      config?.grain?.amount ?? this.bloomAndGrainValues.grain;
    this.gaussGrainEffect.uniforms.alpha.value = 1.0;

    this.registerEffect(
      "n8ssao",
      this.n8aopass,
      config?.ssao?.enabled ?? this.n8ssaoValues.enabled,
    );
    this.registerEffect("fxaa", this.fxaaEffect, true);
    this.registerEffect("bloom", this.bloomEffect, true);
    this.registerEffect("toneMapping", this.toneMappingEffect, true);
    this.registerEffect("bcs", this.colorGradeEffect, true);
    this.registerEffect("grain", this.colorGradeEffect, true);
  }

  private registerEffect(name: string, instance: any, defaultEnabled: boolean = true) {
    this.effectStates.set(name, {
      name,
      enabled: defaultEnabled,
      wasEnabledBeforeGlobalDisable: defaultEnabled,
      instance,
    });
  }

  private setupPipeline() {
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.effectComposer.addPass(this.renderPass);
    this.rebuildPipeline();
  }

  private rebuildPipeline() {
    // remove all passes except the render pass
    while (this.effectComposer.passes.length > 1) {
      this.effectComposer.removePass(this.effectComposer.passes[1]);
    }
    // The merged pass is rebuilt from the enabled effects. Its effects are reused, so only the pass's own
    // material is released here (EffectPass.dispose would also dispose the effects).
    if (this.mergedPass) {
      const oldPass = this.mergedPass as any;
      for (const effect of oldPass.effects as Effect[]) {
        effect.removeEventListener("change", oldPass.listener);
      }
      this.mergedPass.fullscreenMaterial.dispose();
      this.mergedPass = null;
    }

    if (!this.isGloballyEnabled) return;

    const ssao = this.effectStates.get("n8ssao");
    if (ssao?.enabled) {
      this.effectComposer.addPass(this.n8aopass);
      ssao.passIndex = this.effectComposer.passes.length - 1;
    }

    this.colorGradeEffect.bcsEnabled = this.isEffectEnabled("bcs");
    this.colorGradeEffect.grainEnabled =
      this.isEffectEnabled("grain") && (this.quality?.grain ?? true);

    const effects: Effect[] = [];
    for (const name of MERGED_EFFECT_ORDER) {
      const state = this.effectStates.get(name);
      if (!state?.enabled) {
        continue;
      }
      if (name === "grain" && effects.includes(this.colorGradeEffect)) {
        continue;
      }
      if (name === "grain" && !this.colorGradeEffect.grainEnabled) {
        continue;
      }
      effects.push(state.instance as Effect);
    }
    if (effects.length === 0) {
      // keep a pass so the image still reaches the screen with the correct output colour space
      effects.push(this.toneMappingEffect);
    }
    this.mergedPass = new EffectPass(this.camera, ...effects);
    this.effectComposer.addPass(this.mergedPass);
    for (const name of MERGED_EFFECT_ORDER) {
      const state = this.effectStates.get(name);
      if (state) {
        state.passIndex = this.effectComposer.passes.length - 1;
      }
    }
  }

  public enableEffect(name: string) {
    const effectState = this.effectStates.get(name);
    if (effectState && !effectState.enabled) {
      effectState.enabled = true;
      effectState.wasEnabledBeforeGlobalDisable = true;
      if (this.isGloballyEnabled) {
        this.rebuildPipeline();
      }
    }
  }

  public disableEffect(name: string) {
    const effectState = this.effectStates.get(name);
    if (effectState && effectState.enabled) {
      effectState.enabled = false;
      effectState.wasEnabledBeforeGlobalDisable = false;
      if (this.isGloballyEnabled) {
        this.rebuildPipeline();
      }
    }
  }

  public toggleGlobalPostProcessing(enabled?: boolean) {
    const next = enabled ?? !this.isGloballyEnabled;
    if (next === this.isGloballyEnabled) {
      return;
    }
    this.isGloballyEnabled = next;

    if (this.isGloballyEnabled) {
      // restore previously enabled effects
      this.effectStates.forEach((state) => {
        state.enabled = state.wasEnabledBeforeGlobalDisable;
      });
    } else {
      // store current states and disable all
      this.effectStates.forEach((state) => {
        state.wasEnabledBeforeGlobalDisable = state.enabled;
        state.enabled = false;
      });
    }

    this.rebuildPipeline();
  }

  /**
   * Applies a quality tier: SSAO on/off and its resolution and samples, bloom resolution and mip levels,
   * and grain.
   */
  public applyQuality(quality: QualitySettings) {
    this.quality = quality;
    this.bloomEffect.bloomResolutionScale = quality.bloom.resolutionScale;
    this.bloomEffect.mipmapBlurPass.levels = quality.bloom.levels;

    this.n8ssaoValues.halfRes = quality.ssao.halfRes;
    this.n8ssaoValues.aoSamples = quality.ssao.aoSamples;
    this.n8ssaoValues.denoiseSamples = quality.ssao.denoiseSamples;
    if (this.n8aopass.configuration.halfRes !== quality.ssao.halfRes) {
      this.n8aopass.configuration.halfRes = quality.ssao.halfRes;
    }
    if (this.n8aopass.configuration.aoSamples !== quality.ssao.aoSamples) {
      this.n8aopass.configuration.aoSamples = quality.ssao.aoSamples;
    }
    if (this.n8aopass.configuration.denoiseSamples !== quality.ssao.denoiseSamples) {
      this.n8aopass.configuration.denoiseSamples = quality.ssao.denoiseSamples;
    }

    const ssaoState = this.effectStates.get("n8ssao")!;
    this.n8ssaoValues.enabled = quality.ssao.enabled;
    if (this.isGloballyEnabled) {
      ssaoState.enabled = quality.ssao.enabled;
      ssaoState.wasEnabledBeforeGlobalDisable = quality.ssao.enabled;
    } else {
      ssaoState.wasEnabledBeforeGlobalDisable = quality.ssao.enabled;
    }
    this.rebuildPipeline();
    this.effectComposer.setSize(this.width, this.height);
  }

  /** Keeps the tone mapping effect in step with the renderer's tone mapping choice. */
  public setRendererToneMapping(toneMapping: ToneMapping) {
    const mode = toneMappingModeFor(toneMapping);
    // CustomToneMapping keeps the mode chosen in the tone mapping folder
    this.toneMappingEffect.mode = mode ?? this.toneMappingValues.mode;
  }

  public setBloomScale(scale: number) {
    if (scale === this.bloomScale) {
      return;
    }
    this.bloomScale = scale;
    this.bloomEffect.intensity = this.bloomAndGrainValues.bloom * this.bloomScale;
  }

  public updateEffectConfiguration(config: PostProcessingConfig) {
    if (config.bloom?.intensity !== undefined) {
      this.bloomAndGrainValues.bloom = config.bloom.intensity;
      this.bloomEffect.intensity = config.bloom.intensity * this.bloomScale;
    }
    if (config.bloom?.mode !== undefined) {
      this.bloomAndGrainValues.bloomMode = config.bloom.mode;
      this.bloomEffect.mode = config.bloom.mode;
    }
    if (config.bloom?.threshold !== undefined) {
      this.bloomAndGrainValues.bloomThreshold = config.bloom.threshold;
      this.bloomEffect.threshold = config.bloom.threshold;
    }
    if (config.bloom?.smoothing !== undefined) {
      this.bloomAndGrainValues.bloomSmoothing = config.bloom.smoothing;
      this.bloomEffect.smoothing = config.bloom.smoothing;
    }
    if (config.bloom?.radius !== undefined) {
      this.bloomAndGrainValues.bloomRadius = config.bloom.radius;
      this.bloomEffect.mipmapBlurPass.radius = config.bloom.radius;
    }

    if (config.bcs?.brightness !== undefined) {
      this.bcs.uniforms.brightness.value = config.bcs.brightness;
      this.bcsValues.brightness = config.bcs.brightness;
    }
    if (config.bcs?.contrast !== undefined) {
      this.bcs.uniforms.contrast.value = config.bcs.contrast;
      this.bcsValues.contrast = config.bcs.contrast;
    }
    if (config.bcs?.saturation !== undefined) {
      this.bcs.uniforms.saturation.value = config.bcs.saturation;
      this.bcsValues.saturation = config.bcs.saturation;
    }

    if (config.grain?.amount !== undefined) {
      this.gaussGrainEffect.uniforms.amount.value = config.grain.amount;
      this.bloomAndGrainValues.grain = config.grain.amount;
    }

    if (config.ssao) {
      if (
        config.ssao.enabled !== undefined &&
        config.ssao.enabled !== this.isEffectEnabled("n8ssao")
      ) {
        if (config.ssao.enabled) {
          this.enableEffect("n8ssao");
        } else {
          this.disableEffect("n8ssao");
        }
      }
      if (config.ssao.halfRes !== undefined) {
        this.n8aopass.configuration.halfRes = config.ssao.halfRes;
      }
      if (config.ssao.aoRadius !== undefined) {
        this.n8aopass.configuration.aoRadius = config.ssao.aoRadius;
      }
      if (config.ssao.distanceFalloff !== undefined) {
        this.n8aopass.configuration.distanceFalloff = config.ssao.distanceFalloff;
      }
      if (config.ssao.intensity !== undefined) {
        this.n8aopass.configuration.intensity = config.ssao.intensity;
        this.n8ssaoValues.intensity = config.ssao.intensity;
      }
      if (config.ssao.aoSamples !== undefined) {
        this.n8aopass.configuration.aoSamples = config.ssao.aoSamples;
      }
      if (config.ssao.denoiseSamples !== undefined) {
        this.n8aopass.configuration.denoiseSamples = config.ssao.denoiseSamples;
      }
      if (config.ssao.denoiseRadius !== undefined) {
        this.n8aopass.configuration.denoiseRadius = config.ssao.denoiseRadius;
      }
    }

    if (config.toneMapping) {
      Object.keys(config.toneMapping).forEach((key) => {
        if (config.toneMapping![key as keyof typeof config.toneMapping] !== undefined) {
          (this.toneMappingEffect as any)[key] =
            config.toneMapping![key as keyof typeof config.toneMapping];
        }
      });
    }
  }

  public updateCamera(camera: PerspectiveCamera): void {
    this.camera = camera;
    this.bloomEffect.setCamera(camera);
    // remove old render pass and create new one with updated camera
    this.effectComposer.removePass(this.renderPass);
    this.renderPass = new RenderPass(this.scene, camera);
    this.effectComposer.addPass(this.renderPass, 0); // Add at beginning
    this.rebuildPipeline();
  }

  public resizeActiveEffects(width: number, height: number) {
    this.width = width;
    this.height = height;
    const pixelRatio = this.renderer.getPixelRatio();
    this.resolution.set(this.width * pixelRatio, this.height * pixelRatio);

    // EffectComposer.setSize uses renderer.getDrawingBufferSize() internally,
    // which accounts for the pixel ratio, and propagates the correct
    // device-pixel dimensions to all passes (including N8SSAOPass).
    this.effectComposer.setSize(this.width, this.height);
  }

  /** Ask the bloom to look for new glowing objects (e.g. after MML content changed). */
  public invalidateGlowObjects() {
    this.bloomEffect.invalidate();
  }

  public render(deltaTimeSeconds?: number) {
    this.effectComposer.render(deltaTimeSeconds);
  }

  public getEffectState(name: string): EffectState | undefined {
    return this.effectStates.get(name);
  }

  public getAllEffectStates(): EffectState[] {
    return Array.from(this.effectStates.values());
  }

  public isEffectEnabled(name: string): boolean {
    return this.effectStates.get(name)?.enabled ?? false;
  }

  public get n8ssaoPass(): N8SSAOPass {
    return this.n8aopass;
  }

  public get toneMappingEffectInstance(): ToneMappingEffect {
    return this.toneMappingEffect;
  }

  /** The old separate tone mapping pass; now an object whose `enabled` toggles the merged effect. */
  public get toneMappingPassInstance(): { enabled: boolean } {
    return this.toneMappingPassShim;
  }

  public get bcsInstance(): typeof BrightnessContrastSaturation {
    return this.bcs;
  }

  public get bloomEffectInstance(): EmissiveBloomEffect {
    return this.bloomEffect;
  }

  public get gaussGrainEffectInstance(): typeof GaussGrainEffect {
    return this.gaussGrainEffect;
  }

  public dispose() {
    this.effectComposer.dispose();
    this.bloomEffect.dispose();
    this.colorGradeEffect.dispose();
    this.toneMappingEffect.dispose();
    this.fxaaEffect.dispose();
  }
}
