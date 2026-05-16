#version 300 es
precision highp float;

in float aX;
in float aMinY;
in float aMaxY;

uniform vec2 uScale;
uniform vec2 uOffset;

void main() {
  float y = (gl_VertexID == 0) ? aMinY : aMaxY;
  vec2 position = vec2(aX, y);
  vec2 clipSpace = position * uScale + uOffset;
  gl_Position = vec4(clipSpace, 0.0, 1.0);
}
