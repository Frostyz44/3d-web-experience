import {
  BackSide,
  BoxGeometry,
  Color,
  Mesh,
  PMREMGenerator,
  Scene,
  ShaderMaterial,
  Texture,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget,
} from "three";

export type ProceduralSkyParameters = {
  turbidity: number;
  rayleigh: number;
  mieCoefficient: number;
  mieDirectionalG: number;
  exposure: number;
  /** Sun direction as polar / azimuthal angles in radians (polar from straight up). */
  sunPolarAngle: number;
  sunAzimuthalAngle: number;
  /** Colour the sky fades to at the horizon (and below it). Usually the fog colour. */
  horizonColor: Color;
  /** Degrees above the horizon over which the sky fades into `horizonColor`. */
  horizonBlend: number;
  nightColor: Color;
  /** 0 = day, 1 = full night. */
  night: number;
  /** Star brightness (already scaled by how dark it is). */
  stars: number;
  /** Ground colour seen below the horizon by reflections (not by the camera). */
  groundColor: Color;
};

/*
 * Preetham daylight model (as in three/examples Sky.js) with additions:
 *  - a horizon band that fades into the fog colour, and the fog colour below the horizon, so the ground's
 *    far edge disappears into the sky;
 *  - a night sky colour and procedural stars;
 *  - a much dimmer sun disc. The original disc is ~1000x brighter than the sky, which made smooth metals
 *    reflect a blinding dot and made luminance bloom flare. The directional light provides the highlight.
 */
const vertexShader = /* glsl */ `
uniform vec3 sunPosition;
uniform float rayleigh;
uniform float turbidity;
uniform float mieCoefficient;
uniform vec3 up;

varying vec3 vWorldPosition;
varying vec3 vSunDirection;
varying float vSunfade;
varying vec3 vBetaR;
varying vec3 vBetaM;
varying float vSunE;

const float e = 2.71828182845904523536028747135266249775724709369995957;
const float pi = 3.141592653589793238462643383279502884197169;
const vec3 totalRayleigh = vec3( 5.804542996261093E-6, 1.3562911419845635E-5, 3.0265902468824876E-5 );
const float v = 4.0;
const vec3 K = vec3( 0.686, 0.678, 0.666 );
const vec3 MieConst = vec3( 1.8399918514433978E14, 2.7798023919660528E14, 4.0790479543861094E14 );
const float cutoffAngle = 1.6110731556870734;
const float steepness = 1.5;
const float EE = 1000.0;

float sunIntensity( float zenithAngleCos ) {
  zenithAngleCos = clamp( zenithAngleCos, -1.0, 1.0 );
  return EE * max( 0.0, 1.0 - pow( e, -( ( cutoffAngle - acos( zenithAngleCos ) ) / steepness ) ) );
}

vec3 totalMie( float T ) {
  float c = ( 0.2 * T ) * 10E-18;
  return 0.434 * c * MieConst;
}

void main() {
  vec4 worldPosition = modelMatrix * vec4( position, 1.0 );
  vWorldPosition = worldPosition.xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  gl_Position.z = gl_Position.w; // set z to camera.far
  vSunDirection = normalize( sunPosition );
  vSunE = sunIntensity( dot( vSunDirection, up ) );
  vSunfade = 1.0 - clamp( 1.0 - exp( ( sunPosition.y / 450000.0 ) ), 0.0, 1.0 );
  float rayleighCoefficient = rayleigh - ( 1.0 * ( 1.0 - vSunfade ) );
  vBetaR = totalRayleigh * rayleighCoefficient;
  vBetaM = totalMie( turbidity ) * mieCoefficient;
}
`;

const fragmentShader = /* glsl */ `
varying vec3 vWorldPosition;
varying vec3 vSunDirection;
varying float vSunfade;
varying vec3 vBetaR;
varying vec3 vBetaM;
varying float vSunE;

uniform float mieDirectionalG;
uniform vec3 up;
uniform float skyExposure;
uniform vec3 horizonColor;
uniform float horizonBlendSin;
uniform vec3 nightColor;
uniform float night;
uniform float stars;
uniform vec3 groundColor;
uniform float groundAmount;

const float pi = 3.141592653589793238462643383279502884197169;
const float rayleighZenithLength = 8.4E3;
const float mieZenithLength = 1.25E3;
const float sunAngularDiameterCos = 0.999956676946448443553574619906976478926848692873900859324;
const float THREE_OVER_SIXTEENPI = 0.05968310365946075;
const float ONE_OVER_FOURPI = 0.07957747154594767;

float rayleighPhase( float cosTheta ) {
  return THREE_OVER_SIXTEENPI * ( 1.0 + pow( cosTheta, 2.0 ) );
}

float hgPhase( float cosTheta, float g ) {
  float g2 = pow( g, 2.0 );
  float inverse = 1.0 / pow( 1.0 - 2.0 * g * cosTheta + g2, 1.5 );
  return ONE_OVER_FOURPI * ( ( 1.0 - g2 ) * inverse );
}

float starHash( vec3 p ) {
  p = fract( p * vec3( 0.1031, 0.1030, 0.0973 ) );
  p += dot( p, p.yxz + 33.33 );
  return fract( ( p.x + p.y ) * p.z );
}

void main() {
  vec3 direction = normalize( vWorldPosition - cameraPosition );

  float zenithAngle = acos( max( 0.0, dot( up, direction ) ) );
  float inverse = 1.0 / ( cos( zenithAngle ) + 0.15 * pow( 93.885 - ( ( zenithAngle * 180.0 ) / pi ), -1.253 ) );
  float sR = rayleighZenithLength * inverse;
  float sM = mieZenithLength * inverse;
  vec3 Fex = exp( -( vBetaR * sR + vBetaM * sM ) );

  float cosTheta = dot( direction, vSunDirection );
  float rPhase = rayleighPhase( cosTheta * 0.5 + 0.5 );
  vec3 betaRTheta = vBetaR * rPhase;
  float mPhase = hgPhase( cosTheta, mieDirectionalG );
  vec3 betaMTheta = vBetaM * mPhase;

  vec3 Lin = pow( vSunE * ( ( betaRTheta + betaMTheta ) / ( vBetaR + vBetaM ) ) * ( 1.0 - Fex ), vec3( 1.5 ) );
  Lin *= mix( vec3( 1.0 ), pow( vSunE * ( ( betaRTheta + betaMTheta ) / ( vBetaR + vBetaM ) ) * Fex, vec3( 1.0 / 2.0 ) ), clamp( pow( 1.0 - dot( up, vSunDirection ), 5.0 ), 0.0, 1.0 ) );

  vec3 L0 = vec3( 0.1 ) * Fex;
  float sundisk = smoothstep( sunAngularDiameterCos, sunAngularDiameterCos + 0.00002, cosTheta );
  // dimmed sun disc (x0.02 of the original)
  L0 += ( vSunE * 380.0 * Fex ) * sundisk;

  vec3 texColor = ( Lin + L0 ) * 0.04 + vec3( 0.0, 0.0003, 0.00075 );
  vec3 color = pow( texColor, vec3( 1.0 / ( 1.2 + ( 1.2 * vSunfade ) ) ) ) * skyExposure;

  // night sky: a little lighter towards the horizon, plus stars
  float elevation = direction.y;
  vec3 nightSky = nightColor * mix( 1.8, 1.0, clamp( elevation * 3.0, 0.0, 1.0 ) );
  color = mix( color, max( color, nightSky ), night );
  if ( stars > 0.0 ) {
    vec3 cell = floor( direction * 260.0 );
    float h = starHash( cell );
    float star = smoothstep( 0.9975, 1.0, h );
    color += vec3( 0.9, 0.95, 1.0 ) * star * stars * 1.5 * smoothstep( 0.02, 0.2, elevation );
  }

  // fade into the horizon / fog colour, and use it below the horizon
  float horizonT = clamp( elevation / max( horizonBlendSin, 1e-4 ), 0.0, 1.0 );
  color = mix( horizonColor, color, pow( horizonT, 0.7 ) );
  // the environment map sees a ground below the horizon (gives metals contrast and grounded reflections)
  color = mix( color, groundColor, groundAmount * smoothstep( 0.0, -0.12, elevation ) );

  gl_FragColor = vec4( color, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const tempVector = new Vector3();

/**
 * Procedural sky dome plus a matching image-based-lighting environment map.
 *
 * The environment map is regenerated with PMREM only when the sky changes noticeably (the caller decides
 * how often via `updateEnvironment`), at a size set by the quality tier.
 */
export class ProceduralSky {
  public readonly mesh: Mesh;
  private readonly material: ShaderMaterial;
  private readonly envScene = new Scene();
  private pmremGenerator: PMREMGenerator | null = null;
  private envTarget: WebGLRenderTarget | null = null;
  private envSize = 128;
  private dirty = true;

  constructor() {
    this.material = new ShaderMaterial({
      name: "ProceduralSky",
      uniforms: {
        turbidity: { value: 2.5 },
        rayleigh: { value: 1.2 },
        mieCoefficient: { value: 0.005 },
        mieDirectionalG: { value: 0.8 },
        sunPosition: { value: new Vector3(0, 1, 0) },
        up: { value: new Vector3(0, 1, 0) },
        skyExposure: { value: 1 },
        horizonColor: { value: new Color(0.7, 0.78, 0.88) },
        horizonBlendSin: { value: Math.sin((8 * Math.PI) / 180) },
        nightColor: { value: new Color(0.012, 0.02, 0.05) },
        night: { value: 0 },
        stars: { value: 0 },
        groundColor: { value: new Color(0.1, 0.1, 0.1) },
        groundAmount: { value: 0 },
      },
      vertexShader,
      fragmentShader,
      side: BackSide,
      depthWrite: false,
      fog: false,
    });
    const geometry = new BoxGeometry(1, 1, 1);
    this.mesh = new Mesh(geometry, this.material);
    this.mesh.name = "ProceduralSky";
    this.mesh.scale.setScalar(50000);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;

    const envMesh = new Mesh(geometry, this.material);
    envMesh.scale.setScalar(50000);
    envMesh.frustumCulled = false;
    this.envScene.add(envMesh);
  }

  public setParameters(p: ProceduralSkyParameters) {
    const u = this.material.uniforms;
    tempVector.setFromSphericalCoords(1, p.sunPolarAngle, p.sunAzimuthalAngle);
    const changed =
      !u.sunPosition.value.equals(tempVector) ||
      u.turbidity.value !== p.turbidity ||
      u.rayleigh.value !== p.rayleigh ||
      u.mieCoefficient.value !== p.mieCoefficient ||
      u.mieDirectionalG.value !== p.mieDirectionalG ||
      u.skyExposure.value !== p.exposure ||
      !u.horizonColor.value.equals(p.horizonColor) ||
      !u.nightColor.value.equals(p.nightColor) ||
      !u.groundColor.value.equals(p.groundColor) ||
      u.night.value !== p.night;
    u.sunPosition.value.copy(tempVector);
    u.turbidity.value = p.turbidity;
    u.rayleigh.value = p.rayleigh;
    u.mieCoefficient.value = p.mieCoefficient;
    u.mieDirectionalG.value = p.mieDirectionalG;
    u.skyExposure.value = p.exposure;
    u.horizonColor.value.copy(p.horizonColor);
    u.horizonBlendSin.value = Math.sin((Math.max(0.1, p.horizonBlend) * Math.PI) / 180);
    u.nightColor.value.copy(p.nightColor);
    u.night.value = p.night;
    u.stars.value = p.stars;
    u.groundColor.value.copy(p.groundColor);
    if (changed) {
      this.dirty = true;
    }
  }

  public setEnvironmentSize(size: number) {
    if (size !== this.envSize) {
      this.envSize = size;
      this.dirty = true;
    }
  }

  public get needsEnvironmentUpdate(): boolean {
    return this.dirty;
  }

  /** Regenerates the environment map if the sky changed. Returns the current environment texture. */
  public updateEnvironment(renderer: WebGLRenderer): Texture | null {
    if (!this.dirty && this.envTarget) {
      return this.envTarget.texture;
    }
    this.dirty = false;
    if (!this.pmremGenerator) {
      this.pmremGenerator = new PMREMGenerator(renderer);
    }
    // stars are too small to matter for lighting and only add noise
    const starValue = this.material.uniforms.stars.value;
    this.material.uniforms.stars.value = 0;
    this.material.uniforms.groundAmount.value = 1;
    const previous = this.envTarget;
    this.envTarget = this.pmremGenerator.fromScene(this.envScene, 0, 0.1, 100, {
      size: this.envSize,
    });
    this.material.uniforms.stars.value = starValue;
    this.material.uniforms.groundAmount.value = 0;
    previous?.dispose();
    return this.envTarget.texture;
  }

  public get environmentTexture(): Texture | null {
    return this.envTarget?.texture ?? null;
  }

  public dispose() {
    this.envTarget?.dispose();
    this.envTarget = null;
    this.pmremGenerator?.dispose();
    this.pmremGenerator = null;
    this.material.dispose();
    this.mesh.geometry.dispose();
  }
}
