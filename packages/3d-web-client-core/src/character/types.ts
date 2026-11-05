export type AnimationConfig = {
  idleAnimationFileUrl: string;
  jogAnimationFileUrl: string;
  sprintAnimationFileUrl: string;
  airAnimationFileUrl: string;
  doubleJumpAnimationFileUrl: string;
  emoteAnimationFileUrl?: string;
  /** Climbing a ladder or wall (MML climbable="true"); without it the idle animation is used. */
  climbAnimationFileUrl?: string;
};
