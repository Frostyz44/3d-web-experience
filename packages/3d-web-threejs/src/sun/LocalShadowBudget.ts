import { Light, Object3D, PointLight, Scene, SpotLight, Vector3 } from "three";

const tempPosition = new Vector3();

/**
 * Limits how many point and spot light shadows (usually from MML content) are re-rendered each frame.
 *
 * A point light shadow re-renders the scene six times per frame, so a few shadow-casting MML lights can
 * cost more than everything else. Lights keep `castShadow` as authored (turning it off would recompile
 * every material); instead only the `budget` lights nearest the camera update every frame, and the rest
 * keep their last shadow map and refresh one at a time every `refreshSeconds`.
 */
export class LocalShadowBudget {
  private lights: Array<PointLight | SpotLight> = [];
  private secondsSinceScan = Infinity;
  private secondsSinceRefresh = 0;
  private refreshIndex = 0;
  private readonly scanIntervalSeconds = 0.5;

  constructor(
    private scene: Scene,
    private budget: number,
    private refreshSeconds: number = 1,
  ) {}

  public setBudget(budget: number) {
    this.budget = budget;
    this.secondsSinceScan = Infinity;
  }

  public update(cameraPosition: Vector3, deltaSeconds: number) {
    this.secondsSinceScan += deltaSeconds;
    if (this.secondsSinceScan >= this.scanIntervalSeconds) {
      this.secondsSinceScan = 0;
      this.scan(cameraPosition);
    }
    // round-robin refresh of the lights outside the budget
    this.secondsSinceRefresh += deltaSeconds;
    const outside = this.lights.slice(this.budget);
    if (outside.length > 0 && this.secondsSinceRefresh >= this.refreshSeconds / outside.length) {
      this.secondsSinceRefresh = 0;
      this.refreshIndex = (this.refreshIndex + 1) % outside.length;
      outside[this.refreshIndex].shadow.needsUpdate = true;
    }
  }

  private scan(cameraPosition: Vector3) {
    const found: Array<PointLight | SpotLight> = [];
    this.scene.traverseVisible((object: Object3D) => {
      const light = object as Light;
      if (
        ((light as PointLight).isPointLight || (light as SpotLight).isSpotLight) &&
        light.castShadow &&
        light.shadow
      ) {
        found.push(light as PointLight | SpotLight);
      }
    });
    const distances = new Map<Light, number>();
    for (const light of found) {
      light.getWorldPosition(tempPosition);
      distances.set(light, tempPosition.distanceToSquared(cameraPosition));
    }
    found.sort((a, b) => distances.get(a)! - distances.get(b)!);

    const known = new Set(this.lights);
    found.forEach((light, index) => {
      const inBudget = index < this.budget;
      if (light.shadow.autoUpdate !== inBudget) {
        light.shadow.autoUpdate = inBudget;
      }
      if (!inBudget && !known.has(light)) {
        // render its shadow map once so it is never sampled empty
        light.shadow.needsUpdate = true;
      }
    });
    // lights that left the scene go back to normal behaviour
    for (const light of this.lights) {
      if (!found.includes(light)) {
        light.shadow.autoUpdate = true;
      }
    }
    this.lights = found;
  }
}
