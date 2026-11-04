import { BladeController, View } from "@tweakpane/core";
import { BladeApi, FolderApi, TpChangeEvent } from "tweakpane";

import type { EmissiveBloomEffect } from "../../../post-effects/EmissiveBloomEffect";
import { GaussGrainEffect } from "../../../post-effects/gauss-grain";

export type BloomAndGrainValues = {
  grain: number;
  /** Bloom intensity. */
  bloom: number;
  /** "emissive": only emissive surfaces and additive particles glow. "luminance": bright pixels glow. */
  bloomMode: "emissive" | "luminance";
  bloomThreshold: number;
  bloomSmoothing: number;
  bloomRadius: number;
};

export function createDefaultBloomAndGrainValues(): BloomAndGrainValues {
  return {
    grain: 0.02,
    bloom: 1.3,
    bloomMode: "emissive",
    bloomThreshold: 0.05,
    bloomSmoothing: 0.3,
    bloomRadius: 0.7,
  };
}

const bloomAndGrainOptions = {
  grain: {
    amount: { min: 0, max: 0.2, step: 0.002 },
  },
  bloom: {
    amount: { min: 0, max: 10, step: 0.05 },
    threshold: { min: 0, max: 5, step: 0.01 },
    smoothing: { min: 0, max: 2, step: 0.01 },
    radius: { min: 0, max: 1, step: 0.01 },
  },
};

export class BloomAndGrainFolder {
  private folder: FolderApi;
  constructor(
    parentFolder: FolderApi,
    private bloomAndGrainValues: BloomAndGrainValues,
    expand: boolean = false,
  ) {
    this.folder = parentFolder.addFolder({ title: "bloom / grain", expanded: expand });
    this.folder.addBinding(this.bloomAndGrainValues, "bloom", bloomAndGrainOptions.bloom.amount);
    this.folder.addBinding(this.bloomAndGrainValues, "bloomMode", {
      options: { emissive: "emissive", luminance: "luminance" },
    });
    this.folder.addBinding(
      this.bloomAndGrainValues,
      "bloomThreshold",
      bloomAndGrainOptions.bloom.threshold,
    );
    this.folder.addBinding(
      this.bloomAndGrainValues,
      "bloomSmoothing",
      bloomAndGrainOptions.bloom.smoothing,
    );
    this.folder.addBinding(
      this.bloomAndGrainValues,
      "bloomRadius",
      bloomAndGrainOptions.bloom.radius,
    );
    this.folder.addBinding(this.bloomAndGrainValues, "grain", bloomAndGrainOptions.grain.amount);
  }

  public setupChangeEvent(
    bloomEffect: EmissiveBloomEffect,
    gaussGrainEffect: typeof GaussGrainEffect | any,
  ): void {
    this.folder.on("change", (e: TpChangeEvent<unknown, BladeApi<BladeController<View>>>) => {
      const target = (e.target as any).key;
      if (!target) return;
      switch (target) {
        case "bloom":
          bloomEffect.intensity = e.value as number;
          break;
        case "bloomMode":
          bloomEffect.mode = e.value as "emissive" | "luminance";
          break;
        case "bloomThreshold":
          bloomEffect.threshold = e.value as number;
          break;
        case "bloomSmoothing":
          bloomEffect.smoothing = e.value as number;
          break;
        case "bloomRadius":
          bloomEffect.mipmapBlurPass.radius = e.value as number;
          break;
        case "grain":
          gaussGrainEffect.uniforms.amount.value = e.value as number;
          break;
        default:
          break;
      }
    });
  }
}
