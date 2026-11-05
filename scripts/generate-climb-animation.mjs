/*
 Generates the climbing animation (example/assets/models/anim_climb.glb) from the idle animation's skeleton.

   node scripts/generate-climb-animation.mjs

 The avatars have no climbing clip, so this one is made in code. Instead of guessing each bone's local axes, the pose
 is described as directions in the character's own frame (up, forward to the ladder, right): "the upper arm points
 forward and up", "the knee is raised". For every key frame the script turns each limb bone, from the skeleton's rest
 pose, so that it points that way, and converts the result into the bone's local rotation. Arms and legs alternate
 (right hand high with the left knee raised, then the other way round), a cycle per 1.2 s of animation time; the
 world plays it in step with the climbing speed, so the hands and feet move with the body.

 The output keeps the idle file's skeleton (nodes, skin) and replaces its animation, so it loads like the others.
*/
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

import { Matrix4, Quaternion, Vector3 } from "three";

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(root, "example/assets/models/anim_idle.glb");
const outputPath = path.join(root, "example/assets/models/anim_climb.glb");

const duration = 1.2;
const keyCount = 31;

// --- Read the GLB -----------------------------------------------------------------------------------------------------

const glb = fs.readFileSync(sourcePath);
const jsonLength = glb.readUInt32LE(12);
const json = JSON.parse(glb.subarray(20, 20 + jsonLength).toString("utf8"));
const binStart = 20 + jsonLength + 8;
const binLength = glb.readUInt32LE(20 + jsonLength);
const bin = glb.subarray(binStart, binStart + binLength);

const componentCounts = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
function readAccessor(index) {
  const accessor = json.accessors[index];
  const view = json.bufferViews[accessor.bufferView];
  const count = accessor.count * componentCounts[accessor.type];
  const offset = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const out = new Float32Array(count);
  const data = new DataView(bin.buffer, bin.byteOffset + offset);
  for (let i = 0; i < count; i++) {
    switch (accessor.componentType) {
      case 5126:
        out[i] = data.getFloat32(i * 4, true);
        break;
      case 5122:
        out[i] = Math.max(data.getInt16(i * 2, true) / 32767, -1);
        break;
      case 5120:
        out[i] = Math.max(data.getInt8(i) / 127, -1);
        break;
      case 5123:
        out[i] = data.getUint16(i * 2, true) / 65535;
        break;
      case 5121:
        out[i] = data.getUint8(i) / 255;
        break;
      default:
        throw new Error(`Unsupported component type ${accessor.componentType}`);
    }
  }
  return out;
}

// --- The rest pose: the idle animation's first frame ------------------------------------------------------------------

const nodes = json.nodes;
const rest = nodes.map((node) => ({
  t: new Vector3(...(node.translation ?? [0, 0, 0])),
  r: new Quaternion(...(node.rotation ?? [0, 0, 0, 1])),
  s: new Vector3(...(node.scale ?? [1, 1, 1])),
}));
const animatedPaths = new Map(); // node -> Set of paths animated by the idle clip
const idle = json.animations[0];
for (const channel of idle.channels) {
  const sampler = idle.samplers[channel.sampler];
  const values = readAccessor(sampler.output);
  const node = channel.target.node;
  if (!animatedPaths.has(node)) {
    animatedPaths.set(node, new Set());
  }
  animatedPaths.get(node).add(channel.target.path);
  if (channel.target.path === "translation") {
    rest[node].t.set(values[0], values[1], values[2]);
  } else if (channel.target.path === "rotation") {
    rest[node].r.set(values[0], values[1], values[2], values[3]).normalize();
  } else if (channel.target.path === "scale") {
    rest[node].s.set(values[0], values[1], values[2]);
  }
}

const parentOf = new Array(nodes.length).fill(-1);
nodes.forEach((node, index) => (node.children ?? []).forEach((child) => (parentOf[child] = index)));
const indexOf = (name) => {
  const index = nodes.findIndex((node) => node.name === name);
  if (index < 0) {
    throw new Error(`No bone named ${name}`);
  }
  return index;
};

// World (model space) matrices of the rest pose
const restWorld = new Array(nodes.length);
function worldMatrix(index) {
  if (restWorld[index]) {
    return restWorld[index];
  }
  const local = new Matrix4().compose(rest[index].t, rest[index].r, rest[index].s);
  restWorld[index] =
    parentOf[index] >= 0 ? new Matrix4().multiplyMatrices(worldMatrix(parentOf[index]), local) : local;
  return restWorld[index];
}
const worldPosition = (name) => new Vector3().setFromMatrixPosition(worldMatrix(indexOf(name)));
const worldRotation = (index) => {
  const q = new Quaternion();
  worldMatrix(index).decompose(new Vector3(), q, new Vector3());
  return q;
};

// The character's frame, from the skeleton itself
const up = worldPosition("head").sub(worldPosition("pelvis")).normalize();
const right = worldPosition("thigh_r").sub(worldPosition("thigh_l"));
right.addScaledVector(up, -right.dot(up)).normalize();
const forward = new Vector3().crossVectors(up, right);
const toes = worldPosition("ball_l").sub(worldPosition("foot_l"));
if (forward.dot(toes) < 0) {
  forward.negate();
}
console.log(
  `frame: up ${up.toArray().map((v) => v.toFixed(2))} forward ${forward.toArray().map((v) => v.toFixed(2))} right ${right.toArray().map((v) => v.toFixed(2))}`,
);

/**
 * A direction in the character's frame: `angle` degrees from straight down towards forward (90 = forward, 180 = up),
 * tilted `side` degrees towards the character's right (negative: left).
 */
function direction(angle, side = 0) {
  const a = (angle * Math.PI) / 180;
  const v = new Vector3()
    .addScaledVector(up, -Math.cos(a))
    .addScaledVector(forward, Math.sin(a))
    .normalize();
  const s = (side * Math.PI) / 180;
  return v.multiplyScalar(Math.cos(s)).addScaledVector(right, Math.sin(s)).normalize();
}

// --- The pose ----------------------------------------------------------------------------------------------------------

const lerp = (a, b, t) => a + (b - a) * t;
// 0 = low (hand on a rung at the chest, elbow bent; foot on a rung), 1 = high (hand on a rung above the head, knee
// raised to the hip); smooth in and out
const height = (phase) => 0.5 - 0.5 * Math.cos(2 * Math.PI * phase);

/** The limb directions at a phase (0..1) of the cycle. Each chain is aimed bone by bone from the shoulder or hip. */
function pose(phase) {
  const targets = [];
  for (const [side, offset, sign] of [
    ["r", 0, 1],
    ["l", 0.5, -1],
  ]) {
    // Arms: the right hand is high at phase 0.5, the left hand at phase 0
    const arm = height(phase + offset);
    targets.push(["upperarm_" + side, "lowerarm_" + side, direction(lerp(62, 138, arm), sign * 12)]);
    targets.push(["lowerarm_" + side, "hand_" + side, direction(lerp(118, 158, arm), sign * 4)]);
    // Legs: the knee on the other side from the high hand is raised
    const leg = height(phase + offset + 0.5);
    targets.push(["thigh_" + side, "calf_" + side, direction(lerp(6, 88, leg), sign * 7)]);
    targets.push(["calf_" + side, "foot_" + side, direction(lerp(2, 12, leg), sign * 3)]);
  }
  return targets;
}

// Bones whose rotation the climbing pose changes, in parent-before-child order
const posedBones = [
  "upperarm_r",
  "lowerarm_r",
  "upperarm_l",
  "lowerarm_l",
  "thigh_r",
  "calf_r",
  "thigh_l",
  "calf_l",
];
// A slight forward lean of the upper body towards the ladder
const lean = new Map([
  ["spine_02", 6],
  ["spine_03", 5],
  ["neck_01", -8],
]);

/** Local rotations of the posed bones at a phase. */
function localRotations(phase) {
  const targets = new Map(pose(phase).map(([bone, child, dir]) => [bone, { child, dir }]));
  const world = new Map(); // bone index -> new world rotation
  const result = new Map();
  // Parent world rotations for chains whose parent is not posed: the rest pose
  const parentWorld = (index) => world.get(parentOf[index]) ?? worldRotation(parentOf[index]);

  for (const [name, degrees] of lean) {
    const index = indexOf(name);
    const bend = new Quaternion().setFromAxisAngle(right, (degrees * Math.PI) / 180);
    const newWorld = bend.multiply(worldRotation(index));
    result.set(index, parentWorld(index).invert().multiply(newWorld));
  }
  for (const name of posedBones) {
    const index = indexOf(name);
    const { child, dir } = targets.get(name);
    const restRotation = worldRotation(index);
    // The bone's direction in its own frame (towards its child joint)
    const restDir = worldPosition(child).sub(worldPosition(name)).normalize();
    const boneSpaceDir = restDir.clone().applyQuaternion(restRotation.clone().invert());
    // Where the bone points now (its parent may have turned), then aim it at the target
    const parent = parentWorld(index);
    const current = parent.clone().multiply(rest[index].r);
    const currentDir = boneSpaceDir.clone().applyQuaternion(current);
    const aim = new Quaternion().setFromUnitVectors(currentDir, dir);
    const newWorld = aim.multiply(current);
    world.set(index, newWorld);
    result.set(index, parent.clone().invert().multiply(newWorld));
  }
  return result;
}

// --- Write the GLB -----------------------------------------------------------------------------------------------------

const chunks = [];
let byteLength = 0;
const accessors = [json.accessors[json.skins[0].inverseBindMatrices]];
const bufferViews = [];
// Keep the inverse bind matrices (accessor 0 in the output)
{
  const accessor = accessors[0];
  const view = json.bufferViews[accessor.bufferView];
  const bytes = bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
  bufferViews.push({ buffer: 0, byteOffset: 0, byteLength: bytes.length });
  chunks.push(Buffer.from(bytes));
  byteLength += bytes.length;
  accessors[0] = { ...accessor, bufferView: 0, byteOffset: 0 };
}
function addFloats(values, type, minMax = false) {
  const data = Buffer.from(new Float32Array(values).buffer);
  const padding = (4 - (byteLength % 4)) % 4;
  if (padding) {
    chunks.push(Buffer.alloc(padding));
    byteLength += padding;
  }
  bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: data.length });
  chunks.push(data);
  byteLength += data.length;
  const accessor = {
    bufferView: bufferViews.length - 1,
    componentType: 5126,
    count: values.length / componentCounts[type],
    type,
  };
  if (minMax) {
    accessor.min = [Math.min(...values)];
    accessor.max = [Math.max(...values)];
  }
  accessors.push(accessor);
  return accessors.length - 1;
}

const keyTimes = Array.from({ length: keyCount }, (_, i) => (i / (keyCount - 1)) * duration);
const animatedInput = addFloats(keyTimes, "SCALAR", true);
const constantInput = addFloats([0, duration], "SCALAR", true);
const frames = keyTimes.map((t) => localRotations(t / duration));

const samplers = [];
const channels = [];
function addChannel(node, pathName, input, values, type) {
  samplers.push({ input, output: addFloats(values, type), interpolation: "LINEAR" });
  channels.push({ sampler: samplers.length - 1, target: { node, path: pathName } });
}
for (const [node, paths] of animatedPaths) {
  const r = rest[node];
  if (paths.has("translation")) {
    addChannel(node, "translation", constantInput, [...r.t.toArray(), ...r.t.toArray()], "VEC3");
  }
  if (paths.has("scale")) {
    addChannel(node, "scale", constantInput, [...r.s.toArray(), ...r.s.toArray()], "VEC3");
  }
  if (paths.has("rotation")) {
    if (frames[0].has(node)) {
      const values = [];
      let previous = null;
      for (const frame of frames) {
        const q = frame.get(node).clone().normalize();
        // Keep neighbouring keys in the same hemisphere so interpolation takes the short way
        if (previous && previous.dot(q) < 0) {
          q.set(-q.x, -q.y, -q.z, -q.w);
        }
        values.push(q.x, q.y, q.z, q.w);
        previous = q;
      }
      addChannel(node, "rotation", animatedInput, values, "VEC4");
    } else {
      addChannel(node, "rotation", constantInput, [...r.r.toArray(), ...r.r.toArray()], "VEC4");
    }
  }
}

const out = {
  ...json,
  accessors,
  bufferViews,
  buffers: [{ byteLength }],
  skins: json.skins.map((skin) => ({ ...skin, inverseBindMatrices: 0 })),
  animations: [{ name: "climb", samplers, channels }],
};
let jsonText = JSON.stringify(out);
while (Buffer.byteLength(jsonText) % 4) {
  jsonText += " ";
}
const jsonBytes = Buffer.from(jsonText);
let binBytes = Buffer.concat(chunks);
if (binBytes.length % 4) {
  binBytes = Buffer.concat([binBytes, Buffer.alloc(4 - (binBytes.length % 4))]);
}
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + jsonBytes.length + 8 + binBytes.length, 8);
const jsonHeader = Buffer.alloc(8);
jsonHeader.writeUInt32LE(jsonBytes.length, 0);
jsonHeader.writeUInt32LE(0x4e4f534a, 4);
const binHeader = Buffer.alloc(8);
binHeader.writeUInt32LE(binBytes.length, 0);
binHeader.writeUInt32LE(0x004e4942, 4);
fs.writeFileSync(outputPath, Buffer.concat([header, jsonHeader, jsonBytes, binHeader, binBytes]));
console.log(`Wrote ${path.relative(root, outputPath)} (${channels.length} channels, ${Math.round((12 + 16 + jsonBytes.length + binBytes.length) / 1024)} KiB)`);
