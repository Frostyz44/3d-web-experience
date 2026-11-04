import {
  CameraHelper,
  DirectionalLight,
  Group,
  Matrix4,
  OrthographicCamera,
  Quaternion,
  Vector3,
} from "three";

import { SunValues } from "../tweakpane/blades/environmentFolder";

const UP = new Vector3(0, 1, 0);
const tempMatrix = new Matrix4();
const tempQuaternion = new Quaternion();
const tempInverse = new Quaternion();
const tempVector = new Vector3();

/**
 * The sun: a directional light whose shadow camera follows the player.
 *
 * The shadow camera covers a square of `2 * shadowDistance` metres around the player. Its centre is
 * snapped to whole shadow-map texels in light space, so moving does not make shadow edges crawl or
 * shimmer; only rotating the light (time of day) moves texels.
 */
export class Sun extends Group {
  private readonly debug: boolean = false;
  private readonly lightDistance = 100;
  private shadowMapSize: number = 2048;
  private shadowDistance: number = 30;
  private shadowSoftness: number = 2.5;
  private readonly camHelper: CameraHelper | null = null;

  private readonly shadowCamera: OrthographicCamera;
  private readonly directionalLight: DirectionalLight;
  /** Unit vector from the target towards the light. */
  private readonly direction = new Vector3(0, 1, 0);
  private polarAngle = 0;
  private azimuthalAngle = 0;

  public target: Vector3 | null = null;

  constructor(private sunValues: SunValues) {
    super();

    this.shadowCamera = new OrthographicCamera(-1, 1, 1, -1, 0.5, this.lightDistance * 2);
    if (this.debug === true) {
      this.camHelper = new CameraHelper(this.shadowCamera);
    }
    this.directionalLight = new DirectionalLight(0xffffff);
    this.directionalLight.shadow.camera = this.shadowCamera;
    this.directionalLight.castShadow = true;
    this.directionalLight.shadow.bias = -0.0002;
    this.setIntensity(this.sunValues.sunIntensity);
    this.setColor();
    this.applyShadowSettings();

    this.polarAngle = (this.sunValues.sunPosition.sunPolarAngle * Math.PI) / 180;
    this.azimuthalAngle = (this.sunValues.sunPosition.sunAzimuthalAngle * Math.PI) / 180;
    this.updateDirection();
    this.updateCharacterPosition(new Vector3(0, 0, 0));

    this.add(this.directionalLight);
    this.add(this.directionalLight.target);
    if (this.debug === true && this.camHelper instanceof CameraHelper) {
      this.add(this.camHelper);
    }
  }

  public get light(): DirectionalLight {
    return this.directionalLight;
  }

  /** Shadow map resolution (pixels) and half-width of the shadowed area (metres). */
  public setShadowQuality(mapSize: number, distance: number) {
    if (mapSize === this.shadowMapSize && distance === this.shadowDistance) {
      return;
    }
    this.shadowMapSize = mapSize;
    this.shadowDistance = distance;
    this.applyShadowSettings();
  }

  /** Blur radius of shadow edges in shadow-map texels. */
  public setShadowSoftness(texels: number) {
    this.shadowSoftness = texels;
    this.directionalLight.shadow.radius = texels;
  }

  public setShadowIntensity(intensity: number) {
    this.directionalLight.shadow.intensity = intensity;
  }

  public setCastShadow(enabled: boolean) {
    this.directionalLight.castShadow = enabled;
  }

  private applyShadowSettings() {
    const shadow = this.directionalLight.shadow;
    const d = this.shadowDistance;
    this.shadowCamera.left = -d;
    this.shadowCamera.right = d;
    this.shadowCamera.top = d;
    this.shadowCamera.bottom = -d;
    this.shadowCamera.updateProjectionMatrix();
    if (shadow.mapSize.x !== this.shadowMapSize) {
      shadow.mapSize.set(this.shadowMapSize, this.shadowMapSize);
      if (shadow.map) {
        // re-created at the new size on the next shadow render
        shadow.map.dispose();
        shadow.map = null;
      }
    }
    // Normal offset of about one and a half texels removes acne without visible peter-panning.
    const texelWorldSize = (2 * d) / this.shadowMapSize;
    shadow.normalBias = texelWorldSize * 1.5;
    shadow.radius = this.shadowSoftness;
    if (this.target) {
      this.updateCharacterPosition(this.target);
    }
  }

  public updateCharacterPosition(position: Vector3 | undefined) {
    if (!position) return;
    if (this.target !== position) {
      this.target = (this.target ?? new Vector3()).copy(position);
    }
    this.placeLight();
  }

  public setAzimuthalAngle(angle: number) {
    this.azimuthalAngle = angle;
    this.updateDirection();
    this.placeLight();
  }

  public setPolarAngle(angle: number) {
    this.polarAngle = angle;
    this.updateDirection();
    this.placeLight();
  }

  public setIntensity(intensity: number) {
    this.directionalLight.intensity = intensity;
  }

  public setColor() {
    this.directionalLight.color.setRGB(
      this.sunValues.sunColor.r,
      this.sunValues.sunColor.g,
      this.sunValues.sunColor.b,
    );
  }

  public setColorRGB(r: number, g: number, b: number) {
    this.directionalLight.color.setRGB(r, g, b);
  }

  private updateDirection() {
    // add 90° offset to align coordinate system with player facing +Z
    const adjustedAzimuthalAngle = -this.azimuthalAngle + Math.PI / 2;
    this.direction
      .set(
        Math.sin(this.polarAngle) * Math.cos(adjustedAzimuthalAngle),
        Math.cos(this.polarAngle),
        Math.sin(this.polarAngle) * Math.sin(adjustedAzimuthalAngle),
      )
      .normalize();
  }

  private placeLight() {
    if (!this.target) return;
    // Light-space orientation (same as the shadow camera's lookAt).
    tempMatrix.lookAt(this.direction, tempVector.set(0, 0, 0), UP);
    tempQuaternion.setFromRotationMatrix(tempMatrix);
    tempInverse.copy(tempQuaternion).invert();

    // Snap the target to whole texels across the light's view plane.
    const texel = (2 * this.shadowDistance) / this.shadowMapSize;
    const snapped = tempVector.copy(this.target).applyQuaternion(tempInverse);
    snapped.x = Math.round(snapped.x / texel) * texel;
    snapped.y = Math.round(snapped.y / texel) * texel;
    snapped.applyQuaternion(tempQuaternion);

    this.directionalLight.target.position.copy(snapped);
    this.directionalLight.position
      .copy(snapped)
      .addScaledVector(this.direction, this.lightDistance);
    this.directionalLight.target.updateMatrixWorld();
    this.directionalLight.updateMatrixWorld();
  }
}
