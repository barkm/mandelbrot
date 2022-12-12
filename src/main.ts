import "./style.css";
import * as THREE from "three";
import { GPUComputationRenderer } from "three/examples/jsm/misc/GPUComputationRenderer.js";

let startOffset = [-0.75, 0];
let zoomTarget = [-0.75, 0];
let startScale = 100;
let targetScale = 1.5;

const maxScale = 1.5;
const minScale = 0.001;
const scaleDiff = 0.05;
const momentum = 0.9;
const velocityMomentum = 0.95;
const minVelocity = 0.001;

const renderer = new THREE.WebGLRenderer({
  powerPreference: "high-performance",
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
const canvas = renderer.domElement;
document.body.appendChild(canvas);

const computationRenderer = new GPUComputationRenderer(
  window.devicePixelRatio * window.innerWidth,
  window.devicePixelRatio * window.innerHeight,
  renderer
);
const material = computationRenderer.createShaderMaterial(
  `
    const float squaredRadius = 5.0 * 5.0;
    const float maxIterations = 500.0;
    const float minIntensity = 0.75;
    uniform float scale;
    uniform vec2 offset;
    uniform vec2 target;
    vec2 f(vec2 z, vec2 c) {
      return vec2(
        z.x * z.x - z.y * z.y + c.x,
        2.0 * z.x * z.y + c.y
      );
    }
    void main() {
        vec2 c = gl_FragCoord.xy;
        c = (resolution / min(resolution.x, resolution.y)) * (2.0 * (c / resolution) - 1.0);
        c = scale * c + offset;
        vec2 z = vec2(0.0, 0.0);
        float i = 0.0;
        for (; i < maxIterations; i++) {
          if (z.x * z.x + z.y * z.y > squaredRadius) { break; }
          z = f(z, c);
        }
        float intensity = i / maxIterations;
        gl_FragColor = vec4(vec3(0.0), minIntensity * pow(intensity, 0.5));
    }
  `,
  {
    scale: { value: startScale },
    offset: { value: startOffset },
  }
);
// @ts-ignore
const renderTarget = computationRenderer.createRenderTarget();
computationRenderer.doRenderTarget(material, renderTarget);

const camera = new THREE.Camera();
const scene = new THREE.Scene();
scene.background = renderTarget.texture;

const getCoord = (coordInWindow: [number, number]): [number, number] => {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const size = Math.min(width, height);
  const x = (width / size) * ((2 * coordInWindow[0]) / width - 1);
  const y = -(height / size) * ((2 * coordInWindow[1]) / height - 1);
  const scale = material.uniforms.scale.value;
  const offset = material.uniforms.offset.value;
  return [scale * x + offset[0], scale * y + offset[1]];
};

const updateScale = (scaleIn: boolean) => {
  targetScale *= 1 + scaleDiff * (scaleIn ? -1 : 1);
  targetScale = Math.max(minScale, Math.min(maxScale, targetScale));
};

const zoom = (event: WheelEvent) => {
  zoomTarget = getCoord([event.offsetX, event.offsetY]);
  updateScale(event.deltaY > 0);
};

let moving = false;
let moveStart: [number, number] = [0, 0];
let moveVelocity: [number, number] = [0, 0];
const initMove = (event: MouseEvent) => {
  moving = true;
  moveStart = getCoord([event.x, event.y]);
  moveVelocity = [0, 0];
};
const move = (event: MouseEvent) => {
  if (moving) {
    const coord = getCoord([event.x, event.y]);
    moveVelocity[0] = -(coord[0] - moveStart[0]);
    moveVelocity[1] = -(coord[1] - moveStart[1]);
  }
};
const endMove = () => {
  moving = false;
};

const touchStart = (event: TouchEvent) => {
  if (event.touches.length == 1) {
    const touch = event.touches.item(0)!;
    moveStart = getCoord([touch.screenX, touch.screenY]);
  }
};
let prevDistance: number | null = null;
let lastPinchTime = Date.now();
const touchMove = (event: TouchEvent) => {
  if (event.touches.length == 1 && Date.now() - lastPinchTime > 100) {
    const touch = event.touches.item(0)!;
    const coord = getCoord([touch.screenX, touch.screenY]);
    moveVelocity[0] = -(coord[0] - moveStart[0]);
    moveVelocity[1] = -(coord[1] - moveStart[1]);
  } else if (event.touches.length == 2) {
    lastPinchTime = Date.now();
    const touch1 = event.touches.item(0)!;
    const touch2 = event.touches.item(1)!;
    const distance = Math.hypot(
      touch1.screenX - touch2.screenX,
      touch1.screenY - touch2.screenY
    );
    if (prevDistance) {
      updateScale(prevDistance - distance < 0);
    }
    prevDistance = distance;
    zoomTarget = getCoord([
      (touch1.screenX + touch2.screenX) / 2,
      (touch2.screenY + touch2.screenY) / 2,
    ]);
  }
};

canvas.addEventListener("mousedown", initMove);
canvas.addEventListener("mousemove", move);
canvas.addEventListener("mouseup", endMove);
canvas.addEventListener("wheel", zoom);
canvas.addEventListener("touchstart", touchStart);
canvas.addEventListener("touchmove", touchMove);

computationRenderer.doRenderTarget(material, renderTarget);
renderer.render(scene, camera);

const animate = () => {
  requestAnimationFrame(animate);
  const scale = material.uniforms.scale.value;
  if (
    moveVelocity[0] ** 2 + moveVelocity[1] ** 2 >
      minVelocity ** 2 * scale ** 2 ||
    Math.abs(scale - targetScale) > minScale / 10
  ) {
    const offset = material.uniforms.offset.value;
    const newScale = momentum * scale + (1 - momentum) * targetScale;
    offset[0] += (1 - newScale / scale) * (zoomTarget[0] - offset[0]);
    offset[1] += (1 - newScale / scale) * (zoomTarget[1] - offset[1]);
    offset[0] += moveVelocity[0];
    offset[1] += moveVelocity[1];
    offset[0] = Math.max(-2, Math.min(1, offset[0]));
    offset[1] = Math.max(-1, Math.min(1, offset[1]));
    material.uniforms.scale.value = newScale;
    material.needsUpdate = true;
    computationRenderer.doRenderTarget(material, renderTarget);
    renderer.render(scene, camera);
  }
  moveVelocity[0] *= velocityMomentum;
  moveVelocity[1] *= velocityMomentum;
};

animate();
