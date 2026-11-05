import { describe, expect, test } from "@jest/globals";

import { AnimationState, CharacterState } from "../../src/character/CharacterState";
import { RemoteController } from "../../src/character/RemoteController";
import { EulXYZ } from "../../src/math/EulXYZ";
import { Vect3 } from "../../src/math/Vect3";

/** A remote user's updates as they arrive: taken every `sendMs` on the sender's clock, relayed on a server tick. */
type Arrival = { at: number; update: CharacterState };

function makeUpdate(
  x: number,
  y: number,
  z: number,
  time?: number,
  state: AnimationState = AnimationState.idle,
  eulerY = 0,
): CharacterState {
  return { position: { x, y, z }, rotation: { eulerY }, state, time };
}

/**
 * A controller on a virtual clock, fed with the latest update that has arrived each frame (as the networking does:
 * the same state is seen again on frames without news).
 */
function playback(arrivals: Array<Arrival>, frames: number, frameMs = 1000 / 60) {
  let now = 0;
  const first = arrivals[0].update;
  const controller = new RemoteController(
    new Vect3(first.position.x, first.position.y, first.position.z),
    new EulXYZ(),
    first.state,
    () => now,
  );
  const shown: Array<{ t: number; x: number; z: number; yaw: number; state: AnimationState }> = [];
  let latest = first;
  let next = 0;
  for (let f = 0; f < frames; f++) {
    now = f * frameMs;
    while (next < arrivals.length && arrivals[next].at <= now) {
      latest = arrivals[next].update;
      next++;
    }
    controller.update(latest, frameMs / 1000);
    shown.push({
      t: now,
      x: controller.position.x,
      z: controller.position.z,
      yaw: controller.getRotationEuler().y,
      state: controller.animationState,
    });
  }
  return { controller, shown };
}

/** Updates sent every 33 ms while walking at `speed` along x, relayed on a server tick with jitter. */
function walking(speed: number, durationMs: number, jitter: (i: number) => number, tickMs = 33) {
  const sent: Array<{ t: number; update: CharacterState }> = [];
  for (let t = 0; t <= durationMs; t += 33) {
    sent.push({ t, update: makeUpdate((speed * t) / 1000, 0, 0, t, AnimationState.walking) });
  }
  const arrivals: Array<Arrival> = [];
  let tick = 0;
  for (let at = 0; at <= durationMs + 200; at += tickMs, tick++) {
    // The server relays the newest update it has; it reaches this client after 40 ms plus jitter
    const latest = [...sent].reverse().find((s) => s.t <= at);
    if (latest) {
      arrivals.push({ at: at + 40 + jitter(tick), update: latest.update });
    }
  }
  arrivals.sort((a, b) => a.at - b.at);
  return arrivals;
}

describe("RemoteController", () => {
  test("starts where the user is and snaps on the first update", () => {
    const { controller } = playback([{ at: 0, update: makeUpdate(3, 1, -2, 0) }], 1);
    expect(controller.position.x).toBe(3);
    expect(controller.position.y).toBe(1);
    expect(controller.position.z).toBe(-2);
  });

  test.each([
    ["33 ms relay", 33],
    ["50 ms relay (uneven steps of 33 and 67 ms)", 50],
  ])("plays updates back at an even speed although they arrive unevenly (%s)", (_name, tickMs) => {
    // Up to 30 ms of jitter on top
    const arrivals = walking(2, 5000, (i) => ((i * 7919) % 31) - 1, tickMs as number);
    const { shown } = playback(arrivals, 300);
    const speeds: Array<number> = [];
    for (let i = 60; i < shown.length; i++) {
      speeds.push((shown[i].x - shown[i - 1].x) / ((shown[i].t - shown[i - 1].t) / 1000));
    }
    const mean = speeds.reduce((a, b) => a + b, 0) / speeds.length;
    const worst = Math.max(...speeds.map((s) => Math.abs(s - mean)));
    expect(mean).toBeCloseTo(2, 1);
    // Within 10% of the walking speed on every frame: no stutter
    expect(worst).toBeLessThan(0.2);
  });

  test("stays a short, adaptive delay behind the newest update", () => {
    const arrivals = walking(2, 3000, () => 0);
    const { controller, shown } = playback(arrivals, 180);
    expect(controller.getDelay()).toBeGreaterThanOrEqual(50);
    expect(controller.getDelay()).toBeLessThan(140);
    // Shown position lags the sender by about the delay plus the network time, not more
    const last = shown[shown.length - 1];
    expect((last.t / 1000) * 2 - last.x).toBeLessThan(0.5);
  });

  test("continues briefly through a gap, then holds", () => {
    const arrivals = walking(2, 1000, () => 0).filter((a) => a.at < 1000);
    const { shown } = playback(arrivals, 120);
    const atGapEnd = shown[shown.length - 1].x;
    // It did not stop dead at the last update (about 1.9 m) but did not run on for ever either
    expect(atGapEnd).toBeGreaterThan(1.8);
    expect(atGapEnd).toBeLessThan(2.4);
  });

  test("teleports instead of sliding across a long jump", () => {
    const arrivals: Array<Arrival> = [
      { at: 0, update: makeUpdate(0, 0, 0, 0) },
      { at: 33, update: makeUpdate(0, 0, 0, 33) },
      { at: 66, update: makeUpdate(20, 0, 0, 66) },
      { at: 99, update: makeUpdate(20, 0, 0, 99) },
    ];
    const { shown } = playback(arrivals, 40);
    // Never shown in between
    expect(shown.every((s) => s.x < 0.01 || s.x > 19.99)).toBe(true);
    expect(shown[shown.length - 1].x).toBeCloseTo(20, 5);
  });

  test("turns the short way round", () => {
    const arrivals: Array<Arrival> = [];
    for (let i = 0; i < 20; i++) {
      // From 3.0 rad to -3.0 rad: the short way passes through pi, not through 0
      const yaw = i < 5 ? 3 : -3;
      arrivals.push({
        at: i * 33 + 40,
        update: makeUpdate(0, 0, 0, i * 33, AnimationState.idle, yaw),
      });
    }
    const { shown } = playback(arrivals, 60);
    for (const s of shown.slice(10)) {
      expect(Math.abs(Math.cos(s.yaw))).toBeGreaterThan(0.95);
    }
  });

  test("changes the animation state when the sender did, after the delay", () => {
    const arrivals: Array<Arrival> = [];
    for (let i = 0; i < 30; i++) {
      const state = i < 10 ? AnimationState.walking : AnimationState.running;
      arrivals.push({ at: i * 33 + 40, update: makeUpdate(i * 0.05, 0, 0, i * 33, state) });
    }
    const { shown } = playback(arrivals, 80);
    const firstRunning = shown.findIndex((s) => s.state === AnimationState.running);
    // The switch happened at 330 ms on the sender's clock: shown later (network time plus delay), not earlier
    expect(shown[firstRunning].t).toBeGreaterThan(330 + 40);
    expect(shown[firstRunning].t).toBeLessThan(330 + 40 + 250);
  });

  test("works with updates without the sender's clock (older clients)", () => {
    const arrivals: Array<Arrival> = [];
    for (let i = 0; i < 40; i++) {
      arrivals.push({ at: i * 50, update: makeUpdate(i * 0.1, 0, 0, undefined) });
    }
    const { shown } = playback(arrivals, 140);
    expect(shown[shown.length - 1].x).toBeGreaterThan(3.5);
  });

  test("position is a copy, not a reference to the constructor argument", () => {
    const pos = new Vect3(1, 2, 3);
    const controller = new RemoteController(pos, new EulXYZ(), AnimationState.idle);
    pos.set(9, 9, 9);
    expect(controller.position.x).toBe(1);
  });
});
