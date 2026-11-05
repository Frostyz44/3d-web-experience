import { CollisionMeshState, CollisionsManager } from "../collisions/CollisionsManager";
import { EulXYZ } from "../math/EulXYZ";
import { Line } from "../math/Line";
import { Matr4 } from "../math/Matr4";
import { Quat } from "../math/Quat";
import { Ray } from "../math/Ray";
import { IVect3, Vect3 } from "../math/Vect3";
import { CharacterControllerValues } from "../tweakpane/blades/characterControlsFolder";

import { SpawnConfigurationState } from "./CharacterManager";
import { AnimationState, CharacterState, senderClockWrap } from "./CharacterState";
import { getSpawnData } from "./Spawning";

const downVector = new Vect3(0, -1, 0);

// Climbing (MML climbable="true")
/** How far beyond the capsule a climbable surface can be taken hold of (metres). */
const climbReach = 0.22;
/** Distance kept between the capsule's surface and the climbable surface while climbing. */
const climbGap = 0.06;
/** Climbing speed (m/s), and while sprinting. */
const climbSpeed = 1.3;
const climbSprintSpeed = 2.0;
/** Climbing animation cycles per metre climbed (its clip is 1.2 s long and covers about 0.75 m). */
const climbAnimationRatePerMetre = 1.2 / 0.75;
/** Time to pull up onto a platform at the top (s). */
const climbMountDuration = 0.8;
/** After letting go, the same surface is not taken hold of again for this long (ms). */
const climbRegrabDelay = 450;

export type InputOutput = { direction: number | null; isSprinting: boolean; jump: boolean };

export type InputProvider = {
  getOutput(): InputOutput | null;
};

export type CameraProvider = {
  getCameraPosition(): Vect3;
  getCameraRotation(): Quat;
};

export type LocalControllerConfig = {
  id: number;
  position: Vect3;
  quaternion: Quat;
  collisionsManager: CollisionsManager;
  keyInputManager: InputProvider;
  additionalInputProvider?: InputProvider;
  cameraManager: CameraProvider;
  spawnConfiguration: SpawnConfigurationState;
  characterControllerValues: CharacterControllerValues;
};

export class LocalController {
  public capsuleInfo = {
    radius: 0.45,
    segment: new Line(new Vect3(), new Vect3(0, 1.05, 0)),
  };

  public gravity: number;
  public jumpForce: number;
  public doubleJumpForce: number;
  public coyoteTimeThreshold: number;
  public canJump: boolean = true;
  public canDoubleJump: boolean = true;
  public coyoteJumped = false;
  public doubleJumpUsed: boolean = false;
  public jumpCounter: number = 0;

  public airResistance: number;
  public groundResistance: number;
  public airControlModifier: number;
  public groundWalkControl: number;
  public groundRunControl: number;
  public baseControl: number;
  public minimumSurfaceAngle: number;

  public latestPosition: Vect3 = new Vect3();
  public characterOnGround: boolean = false;
  public coyoteTime: boolean = false;

  private useCollisionsCulling: boolean = true;

  private characterWasOnGround: boolean = false;
  private characterAirborneSince: number = 0;
  private currentHeight: number = 0;
  private currentSurfaceAngle = new Vect3();

  private characterVelocity: Vect3 = new Vect3();
  private vectorUp: Vect3 = new Vect3(0, 1, 0);
  private vectorDown: Vect3 = new Vect3(0, -1, 0);

  private rotationOffset: number = 0;
  private azimuthalAngle: number = 0;

  private tempSegment: Line = new Line();
  private tempQuat: Quat = new Quat();
  private tempEulXYZ: EulXYZ = new EulXYZ();
  private tempVector: Vect3 = new Vect3();
  private tempVector2: Vect3 = new Vect3();
  private tempVect3: Vect3 = new Vect3();
  private tempRay: Ray = new Ray();
  private tempCameraPos = new Vect3();
  private tempPositionCopy = new Vect3();

  private surfaceTempQuat = new Quat();
  private surfaceTempQuat2 = new Quat();
  private surfaceTempVector1 = new Vect3();
  private surfaceTempVector2 = new Vect3();
  private surfaceTempVect3 = new Vect3();
  private surfaceTempVector4 = new Vect3();
  private surfaceTempVector5 = new Vect3();
  private surfaceTempRay = new Ray();
  private lastMatrixTemp: Matr4 = new Matr4();
  private lastFrameSurfaceState:
    | [
        CollisionMeshState,
        {
          lastMatrix: Matr4;
        },
      ]
    | null = null;
  private surfaceIsMoving: boolean = false;

  public jumpReleased: boolean = true; // Indicates if the jump button has been released

  // Climbing state
  private climbing = false;
  private climbNormal = new Vect3(); // horizontal, from the climbable surface towards the character
  private climbTop = 0;
  private climbVerticalSpeed = 0;
  private climbAnimationRate = 0;
  private climbRegrabAfter = 0;
  private climbMount: { from: Vect3; to: Vect3; time: number } | null = null;
  private climbSegment: Line = new Line();
  private climbRay: Ray = new Ray();
  private climbVector = new Vect3();
  private climbQuat = new Quat();

  /** True while the character holds on to a climbable surface or pulls itself up at its top. */
  public isClimbing(): boolean {
    return this.climbing || this.climbMount !== null;
  }

  /** How fast the climbing animation should play (1 = its normal speed, 0 = holding still). */
  public getClimbingAnimationRate(): number {
    return this.climbAnimationRate;
  }

  /** Returns true if the character is currently on a moving surface (e.g., a rotating platform) */
  public isOnMovingSurface(): boolean {
    return this.surfaceIsMoving;
  }

  public networkState: CharacterState;
  public config: LocalControllerConfig;
  private controlState: { direction: number | null; isSprinting: boolean; jump: boolean } | null =
    null;

  private minimumX: number;
  private maximumX: number;
  private minimumY: number;
  private maximumY: number;
  private minimumZ: number;
  private maximumZ: number;

  constructor(config: LocalControllerConfig) {
    this.config = config;
    this.gravity = -config.characterControllerValues.gravity;
    this.jumpForce = config.characterControllerValues.jumpForce;
    this.doubleJumpForce = config.characterControllerValues.doubleJumpForce;
    this.coyoteTimeThreshold = config.characterControllerValues.coyoteJump;
    this.airResistance = config.characterControllerValues.airResistance;
    this.groundResistance = 0.99999999 + config.characterControllerValues.groundResistance * 1e-7;
    this.airControlModifier = config.characterControllerValues.airControlModifier;
    this.groundWalkControl = config.characterControllerValues.groundWalkControl;
    this.groundRunControl = config.characterControllerValues.groundRunControl;
    this.baseControl = config.characterControllerValues.baseControlMultiplier;
    this.minimumSurfaceAngle = config.characterControllerValues.minimumSurfaceAngle;

    this.networkState = {
      position: { x: 0, y: 0, z: 0 },
      rotation: { eulerY: 0 },
      state: AnimationState.idle,
    };
    this.minimumX = this.config.spawnConfiguration.respawnTrigger.minX;
    this.maximumX = this.config.spawnConfiguration.respawnTrigger.maxX;
    this.minimumY = this.config.spawnConfiguration.respawnTrigger.minY;
    this.maximumY = this.config.spawnConfiguration.respawnTrigger.maxY;
    this.minimumZ = this.config.spawnConfiguration.respawnTrigger.minZ;
    this.maximumZ = this.config.spawnConfiguration.respawnTrigger.maxZ;

    const maxAbsSpawnX =
      Math.abs(this.config.spawnConfiguration.spawnPosition.x) +
      Math.abs(this.config.spawnConfiguration.spawnPositionVariance.x);

    const maxAbsSpawnY =
      Math.abs(this.config.spawnConfiguration.spawnPosition.y) +
      Math.abs(this.config.spawnConfiguration.spawnPositionVariance.y);

    const maxAbsSpawnZ =
      Math.abs(this.config.spawnConfiguration.spawnPosition.z) +
      Math.abs(this.config.spawnConfiguration.spawnPositionVariance.z);

    if (Math.abs(this.minimumX) < maxAbsSpawnX || Math.abs(this.maximumX) < maxAbsSpawnX) {
      // If the respawn trigger minX or maxX is out of bounds of the spawn position variance,
      // set it to the spawn position variance +- a 1m skin to prevent a respawn infinite loop
      // and warn the user. The same goes for all other axes.
      this.minimumX = -maxAbsSpawnX - 1;
      this.maximumX = maxAbsSpawnX + 1;
      console.warn(
        "The respawnTrigger X values are out of the bounds of the spawnPosition + spawnPositionVariance. Please check your respawnTrigger config.",
      );
    }

    if (Math.abs(this.minimumY) < maxAbsSpawnY || Math.abs(this.maximumY) < maxAbsSpawnY) {
      this.minimumY = -maxAbsSpawnY - 1;
      this.maximumY = maxAbsSpawnY + 1;
      console.warn(
        "The respawnTrigger Y values are out of the bounds of the spawnPosition + spawnPositionVariance. Please check your respawnTrigger config.",
      );
    }

    if (Math.abs(this.minimumZ) < maxAbsSpawnZ) {
      this.minimumZ = -maxAbsSpawnZ - 1;
      this.maximumZ = maxAbsSpawnZ + 1;
      console.warn(
        "The respawnTrigger Z values are out of the bounds of the spawnPosition + spawnPositionVariance. Please check your respawnTrigger config.",
      );
    }

    this.config.collisionsManager.setCullingEnabled(this.useCollisionsCulling);
  }

  public updateSpawnConfig(spawnConfig: SpawnConfigurationState): void {
    this.config.spawnConfiguration = spawnConfig;
    this.minimumX = spawnConfig.respawnTrigger.minX;
    this.maximumX = spawnConfig.respawnTrigger.maxX;
    this.minimumY = spawnConfig.respawnTrigger.minY;
    this.maximumY = spawnConfig.respawnTrigger.maxY;
    this.minimumZ = spawnConfig.respawnTrigger.minZ;
    this.maximumZ = spawnConfig.respawnTrigger.maxZ;
  }

  private frozen: boolean = false;

  /** Park the character in place: no input, no gravity. Used to hold the
   *  local player at spawn until the world has finished loading. */
  public freeze(): void {
    this.frozen = true;
    this.characterVelocity.set(0, 0, 0);
  }

  public unfreeze(): void {
    this.frozen = false;
  }

  public update(deltaTime: number): void {
    if (this.frozen) return;
    this.controlState =
      this.config.keyInputManager.getOutput() ||
      this.config.additionalInputProvider?.getOutput() ||
      null;

    this.tempRay.set(this.config.position, this.vectorDown);
    this.tempRay.origin.y += this.capsuleInfo.radius;
    const firstRaycastHit = this.config.collisionsManager.raycastFirst(this.tempRay);
    if (firstRaycastHit !== null) {
      this.currentHeight = firstRaycastHit[0];
      this.currentSurfaceAngle.copy(firstRaycastHit[1]);
    } else {
      this.currentHeight = Number.POSITIVE_INFINITY;
    }

    if (this.climbMount || this.climbing) {
      if (this.climbMount) {
        this.updateClimbMount(deltaTime);
      } else {
        this.updateClimbing(deltaTime);
      }
      this.checkBounds();
      this.updateNetworkState();
      return;
    }
    this.climbAnimationRate = 0;

    if (this.controlState) {
      this.updateRotation(deltaTime);
    }

    this.config.collisionsManager.setExemptFromCulling(
      this.lastFrameSurfaceState ? this.lastFrameSurfaceState[0] : null,
    );

    // Adaptive substeps to prevent capsule tunneling through thin geometry.
    // Scale step count by how far the character moves relative to its radius:
    // standing still = 1 step, sprinting/falling = up to 8.
    const moveDist = this.characterVelocity.length() * deltaTime;
    const steps = Math.max(1, Math.min(8, Math.ceil(moveDist / (this.capsuleInfo.radius * 0.5))));
    for (let i = 0; i < steps; i++) {
      this.updatePosition(deltaTime, deltaTime / steps, i);
    }

    this.tryStartClimbing();
    this.checkBounds();
    this.updateNetworkState();
  }

  private checkBounds(): void {
    const outOfBounds =
      this.config.position.x < this.minimumX || // left
      this.config.position.x > this.maximumX || // right
      this.config.position.z < this.minimumZ || // back
      this.config.position.z > this.maximumZ || // front
      this.config.position.y < this.minimumY || // down
      this.config.position.y > this.maximumY; //   up

    if (outOfBounds) {
      this.resetPosition();
    }
  }

  // -------------------------------------------------------------------------------------------------------------------
  // Climbing: MML elements with climbable="true" (or inside an m-group with it) can be climbed like a ladder

  /** The capsule's axis at the current position (world). */
  private capsuleAxis(): Line {
    const segment = this.climbSegment;
    segment.copy(this.capsuleInfo.segment);
    segment.start.add(this.config.position);
    segment.start.y += this.capsuleInfo.radius;
    segment.end.add(this.config.position);
    segment.end.y += this.capsuleInfo.radius;
    return segment;
  }

  /** The world direction the player is steering towards (camera relative), or null without input. */
  private inputHeading(): Vect3 | null {
    if (!this.controlState || this.controlState.direction === null) {
      return null;
    }
    return this.climbVector
      .set(0, 0, 1)
      .applyAxisAngle(this.vectorUp, this.azimuthalAngle + this.controlState.direction);
  }

  /** Takes hold of a climbable surface when the character walks into it. */
  private tryStartClimbing(): void {
    if (performance.now() < this.climbRegrabAfter) {
      return;
    }
    const heading = this.inputHeading();
    if (!heading) {
      return;
    }
    const contact = this.config.collisionsManager.findClimbable(
      this.capsuleAxis(),
      this.capsuleInfo.radius,
      climbReach,
    );
    // Only when moving into the surface, and only if there is something to climb above the feet
    if (!contact || contact.top < this.config.position.y + 0.6) {
      return;
    }
    const into = -(heading.x * contact.normal.x + heading.z * contact.normal.z);
    if (into < 0.4) {
      return;
    }
    this.climbing = true;
    this.climbNormal.copy(contact.normal);
    this.climbTop = contact.top;
    this.characterVelocity.set(0, 0, 0);
    this.characterOnGround = false;
    this.doubleJumpUsed = false;
    this.jumpCounter = 0;
  }

  private stopClimbing(): void {
    this.climbing = false;
    this.climbMount = null;
    this.climbVerticalSpeed = 0;
    this.climbRegrabAfter = performance.now() + climbRegrabDelay;
  }

  private updateClimbing(deltaTime: number): void {
    const position = this.config.position;
    const control = this.controlState;

    // Jump lets go, pushing away from the surface
    if (control?.jump && this.jumpReleased) {
      this.stopClimbing();
      this.jumpReleased = false;
      this.jumpCounter = 1;
      this.characterVelocity.set(
        this.climbNormal.x * 3.5,
        this.jumpForce * 0.6,
        this.climbNormal.z * 3.5,
      );
      this.climbAnimationRate = 0;
      return;
    }
    if (!control?.jump) {
      this.jumpReleased = true;
    }

    // Forward (W, joystick up; its direction is pi) climbs up, back climbs down; sideways input does not move along
    // the ladder
    const vertical = control && control.direction !== null ? -Math.cos(control.direction) : 0;
    const speed = control?.isSprinting ? climbSprintSpeed : climbSpeed;
    let verticalSpeed = Math.abs(vertical) < 0.3 ? 0 : Math.sign(vertical) * speed;

    // At the bottom: climbing down onto the ground steps off
    const feetClearance = this.currentHeight - this.capsuleInfo.radius;
    if (verticalSpeed < 0 && feetClearance < 0.04) {
      this.stopClimbing();
      this.climbAnimationRate = 0;
      return;
    }

    // Climbing up: pull up onto a platform beyond the top when there is one within reach of the hands
    if (verticalSpeed > 0) {
      const landing = this.findClimbLanding();
      if (landing) {
        this.climbMount = { from: position.clone(), to: landing, time: 0 };
        this.climbing = false;
        this.climbAnimationRate = 1.5;
        return;
      }
    }

    position.y += verticalSpeed * deltaTime;
    // Not higher than the climbable surface reaches
    const highest = this.climbTop - 0.5;
    if (position.y > highest) {
      position.y = Math.max(highest, position.y - verticalSpeed * deltaTime);
      verticalSpeed = 0;
    }

    // Stay at the surface (it may be uneven or slanted); let go if it ends
    const contact = this.config.collisionsManager.findClimbable(
      this.capsuleAxis(),
      this.capsuleInfo.radius,
      climbReach + 0.25,
    );
    if (!contact) {
      this.stopClimbing();
      return;
    }
    this.climbTop = contact.top;
    const blend = Math.min(1, deltaTime * 8);
    this.climbNormal.lerp(contact.normal, blend);
    this.climbNormal.y = 0;
    this.climbNormal.normalize();
    const correction = (this.capsuleInfo.radius + climbGap - contact.distance) * blend;
    position.x += contact.normal.x * correction;
    position.z += contact.normal.z * correction;

    // Walls and ceilings still block the capsule
    const axis = this.capsuleAxis();
    this.config.collisionsManager.applyColliders(axis, this.capsuleInfo.radius);
    position.set(axis.start.x, axis.start.y - this.capsuleInfo.radius, axis.start.z);

    this.faceDirection(-this.climbNormal.x, -this.climbNormal.z, deltaTime);
    this.climbVerticalSpeed = verticalSpeed;
    this.climbAnimationRate = Math.abs(verticalSpeed) * climbAnimationRatePerMetre;
    this.characterVelocity.set(0, 0, 0);
    this.characterOnGround = false;
    this.latestPosition.copy(position);
  }

  /**
   * A standing place beyond the top of the climbable surface at about chest height (between 0.3 and 1.3 m above the
   * feet), or null.
   */
  private findClimbLanding(): Vect3 | null {
    const position = this.config.position;
    const reachForward = this.capsuleInfo.radius * 2 + 0.25;
    const origin = this.climbVector.set(
      position.x - this.climbNormal.x * reachForward,
      position.y + 2.4,
      position.z - this.climbNormal.z * reachForward,
    );
    this.climbRay.set(origin, this.vectorDown);
    const hit = this.config.collisionsManager.raycastFirst(this.climbRay, 2.4);
    if (!hit) {
      return null;
    }
    const [distance, normal] = hit;
    const landingY = origin.y - distance;
    const rise = landingY - position.y;
    if (normal.y < 0.7 || rise < 0.3 || rise > 1.3) {
      return null;
    }
    // There must be room to stand: nothing between the landing and head height
    this.climbRay.set(this.climbVector.set(origin.x, landingY + 0.05, origin.z), this.vectorUp);
    if (this.config.collisionsManager.raycastFirst(this.climbRay, 1.6)) {
      return null;
    }
    return new Vect3(origin.x, landingY + 0.02, origin.z);
  }

  /** Pulls the character up onto the landing: first up past the edge, then forward onto it. */
  private updateClimbMount(deltaTime: number): void {
    const mount = this.climbMount!;
    mount.time += deltaTime;
    const t = Math.min(1, mount.time / climbMountDuration);
    const smooth = (x: number) => x * x * (3 - 2 * x);
    const rise = smooth(Math.min(1, t / 0.6));
    const forward = smooth(Math.max(0, (t - 0.35) / 0.65));
    this.config.position.set(
      mount.from.x + (mount.to.x - mount.from.x) * forward,
      mount.from.y + (mount.to.y - mount.from.y) * rise,
      mount.from.z + (mount.to.z - mount.from.z) * forward,
    );
    this.faceDirection(-this.climbNormal.x, -this.climbNormal.z, deltaTime);
    this.climbAnimationRate = t < 0.6 ? 1.5 : 0;
    this.latestPosition.copy(this.config.position);
    if (t >= 1) {
      this.stopClimbing();
      this.characterVelocity.set(0, 0, 0);
      this.characterOnGround = true;
    }
  }

  /** Turns the character smoothly to face a horizontal direction. */
  private faceDirection(x: number, z: number, deltaTime: number): void {
    const target = this.climbQuat.setFromAxisAngle(this.vectorUp, Math.atan2(x, z));
    const difference = this.computeAngularDifference(target);
    this.config.quaternion.rotateTowards(target, (difference / 0.12) * deltaTime);
  }

  public getTargetAnimation(): AnimationState {
    if (this.isClimbing()) {
      return this.climbMount && this.climbMount.time / climbMountDuration > 0.6
        ? AnimationState.idle
        : AnimationState.climbing;
    }
    const jumpHeight = this.characterVelocity.y > 0 ? 0.2 : 1.8;
    if (this.currentHeight > jumpHeight && !this.characterOnGround) {
      if (this.doubleJumpUsed) {
        return AnimationState.doubleJump;
      }
      return AnimationState.air;
    }
    if (!this.controlState || this.controlState.direction === null) {
      return AnimationState.idle;
    }

    if (this.controlState.isSprinting) {
      return AnimationState.running;
    }

    return AnimationState.walking;
  }

  private updateRotationOffset(): void {
    if (this.controlState && this.controlState.direction !== null) {
      this.rotationOffset = this.controlState.direction;
    }
  }

  private updateAzimuthalAngle(): void {
    const cameraPos = this.tempCameraPos.copy(this.config.cameraManager.getCameraPosition());
    const camToModelDistance = cameraPos.distanceTo(
      this.tempPositionCopy.copy(this.config.position),
    );
    const isCameraFirstPerson = camToModelDistance < 2;
    if (isCameraFirstPerson) {
      const cameraRotation = this.config.cameraManager.getCameraRotation();
      const cameraForward = this.tempVector.set(0, 0, 1).applyQuat(cameraRotation);
      this.azimuthalAngle = Math.atan2(cameraForward.x, cameraForward.z);
    } else {
      const cameraPos = this.config.cameraManager.getCameraPosition();
      this.azimuthalAngle = Math.atan2(
        cameraPos.x - this.config.position.x,
        cameraPos.z - this.config.position.z,
      );
    }
  }

  private computeAngularDifference(rotationQuat: Quat): number {
    const rotation = new Quat().copy(this.config.quaternion);
    return 2 * Math.acos(Math.abs(rotation.dot(rotationQuat)));
  }

  private updateRotation(deltaTime: number): void {
    this.updateRotationOffset();
    this.updateAzimuthalAngle();
    const rotationQuat = this.tempQuat.setFromAxisAngle(
      this.vectorUp,
      this.azimuthalAngle + this.rotationOffset,
    );
    const angularDifference = this.computeAngularDifference(rotationQuat);
    const desiredTime = 0.07;
    const angularSpeed = angularDifference / desiredTime;
    const frameRotation = angularSpeed * deltaTime;
    this.config.quaternion.rotateTowards(rotationQuat, frameRotation);
  }

  private processJump(currentAcceleration: Vect3, deltaTime: number) {
    const jump = this.controlState?.jump;

    if (this.characterOnGround) {
      this.coyoteJumped = false;
      this.canDoubleJump = false;
      this.doubleJumpUsed = false;
      this.jumpCounter = 0;

      if (!jump) {
        this.canDoubleJump = !this.doubleJumpUsed && this.jumpReleased && this.jumpCounter === 1;
        this.canJump = true;
        this.jumpReleased = true;
      }

      if (jump && this.canJump && this.jumpReleased) {
        currentAcceleration.y += this.jumpForce / deltaTime;
        this.canJump = false;
        this.jumpReleased = false;
        this.jumpCounter++;
      } else {
        if (this.currentSurfaceAngle.y < this.minimumSurfaceAngle) {
          currentAcceleration.y += this.gravity;
        }
      }
    } else {
      if (jump && !this.coyoteJumped && this.coyoteTime) {
        this.coyoteJumped = true;
        currentAcceleration.y += this.jumpForce / deltaTime;
        this.canJump = false;
        this.jumpReleased = false;
        this.jumpCounter++;
      } else if (jump && this.canDoubleJump) {
        currentAcceleration.y += this.doubleJumpForce / deltaTime;
        this.doubleJumpUsed = true;
        this.jumpReleased = false;
        this.jumpCounter++;
      } else {
        currentAcceleration.y += this.gravity;
        this.canJump = false;
      }
    }

    if (!jump) {
      this.jumpReleased = true;
      if (!this.characterOnGround) {
        currentAcceleration.y += this.gravity;
      }
    }
  }

  private applyControls(stepDeltaTime: number): void {
    const resistance = this.characterOnGround ? this.groundResistance : this.airResistance;

    // Dampen the velocity based on the resistance
    const speedFactor = Math.pow(1 - resistance, stepDeltaTime);
    this.characterVelocity.multiplyScalar(speedFactor);

    const acceleration = this.tempVector.set(0, 0, 0);
    this.canDoubleJump = !this.doubleJumpUsed && this.jumpReleased && this.jumpCounter === 1;
    this.processJump(acceleration, stepDeltaTime);

    const control =
      (this.characterOnGround
        ? this.controlState?.isSprinting
          ? this.groundRunControl
          : this.groundWalkControl
        : this.airControlModifier) * this.baseControl;

    const controlAcceleration = this.tempVector2.set(0, 0, 0);

    if (this.controlState && this.controlState.direction !== null) {
      // convert heading to direction vector
      const heading = this.controlState.direction;
      const headingVector = this.tempVect3
        .set(0, 0, 1)
        .applyAxisAngle(this.vectorUp, this.azimuthalAngle + heading);
      controlAcceleration.add(headingVector);
    }
    if (controlAcceleration.lengthSquared() > 0) {
      controlAcceleration.normalize();
      controlAcceleration.multiplyScalar(control);
    }
    acceleration.add(controlAcceleration);
    this.characterVelocity.addScaledVector(acceleration, stepDeltaTime);

    this.config.position.addScaledVector(this.characterVelocity, stepDeltaTime);
  }

  private updatePosition(deltaTime: number, stepDeltaTime: number, iter: number): void {
    this.applyControls(stepDeltaTime);

    if (iter === 0) {
      const lastMovement = this.getMovementFromSurfaces(this.config.position, deltaTime);
      if (lastMovement) {
        const newPosition = this.tempVector.copy(this.config.position);
        newPosition.add(lastMovement.position);
        this.config.position.set(newPosition.x, newPosition.y, newPosition.z);
        const asQuat = this.config.quaternion;
        const lastMovementEulXYZ = this.tempEulXYZ.setFromQuaternion(lastMovement.rotation);
        lastMovementEulXYZ.x = 0;
        lastMovementEulXYZ.z = 0;
        lastMovement.rotation.setFromEulerXYZ(lastMovementEulXYZ);
        asQuat.multiply(lastMovement.rotation);
      }
    }

    const avatarSegment = this.tempSegment;
    avatarSegment.copy(this.capsuleInfo.segment!);
    avatarSegment.start.add(this.config.position);
    avatarSegment.start.y += this.capsuleInfo.radius;
    avatarSegment.end.add(this.config.position);
    avatarSegment.end.y += this.capsuleInfo.radius;

    const positionBeforeCollisions = this.tempVector.copy(avatarSegment.start);
    this.config.collisionsManager.applyColliders(avatarSegment, this.capsuleInfo.radius!);

    // Raycast from the top of the capsule to the bottom of the capsule to see if there is a surface intersecting the capsule
    const capsuleLength =
      this.capsuleInfo.segment.end.y -
      this.capsuleInfo.segment.start.y +
      this.capsuleInfo.radius * 2;
    // Set the origin of the ray to the bottom of the segment (1 radius length from the bottom point of the capsule)
    this.tempRay.set(avatarSegment.start, this.vectorDown);

    // Amount to ignore from the start and end of the ray (to avoid unwanted collisions)
    const endIgnoreLength = 0.1;

    // Move the ray origin to the bottom of the capsule and then add the total length to move the ray origin to the top point of the capsule
    this.tempRay.origin.y += -this.capsuleInfo.radius + capsuleLength - endIgnoreLength;
    // Find the first mesh that intersects the ray
    const withinCapsuleRayHit = this.config.collisionsManager.raycastFirst(
      this.tempRay,
      capsuleLength - endIgnoreLength * 2,
    );
    if (withinCapsuleRayHit !== null) {
      // There is a mesh ray collision within the capsule. Move the character up to the point of the collision
      const rayHitPosition = withinCapsuleRayHit[3];
      avatarSegment.start.copy(rayHitPosition);
      // Account for the radius of the capsule
      avatarSegment.start.y += this.capsuleInfo.radius;
    }

    this.config.position.set(
      avatarSegment.start.x,
      avatarSegment.start.y - this.capsuleInfo.radius,
      avatarSegment.start.z,
    );
    const deltaCollisionPosition = avatarSegment.start.sub(positionBeforeCollisions);
    this.characterOnGround = deltaCollisionPosition.y > 0;

    if (this.characterOnGround) {
      this.doubleJumpUsed = false;
      this.jumpCounter = 0;
    }

    if (this.characterWasOnGround && !this.characterOnGround) {
      this.characterAirborneSince = Date.now();
    }

    if (!this.controlState?.jump) {
      this.jumpReleased = true;
    }

    this.coyoteTime =
      this.characterVelocity.y < 0 &&
      !this.characterOnGround &&
      Date.now() - this.characterAirborneSince < this.coyoteTimeThreshold;

    this.latestPosition.copy(this.config.position);
    this.characterWasOnGround = this.characterOnGround;
  }

  public getMovementFromSurfaces(userPosition: IVect3, deltaTime: number) {
    let lastMovement: { rotation: Quat; position: Vect3 } | null = null;

    // If we have a last frame state, we can calculate the movement of the mesh to apply it to the user
    if (this.lastFrameSurfaceState !== null) {
      const meshState = this.lastFrameSurfaceState[0];

      // Extract the matrix from the current frame and the last frame
      const currentFrameMatrix = meshState.matrix;
      const lastFrameMatrix = this.lastFrameSurfaceState[1].lastMatrix;

      if (lastFrameMatrix.equals(currentFrameMatrix)) {
        // No movement from this mesh - do nothing
        this.surfaceIsMoving = false;
      } else {
        this.surfaceIsMoving = true;
        // The mesh has moved since the last frame - calculate the movement

        // Get the position of the mesh in the last frame
        const lastMeshPosition = this.surfaceTempVector1;
        const lastMeshRotation = this.surfaceTempQuat;
        lastFrameMatrix.decompose(lastMeshPosition, lastMeshRotation, this.surfaceTempVect3);

        // Get the position of the mesh in the current frame
        const currentMeshPosition = this.surfaceTempVector2;
        const currentMeshRotation = this.surfaceTempQuat2;
        currentFrameMatrix.decompose(
          currentMeshPosition,
          currentMeshRotation,
          this.surfaceTempVect3,
        );

        // Calculate the difference between the new position and the old position to determine the movement due to translation of position
        const meshTranslationDelta = this.surfaceTempVector5
          .copy(currentMeshPosition)
          .sub(lastMeshPosition);

        // Calculate the relative position of the user to the mesh in the last frame
        const lastFrameRelativeUserPosition = this.surfaceTempVect3
          .copy(userPosition)
          .sub(lastMeshPosition);

        // Calculate the world-relative rotation delta from the last frame to the current frame
        const meshRotationDelta = currentMeshRotation.multiply(lastMeshRotation.invert());

        // Apply the relative quaternion to the relative user position to determine the new position of the user given just the rotation
        const translationDueToRotation = this.surfaceTempVector4
          .copy(lastFrameRelativeUserPosition)
          .applyQuat(meshRotationDelta)
          .sub(lastFrameRelativeUserPosition);

        // Combine the mesh translation delta and the rotation translation delta to determine the total movement of the user
        const translationAndRotationPositionDelta = this.surfaceTempVector1
          .copy(meshTranslationDelta)
          .add(translationDueToRotation);

        lastMovement = {
          position: translationAndRotationPositionDelta,
          rotation: meshRotationDelta,
        };
        lastFrameMatrix.copy(currentFrameMatrix);
      }
    }

    const newPosition = this.surfaceTempVect3.copy(userPosition);
    if (lastMovement) {
      newPosition.add(lastMovement.position);
    }
    newPosition.y = newPosition.y + 0.05;

    // Raycast down from the new position to see if there is a surface below the user which will be tracked in the next frame
    const ray = this.surfaceTempRay.set(newPosition, downVector);
    const hit = this.config.collisionsManager.raycastFirst(ray);
    if (hit && hit[0] < 0.8) {
      // There is a surface below the user
      const currentCollisionMeshState = hit[2];
      this.lastFrameSurfaceState = [
        currentCollisionMeshState,
        { lastMatrix: this.lastMatrixTemp.copy(currentCollisionMeshState.matrix) },
      ];
    } else {
      if (this.lastFrameSurfaceState !== null && lastMovement) {
        // Apply the last movement to the user's velocity
        this.characterVelocity.add(
          lastMovement.position.clone().multiplyScalar(1 / deltaTime), // The position delta is the result of one tick which is deltaTime seconds, so we need to divide by deltaTime to get the velocity per second
        );
      }
      this.lastFrameSurfaceState = null;
      this.surfaceIsMoving = false;
    }
    return lastMovement;
  }

  private updateNetworkState(): void {
    const characterPosition = this.config.position;
    const characterQuat = this.config.quaternion;

    this.networkState = {
      position: {
        x: characterPosition.x,
        y: characterPosition.y,
        z: characterPosition.z,
      },
      rotation: { eulerY: 2 * Math.atan2(characterQuat.y, characterQuat.w) },
      state: this.getTargetAnimation(),
      // Wrapped to stay a small integer on the wire
      time: Math.round(performance.now()) % senderClockWrap,
    };
  }

  /**
   * Programmatic jump with optional custom force. Supports double jump.
   * Returns true if the jump was initiated.
   */
  public jump(force?: number): boolean {
    if (this.characterOnGround && this.jumpCounter === 0) {
      this.characterVelocity.y = force ?? this.jumpForce;
      this.characterOnGround = false;
      this.jumpReleased = false;
      this.jumpCounter++;
      return true;
    }
    if (!this.characterOnGround && this.jumpCounter === 1 && !this.doubleJumpUsed) {
      this.characterVelocity.y += force ?? this.doubleJumpForce;
      this.doubleJumpUsed = true;
      this.jumpReleased = false;
      this.jumpCounter++;
      return true;
    }
    return false;
  }

  /**
   * Set horizontal velocity directly, bypassing the input-based acceleration.
   * Useful for programmatic movement (e.g., agent bridge waypoint following).
   * Vertical velocity is not affected (gravity and jump still apply normally).
   */
  public setHorizontalVelocity(vx: number, vz: number): void {
    this.characterVelocity.x = vx;
    this.characterVelocity.z = vz;
  }

  /** Current vertical velocity (positive = upward). */
  public get verticalVelocity(): number {
    return this.characterVelocity.y;
  }

  /**
   * Reset velocity and jump state (e.g., on teleport).
   */
  public resetVelocity(): void {
    this.climbing = false;
    this.climbMount = null;
    this.characterVelocity.set(0, 0, 0);
    this.characterOnGround = false;
    this.doubleJumpUsed = false;
    this.jumpReleased = true;
    this.jumpCounter = 0;
    this.lastFrameSurfaceState = null;
  }

  public resetPosition(): void {
    this.resetVelocity();

    const spawnData = getSpawnData(this.config.spawnConfiguration, false);

    this.config.position.set(
      spawnData.spawnPosition.x,
      spawnData.spawnPosition.y,
      spawnData.spawnPosition.z,
    );

    this.config.quaternion.setFromEulerXYZ(spawnData.spawnRotation);
  }
}
