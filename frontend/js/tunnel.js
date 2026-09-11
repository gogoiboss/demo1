/**
 * tunnel.js - WebGL tunnel journey for OUTLIERS ETA Intelligence Engine
 * Full Three.js WebGL tunnel with camera path animation, train movement,
 * dynamic lighting, and GSAP-driven timeline.
 */
import * as THREE from 'three';

let _renderer, _scene, _camera, _clock, _raf;
let _tunnel, _train, _rings = [], _lights = [];
let _trainInTunnel;
let _animating = false;
let _resolvePromise = null;

// ── Public: run the full tunnel journey ─────────────────────────────────────
export function runTunnelJourney(sharedCanvas, sharedRenderer, sharedScene, sharedCamera, trainMesh, tier) {
  return new Promise(resolve => {
    _resolvePromise = resolve;
    _renderer = sharedRenderer;
    _scene = sharedScene;
    _camera = sharedCamera;
    _clock = new THREE.Clock();
    _animating = true;

    // Add tunnel geometry to scene
    _buildTunnel(tier);

    // Clone train position into tunnel
    _trainInTunnel = trainMesh;

    // Safety timeout in case animation is blurred/paused
    setTimeout(() => _finishJourney(), 8500);
    // Run GSAP camera + train animation
    _runJourneyTimeline(tier);
  });
}

export function disposeTunnel() {
  _animating = false;
  if (_tunnel) _scene.remove(_tunnel);
  _rings = [];
  _lights.forEach(l => _scene.remove(l));
  _lights = [];
}

function _buildTunnel(tier) {
  const group = new THREE.Group();

  // Tunnel tube using TubeGeometry along a straight path with slight curve
  const path = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 20),
    new THREE.Vector3(0, 0.5, 0),
    new THREE.Vector3(0, 0, -80),
  ]);

  const segments = tier === 'low' ? 32 : tier === 'medium' ? 64 : 120;
  const tubeGeo = new THREE.TubeGeometry(path, segments, 4.5, tier === 'low' ? 8 : 16, false);
  const tubeMat = new THREE.MeshStandardMaterial({
    color: 0x0a1520,
    side: THREE.BackSide,
    roughness: 0.95,
    metalness: 0.05,
  });
  const tube = new THREE.Mesh(tubeGeo, tubeMat);
  group.add(tube);

  // Tunnel rings (glowing cyan bands)
  const ringCount = tier === 'low' ? 15 : 30;
  for (let i = 0; i < ringCount; i++) {
    const t = i / ringCount;
    const pos = path.getPoint(t);
    const ringGeo = new THREE.TorusGeometry(4.5, 0.08, 8, 32);
    const ringMat = new THREE.MeshStandardMaterial({
      color: 0x0066ff,
      emissive: 0x0044cc,
      emissiveIntensity: 1.2 + Math.random() * 0.8,
      transparent: true,
      opacity: 0.6 + Math.random() * 0.3,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.copy(pos);
    // Orient ring perpendicular to path
    const tangent = path.getTangent(t);
    ring.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1), tangent.normalize());
    group.add(ring);
    _rings.push(ring);
  }

  // Point lights along tunnel for dramatic lighting
  const lightCount = tier === 'low' ? 4 : 8;
  for (let i = 0; i < lightCount; i++) {
    const t = (i + 0.5) / lightCount;
    const pos = path.getPoint(t);
    const colors = [0x0066ff, 0x0044aa, 0x00aaff, 0x2244ff];
    const light = new THREE.PointLight(colors[i % colors.length], tier === 'low' ? 2 : 3, 20);
    light.position.copy(pos);
    _scene.add(light);
    _lights.push(light);
  }

  // Ground rails inside tunnel
  const railMat = new THREE.MeshStandardMaterial({ color:0x445566, metalness:0.9, roughness:0.2 });
  const railGeo = new THREE.BoxGeometry(0.06, 0.06, 120);
  const r1 = new THREE.Mesh(railGeo, railMat); r1.position.set(-0.75, -4.0, -30);
  const r2 = new THREE.Mesh(railGeo, railMat); r2.position.set( 0.75, -4.0, -30);
  group.add(r1, r2);

  _tunnel = group;
  _scene.add(group);
  return { path };
}

function _runJourneyTimeline(tier) {
  const gsap = window.gsap;
  if (!gsap) { _finishJourney(); return; }

  const cam = _camera;
  const train = _trainInTunnel;

  // Disable idle orbit on scene.js side
  window._outliersIdleOrbit = false;

  const tl = gsap.timeline({
    onComplete: _finishJourney
  });

  // Phase 1: Train starts moving toward tunnel entrance (camera follows)
  if (train && train.position) { tl.to(train.position, { z: -5, duration: 1.5, ease: 'power2.in' }, 0); }
  if (cam && cam.position) { tl.to(cam.position, { x:0, y:2, z:8, duration:1.5, ease:'power2.in' }, 0); }

  // Phase 2: Enter tunnel — camera rushes forward
  if (cam && cam.position) { tl.to(cam.position, { z:-20, y:0.5, duration:2.5, ease:'power4.in' }, 1.2); }
  if (train && train.position) { tl.to(train.position, { z:-25, duration:2.5, ease:'power4.in' }, 1.2); }

  // Ring pulse during flight
  _rings.forEach((ring, i) => {
    tl.to(ring.material, { emissiveIntensity: 3.0, opacity:0.9, duration:0.1, yoyo:true, repeat:3 }, 1.5 + i*0.08);
  });

  // Phase 3: Midpoint — camera slows, AI analysis flash
  if (cam && cam.position) { tl.to(cam.position, { z:-50, y:1, duration:1.8, ease:'power2.out' }, 3.5); }

  // Phase 4: Light flash (white flash at midpoint)
  const flashEl = document.getElementById('tunnel-flash');
  if (flashEl) {
    tl.to(flashEl, { opacity:1, duration:0.15, ease:'power4.in' }, 4.5);
    tl.to(flashEl, { opacity:0, duration:0.4, ease:'power2.out' }, 4.65);
  }

  // Phase 5: Auth approach — camera decelerates
  if (cam && cam.position) { tl.to(cam.position, { z:-75, y:0.5, duration:1.5, ease:'power3.out' }, 5.0); }

  // Phase 6: Fade to black before auth
  const overlayEl = document.getElementById('tunnel-overlay');
  if (overlayEl) {
    tl.to(overlayEl, { opacity:1, duration:0.6, ease:'power2.in' }, 6.2);
  }
}

function _finishJourney() {
  _animating = false;
  if (_resolvePromise) {
    _resolvePromise();
    _resolvePromise = null;
  }
}
