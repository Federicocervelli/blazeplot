attribute vec2 position;

uniform vec2 uScale;
uniform vec2 uOffset;

void main() {
  vec2 clipSpace = position * uScale + uOffset;
  gl_Position = vec4(clipSpace, 0.0, 1.0);
}
