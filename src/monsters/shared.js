import * as THREE from 'three';

const _v = new THREE.Vector3();
const _x = new THREE.Vector3();
const _z = new THREE.Vector3();
const _m = new THREE.Matrix4();

export function onScreen(camera, pos, margin = 1.0) {
  _v.copy(pos).project(camera);
  return _v.z < 1 && Math.abs(_v.x) < margin && Math.abs(_v.y) < margin;
}

// Rotate obj so its +Y is `up` and its +Z faces `target`.
export function orient(obj, up, target) {
  _z.copy(target).sub(obj.position).projectOnPlane(up);
  if (_z.lengthSq() < 1e-6) return;
  _z.normalize();
  _x.crossVectors(up, _z).normalize();
  _m.makeBasis(_x, up, _z);
  obj.quaternion.setFromRotationMatrix(_m);
}

// Cosine of the angle between the camera's view and the direction to `pos`.
export function lookCos(camera, pos) {
  const camPos = camera.position;
  _v.copy(pos).sub(camPos).normalize();
  _x.set(0, 0, -1).applyQuaternion(camera.quaternion);
  return _v.dot(_x);
}

export function limb(geoLen, radius, mat) {
  const g = new THREE.CapsuleGeometry(radius, geoLen, 3, 6);
  g.translate(0, -geoLen / 2 - radius, 0); // pivot at the top
  return new THREE.Mesh(g, mat);
}
