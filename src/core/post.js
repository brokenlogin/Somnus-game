import * as THREE from 'three';

// Renders the scene to a low-resolution target, then composites it with grain,
// vignette, chromatic fringing and a slight dream wobble.
export class Post {
  constructor(renderer) {
    this.renderer = renderer;
    this.scale = 0.62;
    this.target = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: true });
    this.uniforms = {
      tDiffuse: { value: this.target.texture },
      time: { value: 0 },
      grain: { value: 0.07 },
      vig: { value: 1.1 },
      aber: { value: 0.0025 },
      fear: { value: 0 },
      desat: { value: 0.25 },
      // Up to two smeared zones around monsters: xy = uv centre, z = radius (in screen heights), w = strength.
      blurA: { value: new THREE.Vector4() },
      blurB: { value: new THREE.Vector4() },
      wave: { value: new THREE.Vector2() }, // heat-haze wobble per zone
      aspect: { value: 1 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        uniform float time, grain, vig, aber, fear, desat, aspect;
        uniform vec4 blurA, blurB;
        uniform vec2 wave;
        varying vec2 vUv;
        float rand(vec2 c) { return fract(sin(dot(c, vec2(12.9898, 78.233))) * 43758.5453); }
        float zone(vec4 b, vec2 uv) {
          if (b.w <= 0.0) return 0.0;
          vec2 d = uv - b.xy;
          d.x *= aspect;
          return 1.0 - smoothstep(b.z * 0.45, b.z, length(d));
        }
        void main() {
          vec2 uv = vUv;
          vec2 c = uv - 0.5;
          float d = length(c);
          float w = 0.0007 * (1.0 + fear * 4.0);
          uv += vec2(sin(uv.y * 11.0 + time * 0.7), cos(uv.x * 9.0 + time * 0.6)) * w;
          float zA = zone(blurA, vUv), zB = zone(blurB, vUv);
          float bw = max(zA * blurA.w, zB * blurB.w);
          float wv = max(zA * wave.x, zB * wave.y);
          // Heat-haze wobble inside the blur zone.
          uv += vec2(sin(uv.y * 60.0 + time * 4.0), cos(uv.x * 55.0 + time * 3.3)) * 0.004 * wv;
          float a = aber * (0.3 + d * 1.5) * (1.0 + fear * 3.0) + bw * 0.01;
          vec3 col;
          col.r = texture2D(tDiffuse, uv + c * a).r;
          col.g = texture2D(tDiffuse, uv).g;
          col.b = texture2D(tDiffuse, uv - c * a).b;
          if (bw > 0.01) {
            vec3 acc = vec3(0.0);
            float rad = bw * 0.022;
            for (int i = 0; i < 18; i++) {
              float fi = float(i);
              float ang = fi * 2.39996 + time * 2.0;
              float rr = sqrt((fi + 0.5) / 18.0) * rad;
              acc += texture2D(tDiffuse, uv + vec2(cos(ang) / aspect, sin(ang)) * rr).rgb;
            }
            col = mix(col, acc / 18.0, clamp(bw * 1.4, 0.0, 1.0));
          }
          float l = dot(col, vec3(0.299, 0.587, 0.114));
          col = mix(col, vec3(l), desat);
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          float n = rand(vUv * 913.0 + fract(time * 7.13) * 61.0) - 0.5;
          gl_FragColor.rgb += n * grain;
          gl_FragColor.rgb *= smoothstep(0.95, 0.2, d * vig * (1.0 + fear * 0.35));
        }`,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    this.quad.frustumCulled = false;
    this.quadScene = new THREE.Scene();
    this.quadScene.add(this.quad);
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }

  setSize(w, h) {
    const pr = Math.min(window.devicePixelRatio || 1, 2);
    this.target.setSize(Math.max(2, Math.floor(w * pr * this.scale)), Math.max(2, Math.floor(h * pr * this.scale)));
  }

  render(scene, camera, time) {
    this.uniforms.time.value = time;
    const r = this.renderer;
    r.setRenderTarget(this.target);
    r.render(scene, camera);
    r.setRenderTarget(null);
    r.render(this.quadScene, this.quadCam);
  }
}
