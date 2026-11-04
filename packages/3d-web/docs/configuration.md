# Configuration Reference

The CLI takes a **`world.json`** file as its primary argument. This file defines the 3D experience: environment, spawn, avatars, and MML documents. It is portable — the same file can be used with the hosted [MML Worlds Service](https://mml.io).

Local serving options (port, host, file directories) are passed as CLI flags.

The world config is validated at startup using JSON Schema (via AJV). Unknown properties are rejected.

## Quick Start

```bash
# Generate a starter world.json and MML document
3d-web-experience init

# Start a server
3d-web-experience serve world.json --mml-documents ./mml-documents/
```

The `init` command generates:

**world.json:**
```json
{
  "chat": true,
  "auth": {
    "allowAnonymous": true
  },
  "mmlDocuments": {
    "hello-world.html": {
      "url": "ws:///mml-documents/hello-world.html",
      "position": { "x": 0, "y": 0, "z": 10 }
    }
  }
}
```

**mml-documents/hello-world.html** — a sample MML document with a clickable cube.

---

## CLI Commands

### `init [directory]`

Generate a starter `world.json` and `mml-documents/` directory.

```bash
3d-web-experience init          # initialize in current directory
3d-web-experience init my-world # initialize in ./my-world/
```

### `validate <world-config>`

Validate a world config JSON file without starting the server.

```bash
3d-web-experience validate world.json
```

### `serve <world-config> [options]`

Start a 3D web experience server from a world config file.

```bash
3d-web-experience serve world.json --mml-documents ./mml-documents/
3d-web-experience serve world.json --port 3000 --host 0.0.0.0 --mml-documents ./mml-documents/ --assets ./assets/
```

#### CLI Flags

| Flag | Description | Default |
|------|-------------|---------|
| `-p, --port <number>` | Port to listen on | `8080` |
| `--host <address>` | Host to bind to | `127.0.0.1` |
| `--no-watch` | Disable live-reloading when the world config file changes | enabled |
| `--mml-documents <path>` | Serve MML documents from this directory (watched for live reload) | — |
| `--mml-ws-path <path>` | WebSocket URL path prefix for MML documents | `/mml-documents/` |
| `--assets <path>` | Serve a directory as static assets | — |
| `--assets-url-path <path>` | URL path to serve assets on | `/assets/` |

All paths are resolved relative to the current working directory.

#### Environment Variables

| Variable | Description |
|----------|-------------|
| `TRUST_PROXY` | Set to `"1"` or `"true"` to enable Express `trust proxy` mode. Required when running behind a reverse proxy or load balancer so that rate limiting uses the real client IP instead of the proxy's IP. |

If `--mml-documents` is not provided, the server auto-detects an `mml-documents/` directory adjacent to the config file and serves it automatically.

---

## World Config (`world.json`)

Controls the 3D experience: what users see, where they spawn, which avatars are available, and which MML documents are loaded. This file is portable — it can be used directly with the hosted worlds service.

All fields are optional.

```json
{
  "chat": true,
  "allowOrbitalCamera": true,
  "enableTweakPane": false,
  "mmlDocuments": { ... },
  "environment": { ... },
  "spawn": { ... },
  "avatars": { ... }
}
```

---

### `chat`

**Type:** `boolean`
**Default:** `true`

Enable or disable the text chat UI and chat message relaying.

---

### `allowOrbitalCamera`

**Type:** `boolean`

Allow users to toggle a free-fly camera with the C key. Default behavior is determined by the client library (disabled when not specified).

---

### `enableTweakPane`

**Type:** `boolean`
**Default:** `false`

Show a debug tweakpane UI for tuning camera and character controller values at runtime.

---

### `mmlDocuments`

A map of named MML documents to load into the world. Each document has a URL and optional placement.

```json
{
  "mmlDocuments": {
    "hello-world.html": {
      "url": "ws:///mml-documents/hello-world.html",
      "position": { "x": 0, "y": 0, "z": 10 },
      "rotation": { "x": 0, "y": 180, "z": 0 },
      "scale": { "x": 1, "y": 1, "z": 1 }
    },
    "remote-doc": {
      "url": "wss://example.com/some-document",
      "position": { "x": -10, "y": 0, "z": 0 },
      "passAuthToken": true
    }
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `url` | `string` **(required)** | WebSocket URL to the MML document. Use `ws:///path` (three slashes) for protocol-relative URLs resolved against the current host. |
| `position` | `{ x, y, z }` | World-space position. |
| `rotation` | `{ x, y, z }` | Rotation in degrees. |
| `scale` | `{ x, y, z }` | Scale multiplier. |
| `passAuthToken` | `boolean` | When `true`, the authenticated user's session token is passed to the MML document WebSocket connection. |

#### URL formats

MML document URLs accept the following schemes (pattern: `^(wss?://|https?://|/)`):

- **`ws:///mml-documents/hello.html`** — protocol-relative to the current host (three slashes). The client resolves `ws:` or `wss:` based on the page protocol. Works locally and in production.
- **`wss:///mml-documents/hello.html`** — always uses a secure WebSocket connection regardless of the page protocol.
- **`wss://example.com/doc`** — absolute secure WebSocket URL to a remote MML document.
- **`ws://example.com/doc`** — absolute unencrypted WebSocket URL (useful for local development).
- **`https://example.com/doc`** — HTTPS URL.
- **`http://example.com/doc`** — HTTP URL (useful for local development).
- **`/mml-documents/hello.html`** — bare path, resolved against the current host.

---

### `environment`

Controls the visual environment: sky, sun and shadows, time of day, lighting, fog, post-processing and
rendering quality. Every field is optional. Colours are linear RGB with channels from 0 to 1.

```json
{
  "environment": {
    "groundPlane": true,
    "sun": { "intensity": 2.6, "polarAngle": 50, "azimuthalAngle": 30 },
    "sky": { "turbidity": 2.5, "rayleigh": 1.2, "exposure": 0.45 },
    "timeOfDay": { "hour": 16.5, "cycleMinutes": 0 },
    "envMap": { "intensity": 0.6 },
    "fog": { "fogNear": 45, "fogFar": 230 },
    "ambientLight": { "intensity": 0.6 },
    "shadows": { "softness": 2.5 },
    "postProcessing": {
      "bloom": { "mode": "emissive", "intensity": 1.3 },
      "toneMapping": "aces",
      "exposure": 1
    },
    "quality": { "tier": "auto" }
  }
}
```

#### `environment.groundPlane`

**Type:** `boolean`
**Default:** `true`

Show a ground plane at y=0 (500 × 500 m, large enough that its edge sits inside the fog).

#### `environment.skybox`

An HDR skybox. When set it replaces the procedural sky (`environment.sky`) and lights the scene.

| Field | Type | Default | Range | Description |
|-------|------|---------|-------|-------------|
| `hdrJpgUrl` | `string` | — | — | URL to an HDR JPG skybox image. Provide either this or `hdrUrl`. |
| `hdrUrl` | `string` | — | — | URL to an HDR skybox image. Provide either this or `hdrJpgUrl`. |
| `intensity` | `number` | `0.9` | 0–10 | Skybox brightness. |
| `blurriness` | `number` | `0` | 0–1 | Skybox blur amount. |
| `azimuthalAngle` | `number` | `0` | -360–360 | Horizontal rotation of the skybox in degrees. |
| `polarAngle` | `number` | `0` | -360–360 | Vertical rotation of the skybox in degrees. |

#### `environment.sun`

The sun is a directional light with soft shadows. Its shadow area follows the player and is snapped to
shadow-map texels, so shadows do not shimmer while moving.

| Field | Type | Default | Range | Description |
|-------|------|---------|-------|-------------|
| `intensity` | `number` | `2.6` | 0–10 | Directional light intensity. |
| `polarAngle` | `number` | `50` | -360–360 | Angle from straight up in degrees (0 = overhead, 90 = horizon). Ignored when `timeOfDay` is set. |
| `azimuthalAngle` | `number` | `30` | -360–360 | Horizontal angle of the sun in degrees. Ignored when `timeOfDay` is set. |
| `color` | `{ r, g, b }` | `{ 1, 0.96, 0.9 }` | 0–1 per channel | Light colour. With `timeOfDay` it is warmed near the horizon. |

#### `environment.sky`

The procedural sky (Preetham model), used when no `skybox` is set. It also provides the environment map
that lights and reflects on materials, and it fades into the fog colour at the horizon.

| Field | Type | Default | Range | Description |
|-------|------|---------|-------|-------------|
| `turbidity` | `number` | `2.5` | 0–30 | Haze. Higher is whiter and hazier. |
| `rayleigh` | `number` | `1.2` | 0–10 | Blue scattering. Higher is a deeper blue (and redder sunsets). |
| `mieCoefficient` | `number` | `0.005` | 0–0.1 | Strength of the glow around the sun. |
| `mieDirectionalG` | `number` | `0.8` | 0–0.999 | Size of the glow around the sun (higher is tighter). |
| `exposure` | `number` | `0.45` | 0–10 | Sky brightness. |
| `nightColor` | `{ r, g, b }` | `{ 0.012, 0.02, 0.05 }` | 0–1 per channel | Night sky colour (when the sun is below the horizon). |
| `stars` | `number` | `1` | 0–10 | Star brightness at night. `0` disables stars. |
| `horizonBlend` | `number` | `8` | 0–90 | Degrees above the horizon over which the sky fades into the fog colour. |

#### `environment.timeOfDay`

When set, the hour positions the sun (sunrise 6, noon 12, sunset 18) and adjusts the light colour, ambient
light, sky, fog colour, exposure and bloom. At night a dim, cool moonlight keeps the world readable and
glowing objects stand out more.

| Field | Type | Default | Range | Description |
|-------|------|---------|-------|-------------|
| `hour` | `number` | — (required) | 0–24 | Time of day. |
| `cycleMinutes` | `number` | `0` | 0+ | Real minutes per in-world day. `0` keeps the hour fixed. |
| `azimuthalAngle` | `number` | `20` | -360–360 | Direction of the sun at noon (same convention as `sun.azimuthalAngle`). |
| `maxElevation` | `number` | `55` | 5–89 | Sun elevation at noon in degrees. |

For testing, the page URL parameter `?hour=21` overrides the hour (and stops the cycle).

#### `environment.envMap`

| Field | Type | Default | Range | Description |
|-------|------|---------|-------|-------------|
| `intensity` | `number` | `0.6` | 0–5 | Environment map lighting and reflection intensity on materials. |

#### `environment.fog`

| Field | Type | Default | Range | Description |
|-------|------|---------|-------|-------------|
| `fogNear` | `number` | `30` | 0+ | Distance at which fog starts. |
| `fogFar` | `number` | `210` | 0+ | Distance at which fog fully obscures. `0` disables fog. |
| `fogColor` | `{ r, g, b }` | sky horizon | 0–1 per channel | Colour of the distance fog. When omitted with the procedural sky, the fog follows the sky's horizon colour (including time of day); with an HDR skybox it defaults to `{ 0.6, 0.6, 0.6 }`. |

#### `environment.postProcessing`

Applies when `postProcessingEnabled` is `true`.

| Field | Type | Default | Range | Description |
|-------|------|---------|-------|-------------|
| `bloom.mode` | `string` | `"emissive"` | `emissive`, `luminance` | `emissive`: only emissive surfaces (`m-material` `emissive`, `emissive-map`, `emissive-intensity`) and additive particles (fire, sparks) glow, by how bright they are; lit white surfaces and the sky never bloom. `luminance`: anything brighter than `threshold` in the image glows. |
| `bloom.intensity` | `number` | `1.3` | 0–10 | Glow strength. |
| `bloom.threshold` | `number` | `0.05` (emissive) / `1.2` (luminance) | 0–100 | Linear brightness below which nothing glows. |
| `bloom.smoothing` | `number` | `0.3` | 0–10 | Softness of the threshold. |
| `bloom.radius` | `number` | `0.7` | 0–1 | Spread of the glow. |
| `bloomIntensity` | `number` | — | 0–10 | Deprecated alias of `bloom.intensity` (still honoured). |
| `toneMapping` | `string` | `"aces"` | `aces`, `agx`, `neutral`, `reinhard`, `cineon`, `linear` | Tone mapping, used with and without post-processing. |
| `exposure` | `number` | `1` | 0–10 | Tone mapping exposure. |
| `ambientOcclusion` | `number` | `1` | 0–5 | Screen-space ambient occlusion strength (on tiers that have SSAO). |
| `grain` | `number` | `0.02` | 0–1 | Film grain amount (off on the low tier). |

#### `environment.ambientLight`

A hemisphere light: `color` from above, `groundColor` from below, so shapes keep definition in shadow.

| Field | Type | Default | Range | Description |
|-------|------|---------|-------|-------------|
| `intensity` | `number` | `0.6` | 0–5 | Ambient light intensity. |
| `color` | `{ r, g, b }` | `{ 0.75, 0.85, 1 }` | 0–1 per channel | Light from the sky. |
| `groundColor` | `{ r, g, b }` | `{ 0.42, 0.38, 0.33 }` | 0–1 per channel | Light bounced from the ground. |

#### `environment.shadows`

| Field | Type | Default | Range | Description |
|-------|------|---------|-------|-------------|
| `enabled` | `boolean` | `true` | — | Sun shadows. |
| `distance` | `number` | from the quality tier (40 / 30 / 22) | 0–500 | Half the width in metres of the shadowed area around the player. |
| `softness` | `number` | `2.5` | 0–20 | Blur radius of shadow edges, in shadow-map texels. |
| `intensity` | `number` | `1` | 0–1 | Shadow darkness. |

#### `environment.quality`

Rendering quality tiers. `auto` picks a tier from the device (GPU, mobile or desktop, memory, cores) and,
with `adaptive`, steps down a tier when frames stay slower than about 38 fps.

| Field | Type | Default | Range | Description |
|-------|------|---------|-------|-------------|
| `tier` | `string` | `"auto"` | `auto`, `high`, `medium`, `low` | Quality tier. The page URL parameter `?quality=low` (or `medium`, `high`, `auto`) overrides it. |
| `adaptive` | `boolean` | `true` | — | With `auto`, lower the tier when frames are slow. |
| `maxPixelRatio` | `number` | — | 0.25–4 | Extra upper limit for the device pixel ratio. |

What each tier controls:

| | `high` (desktop) | `medium` (laptops, high-end phones) | `low` (phones, slow GPUs) |
|---|---|---|---|
| Max pixel ratio | 2 | 1.5 | 1 |
| SSAO | full resolution, 16 samples | half resolution, 8 samples | off |
| Sun shadow map / area | 4096 px / ±40 m | 2048 px / ±30 m | 1024 px / ±22 m |
| Point light shadows updated per frame | nearest 2 | nearest 1 | none (refreshed in turns) |
| Bloom resolution / blur levels | 1/2 / 8 | 1/2 / 6 | 1/4 / 5 |
| Sky environment map | 256 px | 128 px | 64 px |
| Film grain | on | on | off |

---

### `spawn`

Controls where users appear and when they respawn.

```json
{
  "spawn": {
    "spawnPosition": { "x": 0, "y": 0, "z": 0 },
    "spawnPositionVariance": { "x": 3, "y": 0, "z": 3 },
    "spawnYRotation": 180,
    "respawnTrigger": {
      "minY": -10
    }
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `spawnPosition` | `{ x, y, z }` | `{ 0, 0, 0 }` | Center point where users spawn. |
| `spawnPositionVariance` | `{ x, y, z }` | `{ 0, 0, 0 }` | Random offset range applied to spawn position. |
| `spawnYRotation` | `number` | `0` | Initial facing direction in degrees (-360–360). |
| `respawnTrigger` | `object` | — | Bounding box that triggers respawn when exited. |
| `respawnTrigger.minX` | `number` | `-Infinity` | Minimum X boundary. |
| `respawnTrigger.maxX` | `number` | `+Infinity` | Maximum X boundary. |
| `respawnTrigger.minY` | `number` | `-100` | Minimum Y boundary (fall detection). |
| `respawnTrigger.maxY` | `number` | `+Infinity` | Maximum Y boundary. |
| `respawnTrigger.minZ` | `number` | `-Infinity` | Minimum Z boundary. |
| `respawnTrigger.maxZ` | `number` | `+Infinity` | Maximum Z boundary. |

When a user's position exits the `respawnTrigger` bounding box, they are respawned at the spawn position. The default `minY` of `-100` acts as basic fall-off-the-map detection.

---

### `avatars`

Controls the avatar selection UI and which avatars users can pick.

```json
{
  "avatars": {
    "allowCustomAvatars": false,
    "availableAvatars": [
      {
        "name": "Robot",
        "meshFileUrl": "/assets/models/robot.glb",
        "isDefaultAvatar": true,
        "thumbnailUrl": "/assets/thumbnails/robot.png"
      },
      {
        "name": "Custom Character",
        "mmlCharacterUrl": "https://example.com/character.html"
      }
    ]
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `allowCustomAvatars` | `boolean` | `false` | Let users paste an arbitrary avatar URL. |
| `availableAvatars` | `array` | `[]` | List of avatars to show in the selection UI. |

Each avatar should include one of these source fields:

| Source Field | Type | Description |
|-------------|------|-------------|
| `meshFileUrl` | `string` | URL to a GLB/GLTF model file. |
| `mmlCharacterUrl` | `string` | URL to an MML character document. |
| `mmlCharacterString` | `string` | Inline MML character markup. |

Additional avatar fields:

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Display name shown in the avatar picker. |
| `thumbnailUrl` | `string` | Thumbnail image URL for the avatar picker. |
| `isDefaultAvatar` | `boolean` | Mark this avatar as the pre-selected default. |

If no avatars are configured, users get the built-in default bot avatar.

---

### `allowCustomDisplayName`

**Type:** `boolean`

Allow users to set a custom display name. Default behavior is determined by the client library (disabled when not specified).

---

### `postProcessingEnabled`

**Type:** `boolean`

Enable post-processing effects (emissive bloom, SSAO, tone mapping, anti-aliasing). Default behavior is determined by the client library (disabled when not specified). Recommended: `true`; the effects scale with `environment.quality`.

---

### `loadingScreen`

Customize the loading screen appearance.

```json
{
  "loadingScreen": {
    "background": "linear-gradient(to bottom, #1a1a2e, #16213e)",
    "backgroundImageUrl": "/assets/loading-bg.jpg",
    "backgroundBlurAmount": 4,
    "overlayLayers": [
      {
        "overlayImageUrl": "/assets/logo.png",
        "overlayAnchor": "top-left",
        "overlayOffset": { "x": 20, "y": 20 }
      }
    ],
    "title": "My World",
    "subtitle": "Loading...",
    "color": "#ffffff"
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `background` | `string` | CSS background value (color, gradient, etc.). |
| `backgroundImageUrl` | `string` | URL to a background image. |
| `backgroundBlurAmount` | `number` | Blur amount for the background image (minimum `0`). |
| `overlayLayers` | `array` | Overlay images positioned on the loading screen. |
| `overlayLayers[].overlayImageUrl` | `string` **(required)** | URL to the overlay image. |
| `overlayLayers[].overlayAnchor` | `string` **(required)** | Anchor position: `"top-left"`, `"top-right"`, `"bottom-left"`, or `"bottom-right"`. |
| `overlayLayers[].overlayOffset` | `{ x, y }` | Pixel offset from the anchor position. |
| `title` | `string` | Title text displayed on the loading screen. |
| `subtitle` | `string` | Subtitle text displayed on the loading screen. |
| `color` | `string` | Text color for the loading screen. |

---

### `auth`

Authentication configuration.

```json
{
  "auth": {
    "allowAnonymous": true,
    "maxConnections": 50
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `allowAnonymous` | `boolean` | `false` | Allow users to connect without authentication. |
| `webhookUrl` | `string` | — | URL for webhook-based authentication. Must be an absolute URL (pattern: `^https?://`). |
| `serverUrl` | `string` | — | URL for remote auth server. Must be an absolute URL (pattern: `^https?://`). |
| `maxConnections` | `integer` | — | Maximum number of simultaneous connections (minimum `1`). |

> **Note:** If both `webhookUrl` and `serverUrl` are set, `serverUrl` takes precedence and `webhookUrl` is ignored with a warning.

---

### `hud`

Control the visibility of HUD (heads-up display) elements. Set to `false` to disable all HUD elements, or provide an object to control individual elements. To enable all HUD elements with defaults, omit the `hud` field entirely or use `hud: {}`. Note that `hud: true` is **not** accepted by the schema — only `false` or an object are valid.

```json
{
  "hud": {
    "minimap": true,
    "playerList": true,
    "respawnButton": true
  }
}
```

| Value | Description |
|-------|-------------|
| `false` | Disable all HUD elements. |
| `{ ... }` | Object with boolean fields to toggle individual HUD elements. |

Object fields:

| Field | Type | Description |
|-------|------|-------------|
| `minimap` | `boolean` | Show the minimap. |
| `playerList` | `boolean` | Show the player list. |
| `respawnButton` | `boolean` | Show a "RESPAWN" button in the UI. |

---

### `clientScripts`

**Type:** `string[]`

Paths to JavaScript files to inject into the client page. Can be local file paths (resolved relative to the config file) or HTTP/HTTPS URLs. Local paths must remain within the config file's directory.

```json
{
  "clientScripts": [
    "scripts/analytics.js",
    "https://cdn.example.com/tracker.js"
  ]
}
```

---

## Validation

The world config is validated at startup against a JSON Schema using [AJV](https://ajv.js.org/). Validation enforces:

- **Type checking** — every field must match its declared type
- **No unknown properties** — misspelled keys are rejected
- **Range constraints** — numeric fields are bounded (e.g., skybox intensity 0–10, bloom intensity 0–10)
- **Required fields** — `url` is required per MML document

Example error output:

```
Invalid world config:
  /mmlDocuments/my-doc: must have required property 'url'
  /environment/skybox/intensity: must be <= 10
```

The schema is defined in `src/worldConfigSchema.ts`.

---

## Full Example

```bash
3d-web-experience serve world.json \
  --port 3000 \
  --mml-documents ./mml-documents/ \
  --assets ./assets/
```

**world.json:**
```json
{
  "chat": true,
  "allowOrbitalCamera": true,
  "mmlDocuments": {
    "gallery": {
      "url": "ws:///mml-documents/gallery.html",
      "position": { "x": 0, "y": 0, "z": 15 },
      "rotation": { "x": 0, "y": 180, "z": 0 }
    },
    "stage": {
      "url": "ws:///mml-documents/stage.html",
      "position": { "x": -20, "y": 0, "z": 0 },
      "scale": { "x": 2, "y": 2, "z": 2 }
    }
  },
  "environment": {
    "groundPlane": true,
    "skybox": {
      "hdrJpgUrl": "/assets/evening_sky.hdr.jpg",
      "intensity": 1.0,
      "blurriness": 0.1
    },
    "sun": {
      "intensity": 1.5,
      "polarAngle": -45,
      "azimuthalAngle": 200
    },
    "fog": {
      "fogNear": 30,
      "fogFar": 150
    },
    "ambientLight": {
      "intensity": 0.2
    },
    "postProcessing": {
      "bloomIntensity": 0.1
    }
  },
  "spawn": {
    "spawnPosition": { "x": 0, "y": 0, "z": 5 },
    "spawnPositionVariance": { "x": 2, "y": 0, "z": 2 },
    "spawnYRotation": 180,
    "respawnTrigger": {
      "minY": -20
    }
  },
  "avatars": {
    "allowCustomAvatars": true,
    "availableAvatars": [
      {
        "name": "Bot",
        "meshFileUrl": "/assets/models/bot.glb",
        "thumbnailUrl": "/assets/thumbnails/bot.png",
        "isDefaultAvatar": true
      }
    ]
  }
}
```
