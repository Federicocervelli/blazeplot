attribute float aX;
attribute float aMinY;
attribute float aMaxY;
attribute float aSelect;

uniform vec2 uScale;
uniform vec2 uOffset;

void main() {
  float y = (aSelect < 0.5) ? aMinY : aMaxY;
  vec2 position = vec2(aX, y);
  vec2 clipSpace = position * uScale + uOffset;
  gl_Position = vec4(clipSpace, 0.0, 1.0);
}
