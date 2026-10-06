precision mediump float;

varying vec4 vColor;

// The drawing buffer is premultiplied (see WebGL2Backend), so emit premultiplied color.
void main() {
  gl_FragColor = vec4(vColor.rgb * vColor.a, vColor.a);
}
