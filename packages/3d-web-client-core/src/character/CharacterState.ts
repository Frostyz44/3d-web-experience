export enum AnimationState {
  "idle" = 0,
  "walking" = 1,
  "running" = 2,
  "jumpToAir" = 3,
  "air" = 4,
  "airToGround" = 5,
  "doubleJump" = 6,
  // Non-locomotion clip slot; LocalController never produces this.
  "emote" = 7,
  // Holding on to a climbable surface (MML climbable="true"); the clip plays in step with the climbing speed
  "climbing" = 8,
}

/** Senders' clocks are sent modulo this many milliseconds (about 12 days). */
export const senderClockWrap = 2 ** 30;

export type CharacterState = {
  position: {
    x: number;
    y: number;
    z: number;
  };
  rotation: {
    eulerY: number;
  };
  state: AnimationState;
  /**
   * The sender's clock (milliseconds) when this state was taken, so receivers can play remote avatars back on the
   * sender's own, even timeline (see RemoteController). Optional for older clients.
   */
  time?: number;
};
