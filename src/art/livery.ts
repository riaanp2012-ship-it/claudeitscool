import {
  Color,
  DataTexture,
  FloatType,
  MeshPhysicalMaterial,
  RGBAFormat,
  Vector4,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import type { Team } from '../core/types';
import { patchAtmosphere } from '../render/atmosphere';
import { atlasRect, getAtlas, glyphGrid } from './atlas';
import type { DecalDef } from './context';

/** A paint scheme. Colours are sRGB hex; the shader receives linear values. */
export interface Livery {
  name: string;
  /** 0 soft disruptive blotches, 1 countershaded mottle, 2 angular splinter, 3 digital. */
  camo: 0 | 1 | 2 | 3;
  a: number;
  b: number;
  c: number;
  under: number;
  accent: number;
  stencil: number;
  scale: number;
  /** Strength of the lighter underside colour. */
  underside: number;
  /** Insignia desaturation toward the base colour (low-visibility markings). */
  lowVis: number;
  gloss: number;
  rough: number;
  wear: number;
}

export const LIVERIES: Record<Team, readonly Livery[]> = {
  blue: [
    {
      name: 'Coastal Low-Vis',
      camo: 0,
      a: 0x7b848d,
      b: 0x646d76,
      c: 0x8b949c,
      under: 0xaab2b9,
      accent: 0x2f5d9a,
      stencil: 0x2f353c,
      scale: 1,
      underside: 0.85,
      lowVis: 0.75,
      gloss: 0.22,
      rough: 0.56,
      wear: 0.5,
    },
    {
      name: 'Sea Mist',
      camo: 1,
      a: 0x5f6e7e,
      b: 0x55636f,
      c: 0x6b7a89,
      under: 0x9eabb7,
      accent: 0x2c63b8,
      stencil: 0x22282e,
      scale: 1,
      underside: 1,
      lowVis: 0.15,
      gloss: 0.38,
      rough: 0.46,
      wear: 0.35,
    },
    {
      name: 'Ghost Splinter',
      camo: 2,
      a: 0x8a9197,
      b: 0x6e767e,
      c: 0xa0a6ab,
      under: 0xb2b7bb,
      accent: 0x3a6db0,
      stencil: 0x30363c,
      scale: 1,
      underside: 0.7,
      lowVis: 0.5,
      gloss: 0.16,
      rough: 0.6,
      wear: 0.6,
    },
  ],
  red: [
    {
      name: 'Taiga',
      camo: 0,
      a: 0x4b5341,
      b: 0x5c4c3a,
      c: 0x30372a,
      under: 0x8d99a2,
      accent: 0x7a1a1a,
      stencil: 0x1c1c1c,
      scale: 0.9,
      underside: 1,
      lowVis: 0,
      gloss: 0.1,
      rough: 0.66,
      wear: 0.7,
    },
    {
      name: 'Slate',
      camo: 1,
      a: 0x3d4249,
      b: 0x2d3137,
      c: 0x4a5058,
      under: 0x5e646c,
      accent: 0x7f1c1c,
      stencil: 0xb9b6ad,
      scale: 1,
      underside: 0.8,
      lowVis: 0.2,
      gloss: 0.3,
      rough: 0.5,
      wear: 0.5,
    },
    {
      name: 'Rust Digital',
      camo: 3,
      a: 0x4e4742,
      b: 0x5d3229,
      c: 0x3b4046,
      under: 0x6e7072,
      accent: 0x741717,
      stencil: 0x1c1c1c,
      scale: 1,
      underside: 0.75,
      lowVis: 0,
      gloss: 0.1,
      rough: 0.62,
      wear: 0.62,
    },
  ],
};

export function liveryFor(team: Team, index: number): Livery {
  const list = LIVERIES[team];
  return list[((Math.floor(index) % list.length) + list.length) % list.length]!;
}

const VERTEX_PARS = /* glsl */ `
attribute vec2 aAux;
attribute vec3 aTint;
attribute vec4 aInfo;
varying vec3 vArtPos;
varying vec3 vArtNrm;
varying vec2 vArtUv;
varying vec2 vArtAux;
varying vec3 vArtTint;
varying vec4 vArtInfo;
varying vec4 vArtState;
varying vec4 vArtGlyphs;
`;

const VERTEX_MAIN = /* glsl */ `
vArtPos = position;
vArtNrm = normal;
vArtUv = uv;
vArtAux = aAux;
vArtTint = aTint;
vArtInfo = aInfo;
#ifdef USE_SKINNING
  mat4 artData = getBoneMatrix( 0.0 );
  vec4 artDmg = artData[ 0 ];
  float artPart = aInfo.y;
  float artD = artPart < 0.5 ? 0.35 * max( max( artDmg.x, artDmg.y ), max( artDmg.z, artDmg.w ) )
    : artPart < 1.5 ? artDmg.x : artPart < 2.5 ? artDmg.y : artPart < 3.5 ? artDmg.z : artDmg.w;
  vArtState = vec4( artD, artData[ 1 ].x, artData[ 1 ].y, artData[ 1 ].z );
  vArtGlyphs = vec4( artData[ 2 ].y, artData[ 2 ].z, artData[ 2 ].w, artData[ 3 ].x );
#else
  vArtState = vec4( 0.0 );
  vArtGlyphs = vec4( -1.0 );
#endif
`;

const FRAGMENT_PARS = /* glsl */ `
uniform sampler2D uArtAtlas;
uniform highp sampler2D uArtDecals;
uniform int uArtDecalCount;
uniform vec3 uArtColA;
uniform vec3 uArtColB;
uniform vec3 uArtColC;
uniform vec3 uArtColUnder;
uniform vec3 uArtAccent;
uniform vec3 uArtStencil;
uniform vec4 uArtCamo;
uniform vec4 uArtPaint;
uniform vec4 uArtSoot[ 2 ];
uniform vec4 uArtGun;
uniform vec4 uArtRegion;
uniform vec4 uArtRegion2;
uniform vec4 uArtGlyph;
varying vec3 vArtPos;
varying vec3 vArtNrm;
varying vec2 vArtUv;
varying vec2 vArtAux;
varying vec3 vArtTint;
varying vec4 vArtInfo;
varying vec4 vArtState;
varying vec4 vArtGlyphs;

float artHash3( vec3 p ) {
  p = fract( p * 0.3183099 + vec3( 0.71, 0.113, 0.419 ) );
  p *= 17.0;
  return fract( p.x * p.y * p.z * ( p.x + p.y + p.z ) );
}
float artHash1( float n ) {
  return artHash3( vec3( n, n * 0.37 + 1.3, n * 1.71 + 7.1 ) );
}
float artNoise( vec3 x ) {
  vec3 i = floor( x );
  vec3 f = fract( x );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix(
    mix( mix( artHash3( i ), artHash3( i + vec3( 1.0, 0.0, 0.0 ) ), f.x ),
         mix( artHash3( i + vec3( 0.0, 1.0, 0.0 ) ), artHash3( i + vec3( 1.0, 1.0, 0.0 ) ), f.x ), f.y ),
    mix( mix( artHash3( i + vec3( 0.0, 0.0, 1.0 ) ), artHash3( i + vec3( 1.0, 0.0, 1.0 ) ), f.x ),
         mix( artHash3( i + vec3( 0.0, 1.0, 1.0 ) ), artHash3( i + vec3( 1.0, 1.0, 1.0 ) ), f.x ), f.y ),
    f.z );
}
float artFbm( vec3 p ) {
  float a = 0.5;
  float s = 0.0;
  for ( int i = 0; i < 4; i++ ) {
    s += a * artNoise( p );
    p = p * 2.03 + vec3( 1.7, 9.2, 3.1 );
    a *= 0.5;
  }
  return s / 0.9375;
}
// Coverage-correct anti-aliased line: distance d from the centre line, half width hw, pixel footprint fw.
float artLine( float d, float hw, float fw ) {
  float w = max( hw, fw * 0.5 );
  float shape = 1.0 - smoothstep( w - fw * 0.5, w + fw * 0.5, d );
  return shape * clamp( hw / w, 0.0, 1.0 );
}
bool artFrame( float i ) {
  return artHash1( i * 3.17 + 0.5 ) > 0.42 || mod( i, 3.0 ) < 0.5;
}
float artBox( vec2 p, vec2 h ) {
  vec2 d = abs( p ) - h;
  return length( max( d, 0.0 ) ) + min( max( d.x, d.y ), 0.0 );
}

// Panel lines, rivets and per-panel tone for fuselage-style uv (station, arc length).
vec3 artPanelsBody( vec2 uv, float fw ) {
  const float S = 0.62;
  const float T = 0.47;
  float i = floor( uv.x / S );
  float fz = uv.x - i * S;
  bool e0 = artFrame( i );
  bool e1 = artFrame( i + 1.0 );
  float dz = min( e0 ? fz : 1e3, e1 ? S - fz : 1e3 );
  float bay = e0 ? i : ( artFrame( i - 1.0 ) ? i - 1.0 : i - 2.0 );
  float off = artHash1( bay * 7.13 + 1.1 ) * T;
  float v = uv.y + off;
  float j = floor( v / T );
  float fv = v - j * T;
  float dv = min( fv, T - fv );
  float fade = 1.0 - smoothstep( 0.035, 0.09, fw );
  float line = max( artLine( dz, 0.0035, fw ), artLine( dv, 0.003, fw ) * step( 0.25, artHash1( bay * 3.1 + j ) ) );
  // access hatches
  float h = artHash1( bay * 11.7 + j * 5.3 );
  if ( h > 0.7 ) {
    vec2 c = vec2( ( bay + 0.5 + ( h - 0.85 ) ) * S, ( j + 0.5 ) * T - off );
    vec2 hs = vec2( 0.1 + 0.08 * h, 0.07 + 0.05 * fract( h * 7.0 ) );
    line = max( line, artLine( abs( artBox( uv - c, hs ) ), 0.0028, fw ) );
  }
  // rivet rows beside frames
  float rv = mod( uv.y, 0.065 ) - 0.0325;
  float dr = min( e0 ? length( vec2( fz - 0.022, rv ) ) : 1e3, e1 ? length( vec2( S - fz - 0.022, rv ) ) : 1e3 );
  float rivet = artLine( dr, 0.0028, fw ) * ( 1.0 - smoothstep( 0.006, 0.014, fw ) );
  float tone = ( artHash1( bay * 1.93 + j * 13.1 ) - 0.5 ) * ( 1.0 - smoothstep( 0.05, 0.15, fw ) );
  return vec3( line * fade, rivet, tone );
}

// Panel lines for wing-style uv (m from LE, span m) with local chord in aux.x.
vec3 artPanelsWing( vec2 uv, float chord, float fw ) {
  float c = uv.x;
  float d = min( abs( c - 0.11 * chord ), abs( c - 0.63 * chord ) );
  const float R = 0.58;
  float i = floor( uv.y / R );
  float fs = uv.y - i * R;
  bool r0 = artHash1( i * 2.7 + 9.0 ) > 0.35;
  bool r1 = artHash1( ( i + 1.0 ) * 2.7 + 9.0 ) > 0.35;
  float ds = min( r0 ? fs : 1e3, r1 ? R - fs : 1e3 );
  float inBox = step( 0.11 * chord, c ) * step( c, 0.63 * chord );
  float fade = 1.0 - smoothstep( 0.035, 0.09, fw );
  float line = max( artLine( d, 0.0035, fw ), artLine( ds, 0.003, fw ) * inBox );
  float rv = mod( uv.y, 0.07 ) - 0.035;
  float rivet = artLine( length( vec2( d - 0.02, rv ) ), 0.0026, fw ) * ( 1.0 - smoothstep( 0.006, 0.014, fw ) );
  float tone = ( artHash1( i * 5.1 + floor( c / max( chord * 0.26, 0.2 ) ) ) - 0.5 ) * ( 1.0 - smoothstep( 0.05, 0.15, fw ) );
  return vec3( line * fade, rivet, tone );
}

vec3 artCamo( vec3 p, vec3 n, float pw ) {
  float L = uArtPaint.w;
  vec3 q = p / L * uArtCamo.y;
  float kind = uArtCamo.x;
  vec3 col = uArtColA;
  if ( kind < 0.5 ) {
    float f1 = artFbm( q * 3.1 + vec3( 0.0, 3.0, 0.0 ) );
    float f2 = artFbm( q * 3.1 + vec3( 11.3, 0.0, 5.2 ) );
    float w = pw / L * uArtCamo.y * 7.0 + 0.012;
    float m1 = smoothstep( 0.52 - w, 0.52 + w, f1 );
    float m2 = smoothstep( 0.56 - w, 0.56 + w, f2 ) * ( 1.0 - m1 );
    col = mix( col, uArtColB, m1 );
    col = mix( col, uArtColC, m2 );
  } else if ( kind < 1.5 ) {
    float f = artFbm( q * 5.0 );
    col = mix( uArtColA, uArtColB, smoothstep( 0.35, 0.75, f ) * 0.6 );
    col = mix( col, uArtColC, smoothstep( 0.45, 0.2, f ) * 0.35 );
  } else if ( kind < 2.5 ) {
    vec3 g = q * 3.4;
    vec3 ci = floor( g );
    float d1 = 8.0;
    float d2 = 8.0;
    float id = 0.0;
    for ( int x = -1; x <= 1; x++ )
      for ( int y = -1; y <= 1; y++ )
        for ( int z = -1; z <= 1; z++ ) {
          vec3 c = ci + vec3( float( x ), float( y ), float( z ) );
          vec3 fp = c + vec3( artHash3( c ), artHash3( c + 17.1 ), artHash3( c + 31.7 ) );
          float d = length( g - fp );
          if ( d < d1 ) {
            d2 = d1;
            d1 = d;
            id = artHash3( c + 5.3 );
          } else if ( d < d2 ) {
            d2 = d;
          }
        }
    col = id < 0.38 ? uArtColA : id < 0.72 ? uArtColB : uArtColC;
    float edge = ( d2 - d1 ) * L / uArtCamo.y / 3.4;
    float soft = smoothstep( 0.0, pw * 1.5 + 0.004, edge );
    vec3 avg = ( uArtColA + uArtColB + uArtColC ) / 3.0;
    col = mix( mix( avg, col, 0.7 ), col, soft );
  } else {
    float px = 0.11;
    vec3 cell = floor( p / px );
    float f1 = artFbm( ( cell + 0.5 ) * px / L * uArtCamo.y * 4.0 );
    float f2 = artFbm( ( cell + 0.5 ) * px / L * uArtCamo.y * 4.0 + vec3( 7.7, 1.3, 2.9 ) );
    vec3 dig = f1 > 0.55 ? uArtColB : f2 > 0.55 ? uArtColC : uArtColA;
    float fs = artFbm( q * 4.0 );
    vec3 smoothCol = mix( uArtColA, uArtColB, smoothstep( 0.45, 0.65, fs ) );
    col = mix( dig, smoothCol, smoothstep( 0.03, 0.08, pw ) );
  }
  float under = smoothstep( -0.08, -0.5, n.y ) * uArtCamo.z;
  return mix( col, uArtColUnder, under );
}

vec4 artDecal( int i, vec3 p, vec3 n, vec3 dpx, vec3 dpy, vec3 base ) {
  vec4 t0 = texelFetch( uArtDecals, ivec2( 0, i ), 0 );
  vec4 t1 = texelFetch( uArtDecals, ivec2( 1, i ), 0 );
  vec4 t2 = texelFetch( uArtDecals, ivec2( 2, i ), 0 );
  vec3 d = p - t0.xyz;
  float lx = dot( d, t1.xyz );
  float ly = dot( d, t2.xyz );
  if ( abs( lx ) > 1.0 || abs( ly ) > 1.0 ) return vec4( 0.0 );
  vec3 dn = normalize( cross( t1.xyz, t2.xyz ) );
  if ( abs( dot( d, dn ) ) > t1.w || dot( n, dn ) < 0.2 ) return vec4( 0.0 );
  vec4 rect = texelFetch( uArtDecals, ivec2( 3, i ), 0 );
  vec4 color = texelFetch( uArtDecals, ivec2( 4, i ), 0 );
  if ( t2.w > 1.5 ) color.rgb = uArtStencil;
  else if ( t2.w > 0.5 ) color.rgb = uArtAccent;
  vec2 luv = vec2( lx, ly ) * 0.5 + 0.5;
  vec2 gx = 0.5 * vec2( dot( dpx, t1.xyz ), dot( dpx, t2.xyz ) );
  vec2 gy = 0.5 * vec2( dot( dpy, t1.xyz ), dot( dpy, t2.xyz ) );
  float type = t0.w;
  if ( type > 2.5 ) {
    float fw = max( length( gx ), length( gy ) ) + 1e-4;
    float e = min( min( luv.x, 1.0 - luv.x ), min( luv.y, 1.0 - luv.y ) );
    return vec4( color.rgb, color.a * smoothstep( 0.0, fw * 1.5, e ) );
  }
  vec2 auv;
  vec2 scale = rect.zw - rect.xy;
  if ( type > 0.5 ) {
    float g0 = vArtGlyphs.x;
    float g1 = vArtGlyphs.y;
    float g2 = vArtGlyphs.z;
    float g3 = vArtGlyphs.w;
    float count = step( 0.0, g0 ) + step( 0.0, g1 ) + step( 0.0, g2 ) + step( 0.0, g3 );
    float first = 0.0;
    if ( type > 1.5 ) {
      first = max( count - 2.0, 0.0 );
      count = min( count, 2.0 );
    }
    if ( count < 0.5 ) return vec4( 0.0 );
    float cell = floor( luv.x * count );
    float k = first + cell;
    float gi = k < 0.5 ? g0 : k < 1.5 ? g1 : k < 2.5 ? g2 : g3;
    if ( gi < 0.0 ) return vec4( 0.0 );
    vec2 org = uArtGlyph.xy + vec2( mod( gi, 16.0 ) * uArtGlyph.z, -floor( gi / 16.0 ) * uArtGlyph.w );
    scale = uArtGlyph.zw * vec2( count, 1.0 );
    auv = org + vec2( fract( luv.x * count ), luv.y ) * uArtGlyph.zw;
  } else {
    auv = rect.xy + luv * scale;
  }
  vec4 tex = textureGrad( uArtAtlas, auv, gx * scale, gy * scale );
  vec3 c = tex.rgb * color.rgb;
  if ( type < 0.5 && uArtCamo.w > 0.0 && t2.w < 0.5 ) {
    float lum = dot( tex.rgb, vec3( 0.3, 0.59, 0.11 ) );
    c = mix( c, mix( base * 0.62, base * 1.28, lum ), uArtCamo.w * color.a );
  }
  return vec4( c, tex.a * color.a );
}
`;

const FRAGMENT_MAIN = /* glsl */ `
vec3 artP = vArtPos;
vec3 artN = normalize( vArtNrm );
vec3 artDpx = dFdx( artP );
vec3 artDpy = dFdy( artP );
float artPw = max( length( artDpx ), length( artDpy ) );
vec2 artDuv = fwidth( vArtUv );
float artFw = max( artDuv.x, artDuv.y );
float artMode = vArtInfo.x;
float artPanel = vArtInfo.z;
float artAo = vArtInfo.w;
float artRough = uArtPaint.x;
float artMetal = 0.0;
float artCoat = 0.0;
vec3 artEmit = vec3( 0.0 );
vec3 artCol = vArtTint;
float artWear = uArtPaint.z;
float artGrime = artFbm( vec3( artP.x * 5.0, artP.y * 5.0, artP.z * 0.7 ) );
if ( artMode < 0.5 ) {
  artCol = artCamo( artP, artN, artPw );
  artCoat = uArtPaint.y;
  // radome and anti-glare panel
  if ( artP.z < uArtRegion.x ) artCol *= 0.93;
  if ( artP.z > uArtRegion.y && artP.z < uArtRegion.z && abs( artP.x ) < uArtRegion.w && artP.y > uArtRegion2.x && artN.y > 0.25 ) {
    artCol = vec3( 0.035, 0.037, 0.04 );
    artCoat = 0.0;
    artRough = 0.8;
  }
  vec3 pl = artPanel > 1.5 && artPanel < 2.5 ? artPanelsWing( vArtUv, max( vArtAux.x, 0.1 ), artFw )
    : artPanel > 0.5 && artPanel < 1.5 ? artPanelsBody( vArtUv, artFw ) : vec3( 0.0 );
  artCol *= 1.0 + pl.z * 0.07;
  // grime collects along panel seams and on lower surfaces
  float under = smoothstep( 0.2, -0.6, artN.y );
  artCol *= 1.0 - artWear * ( 0.05 + 0.07 * under ) * artGrime;
  artCol *= 1.0 - pl.x * 0.55;
  artCol *= 1.0 - pl.y * 0.28;
  // leading-edge paint wear on wings
  if ( artPanel > 1.5 && artPanel < 2.5 ) {
    float le = 1.0 - smoothstep( 0.0, 0.06, vArtUv.x );
    float chip = smoothstep( 0.45, 0.75, artNoise( artP * 22.0 ) ) * le * artWear;
    artCol = mix( artCol, vec3( 0.46, 0.47, 0.48 ), chip * 0.7 );
    artRough = mix( artRough, 0.32, chip );
    artMetal = chip * 0.6;
  }
  // decals (markings, stencils, tail numbers, bays)
  for ( int i = 0; i < 48; i++ ) {
    if ( i >= uArtDecalCount ) break;
    vec4 dc = artDecal( i, artP, artN, artDpx, artDpy, artCol );
    artCol = mix( artCol, dc.rgb, dc.a );
  }
} else if ( artMode < 1.5 ) {
  artRough = 0.72;
} else if ( artMode < 2.5 ) {
  artMetal = 0.8;
  artRough = 0.38 + artGrime * 0.2;
} else if ( artMode < 3.5 ) {
  artRough = 0.82;
} else if ( artMode < 4.5 ) {
  artRough = 0.93;
} else if ( artMode < 5.5 ) {
  artRough = 0.42;
  artCoat = 0.5;
  artCol *= 1.0 - 0.06 * artGrime;
} else if ( artMode < 6.5 ) {
  artRough = 0.86;
} else if ( artMode < 7.5 ) {
  artRough = 0.07;
  artMetal = 0.3;
  artCoat = 1.0;
} else if ( artMode < 8.5 ) {
  artMetal = 0.7;
  artRough = 0.5;
  float deep = 1.0 - artAo;
  float heat = smoothstep( 0.35, 1.0, vArtState.y ) * 0.5 + vArtState.z * 3.2;
  artEmit = heat * ( 0.25 + deep * 1.2 ) * vec3( 1.0, 0.34, 0.08 );
  artAo = mix( artAo, 1.0, 0.5 );
} else {
  artCol *= 0.18;
  artRough = 0.08;
  artMetal = 0.4;
  artCoat = 1.0;
}
// exhaust soot around the nozzles and gun blast residue
float artSoot = 0.0;
for ( int k = 0; k < 2; k++ ) {
  vec4 s = uArtSoot[ k ];
  if ( s.w <= 0.0 ) continue;
  vec3 v = artP - s.xyz;
  float along = smoothstep( -2.8, -0.2, v.z ) * ( 1.0 - smoothstep( 0.02, 0.2, v.z ) );
  float radial = 1.0 - smoothstep( s.w * 0.9, s.w * 1.9, length( v.xy ) );
  artSoot = max( artSoot, along * radial );
}
vec3 gv = artP - uArtGun.xyz;
artSoot = max( artSoot, uArtGun.w * smoothstep( 1.6, 0.0, gv.z ) * step( -0.05, gv.z ) * ( 1.0 - smoothstep( 0.04, 0.18, length( gv.xy ) ) ) );
artSoot *= ( 0.55 + 0.45 * artNoise( vec3( artP.x * 14.0, artP.y * 14.0, artP.z * 1.5 ) ) ) * ( 0.4 + artWear );
if ( artMode < 8.5 ) artCol = mix( artCol, vec3( 0.03, 0.028, 0.026 ), clamp( artSoot, 0.0, 1.0 ) * 0.85 );
// battle damage: scorching spreads with the part's damage
float artDmg = vArtState.x;
if ( artDmg > 0.001 ) {
  float nb = artFbm( artP * 1.6 + 3.1 );
  float t = 1.08 - artDmg;
  float burn = smoothstep( t - 0.07, t + 0.07, nb + artDmg * 0.3 );
  artCol = mix( artCol, vec3( 0.022, 0.02, 0.018 ), burn * 0.93 );
  artCol += burn * ( 1.0 - burn ) * artDmg * vec3( 0.08, 0.035, 0.012 );
  artRough = mix( artRough, 0.95, burn );
  artCoat *= 1.0 - burn;
  artMetal *= 1.0 - burn;
}
diffuseColor.rgb = artCol;
`;

/** Per-material uniforms for one jet type + livery. */
export interface LiveryUniforms {
  [key: string]: { value: unknown };
}

function linear(hex: number): Color {
  return new Color().setHex(hex);
}

/** Packs decals into a float texture: 5 texels per decal row. */
function decalTexture(decals: readonly DecalDef[]): DataTexture {
  const rows = Math.max(decals.length, 1);
  const data = new Float32Array(8 * rows * 4);
  decals.forEach((d, i) => {
    const o = i * 8 * 4;
    const rect = d.type === 0 && d.atlas ? atlasRect(d.atlas) : [0, 0, 1, 1];
    const col = d.color ?? [1, 1, 1, 1];
    const c = new Color(col[0], col[1], col[2]);
    const vals = [
      d.center[0],
      d.center[1],
      d.center[2],
      d.type,
      d.right[0] / d.halfW,
      d.right[1] / d.halfW,
      d.right[2] / d.halfW,
      d.depth ?? 0.5,
      d.up[0] / d.halfH,
      d.up[1] / d.halfH,
      d.up[2] / d.halfH,
      d.accent ? 1 : d.stencil ? 2 : 0,
      rect[0]!,
      rect[1]!,
      rect[2]!,
      rect[3]!,
      c.r,
      c.g,
      c.b,
      col[3],
    ];
    for (let k = 0; k < vals.length; k++) data[o + k] = vals[k]!;
  });
  const t = new DataTexture(data, 8, rows, RGBAFormat, FloatType);
  t.needsUpdate = true;
  return t;
}

export interface LiverySetup {
  decals: readonly DecalDef[];
  soot: readonly (readonly [number, number, number, number])[];
  gun: readonly [number, number, number];
  radomeZ: number;
  antiGlare: readonly [number, number, number, number];
  length: number;
}

/**
 * The airframe material: MeshPhysicalMaterial with the livery shader patched in through patchAtmosphere.
 * One program serves every jet, livery and LOD (all variation is uniforms), so a full sortie compiles a
 * single airframe program (plus its non-skinned variant for ordnance in flight).
 */
export function createLiveryMaterial(
  setup: LiverySetup | null,
  team: Team,
  liveryIndex: number,
): MeshPhysicalMaterial {
  const lv = liveryFor(team, liveryIndex);
  const decals = setup ? setup.decals.filter((d) => !d.team || d.team === team) : [];
  const soot = setup?.soot ?? [];
  const decalTex = decalTexture(decals);
  const stencil = linear(lv.stencil);
  // numbers and stencils take the livery stencil colour unless they carry their own tint
  const u = {
    uArtAtlas: { value: getAtlas() },
    uArtDecals: { value: decalTex },
    uArtDecalCount: { value: Math.min(decals.length, 48) },
    uArtColA: { value: linear(lv.a) },
    uArtColB: { value: linear(lv.b) },
    uArtColC: { value: linear(lv.c) },
    uArtColUnder: { value: linear(lv.under) },
    uArtAccent: { value: linear(lv.accent) },
    uArtStencil: { value: stencil },
    uArtCamo: { value: new Vector4(lv.camo, lv.scale, lv.underside, lv.lowVis) },
    uArtPaint: { value: new Vector4(lv.rough, lv.gloss, lv.wear, setup?.length ?? 4) },
    uArtSoot: {
      value: [0, 1].map((k) => {
        const s = soot[k];
        return s ? new Vector4(s[0], s[1], s[2], s[3]) : new Vector4(0, 0, 0, 0);
      }),
    },
    uArtGun: {
      value: setup ? new Vector4(setup.gun[0], setup.gun[1], setup.gun[2], 1) : new Vector4(0, 0, 0, 0),
    },
    uArtRegion: {
      value: setup
        ? new Vector4(setup.radomeZ, setup.antiGlare[0], setup.antiGlare[1], setup.antiGlare[2])
        : new Vector4(-1e4, 0, 0, 0),
    },
    uArtRegion2: { value: new Vector4(setup?.antiGlare[3] ?? 0, 0, 0, 0) },
    uArtGlyph: { value: new Vector4(...glyphGrid()) },
  };
  const mat = new MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: lv.rough,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.32,
    envMapIntensity: 1,
  });
  mat.name = `art-livery-${team}-${lv.name}`;
  patchAtmosphere(mat, 'art-livery-v1', (shader: WebGLProgramParametersWithUniforms) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_PARS}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERTEX_MAIN}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAGMENT_PARS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${FRAGMENT_MAIN}`)
      .replace(
        '#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>\nroughnessFactor = artRough;',
      )
      .replace(
        '#include <metalnessmap_fragment>',
        '#include <metalnessmap_fragment>\nmetalnessFactor = artMetal;',
      )
      .replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\ntotalEmissiveRadiance += artEmit;',
      )
      .replace(
        '#include <lights_physical_fragment>',
        '#include <lights_physical_fragment>\n#ifdef USE_CLEARCOAT\nmaterial.clearcoat *= artCoat;\n#endif',
      )
      .replace(
        '#include <aomap_fragment>',
        `#include <aomap_fragment>
reflectedLight.indirectDiffuse *= artAo;
reflectedLight.indirectSpecular *= artAo * artAo;
reflectedLight.directDiffuse *= mix( 1.0, artAo, 0.75 );
reflectedLight.directSpecular *= artAo;`,
      );
  });
  mat.userData.artUniforms = u;
  return mat;
}

/** Frees the textures owned by a livery material (the atlas is shared and survives). */
export function disposeLiveryMaterial(mat: MeshPhysicalMaterial): void {
  const u = mat.userData.artUniforms as { uArtDecals: { value: DataTexture } } | undefined;
  u?.uArtDecals.value.dispose();
  mat.dispose();
}
