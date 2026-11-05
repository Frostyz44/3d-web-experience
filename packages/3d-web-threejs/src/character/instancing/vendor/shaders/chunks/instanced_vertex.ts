export const instanced_vertex = /* glsl */ `
#ifdef USE_INSTANCING_INDIRECT
  mat4 instanceMatrix = getInstancedMatrix();

  #ifdef USE_INSTANCING_COLOR_INDIRECT
    // (vColor is a vec4 since three r187; getColorTexture() is a vec3 without USE_COLOR_ALPHA)
    #ifdef USE_COLOR_ALPHA
      vColor *= getColorTexture();
    #else
      vColor.rgb *= getColorTexture();
    #endif
  #endif
#endif
`;
