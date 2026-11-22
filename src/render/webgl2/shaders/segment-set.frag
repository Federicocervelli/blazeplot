#version 300 es
precision highp float;

in vec2 vPos;
in float vLength;

uniform vec4 uStroke;
// Straight color.
uniform vec4 uColor;

out vec4 fragColor;

// The coverage of segment.frag, with one style for every segment of the draw.
void main() {
  float width = uStroke.x;
  float drawn = max(width, 1.0);
  float coverage = clamp(drawn * 0.5 + 0.5 - abs(vPos.y), 0.0, 1.0) * min(width, 1.0);
  coverage *= clamp(min(vPos.x, vLength - vPos.x) + 0.5, 0.0, 1.0);
  if (uStroke.y > 0.0 && uStroke.z > 0.0) {
    float period = uStroke.y + uStroke.z;
    float m = mod(vPos.x, period);
    coverage *= clamp(min(m, uStroke.y - m) + 0.5, 0.0, 1.0);
  }
  if (coverage <= 0.0) discard;
  fragColor = vec4(uColor.rgb * uColor.a, uColor.a) * coverage;
}
