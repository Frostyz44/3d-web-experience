// vColor is a vec4 since three r187
export const instanced_color_vertex = /* glsl */ `
#ifdef USE_INSTANCING_COLOR_INDIRECT
  #ifdef USE_VERTEX_COLOR
    #ifdef USE_COLOR_ALPHA
      vColor = color;
    #else
      vColor = vec4( color, 1.0 );
    #endif
  #else
    vColor = vec4( 1.0 );
  #endif
#endif
`;
