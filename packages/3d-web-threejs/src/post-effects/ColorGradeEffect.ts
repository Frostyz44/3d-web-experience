import { BlendFunction, Effect } from "postprocessing";
import { Uniform } from "three";

import { BrightnessContrastSaturation } from "./bright-contrast-sat";
import { GaussGrainEffect } from "./gauss-grain";

const fragmentShader = /* glsl */ `
uniform float brightness;
uniform float contrast;
uniform float saturation;
uniform float grainAmount;
uniform float grainTime;

float gaussianGrain(vec2 fragCoord) {
  float seed = dot(fragCoord / resolution, vec2(12.9898, 78.233));
  float noise = fract(sin(seed) * 43758.5453123 + grainTime);
  // gaussian(noise, mean 0, sigma 0.5)
  return 0.7978845608 * exp(-(noise * noise) / 0.5);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 color = inputColor.rgb;
  // saturation (same weights as the previous shader pass)
  float grey = dot(color, vec3(0.3086, 0.6094, 0.0820));
  color = mix(vec3(grey), color, saturation);
  // contrast around 0.5, then brightness
  color = (color - 0.5) * contrast + 0.5 + brightness;
  color += gaussianGrain(gl_FragCoord.xy) * grainAmount;
  outputColor = vec4(clamp(color, 0.0, 1.0), inputColor.a);
}
`;

/**
 * Brightness / contrast / saturation and film grain as one Effect, so they merge into the same full-screen
 * pass as bloom and tone mapping instead of costing two extra passes. The values are read each frame from
 * the original shader definitions (`BrightnessContrastSaturation`, `GaussGrainEffect`), so the existing
 * tweakpane bindings keep working.
 */
export class ColorGradeEffect extends Effect {
  public bcsEnabled = true;
  public grainEnabled = true;

  constructor() {
    super("ColorGradeEffect", fragmentShader, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, Uniform<number>>([
        ["brightness", new Uniform(0)],
        ["contrast", new Uniform(1)],
        ["saturation", new Uniform(1)],
        ["grainAmount", new Uniform(0)],
        ["grainTime", new Uniform(0)],
      ]),
    });
  }

  public update(): void {
    const u = this.uniforms;
    const bcs = BrightnessContrastSaturation.uniforms;
    u.get("brightness")!.value = this.bcsEnabled ? bcs.brightness.value : 0;
    u.get("contrast")!.value = this.bcsEnabled ? bcs.contrast.value : 1;
    u.get("saturation")!.value = this.bcsEnabled ? bcs.saturation.value : 1;
    u.get("grainAmount")!.value = this.grainEnabled ? GaussGrainEffect.uniforms.amount.value : 0;
    u.get("grainTime")!.value = (performance.now() / 1000) % 1000;
  }
}
