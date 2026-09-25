import {
  AdditiveBlending,
  CustomBlending,
  DoubleSide,
  MeshPhysicalMaterial,
  OneFactor,
  OneMinusSrcAlphaFactor,
  ShaderMaterial,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { patchAtmosphere } from '../render/atmosphere';

/**
 * Additive effects of an aircraft: afterburner plume (blue-white core, orange tail, shock diamonds),
 * nozzle glow and nav/strobe light billboards. Everything per-aircraft (throttle, afterburner, time,
 * strobe phase, nav switch, damage) is read from the skeleton's data bone, so one material serves every
 * aircraft and no per-frame uniforms are touched.
 */
const VERT = /* glsl */ `
#include <common>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
attribute vec4 aFxA;
attribute vec4 aFxB;
varying vec4 vFx;
varying vec3 vCol;
varying vec3 vN;
varying vec3 vV;
varying float vI;

float fxFlicker( float time, float seed ) {
  return 0.5 + 0.22 * sin( time * 29.0 + seed * 6.283 ) + 0.17 * sin( time * 47.3 + seed * 2.1 )
    + 0.11 * sin( time * 71.9 + seed * 4.7 );
}

void main() {
  #include <skinbase_vertex>
  vec4 d0 = vec4( 0.0 );
  vec4 d1 = vec4( 0.0 );
  vec4 d2 = vec4( 0.0 );
  #ifdef USE_SKINNING
    mat4 data = getBoneMatrix( 0.0 );
    d0 = data[ 0 ];
    d1 = data[ 1 ];
    d2 = data[ 2 ];
  #endif
  float thr = d1.x;
  float ab = d1.y;
  float time = d1.z;
  float phase = d1.w;
  float kind = aFxA.x;
  vec3 transformed = position;
  vec3 objN = vec3( 0.0, 0.0, 1.0 );
  float intensity = 0.0;
  vec3 col = vec3( 0.0 );
  float billboard = 0.0;
  vec2 corner = vec2( 0.0 );
  float size = 0.0;
  vFx = vec4( kind, aFxA.y, 0.0, 0.0 );
  if ( kind < 1.5 ) {
    float t = aFxA.y;
    float r0 = aFxB.x;
    float aspect = aFxB.y;
    float seed = aFxB.w * 0.37 + phase;
    float flick = fxFlicker( time, seed );
    float dry = smoothstep( 0.6, 1.0, thr ) * ( 1.0 - ab );
    float power = ab + dry * 0.22;
    float outer = step( kind, 0.5 );
    float lenR = mix( mix( 1.2, 2.0, dry ), mix( 5.2, 8.0, outer ), ab ) * mix( 1.0, 1.25, outer * ab );
    float len = r0 * lenR * ( 0.93 + 0.12 * flick ) * step( 0.002, power );
    float r = outer > 0.5
      ? r0 * ( 1.0 + 0.28 * t ) * sqrt( max( 1.0 - pow( t, 2.2 ), 0.0 ) )
      : r0 * 0.78 * pow( max( 1.0 - t, 0.0 ), 0.8 ) * ( 1.0 - 0.18 * t );
    transformed += vec3( aFxA.z * r * aspect, aFxA.w * r, t * len );
    objN = normalize( vec3( aFxA.z, aFxA.w, 0.35 ) );
    intensity = power * ( 0.85 + 0.3 * flick );
    vFx.z = time;
    vFx.w = atan( aFxA.w, aFxA.z );
  } else if ( kind < 2.5 ) {
    float r = aFxB.x * aFxA.y;
    transformed += vec3( aFxA.z * r * aFxB.y, aFxA.w * r, -aFxB.z );
    intensity = smoothstep( 0.25, 1.0, thr ) * 0.35 + ab * 1.6;
    vFx.y = aFxA.y;
  } else {
    billboard = 1.0;
    corner = aFxA.yz;
    size = aFxB.w;
    float part = aFxA.w;
    float gone = part > 1.5 && part < 2.5 ? step( 1.0, d0.y )
      : part > 2.5 && part < 3.5 ? step( 1.0, d0.z ) : part > 3.5 ? step( 1.0, d0.w ) : 0.0;
    float on = d2.x * ( 1.0 - gone );
    float I = 1.0;
    if ( kind > 3.5 && kind < 4.5 ) {
      float tt = mod( time + phase * 1.37, 1.37 );
      I = exp( -pow( tt / 0.028, 2.0 ) ) + 0.8 * exp( -pow( ( tt - 0.15 ) / 0.028, 2.0 ) );
      I *= 3.0;
    } else if ( kind > 4.5 ) {
      I = pow( 0.5 + 0.5 * sin( ( time + phase * 1.1 ) * 5.9 ), 6.0 ) * 1.6;
    }
    intensity = I * on;
    col = aFxB.rgb;
    vFx.yz = corner;
  }
  #include <skinning_vertex>
  vec4 mvPosition = modelViewMatrix * vec4( transformed, 1.0 );
  if ( billboard > 0.5 ) {
    // never smaller than ~2 px (1080p, 60 deg), energy preserved when clamped
    float dist = max( -mvPosition.z, 0.01 );
    float s = max( size, dist * 0.0021 );
    intensity *= ( size * size ) / ( s * s );
    mvPosition.xy += corner * s * 2.2;
  }
  gl_Position = projectionMatrix * mvPosition;
  #include <logdepthbuf_vertex>
  vN = normalize( normalMatrix * objN );
  vV = normalize( -mvPosition.xyz );
  vCol = col;
  vI = intensity;
}
`;

const FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
varying vec4 vFx;
varying vec3 vCol;
varying vec3 vN;
varying vec3 vV;
varying float vI;

void main() {
  #include <logdepthbuf_fragment>
  float kind = vFx.x;
  vec3 col = vec3( 0.0 );
  if ( vI <= 0.0005 ) discard;
  if ( kind < 1.5 ) {
    float t = vFx.y;
    float time = vFx.z;
    float facing = abs( dot( normalize( vN ), normalize( vV ) ) );
    float body = pow( facing, 1.8 ) * smoothstep( 0.0, 0.05, t ) * pow( max( 1.0 - t, 0.0 ), 1.2 );
    float streak = 0.8 + 0.2 * sin( t * 26.0 - time * 44.0 + vFx.w * 3.0 );
    if ( kind < 0.5 ) {
      vec3 hot = mix( vec3( 2.6, 1.9, 1.1 ), vec3( 3.0, 1.2, 0.32 ), smoothstep( 0.05, 0.35, t ) );
      vec3 cool = vec3( 1.0, 0.2, 0.035 );
      col = mix( hot, cool, smoothstep( 0.3, 0.95, t ) ) * body * streak * 0.75;
    } else {
      // shock diamonds: bright nodes along the core, fading downstream
      float cell = t * 3.6 - 0.15;
      float node = pow( 0.5 + 0.5 * cos( cell * 6.2832 ), 10.0 ) * ( 1.0 - smoothstep( 0.1, 0.85, t ) );
      vec3 core = mix( vec3( 2.2, 3.0, 6.5 ), vec3( 4.2, 2.8, 1.5 ), smoothstep( 0.2, 0.8, t ) );
      col = ( core * 1.1 + vec3( 9.0, 8.0, 6.0 ) * node ) * body * streak;
    }
  } else if ( kind < 2.5 ) {
    float r = vFx.y;
    col = mix( vec3( 2.4, 0.7, 0.16 ), vec3( 7.0, 4.2, 2.2 ), clamp( vI - 0.3, 0.0, 1.0 ) ) * ( 1.0 - r * r );
  } else {
    float d = length( vFx.yz );
    float core = smoothstep( 0.42, 0.0, d );
    float halo = exp( -d * d * 9.0 ) * 0.35;
    col = vCol * ( core * 9.0 + halo * 3.0 ) * max( 1.0 - d, 0.0 );
  }
  gl_FragColor = vec4( col * vI, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export function createFxMaterial(): ShaderMaterial {
  const m = new ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: AdditiveBlending,
    side: DoubleSide,
  });
  m.name = 'art-fx';
  return m;
}

/**
 * Canopy glass: clearcoated, slightly tinted (vertex colour), environment reflections kept at full strength
 * while the tint is blended (premultiplied output), so the glass reads as glass rather than grey plastic.
 */
export function createGlassMaterial(): MeshPhysicalMaterial {
  const m = new MeshPhysicalMaterial({
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.05,
    metalness: 0,
    transparent: true,
    opacity: 0.3,
    depthWrite: false,
    clearcoat: 1,
    clearcoatRoughness: 0.04,
    envMapIntensity: 1.4,
    specularIntensity: 1,
    ior: 1.5,
  });
  m.blending = CustomBlending;
  m.blendSrc = OneFactor;
  m.blendDst = OneMinusSrcAlphaFactor;
  m.blendSrcAlpha = OneFactor;
  m.blendDstAlpha = OneMinusSrcAlphaFactor;
  m.name = 'art-glass';
  patchAtmosphere(m, 'art-glass-v1', (shader: WebGLProgramParametersWithUniforms) => {
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <opaque_fragment>',
        `vec3 glassSpec = totalSpecular;
#ifdef USE_CLEARCOAT
glassSpec += ( clearcoatSpecularDirect + clearcoatSpecularIndirect ) * material.clearcoat;
#endif
float glassF = pow( 1.0 - saturate( dot( geometryNormal, geometryViewDir ) ), 4.0 );
float glassA = mix( diffuseColor.a, 0.92, glassF );
gl_FragColor = vec4( totalDiffuse * 0.3 * glassA + glassSpec, glassA );`,
      )
      .replace(
        'gl_FragColor.rgb = atmoApply( gl_FragColor.rgb, vAtmoRay );',
        `{ float glT = atmoTransmittance( vAtmoRay );
  gl_FragColor.rgb = gl_FragColor.rgb * glT + atmoSky( normalize( vAtmoRay ) ) * ( 1.0 - glT ) * gl_FragColor.a; }`,
      );
  });
  return m;
}
