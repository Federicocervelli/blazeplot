precision mediump float;

uniform vec4 uColor;

// The drawing buffer is premultiplied (see WebGL2Backend), so emit premultiplied color.
void main() {
  gl_FragColor = vec4(uColor.rgb * uColor.a, uColor.a);
}
