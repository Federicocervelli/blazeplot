// highp: distances along a long segment or across a large shape need more than mediump's ~11 bits.
precision highp float;

varying vec2 vPos;
varying vec4 vStroke;
varying float vLength;
varying vec4 vColor;

// Coverage across the stroke, at the butt ends, and per dash, each with a one-pixel edge.
// Strokes thinner than a pixel are drawn a pixel wide with their coverage scaled down.
void main() {
  float width = vStroke.x;
  float drawn = max(width, 1.0);
  float coverage = clamp(drawn * 0.5 + 0.5 - abs(vPos.y), 0.0, 1.0) * min(width, 1.0);
  coverage *= clamp(min(vPos.x, vLength - vPos.x) + 0.5, 0.0, 1.0);
  if (vStroke.y > 0.0 && vStroke.z > 0.0) {
    float period = vStroke.y + vStroke.z;
    float m = mod(vPos.x + vStroke.w, period);
    coverage *= clamp(min(m, vStroke.y - m) + 0.5, 0.0, 1.0);
  }
  if (coverage <= 0.0) discard;
  gl_FragColor = vec4(vColor.rgb * vColor.a, vColor.a) * coverage;
}
