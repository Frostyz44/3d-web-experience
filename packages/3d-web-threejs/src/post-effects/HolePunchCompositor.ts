import { Pass } from "postprocessing";
import {
  AddEquation,
  CustomBlending,
  Mesh,
  OneFactor,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  SrcColorFactor,
  Texture,
  UnsignedByteType,
  WebGLRenderer,
  WebGLRenderTarget,
  ZeroFactor,
} from "three";

/*
 * Support for "hole-punched" DOM content (such as the MML fork's m-youtube player), which sits in a layer BEHIND the
 * transparent WebGL canvas. Surfaces that show DOM content are drawn with colour and alpha 0, so the canvas is
 * transparent exactly where they are the nearest surface.
 *
 * The post-processing passes do not keep alpha (the grain pass, for example, writes alpha 1), so:
 *  1. HoleMaskCapturePass copies the alpha of the scene render into a mask, right after the RenderPass.
 *  2. After all passes, HoleAlphaApplier writes that mask into the canvas alpha and clears the colour where the mask
 *     is fully transparent (so bloom glow, grain noise or brightness offsets do not tint the DOM content).
 * When no hole is shown, HoleAlphaApplier forces alpha 1, so the transparent canvas looks exactly like an opaque one.
 */

const fullscreenVertexShader = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}
`;

/**
 * Copies the alpha channel of the scene render into a mask texture. It does not change the composer's buffers.
 */
export class HoleMaskCapturePass extends Pass {
  public readonly maskTarget: WebGLRenderTarget;
  private readonly material: ShaderMaterial;

  constructor() {
    super("HoleMaskCapturePass");
    this.needsSwap = false;
    this.maskTarget = new WebGLRenderTarget(1, 1, {
      type: UnsignedByteType,
      depthBuffer: false,
      stencilBuffer: false,
    });
    this.maskTarget.texture.name = "HoleMask";
    this.material = new ShaderMaterial({
      name: "HoleMaskCapture",
      uniforms: { inputBuffer: { value: null } },
      vertexShader: fullscreenVertexShader,
      fragmentShader: /* glsl */ `
        uniform sampler2D inputBuffer;
        varying vec2 vUv;
        void main() {
          float alpha = texture2D(inputBuffer, vUv).a;
          gl_FragColor = vec4(alpha, alpha, alpha, 1.0);
        }
      `,
      depthTest: false,
      depthWrite: false,
    });
    this.fullscreenMaterial = this.material;
  }

  get maskTexture(): Texture {
    return this.maskTarget.texture;
  }

  render(renderer: WebGLRenderer, inputBuffer: WebGLRenderTarget | null): void {
    if (!inputBuffer) {
      return;
    }
    this.material.uniforms.inputBuffer.value = inputBuffer.texture;
    renderer.setRenderTarget(this.maskTarget);
    renderer.render(this.scene, this.camera);
  }

  setSize(width: number, height: number): void {
    this.maskTarget.setSize(Math.max(1, width), Math.max(1, height));
  }

  dispose(): void {
    super.dispose();
    this.maskTarget.dispose();
    this.material.dispose();
  }
}

/**
 * Writes the canvas alpha after post-processing: the hole mask when holes are shown, otherwise 1.
 */
export class HoleAlphaApplier {
  private readonly scene = new Scene();
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly material: ShaderMaterial;

  constructor() {
    this.material = new ShaderMaterial({
      name: "HoleAlphaApply",
      uniforms: {
        mask: { value: null },
        useMask: { value: false },
      },
      vertexShader: fullscreenVertexShader,
      fragmentShader: /* glsl */ `
        uniform sampler2D mask;
        uniform bool useMask;
        varying vec2 vUv;
        void main() {
          float alpha = useMask ? texture2D(mask, vUv).r : 1.0;
          // Keep the colour (already premultiplied by the scene render) unless the pixel is a full hole
          float keep = alpha > 0.004 ? 1.0 : 0.0;
          gl_FragColor = vec4(keep, keep, keep, alpha);
        }
      `,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      // colour = destination colour * keep, alpha = mask
      blending: CustomBlending,
      blendEquation: AddEquation,
      blendSrc: ZeroFactor,
      blendDst: SrcColorFactor,
      blendEquationAlpha: AddEquation,
      blendSrcAlpha: OneFactor,
      blendDstAlpha: ZeroFactor,
    });
    const quad = new Mesh(new PlaneGeometry(2, 2), this.material);
    quad.frustumCulled = false;
    this.scene.add(quad);
  }

  /**
   * Draws onto the canvas (the default framebuffer).
   *
   * @param mask the hole mask, or null to make the whole canvas opaque
   */
  apply(renderer: WebGLRenderer, mask: Texture | null): void {
    this.material.uniforms.mask.value = mask;
    this.material.uniforms.useMask.value = mask !== null;
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(null);
    renderer.render(this.scene, this.camera);
    renderer.autoClear = autoClear;
  }

  dispose(): void {
    this.material.dispose();
  }
}

/** The attribute the MML fork's DOM overlay layer sets on its container while a hole is shown. */
export const HOLE_PUNCH_ATTRIBUTE = "data-mml-hole-punch";
