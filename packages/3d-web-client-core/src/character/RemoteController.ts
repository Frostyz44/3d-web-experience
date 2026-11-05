import { EulXYZ, Quat, Vect3 } from "../math";

import { AnimationState, CharacterState, senderClockWrap } from "./CharacterState";

/** A state received from the network, placed on the sender's timeline. */
type Sample = {
  /** Sender time in milliseconds (unwrapped), or the arrival time when the sender sends no clock. */
  t: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  state: AnimationState;
};

/** Playback runs at least this far behind the newest sample (ms). */
const minimumDelay = 50;
/** ... and at most this far. */
const maximumDelay = 250;
/** Past the newest sample, motion continues with its velocity for at most this long (ms), then holds. */
const maximumExtrapolation = 150;
/** Moves longer than this between two samples are teleports (respawns). */
const teleportDistance = 5;

function wrapAngle(angle: number): number {
  let a = angle % (Math.PI * 2);
  if (a > Math.PI) {
    a -= Math.PI * 2;
  } else if (a < -Math.PI) {
    a += Math.PI * 2;
  }
  return a;
}

/** Cubic Hermite interpolation between p0 and p1 with tangents m0 and m1 (already scaled by the interval). */
function hermite(p0: number, p1: number, m0: number, m1: number, s: number): number {
  const s2 = s * s;
  const s3 = s2 * s;
  return (
    (2 * s3 - 3 * s2 + 1) * p0 + (s3 - 2 * s2 + s) * m0 + (-2 * s3 + 3 * s2) * p1 + (s3 - s2) * m1
  );
}

/**
 * Plays a remote character back smoothly.
 *
 * Updates arrive unevenly (the server relays them on its own tick, the internet bunches them), but each carries the
 * sender's clock. They are kept in a short jitter buffer and played back on the sender's own timeline, a little behind
 * the newest one: positions follow a curve through the samples with velocities taken from their neighbours, rotations
 * turn the short way round, and animation states change at the moment the sender changed them. For a short gap
 * motion continues with the last velocity; teleports snap. The delay adapts to the measured network jitter.
 *
 * It is renderer-agnostic and frame-rate independent.
 */
export class RemoteController {
  public position: Vect3;
  public rotation: Quat;
  public animationState: AnimationState;

  private samples: Array<Sample> = [];
  private lastTime: number | null = null;
  private wraps = 0;
  /** Arrival time minus sender time for the fastest delivery seen (drifts up slowly). */
  private clockOffset: number | null = null;
  private lastArrival = 0;
  /** Recent lateness of samples (ms) relative to the fastest delivery, for the adaptive delay. */
  private lateness: Array<number> = [];
  private delay = 100;
  private targetDelay = 100;
  private lastFrame: number | null = null;
  private yaw = 0;
  private now: () => number;

  constructor(
    initialPosition: Vect3,
    initialRotation: EulXYZ,
    initialAnimation: AnimationState,
    now: () => number = () => performance.now(),
  ) {
    this.position = new Vect3(initialPosition.x, initialPosition.y, initialPosition.z);
    this.rotation = new Quat().setFromEulerXYZ(initialRotation);
    this.animationState = initialAnimation;
    this.yaw = initialRotation.y;
    this.now = now;
  }

  /** The current playback delay behind the newest sample (ms). */
  public getDelay(): number {
    return this.delay;
  }

  private receive(update: CharacterState, arrival: number) {
    let t: number;
    if (update.time !== undefined) {
      // Unwrap the sender's clock
      if (this.lastTime !== null && update.time < this.lastTime - senderClockWrap / 2) {
        this.wraps++;
      }
      this.lastTime = update.time;
      t = update.time + this.wraps * senderClockWrap;
    } else {
      t = arrival;
    }
    const last = this.samples[this.samples.length - 1];
    if (last && t <= last.t) {
      // The same update relayed again (the server relays the latest state on every tick)
      return;
    }
    const offset = arrival - t;
    if (this.clockOffset === null || offset < this.clockOffset) {
      this.clockOffset = offset;
    } else {
      // Let the offset grow slowly in case the latency grew
      this.clockOffset += Math.min(offset - this.clockOffset, (arrival - this.lastArrival) * 0.002);
    }
    this.lastArrival = arrival;
    this.lateness.push(offset - this.clockOffset);
    if (this.lateness.length > 60) {
      this.lateness.shift();
    }
    const yaw = update.rotation.eulerY;
    const sample: Sample = {
      t,
      x: update.position.x,
      y: update.position.y,
      z: update.position.z,
      // Continuous yaw, so interpolation turns the short way round
      yaw: last ? last.yaw + wrapAngle(yaw - last.yaw) : yaw,
      state: update.state,
    };
    if (
      last &&
      Math.hypot(sample.x - last.x, sample.y - last.y, sample.z - last.z) > teleportDistance
    ) {
      this.samples = [];
    }
    this.samples.push(sample);
    while (this.samples.length > 40) {
      this.samples.shift();
    }
    // Delay: the usual interval between samples plus the jitter of their arrival, within limits
    const intervals: Array<number> = [];
    for (let i = Math.max(1, this.samples.length - 10); i < this.samples.length; i++) {
      intervals.push(this.samples[i].t - this.samples[i - 1].t);
    }
    intervals.sort((a, b) => a - b);
    const interval = intervals.length ? intervals[Math.floor(intervals.length * 0.9)] : 50;
    const sortedLateness = [...this.lateness].sort((a, b) => a - b);
    const jitter = sortedLateness[Math.floor(sortedLateness.length * 0.95)] ?? 0;
    const wanted = Math.max(minimumDelay, Math.min(maximumDelay, interval + jitter + 10));
    // The delay itself moves towards this in update(), gently: a changing delay changes the playback speed
    this.targetDelay = wanted;
    if (this.samples.length <= 2) {
      this.delay = wanted;
    }
  }

  public update(networkUpdate: CharacterState, deltaTime: number): void {
    const now = this.now();
    void deltaTime;
    this.receive(networkUpdate, now);
    // Grow the delay by at most 5% of the elapsed time (playback runs at least 95% speed) when samples come late, shrink
    // it by at most 2% when the network calms down: never a visible change of speed
    const elapsed = this.lastFrame === null ? 0 : Math.max(0, now - this.lastFrame);
    this.lastFrame = now;
    const change = this.targetDelay - this.delay;
    const limit = (change > 0 ? 0.05 : 0.02) * elapsed;
    this.delay += Math.max(-limit, Math.min(limit, change));
    const samples = this.samples;
    if (samples.length === 0 || this.clockOffset === null) {
      return;
    }
    // The moment to show, on the sender's clock
    const playback = now - this.clockOffset - this.delay;
    let x: number;
    let y: number;
    let z: number;
    let yaw: number;
    let state: AnimationState;
    const first = samples[0];
    const last = samples[samples.length - 1];
    if (samples.length === 1 || playback <= first.t) {
      x = first.x;
      y = first.y;
      z = first.z;
      yaw = first.yaw;
      state = first.state;
    } else if (playback >= last.t) {
      // A gap: continue with the last velocity for a little while
      const previous = samples[samples.length - 2];
      const dt = Math.max(1, last.t - previous.t);
      const ahead = Math.min(playback - last.t, maximumExtrapolation);
      const fade = ahead / dt;
      x = last.x + (last.x - previous.x) * fade;
      y = last.y + Math.max(0, last.y - previous.y) * 0 + (last.y - previous.y) * fade * 0.5;
      z = last.z + (last.z - previous.z) * fade;
      yaw = last.yaw;
      state = last.state;
    } else {
      let i = samples.length - 2;
      while (i > 0 && samples[i].t > playback) {
        i--;
      }
      const a = samples[i];
      const b = samples[i + 1];
      const before = samples[Math.max(0, i - 1)];
      const after = samples[Math.min(samples.length - 1, i + 2)];
      const span = b.t - a.t;
      const s = (playback - a.t) / span;
      // Tangents from the neighbours (Catmull-Rom on uneven times), scaled to this interval
      const tangent = (p0: number, p1: number, t0: number, t1: number) =>
        ((p1 - p0) / Math.max(1, t1 - t0)) * span;
      const m0 = (k: "x" | "y" | "z") => tangent(before[k], b[k], before.t, b.t);
      const m1 = (k: "x" | "y" | "z") => tangent(a[k], after[k], a.t, after.t);
      x = hermite(a.x, b.x, m0("x"), m1("x"), s);
      y = hermite(a.y, b.y, m0("y"), m1("y"), s);
      z = hermite(a.z, b.z, m0("z"), m1("z"), s);
      // Never overshoot vertically (a landing does not dip into the floor)
      y = Math.max(Math.min(a.y, b.y), Math.min(Math.max(a.y, b.y), y));
      yaw = a.yaw + (b.yaw - a.yaw) * s;
      state = a.state;
    }
    // Drop samples that playback has passed (keep two behind for tangents)
    while (samples.length > 3 && samples[2].t < playback) {
      samples.shift();
    }
    this.position.set(x, y, z);
    this.yaw = yaw;
    const half = yaw / 2;
    this.rotation.set(0, Math.sin(half), 0, Math.cos(half));
    this.animationState = state;
  }

  public getRotationEuler(): EulXYZ {
    return new EulXYZ().setFromQuaternion(this.rotation);
  }
}
