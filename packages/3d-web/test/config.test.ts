import { buildPageConfig, parseWorldConfig } from "../src/config";

describe("parseWorldConfig", () => {
  it("accepts minimal empty config {}", () => {
    expect(() => parseWorldConfig({})).not.toThrow();
  });

  it("accepts full valid config with all fields", () => {
    const config = {
      chat: true,
      allowOrbitalCamera: true,
      allowCustomDisplayName: true,
      enableTweakPane: false,
      postProcessingEnabled: true,
      loadingScreen: {
        background: "#000",
        title: "Loading",
        subtitle: "Please wait...",
      },
      mmlDocuments: {
        "test.html": {
          url: "wss:///mml-documents/test.html",
          position: { x: 0, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
        },
      },
      environment: {
        groundPlane: true,
        skybox: {
          hdrJpgUrl: "https://example.com/sky.jpg",
          intensity: 1,
          blurriness: 0.5,
          azimuthalAngle: 90,
          polarAngle: 45,
        },
        sun: { intensity: 1, polarAngle: 45, azimuthalAngle: 180 },
        envMap: { intensity: 0.5 },
        fog: { fogNear: 10, fogFar: 100 },
        postProcessing: { bloomIntensity: 0.3 },
        ambientLight: { intensity: 0.5 },
      },
      spawn: {
        spawnPosition: { x: 0, y: 0, z: 0 },
        spawnPositionVariance: { x: 5, y: 0, z: 5 },
        spawnYRotation: 180,
        respawnTrigger: { minY: -10 },
      },
      avatars: {
        allowCustomAvatars: true,
        availableAvatars: [
          {
            name: "Bot",
            thumbnailUrl: "https://example.com/thumb.png",
            isDefaultAvatar: true,
            meshFileUrl: "/bot.glb",
          },
        ],
      },
      auth: {
        allowAnonymous: true,
        webhookUrl: "https://example.com/auth",
        maxConnections: 50,
      },
      hud: { minimap: true, playerList: false },
    };
    expect(() => parseWorldConfig(config)).not.toThrow();
    expect(parseWorldConfig(config)).toEqual(config);
  });

  it("rejects unknown top-level properties", () => {
    expect(() => parseWorldConfig({ unknownProp: true })).toThrow(/Invalid world config/);
  });

  it("rejects invalid types (chat: 'yes' instead of boolean)", () => {
    expect(() => parseWorldConfig({ chat: "yes" })).toThrow(/Invalid world config/);
  });

  it("rejects invalid nested properties (environment.skybox.intensity: 20)", () => {
    expect(() =>
      parseWorldConfig({
        environment: { skybox: { intensity: 20 } },
      }),
    ).toThrow(/Invalid world config/);
  });

  it("returns descriptive error messages with JSON paths", () => {
    try {
      parseWorldConfig({ environment: { skybox: { intensity: 20 } } });
      fail("Expected to throw");
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toContain("/environment/skybox/intensity");
    }
  });

  it("validates auth section (allowAnonymous, webhookUrl, maxConnections)", () => {
    expect(() =>
      parseWorldConfig({
        auth: { allowAnonymous: true, webhookUrl: "https://x.com/auth", maxConnections: 10 },
      }),
    ).not.toThrow();
  });

  it("rejects auth.maxConnections < 1", () => {
    expect(() => parseWorldConfig({ auth: { maxConnections: 0 } })).toThrow(/Invalid world config/);
  });

  it("rejects auth.maxConnections as float", () => {
    expect(() => parseWorldConfig({ auth: { maxConnections: 1.5 } })).toThrow(
      /Invalid world config/,
    );
  });

  it("rejects auth.serverUrl with a bare path", () => {
    expect(() => parseWorldConfig({ auth: { serverUrl: "/auth" } })).toThrow(
      /Invalid world config/,
    );
  });

  it("rejects auth.webhookUrl with a bare path", () => {
    expect(() => parseWorldConfig({ auth: { webhookUrl: "/auth/callback" } })).toThrow(
      /Invalid world config/,
    );
  });

  it("rejects empty string in clientScripts", () => {
    expect(() => parseWorldConfig({ clientScripts: [""] })).toThrow(/Invalid world config/);
  });

  describe("fog distance validation", () => {
    it("rejects fogNear >= fogFar (equal values)", () => {
      expect(() =>
        parseWorldConfig({
          environment: { fog: { fogNear: 100, fogFar: 100 } },
        }),
      ).toThrow("fogNear");
    });

    it("rejects fogNear >= fogFar (near exceeds far)", () => {
      expect(() =>
        parseWorldConfig({
          environment: { fog: { fogNear: 200, fogFar: 100 } },
        }),
      ).toThrow("fogNear");
    });

    it("accepts fogNear < fogFar", () => {
      expect(() =>
        parseWorldConfig({
          environment: { fog: { fogNear: 10, fogFar: 100 } },
        }),
      ).not.toThrow();
    });
  });

  it("accepts fog with fogColor", () => {
    const config = {
      environment: {
        fog: { fogNear: 10, fogFar: 100, fogColor: { r: 0.5, g: 0.5, b: 0.5 } },
      },
    };
    expect(() => parseWorldConfig(config)).not.toThrow();
    expect(parseWorldConfig(config)).toEqual(config);
  });

  it("rejects fog.fogColor with missing components", () => {
    expect(() =>
      parseWorldConfig({
        environment: { fog: { fogColor: { r: 0.5, g: 0.5 } } },
      }),
    ).toThrow(/Invalid world config/);
  });

  it("accepts mmlDocuments with passAuthToken", () => {
    const config = {
      mmlDocuments: {
        "test.html": {
          url: "wss:///mml-documents/test.html",
          passAuthToken: true,
        },
      },
    };
    expect(() => parseWorldConfig(config)).not.toThrow();
    expect(parseWorldConfig(config)).toEqual(config);
  });

  it("accepts enableTweakPane boolean", () => {
    expect(() => parseWorldConfig({ enableTweakPane: true })).not.toThrow();
    expect(parseWorldConfig({ enableTweakPane: true })).toEqual({ enableTweakPane: true });
  });

  it("accepts allowCustomDisplayName boolean", () => {
    expect(() => parseWorldConfig({ allowCustomDisplayName: false })).not.toThrow();
    expect(parseWorldConfig({ allowCustomDisplayName: false })).toEqual({
      allowCustomDisplayName: false,
    });
  });
});

describe("buildPageConfig", () => {
  it("returns empty object when no loading screen is configured", () => {
    expect(buildPageConfig({})).toEqual({});
  });

  it("includes loadingScreen when configured", () => {
    const loadingScreen = { background: "#000", title: "Loading" };
    expect(buildPageConfig({ loadingScreen })).toEqual({ loadingScreen });
  });
});

describe("parseWorldConfig visual environment options", () => {
  const environment = {
    sun: { intensity: 2.6, polarAngle: 50, azimuthalAngle: 30, color: { r: 1, g: 0.96, b: 0.9 } },
    sky: {
      turbidity: 2.5,
      rayleigh: 1.2,
      mieCoefficient: 0.005,
      mieDirectionalG: 0.8,
      exposure: 0.45,
      nightColor: { r: 0.012, g: 0.02, b: 0.05 },
      stars: 1,
      horizonBlend: 8,
    },
    timeOfDay: { hour: 18.5, cycleMinutes: 24, azimuthalAngle: 20, maxElevation: 55 },
    fog: { fogNear: 45, fogFar: 230 },
    postProcessing: {
      bloom: { mode: "emissive", intensity: 1.8, threshold: 0.05, smoothing: 0.3, radius: 0.7 },
      toneMapping: "aces",
      exposure: 1,
      ambientOcclusion: 1,
      grain: 0.02,
    },
    ambientLight: {
      intensity: 0.6,
      color: { r: 0.75, g: 0.85, b: 1 },
      groundColor: { r: 0.42, g: 0.38, b: 0.33 },
    },
    shadows: { enabled: true, distance: 35, softness: 2.5, intensity: 1 },
    quality: { tier: "auto", adaptive: true, maxPixelRatio: 2 },
  };

  it("accepts all new options", () => {
    expect(parseWorldConfig({ environment })).toEqual({ environment });
  });

  it("keeps accepting bloomIntensity", () => {
    const config = { environment: { postProcessing: { bloomIntensity: 0.3 } } };
    expect(parseWorldConfig(config)).toEqual(config);
  });

  it.each([
    [{ timeOfDay: { cycleMinutes: 10 } }],
    [{ timeOfDay: { hour: 25 } }],
    [{ sky: { nightColor: { r: 2, g: 0, b: 0 } } }],
    [{ sky: { unknown: 1 } }],
    [{ postProcessing: { bloom: { mode: "glow" } } }],
    [{ postProcessing: { toneMapping: "filmic" } }],
    [{ shadows: { enabled: "yes" } }],
    [{ shadows: { intensity: 2 } }],
    [{ quality: { tier: "ultra" } }],
    [{ quality: { maxPixelRatio: 0 } }],
    [{ ambientLight: { groundColor: { r: 0.5, g: 0.5 } } }],
  ])("rejects %j", (env) => {
    expect(() => parseWorldConfig({ environment: env })).toThrow(/Invalid world config/);
  });
});
