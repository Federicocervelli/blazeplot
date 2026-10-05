precision mediump float;

uniform vec4 uColor;

varying vec2 vCorner;

// Round marker: keep the quad fragments inside the unit circle, matching the point-sprite fallback.
void main() {
  if (dot(vCorner, vCorner) > 1.0) discard;
  gl_FragColor = vec4(uColor.rgb * uColor.a, uColor.a);
}
