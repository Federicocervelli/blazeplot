precision mediump float;

uniform sampler2D uField;
uniform vec4 uColor;

varying vec2 vUv;

// One color at the opacity the texture holds, filtered between grid vertices; premultiplied, as the buffer is.
void main() {
  float a = texture2D(uField, vUv).r;
  gl_FragColor = vec4(uColor.rgb * a, a);
}
