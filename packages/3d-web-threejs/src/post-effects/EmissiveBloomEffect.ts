import { BloomEffect, BlendFunction, EffectAttribute } from "postprocessing";
import {
  AdditiveBlending,
  Camera,
  Color,
  Material,
  Mesh,
  MeshBasicMaterial,
  NormalBlending,
  Object3D,
  PerspectiveCamera,
  Scene,
  Texture,
  Uniform,
  Vector2,
  WebGLRenderer,
  WebGLRenderTarget,
} from "three";

export type BloomMode = "emissive" | "luminance";

export type EmissiveBloomOptions = {
  mode: BloomMode;
  intensity: number;
  threshold: number;
  smoothing: number;
  radius: number;
  levels: number;
  resolutionScale: number;
};

/** Camera layer used only while the glow buffer is drawn. */
export const GLOW_LAYER = 29;

type EmissiveSource = Material & {
  emissive: Color;
  emissiveIntensity: number;
  emissiveMap: Texture | null;
  alphaMap?: Texture | null;
  map?: Texture | null;
};

type GlowEntry = {
  glow: MeshBasicMaterial;
  kind: "emissive" | "additive";
  hasMap: boolean;
  hasAlphaMap: boolean;
};

const tempColor = new Color();
const clearColor = new Color();

function isEmissiveMaterial(material: Material): material is EmissiveSource {
  const m = material as Partial<EmissiveSource>;
  return m.emissive instanceof Color && typeof m.emissiveIntensity === "number";
}

/** Whether a material emits light: a lit material with a non-black emissive term, or an additive unlit material. */
export function materialGlows(material: Material): "emissive" | "additive" | null {
  if (!material.visible) {
    return null;
  }
  if (isEmissiveMaterial(material)) {
    const e = material.emissive;
    if (material.emissiveIntensity > 0 && e.r + e.g + e.b > 0) {
      return "emissive";
    }
    return null;
  }
  if (
    (material as MeshBasicMaterial).isMeshBasicMaterial &&
    material.blending === AdditiveBlending
  ) {
    return "additive";
  }
  return null;
}

/**
 * Bloom driven by emissive brightness instead of image brightness.
 *
 * In "emissive" mode the bloom source is not the rendered image. Objects whose material glows (emissive
 * surfaces, additive particles) are drawn again into a small buffer with a material that outputs only the
 * emitted light (emissive colour x intensity x emissive map, or the particle colour). Each glow fragment is
 * tested against the main depth buffer so walls still hide glow behind them. That buffer is thresholded,
 * blurred with the mipmap blur and added to the HDR image before tone mapping. Lit white walls, the sky and
 * the sun disc therefore never bloom, and a brighter emissive surface glows more.
 *
 * Only glowing objects are re-drawn (found with a periodic scene scan), so the extra cost is small.
 *
 * In "luminance" mode it behaves like the classic BloomEffect with a luminance threshold on the image.
 */
export class EmissiveBloomEffect extends BloomEffect {
  private modeValue: BloomMode;
  private thresholdValue: number;
  private smoothingValue: number;
  private readonly glowMaterials = new WeakMap<Material, GlowEntry>();
  private glowMeshes: Mesh[] = [];
  private secondsSinceScan = Infinity;
  private readonly scanIntervalSeconds = 0.5;

  private readonly sceneDepthUniform = new Uniform<Texture | null>(null);
  private readonly glowResolutionUniform = new Uniform(new Vector2(1, 1));
  private readonly cameraNearFarUniform = new Uniform(new Vector2(0.1, 1000));
  private readonly thresholdUniform = new Uniform(new Vector2(0.05, 0.3));
  private hasDepth = false;

  constructor(
    private scene: Scene,
    private camera: Camera,
    options: EmissiveBloomOptions,
  ) {
    super({
      blendFunction: BlendFunction.ADD,
      mipmapBlur: true,
      intensity: options.intensity,
      radius: options.radius,
      levels: options.levels,
      luminanceThreshold: options.threshold,
      luminanceSmoothing: options.smoothing,
    });
    this.name = "EmissiveBloomEffect";
    this.setAttributes(this.getAttributes() | EffectAttribute.DEPTH);
    this.modeValue = options.mode;
    this.thresholdValue = options.threshold;
    this.smoothingValue = options.smoothing;
    this.luminancePass.resolution.scale = options.resolutionScale;
    this.applyThreshold();
  }

  public setCamera(camera: Camera): void {
    this.camera = camera;
  }

  get mode(): BloomMode {
    return this.modeValue;
  }

  set mode(mode: BloomMode) {
    this.modeValue = mode;
    this.applyThreshold();
  }

  get threshold(): number {
    return this.thresholdValue;
  }

  set threshold(value: number) {
    this.thresholdValue = value;
    this.applyThreshold();
  }

  get smoothing(): number {
    return this.smoothingValue;
  }

  set smoothing(value: number) {
    this.smoothingValue = value;
    this.applyThreshold();
  }

  get bloomResolutionScale(): number {
    return this.luminancePass.resolution.scale;
  }

  set bloomResolutionScale(scale: number) {
    this.luminancePass.resolution.scale = scale;
    // re-apply sizes for the blur chain
    this.setSize(this.resolution.baseWidth, this.resolution.baseHeight);
  }

  private applyThreshold() {
    // luminance mode: the LuminancePass applies the threshold to the image
    this.luminanceMaterial.threshold = this.thresholdValue;
    this.luminanceMaterial.smoothing = this.smoothingValue;
    // emissive mode: the glow material applies it per fragment (soft knee)
    this.thresholdUniform.value.set(this.thresholdValue, Math.max(1e-4, this.smoothingValue));
  }

  public setDepthTexture(depthTexture: Texture): void {
    this.sceneDepthUniform.value = depthTexture;
    this.hasDepth = true;
  }

  public setSize(width: number, height: number): void {
    const scale = this.luminancePass.resolution.scale;
    this.resolution.setBaseSize(width, height);
    this.luminancePass.setSize(width, height);
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));
    // renderTarget is only used by the deprecated Kawase blur path
    (this as unknown as { renderTarget: WebGLRenderTarget }).renderTarget.setSize(w, h);
    this.mipmapBlurPass.setSize(w, h);
  }

  /** Re-scan the scene for glowing objects on the next frame (e.g. after content changed). */
  public invalidate(): void {
    this.secondsSinceScan = Infinity;
  }

  public update(renderer: WebGLRenderer, inputBuffer: WebGLRenderTarget, deltaTime?: number): void {
    if (this.modeValue === "luminance" || !this.hasDepth) {
      super.update(renderer, inputBuffer, deltaTime ?? 0);
      return;
    }
    this.secondsSinceScan += deltaTime ?? 0.016;
    if (this.secondsSinceScan >= this.scanIntervalSeconds) {
      this.secondsSinceScan = 0;
      this.scanScene();
    }
    // The luminance pass's target (at the bloom resolution) holds the glow buffer in this mode.
    const glowTarget = (this.luminancePass as unknown as { renderTarget: WebGLRenderTarget })
      .renderTarget;
    this.renderGlow(renderer, glowTarget);
    this.mipmapBlurPass.render(renderer, glowTarget, null as unknown as WebGLRenderTarget);
  }

  /** Finds meshes with glowing materials and tags them with the glow layer. */
  private scanScene() {
    for (const mesh of this.glowMeshes) {
      mesh.layers.disable(GLOW_LAYER);
    }
    const found: Mesh[] = [];
    this.scene.traverseVisible((object: Object3D) => {
      const mesh = object as Mesh;
      if (!mesh.isMesh || !mesh.material) {
        return;
      }
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      // Multi-material meshes are drawn with a single glow material; use the first glowing one.
      if (materials.some((m) => materialGlows(m) !== null)) {
        mesh.layers.enable(GLOW_LAYER);
        found.push(mesh);
      }
    });
    this.glowMeshes = found;
  }

  private getGlowEntry(source: Material, kind: "emissive" | "additive"): GlowEntry {
    let entry = this.glowMaterials.get(source);
    if (entry && entry.kind === kind) {
      return entry;
    }
    const glow =
      kind === "additive"
        ? ((source as MeshBasicMaterial).clone() as MeshBasicMaterial)
        : new MeshBasicMaterial({ color: 0x000000 });
    glow.fog = false;
    glow.toneMapped = false;
    glow.depthWrite = false;
    glow.depthTest = false;
    glow.name = `glow:${source.name || source.type}`;
    const uniforms = {
      glowSceneDepth: this.sceneDepthUniform,
      glowResolution: this.glowResolutionUniform,
      glowCameraNearFar: this.cameraNearFarUniform,
      glowThreshold: this.thresholdUniform,
    };
    glow.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "void main() {",
          /* glsl */ `
uniform sampler2D glowSceneDepth;
uniform vec2 glowResolution;
uniform vec2 glowCameraNearFar;
uniform vec2 glowThreshold;
float glowViewZ(const in float depth) {
  float n = glowCameraNearFar.x;
  float f = glowCameraNearFar.y;
  return (n * f) / ((f - n) * depth - f);
}
void main() {
  float glowSceneZ = glowViewZ(texture2D(glowSceneDepth, gl_FragCoord.xy / glowResolution).r);
  float glowFragZ = glowViewZ(gl_FragCoord.z);
  // view-space z is negative; discard fragments clearly behind the visible surface
  if (glowFragZ < glowSceneZ - max(0.08, -glowSceneZ * 0.015)) discard;
`,
        )
        .replace(
          "#include <dithering_fragment>",
          /* glsl */ `#include <dithering_fragment>
  {
    float glowLum = dot(gl_FragColor.rgb, vec3(0.2126, 0.7152, 0.0722));
    float glowKnee = smoothstep(glowThreshold.x, glowThreshold.x + glowThreshold.y, glowLum);
    gl_FragColor.rgb *= glowKnee;
  }`,
        );
    };
    glow.customProgramCacheKey = () => `emissive-glow-${kind}`;
    entry = { glow, kind, hasMap: false, hasAlphaMap: false };
    this.glowMaterials.set(source, entry);
    return entry;
  }

  /** Copies the current emissive state of the source material into its glow material. */
  private syncGlowMaterial(source: Material, entry: GlowEntry): MeshBasicMaterial {
    const glow = entry.glow;
    glow.side = source.side;
    glow.alphaTest = source.alphaTest;
    glow.visible = source.visible;
    if (entry.kind === "emissive") {
      const s = source as EmissiveSource;
      glow.color.copy(s.emissive).multiplyScalar(s.emissiveIntensity);
      glow.opacity = s.opacity;
      glow.transparent = s.transparent || s.opacity < 1;
      glow.blending = NormalBlending;
      const map = s.emissiveMap ?? null;
      const alphaMap = s.alphaMap ?? null;
      if ((map !== null) !== entry.hasMap || (alphaMap !== null) !== entry.hasAlphaMap) {
        entry.hasMap = map !== null;
        entry.hasAlphaMap = alphaMap !== null;
        glow.needsUpdate = true;
      }
      glow.map = map;
      glow.alphaMap = alphaMap;
    } else {
      const s = source as MeshBasicMaterial;
      glow.color.copy(s.color);
      glow.opacity = s.opacity;
      glow.transparent = true;
      glow.blending = AdditiveBlending;
      if ((s.map !== null) !== entry.hasMap) {
        entry.hasMap = s.map !== null;
        glow.needsUpdate = true;
      }
      glow.map = s.map;
      glow.vertexColors = s.vertexColors;
    }
    return glow;
  }

  private renderGlow(renderer: WebGLRenderer, target: WebGLRenderTarget) {
    const camera = this.camera;
    const scene = this.scene;
    if (camera instanceof PerspectiveCamera) {
      this.cameraNearFarUniform.value.set(camera.near, camera.far);
    }
    this.glowResolutionUniform.value.set(target.width, target.height);

    // swap in glow materials
    const swapped: Array<[Mesh, Material | Material[]]> = [];
    for (const mesh of this.glowMeshes) {
      const original = mesh.material;
      if (Array.isArray(original)) {
        const source = original.find((m) => materialGlows(m) !== null);
        const kind = source ? materialGlows(source) : null;
        if (!source || !kind) {
          continue;
        }
        const glow = this.syncGlowMaterial(source, this.getGlowEntry(source, kind));
        swapped.push([mesh, original]);
        mesh.material = original.map((m) => (m === source ? glow : HIDDEN_MATERIAL));
      } else {
        const kind = materialGlows(original);
        if (!kind) {
          // stopped glowing since the last scan: skip it this frame
          swapped.push([mesh, original]);
          mesh.material = HIDDEN_MATERIAL;
          continue;
        }
        swapped.push([mesh, original]);
        mesh.material = this.syncGlowMaterial(original, this.getGlowEntry(original, kind));
      }
    }

    const previousMask = camera.layers.mask;
    const previousBackground = scene.background;
    const previousOverride = scene.overrideMaterial;
    const previousAutoUpdate = renderer.shadowMap.autoUpdate;
    const previousAutoClear = renderer.autoClear;
    const previousClearAlpha = renderer.getClearAlpha();
    renderer.getClearColor(clearColor);

    camera.layers.set(GLOW_LAYER);
    scene.background = null;
    scene.overrideMaterial = null;
    renderer.shadowMap.autoUpdate = false;
    renderer.autoClear = false;
    renderer.setRenderTarget(target);
    renderer.setClearColor(tempColor.setRGB(0, 0, 0), 0);
    renderer.clear(true, false, false);
    if (swapped.length > 0) {
      renderer.render(scene, camera);
    }

    camera.layers.mask = previousMask;
    scene.background = previousBackground;
    scene.overrideMaterial = previousOverride;
    renderer.shadowMap.autoUpdate = previousAutoUpdate;
    renderer.autoClear = previousAutoClear;
    renderer.setClearColor(clearColor, previousClearAlpha);

    for (const [mesh, material] of swapped) {
      mesh.material = material;
    }
  }

  public dispose(): void {
    for (const mesh of this.glowMeshes) {
      mesh.layers.disable(GLOW_LAYER);
    }
    this.glowMeshes = [];
    super.dispose();
  }
}

const HIDDEN_MATERIAL = new MeshBasicMaterial({ visible: false });
