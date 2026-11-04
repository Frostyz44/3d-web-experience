import {
  AdaptiveQualityMonitor,
  advanceHour,
  computeTimeOfDay,
  detectQualityTier,
  ENVIRONMENT_DEFAULTS,
  isMobileDevice,
  lowerQualityTier,
  parseQualityTier,
  QUALITY_PRESETS,
  resolveBloomSettings,
  resolveQualitySettings,
  wrapHour,
} from "../../src/rendering/EnvironmentSettings";

const desktopUA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const androidUA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36";
const iPhoneUA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const iPadUA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

describe("quality tiers", () => {
  test("desktop with a discrete GPU gets high", () => {
    expect(
      detectQualityTier({
        userAgent: desktopUA,
        gpuRenderer: "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0)",
        hardwareConcurrency: 12,
        deviceMemory: 8,
      }),
    ).toBe("high");
  });

  test("desktop with older integrated graphics gets medium", () => {
    expect(
      detectQualityTier({
        userAgent: desktopUA,
        gpuRenderer: "ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0)",
        hardwareConcurrency: 8,
      }),
    ).toBe("medium");
  });

  test("software renderers get low", () => {
    expect(detectQualityTier({ userAgent: desktopUA, gpuRenderer: "Google SwiftShader" })).toBe(
      "low",
    );
    expect(detectQualityTier({ gpuRenderer: "llvmpipe (LLVM 15.0.7, 256 bits)" })).toBe("low");
  });

  test("mid-range phones get low, strong phones get medium", () => {
    expect(
      detectQualityTier({ userAgent: androidUA, gpuRenderer: "Adreno (TM) 619", deviceMemory: 4 }),
    ).toBe("low");
    expect(detectQualityTier({ userAgent: androidUA, gpuRenderer: "Mali-G57 MC2" })).toBe("low");
    expect(
      detectQualityTier({ userAgent: androidUA, gpuRenderer: "Adreno (TM) 740", deviceMemory: 8 }),
    ).toBe("medium");
    expect(detectQualityTier({ userAgent: iPhoneUA, gpuRenderer: "Apple GPU" })).toBe("medium");
  });

  test("low memory or few cores always gets low", () => {
    expect(
      detectQualityTier({ userAgent: desktopUA, gpuRenderer: "NVIDIA", deviceMemory: 2 }),
    ).toBe("low");
    expect(
      detectQualityTier({ userAgent: desktopUA, gpuRenderer: "NVIDIA", hardwareConcurrency: 2 }),
    ).toBe("low");
  });

  test("detects mobile devices including iPadOS", () => {
    expect(isMobileDevice({ userAgent: androidUA })).toBe(true);
    expect(isMobileDevice({ userAgent: iPadUA, maxTouchPoints: 5 })).toBe(true);
    expect(isMobileDevice({ userAgent: iPadUA, maxTouchPoints: 0 })).toBe(false);
    expect(isMobileDevice({ userAgent: androidUA, mobile: false })).toBe(false);
  });

  test("parses tier names", () => {
    expect(parseQualityTier("LOW")).toBe("low");
    expect(parseQualityTier(" high ")).toBe("high");
    expect(parseQualityTier("auto")).toBe("auto");
    expect(parseQualityTier("ultra")).toBeNull();
    expect(parseQualityTier(3)).toBeNull();
  });

  test("steps down one tier at a time", () => {
    expect(lowerQualityTier("high")).toBe("medium");
    expect(lowerQualityTier("medium")).toBe("low");
    expect(lowerQualityTier("low")).toBeNull();
  });

  test("tiers get cheaper from high to low", () => {
    const { high, medium, low } = QUALITY_PRESETS;
    expect(high.shadows.mapSize).toBeGreaterThan(medium.shadows.mapSize);
    expect(medium.shadows.mapSize).toBeGreaterThan(low.shadows.mapSize);
    expect(high.maxPixelRatio).toBeGreaterThan(low.maxPixelRatio);
    expect(low.ssao.enabled).toBe(false);
    expect(high.shadows.localLights).toBeGreaterThan(low.shadows.localLights);
    expect(low.bloom.resolutionScale).toBeLessThan(high.bloom.resolutionScale);
  });

  test("maxPixelRatio from the configuration only lowers the tier limit", () => {
    expect(resolveQualitySettings("high", { maxPixelRatio: 1.25 }).maxPixelRatio).toBe(1.25);
    expect(resolveQualitySettings("low", { maxPixelRatio: 3 }).maxPixelRatio).toBe(1);
    expect(resolveQualitySettings("medium").maxPixelRatio).toBe(1.5);
  });

  test("resolved settings do not share objects with the presets", () => {
    const settings = resolveQualitySettings("high");
    settings.shadows.mapSize = 1;
    expect(QUALITY_PRESETS.high.shadows.mapSize).toBe(4096);
  });
});

describe("AdaptiveQualityMonitor", () => {
  function feed(monitor: AdaptiveQualityMonitor, frameMs: number, seconds: number): boolean {
    let dropped = false;
    const frames = Math.ceil((seconds * 1000) / frameMs);
    for (let i = 0; i < frames; i++) {
      dropped = monitor.addFrame(frameMs / 1000) || dropped;
    }
    return dropped;
  }

  test("asks to drop when frames are consistently slow", () => {
    const monitor = new AdaptiveQualityMonitor({ settleSeconds: 1, windowSeconds: 2 });
    expect(feed(monitor, 40, 5)).toBe(true);
  });

  test("keeps the tier when frames are fast", () => {
    const monitor = new AdaptiveQualityMonitor({ settleSeconds: 1, windowSeconds: 2 });
    expect(feed(monitor, 16.7, 20)).toBe(false);
  });

  test("ignores the settle period and hidden-tab pauses", () => {
    const monitor = new AdaptiveQualityMonitor({ settleSeconds: 3, windowSeconds: 2 });
    expect(feed(monitor, 40, 2.5)).toBe(false);
    expect(monitor.addFrame(5)).toBe(false);
  });

  test("reset restarts the settle period", () => {
    const monitor = new AdaptiveQualityMonitor({ settleSeconds: 2, windowSeconds: 1 });
    expect(feed(monitor, 40, 4)).toBe(true);
    monitor.reset();
    expect(feed(monitor, 40, 1.5)).toBe(false);
    expect(feed(monitor, 40, 2)).toBe(true);
  });
});

describe("time of day", () => {
  test("noon puts the sun high in the configured direction", () => {
    const noon = computeTimeOfDay(12, { azimuthalAngle: 180, maxElevation: 60 });
    expect(noon.sunElevation).toBeCloseTo(60);
    expect(noon.lightPolarAngle).toBeCloseTo(30);
    expect(noon.lightAzimuthalAngle).toBeCloseTo(180);
    expect(noon.daylight).toBe(1);
    expect(noon.lightIntensityScale).toBe(1);
    expect(noon.stars).toBe(0);
  });

  test("sunrise and sunset are on the horizon on opposite sides", () => {
    const sunrise = computeTimeOfDay(6, { azimuthalAngle: 180 });
    const sunset = computeTimeOfDay(18, { azimuthalAngle: 180 });
    expect(sunrise.sunElevation).toBeCloseTo(0);
    expect(sunset.sunElevation).toBeCloseTo(0);
    expect(sunrise.sunAzimuthalAngle).toBeCloseTo(90);
    expect(sunset.sunAzimuthalAngle).toBeCloseTo(270);
    // warm light near the horizon
    expect(sunset.lightColor.b).toBeLessThan(0.6);
    expect(sunset.fogColor.r).toBeGreaterThan(sunset.fogColor.b);
  });

  test("night uses a dim cool moon above the horizon", () => {
    const night = computeTimeOfDay(0);
    expect(night.sunElevation).toBeLessThan(0);
    expect(night.lightPolarAngle).toBeLessThan(90);
    expect(night.lightIntensityScale).toBeGreaterThan(0);
    expect(night.lightIntensityScale).toBeLessThan(0.2);
    expect(night.lightColor.b).toBeGreaterThan(night.lightColor.r);
    expect(night.stars).toBe(1);
    expect(night.daylight).toBe(0);
    expect(night.bloomScale).toBeGreaterThan(1);
    expect(night.exposureScale).toBeGreaterThan(1);
  });

  test("lighting changes smoothly through the day", () => {
    let previous = computeTimeOfDay(0);
    for (let hour = 0.01; hour <= 24; hour += 0.01) {
      const current = computeTimeOfDay(hour);
      expect(Math.abs(current.daylight - previous.daylight)).toBeLessThan(0.03);
      expect(Math.abs(current.fogColor.r - previous.fogColor.r)).toBeLessThan(0.03);
      // the light intensity may only jump while it is close to zero (sun/moon swap)
      const jump = Math.abs(current.lightIntensityScale - previous.lightIntensityScale);
      expect(jump).toBeLessThan(0.03);
      previous = current;
    }
  });

  test("hours wrap and advance with the cycle", () => {
    expect(wrapHour(25)).toBe(1);
    expect(wrapHour(-1)).toBe(23);
    expect(advanceHour(10, 60, 0)).toBe(10);
    // a 24 minute day advances one hour per real minute
    expect(advanceHour(23.5, 60, 24)).toBeCloseTo(0.5);
  });
});

describe("bloom settings", () => {
  test("defaults to emissive bloom", () => {
    expect(resolveBloomSettings(undefined)).toEqual({
      mode: "emissive",
      intensity: 1.8,
      threshold: ENVIRONMENT_DEFAULTS.postProcessing.bloom.emissiveThreshold,
      smoothing: 0.3,
      radius: 0.7,
    });
  });

  test("keeps the deprecated bloomIntensity working", () => {
    expect(resolveBloomSettings({ bloomIntensity: 0.4 }).intensity).toBe(0.4);
    expect(resolveBloomSettings({ bloomIntensity: 0.4, bloom: { intensity: 2 } }).intensity).toBe(
      2,
    );
  });

  test("luminance mode uses a higher default threshold", () => {
    const settings = resolveBloomSettings({ bloom: { mode: "luminance" } });
    expect(settings.mode).toBe("luminance");
    expect(settings.threshold).toBe(ENVIRONMENT_DEFAULTS.postProcessing.bloom.luminanceThreshold);
    expect(resolveBloomSettings({ bloom: { mode: "luminance", threshold: 3 } }).threshold).toBe(3);
  });
});
