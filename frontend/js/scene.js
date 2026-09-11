/**
 * OUTLIERS — realistic cinematic railway scene
 * ---------------------------------------------------------------
 * IMPORTANT:
 * - Uses the real WAP-7 GLTF asset. No cartoon/procedural locomotive.
 * - Expected asset location:
 *     dashboard/assets/3d/uvwag9.gltf
 *     dashboard/assets/3d/uvwag9.bin
 *     dashboard/assets/3d/<all texture files>
 *
 * Public API kept compatible with app.js:
 *   detectTier()
 *   initScene(canvas, tier, onTrainClick)
 *   disposeScene()
 *   getSceneObjects()
 *   setIdleOrbit(enabled)
 *   triggerTrainJourney(callback)
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

let _renderer = null;
let _scene = null;
let _camera = null;
let _clock = null;
let _raf = null;
let _canvas = null;

let _train = null;
let _trainModel = null;
let _wheels = [];
let _headlightL = null;
let _headlightR = null;

let _sun = null;
let _hemi = null;
let _ambient = null;
let _stationLights = [];

let _moving = false;
let _hovered = false;
let _elapsed = 0;
let _tier = 'high';
let _idleOrbit = false;
let _journeyProgress = 0;
let _onTrainClick = null;

const _raycaster = new THREE.Raycaster();
const _mouse = new THREE.Vector2(-99, -99);
const _loader = new GLTFLoader();

let _resizeHandler = null;
let _moveHandler = null;
let _clickHandler = null;
let _touchHandler = null;

const ASSET = './assets/3d/uvwag9.gltf';

// Tunnel is placed ON THE TRAIN'S ACTUAL ROUTE. The journey timeline
// moves the train toward NEGATIVE z, so the tunnel must live in
// negative z too (previously it sat at +72 while the train only ever
// travelled to -132 — the train could never reach it).
const TUNNEL_Z = -125;
const TUNNEL_HALF_DEPTH = 8;
const TUNNEL_ENTRANCE_Z = TUNNEL_Z + TUNNEL_HALF_DEPTH; // face the train reaches first
const TUNNEL_BACK_Z = TUNNEL_Z - TUNNEL_HALF_DEPTH;

/* ============================================================
   QUALITY
   ============================================================ */

export function detectTier() {
  const c = document.createElement('canvas');
  const gl = c.getContext('webgl2') || c.getContext('webgl');
  if (!gl) return 'none';

  if (/Android|iPhone|iPad|iPod|Mobile|Tablet/i.test(navigator.userAgent)) {
    return 'medium';
  }

  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const gpu = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';

    if (/swiftshader|software renderer|intel hd 4000|intel hd 5000/i.test(gpu)) {
      return 'medium';
    }
  } catch (_) { }

  return 'high';
}

/* ============================================================
   INIT
   ============================================================ */

export function initScene(canvas, tier = 'high', onTrainClick = null) {
  disposeScene();

  _canvas = canvas;
  _tier = tier || 'high';
  _onTrainClick = onTrainClick;

  _clock = new THREE.Clock();
  _elapsed = 0;
  _moving = false;
  _hovered = false;
  _journeyProgress = 0;
  _wheels = [];
  _stationLights = [];

  _renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: _tier !== 'low',
    alpha: false,
    powerPreference: 'high-performance'
  });

  _renderer.setPixelRatio(
    Math.min(
      window.devicePixelRatio || 1,
      _tier === 'low' ? 1 : 2
    )
  );

  _renderer.outputColorSpace = THREE.SRGBColorSpace;
  _renderer.toneMapping = THREE.ACESFilmicToneMapping;
  _renderer.toneMappingExposure = 1.08;

  _renderer.shadowMap.enabled = _tier !== 'low';
  _renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  _scene = new THREE.Scene();

  _scene.background = new THREE.Color(0x9caebe);

  _scene.fog = new THREE.Fog(
    0x9caebe,
    55,
    _tier === 'low' ? 180 : 330
  );

  _camera = new THREE.PerspectiveCamera(
    42,
    Math.max(1, canvas.clientWidth || innerWidth) /
    Math.max(1, canvas.clientHeight || innerHeight),
    0.1,
    1000
  );

  // Hero composition:
  // locomotive stays toward the right while website UI remains left.
  _camera.position.set(-8.4, 3.15, 15.5);
  _camera.lookAt(0, 1.45, -1.5);

  _buildSky();
  _buildLighting();
  _buildStation();
  _buildTrack();
  _buildLandscape();
  _buildTunnel();
  _buildTrain();

  _resizeHandler = resize;
  _moveHandler = onPointerMove;
  _clickHandler = onClick;
  _touchHandler = onTouch;

  window.addEventListener('resize', _resizeHandler);

  canvas.addEventListener(
    'mousemove',
    _moveHandler
  );

  canvas.addEventListener(
    'click',
    _clickHandler
  );

  canvas.addEventListener(
    'touchend',
    _touchHandler,
    { passive: true }
  );

  resize();
  animate();

  return {
    renderer: _renderer,
    scene: _scene,
    camera: _camera,
    train: _train,
    startJourney: startJourney,
    setSunlightMode: setSunlightMode
  };
}

/* ============================================================
   SKY
   ============================================================ */

function _buildSky() {
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(
      420,
      _tier === 'high' ? 48 : 24,
      24
    ),

    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,

      uniforms: {
        top: {
          value: new THREE.Color(0x486987)
        },

        mid: {
          value: new THREE.Color(0xaec0cd)
        },

        horizon: {
          value: new THREE.Color(0xe7d5bd)
        }
      },

      vertexShader: `
        varying vec3 vWorld;

        void main() {
          vWorld =
            (modelMatrix * vec4(position, 1.0)).xyz;

          gl_Position =
            projectionMatrix *
            modelViewMatrix *
            vec4(position, 1.0);
        }
      `,

      fragmentShader: `
        varying vec3 vWorld;

        uniform vec3 top;
        uniform vec3 mid;
        uniform vec3 horizon;

        void main() {
          float h = normalize(vWorld).y;

          vec3 c =
            mix(
              horizon,
              mid,
              smoothstep(-0.12, 0.25, h)
            );

          c =
            mix(
              c,
              top,
              smoothstep(0.25, 0.9, h)
            );

          gl_FragColor =
            vec4(c, 1.0);
        }
      `
    })
  );

  _scene.add(sky);
}

/* ============================================================
   LIGHTING
   ============================================================ */

function _buildLighting() {
  _ambient = new THREE.AmbientLight(
    0xeaf1f5,
    0.38
  );

  _scene.add(_ambient);

  _hemi = new THREE.HemisphereLight(
    0x9db9d1,
    0x433a31,
    0.7
  );

  _scene.add(_hemi);

  _sun = new THREE.DirectionalLight(
    0xffd8aa,
    2.35
  );

  _sun.position.set(
    -35,
    42,
    25
  );

  _sun.castShadow = _tier !== 'low';

  if (_sun.castShadow) {
    const size =
      _tier === 'high'
        ? 2048
        : 1024;

    _sun.shadow.mapSize.set(
      size,
      size
    );

    _sun.shadow.camera.left = -55;
    _sun.shadow.camera.right = 55;
    _sun.shadow.camera.top = 40;
    _sun.shadow.camera.bottom = -25;

    _sun.shadow.camera.near = 1;
    _sun.shadow.camera.far = 180;

    _sun.shadow.bias = -0.00025;
    _sun.shadow.normalBias = 0.02;
  }

  _scene.add(_sun);

  for (let i = 0; i < 7; i++) {
    const light = new THREE.PointLight(
      0xffbd6b,
      0.8,
      13,
      1.7
    );

    light.position.set(
      -4.4,
      4.0,
      -22 + i * 8
    );

    _stationLights.push(light);
    _scene.add(light);
  }
}

/* ============================================================
   STATION
   ============================================================ */

function _buildStation() {
  const group = new THREE.Group();

  const concrete =
    new THREE.MeshStandardMaterial({
      color: 0x74797b,
      roughness: 0.94
    });

  const darkMetal =
    new THREE.MeshStandardMaterial({
      color: 0x20252a,
      metalness: 0.72,
      roughness: 0.38
    });

  const roofMat =
    new THREE.MeshStandardMaterial({
      color: 0x24282c,
      metalness: 0.25,
      roughness: 0.8
    });

  const platform = new THREE.Mesh(
    new THREE.BoxGeometry(
      7.4,
      0.75,
      58
    ),
    concrete
  );

  platform.position.set(
    -5.0,
    -0.48,
    3
  );

  platform.receiveShadow = true;

  group.add(platform);

  const platformEdge =
    new THREE.Mesh(
      new THREE.BoxGeometry(
        0.18,
        0.045,
        58
      ),

      new THREE.MeshStandardMaterial({
        color: 0xd1aa48,
        roughness: 0.7
      })
    );

  platformEdge.position.set(
    -1.35,
    -0.05,
    3
  );

  group.add(platformEdge);

  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(
      7.2,
      0.22,
      48
    ),
    roofMat
  );

  roof.position.set(
    -5.0,
    4.25,
    1
  );

  roof.castShadow = true;

  group.add(roof);

  // Roof ribs give the canopy real station depth.
  for (
    let z = -22;
    z <= 25;
    z += 1.5
  ) {
    const rib = new THREE.Mesh(
      new THREE.BoxGeometry(
        7.2,
        0.045,
        0.065
      ),
      darkMetal
    );

    rib.position.set(
      -5.0,
      4.08,
      z
    );

    group.add(rib);
  }

  for (
    const z of [
      -19,
      -11,
      -3,
      5,
      13,
      21
    ]
  ) {
    const column =
      new THREE.Mesh(
        new THREE.CylinderGeometry(
          0.11,
          0.15,
          4.2,
          16
        ),
        darkMetal
      );

    column.position.set(
      -4.7,
      1.85,
      z
    );

    column.castShadow = true;

    group.add(column);
  }
  // Warm station lamps under the canopy.
  for (const z of [-18, -10, -2, 6, 14, 22]) {
    const lamp = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 16, 12),
      new THREE.MeshStandardMaterial({
        color: 0xffe4b0,
        emissive: 0xff9a3d,
        emissiveIntensity: 2.4
      })
    );

    lamp.position.set(
      -4.7,
      3.75,
      z
    );

    group.add(lamp);
  }

  // Station sign.
  const sign = new THREE.Mesh(
    new THREE.BoxGeometry(
      0.12,
      2.0,
      4.0
    ),
    darkMetal
  );

  sign.position.set(
    -8.2,
    1.55,
    -7
  );

  sign.rotation.y = Math.PI / 2;

  group.add(sign);

  // Small sign board.
  const board = new THREE.Mesh(
    new THREE.BoxGeometry(
      0.10,
      1.2,
      3.2
    ),

    new THREE.MeshStandardMaterial({
      color: 0x15202a,
      roughness: 0.65,
      metalness: 0.15,
      emissive: 0x07121b,
      emissiveIntensity: 0.35
    })
  );

  board.position.set(
    -8.12,
    2.0,
    -7
  );

  board.rotation.y = Math.PI / 2;

  group.add(board);

  _scene.add(group);
}

/* ============================================================
   TRACK
   ------------------------------------------------------------
   NOTE: extended to run the full route length (through the
   platform, past the journey's departure phases, and all the
   way through the tunnel bore) so the rails never run out
   under the train.
   ============================================================ */

function _buildTrack() {
  const group = new THREE.Group();

  const ballastMat =
    new THREE.MeshStandardMaterial({
      color: 0x4b4742,
      roughness: 1
    });

  const sleeperMat =
    new THREE.MeshStandardMaterial({
      color: 0x35312d,
      roughness: 0.92
    });

  const railMat =
    new THREE.MeshStandardMaterial({
      color: 0x9b9da0,
      metalness: 0.9,
      roughness: 0.24
    });

  const TRACK_Z_MIN = TUNNEL_BACK_Z - 20; // well past the far side of the bore
  const TRACK_Z_MAX = 140;
  const TRACK_LEN = TRACK_Z_MAX - TRACK_Z_MIN;
  const TRACK_CENTER = (TRACK_Z_MAX + TRACK_Z_MIN) / 2;

  // Long ballast bed.
  const ballast = new THREE.Mesh(
    new THREE.BoxGeometry(
      4.2,
      0.28,
      TRACK_LEN
    ),
    ballastMat
  );

  ballast.position.set(
    0,
    -0.68,
    TRACK_CENTER
  );

  ballast.receiveShadow = true;

  group.add(ballast);

  // Sleepers.
  for (
    let z = TRACK_Z_MIN;
    z <= TRACK_Z_MAX;
    z += 0.9
  ) {
    const sleeper = new THREE.Mesh(
      new THREE.BoxGeometry(
        3.35,
        0.16,
        0.28
      ),
      sleeperMat
    );

    sleeper.position.set(
      0,
      -0.47,
      z
    );

    sleeper.castShadow = true;
    sleeper.receiveShadow = true;

    group.add(sleeper);
  }

  // Two realistic steel rails.
  for (const x of [-0.82, 0.82]) {
    const rail = new THREE.Mesh(
      new THREE.BoxGeometry(
        0.13,
        0.18,
        TRACK_LEN
      ),
      railMat
    );

    rail.position.set(
      x,
      -0.34,
      TRACK_CENTER
    );

    rail.castShadow = true;
    rail.receiveShadow = true;

    group.add(rail);
  }

  // Second track in the distance (station siding — stays outside the tunnel).
  for (const x of [3.9, 5.55]) {
    const rail = new THREE.Mesh(
      new THREE.BoxGeometry(
        0.11,
        0.15,
        260
      ),
      railMat
    );

    rail.position.set(
      x,
      -0.36,
      15
    );

    group.add(rail);
  }

  for (
    let z = -110;
    z <= 140;
    z += 1.2
  ) {
    const sleeper = new THREE.Mesh(
      new THREE.BoxGeometry(
        3.25,
        0.13,
        0.23
      ),
      sleeperMat
    );

    sleeper.position.set(
      4.7,
      -0.49,
      z
    );

    group.add(sleeper);
  }

  // Track-side safety markers.
  const markerMat =
    new THREE.MeshStandardMaterial({
      color: 0xd6c27a,
      roughness: 0.6
    });

  for (
    let z = -95;
    z <= 125;
    z += 18
  ) {
    const marker = new THREE.Mesh(
      new THREE.BoxGeometry(
        0.08,
        0.85,
        0.08
      ),
      markerMat
    );

    marker.position.set(
      2.5,
      -0.05,
      z
    );

    group.add(marker);
  }

  _scene.add(group);
}

/* ============================================================
   LANDSCAPE
   ------------------------------------------------------------
   NOTE ON THE FIX:
   The previous version populated this area with a large flat
   dark-green box "ground slab" plus ~22 squashed green SPHERES
   used as "hills". Squashed low-poly spheres read instantly as
   a cheap game landscape, and several of them landed close to
   the camera / track, which is exactly the "green blobs in the
   foreground" problem described.

   This version:
     - keeps the ground as a single, gently undulating plane
       instead of a raised box, so it reads as terrain rather
       than a floating slab
     - removes the sphere "hill" blobs entirely
     - pushes all raised landform geometry (mountains) well back
       into the distance, past the fog falloff, so they read as
       atmospheric background rather than foreground shapes
     - uses desaturated, photographic earth/olive tones instead
       of saturated cartoon green
     - keeps the river as a subtle reflective background element
   ============================================================ */

function _buildLandscape() {
  const group = new THREE.Group();

  /*
   * Gently undulating ground plane.
   * Segmented + vertex-displaced with a soft noise so it isn't
   * a perfectly flat slab, but the displacement is small enough
   * that it never reads as a "hill" — just natural terrain.
   */
  const groundSegments = _tier === 'high' ? 64 : 28;

  const groundGeo = new THREE.PlaneGeometry(
    220,
    340,
    groundSegments,
    groundSegments
  );

  groundGeo.rotateX(-Math.PI / 2);

  const groundPos = groundGeo.attributes.position;

  for (let i = 0; i < groundPos.count; i++) {
    const x = groundPos.getX(i);
    const z = groundPos.getZ(i);

    // Soft multi-frequency undulation, kept intentionally subtle.
    const height =
      Math.sin(x * 0.045 + z * 0.02) * 0.55 +
      Math.sin(x * 0.11 - z * 0.05) * 0.22 +
      Math.sin(z * 0.03) * 0.35;

    // Flatten the corridor immediately around the tracks/platform
    // so the terrain never intrudes on the railway itself.
    const distFromTrack = Math.abs(x);
    const flatten = THREE.MathUtils.smoothstep(distFromTrack, 6, 16);

    groundPos.setY(i, height * flatten - 1.05);
  }

  groundGeo.computeVertexNormals();

  const groundMat = new THREE.MeshStandardMaterial({
    color: 0x5a5a44,
    roughness: 1
  });

  const ground = new THREE.Mesh(groundGeo, groundMat);

  ground.position.set(0, 0, 10);
  ground.receiveShadow = true;

  group.add(ground);

  // River running through the valley, kept as a calm background element.
  const riverMat =
    new THREE.MeshPhysicalMaterial({
      color: 0x274e63,
      roughness: 0.18,
      metalness: 0.05,
      transmission: 0.04,
      clearcoat: 0.7,
      clearcoatRoughness: 0.18
    });

  const river = new THREE.Mesh(
    new THREE.PlaneGeometry(
      26,
      200,
      1,
      24
    ),
    riverMat
  );

  river.rotation.x = -Math.PI / 2;
  river.position.set(
    -34,
    -0.9,
    18
  );

  group.add(river);

  // Distant mountain range — pushed further back behind the tunnel
  // massif, smoother silhouettes, and a muted, desaturated color so
  // it reads as atmospheric background rather than a foreground shape.
  const mountainMat =
    new THREE.MeshStandardMaterial({
      color: 0x565f61,
      roughness: 1,
      flatShading: true
    });

  const mountainCount = _tier === 'low' ? 10 : 16;

  for (
    let i = 0;
    i < mountainCount;
    i++
  ) {
    const h =
      18 +
      Math.sin(i * 1.7) * 7 +
      (i % 3) * 3;

    const mountain = new THREE.Mesh(
      new THREE.ConeGeometry(
        15 + (i % 4) * 3.5,
        h,
        8
      ),
      mountainMat
    );

    mountain.position.set(
      -70 + i * 9.2,
      h * 0.5 - 1.6,
      TUNNEL_Z - 35 - (i % 3) * 18
    );

    mountain.rotation.y =
      i * 0.27;

    group.add(mountain);
  }

  _buildTrees(group);

  _scene.add(group);
}

/* ============================================================
   TREES
   ------------------------------------------------------------
   Flat-shaded, non-uniformly-scaled icosahedrons read as
   natural canopy silhouettes instead of perfect toy-balloon
   spheres, while staying cheap (single low-poly geometry,
   shared materials, no per-frame cost).
   ============================================================ */

function _buildTrees(parent) {
  const trunkMat =
    new THREE.MeshStandardMaterial({
      color: 0x4b3324,
      roughness: 1
    });

  const leafMat =
    new THREE.MeshStandardMaterial({
      color: 0x3b543f,
      roughness: 0.95,
      flatShading: true
    });

  const leafMat2 =
    new THREE.MeshStandardMaterial({
      color: 0x49604a,
      roughness: 0.95,
      flatShading: true
    });

  const treeCount = _tier === 'low' ? 34 : 70;

  for (
    let i = 0;
    i < treeCount;
    i++
  ) {
    const tree = new THREE.Group();

    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(
        0.12,
        0.22,
        1.8,
        8
      ),
      trunkMat
    );

    trunk.position.y = 0.9;

    tree.add(trunk);

    const foliage = new THREE.Mesh(
      new THREE.IcosahedronGeometry(
        0.95 + (i % 4) * 0.16,
        1
      ),
      i % 2
        ? leafMat
        : leafMat2
    );

    foliage.position.y = 2.0;

    // Irregular, non-uniform scale per axis so no two canopies
    // read as an identical perfect sphere.
    foliage.scale.set(
      0.85 + (i % 5) * 0.07,
      0.9 + (i % 3) * 0.15,
      0.8 + ((i * 3) % 5) * 0.08
    );

    foliage.rotation.y = (i * 0.71) % Math.PI;

    tree.add(foliage);

    const side =
      i % 2 === 0
        ? -1
        : 1;

    // Keep tree rows set back from the immediate trackside so they
    // read as a natural tree line rather than foreground clutter.
    tree.position.set(
      side *
      (16 + (i % 8) * 4.2),
      -0.65,
      -75 + i * 2.45
    );

    tree.rotation.y =
      (i * 1.73) % Math.PI;

    const scale =
      0.75 +
      (i % 5) * 0.12;

    tree.scale.setScalar(scale);

    parent.add(tree);
  }
}

/* ============================================================
   TUNNEL
   ------------------------------------------------------------
   Rebuilt from scratch as an actual rock massif with a real
   arch-shaped bore cut through it, rather than a flat dark
   rectangle. Positioned at TUNNEL_Z, which sits ON the train's
   negative-z travel path (previously the tunnel sat at +72
   while the journey only ever moved the train toward negative
   z, so it was physically unreachable).

   Technique: an ExtrudeGeometry shape whose outer boundary is
   an irregular rock silhouette, with an arch-shaped hole
   punched through it, extruded along the track direction. That
   produces genuine depth through solid rock rather than a
   painted-on opening.
   ============================================================ */

function _buildTunnel() {
  const group = new THREE.Group();

  const rockMat =
    new THREE.MeshStandardMaterial({
      color: 0x655e52,
      roughness: 1,
      flatShading: true
    });

  const portalMat =
    new THREE.MeshStandardMaterial({
      color: 0x3c3a36,
      roughness: 0.82,
      metalness: 0.05
    });

  const archHalfWidth = 4.0;
  const archWallHeight = 4.5;
  const archRadius = 4.0;
  const GROUND_Y = -0.4;

  // --- outer rock massif silhouette (irregular, not a box) -------
  const outer = new THREE.Shape();
  outer.moveTo(-16, 0);
  outer.lineTo(-15.2, 5.2);
  outer.lineTo(-12.6, 10.4);
  outer.lineTo(-9, 15);
  outer.lineTo(-4, 19.2);
  outer.lineTo(1, 21.8);
  outer.lineTo(6, 19.8);
  outer.lineTo(10.6, 15.6);
  outer.lineTo(13.6, 10.6);
  outer.lineTo(15.2, 5.1);
  outer.lineTo(16, 0);
  outer.lineTo(-16, 0);

  // --- arch-shaped hole bored through the massif ------------------
  const archHole = new THREE.Path();
  archHole.moveTo(-archHalfWidth, 0);
  archHole.lineTo(-archHalfWidth, archWallHeight);
  archHole.absarc(0, archWallHeight, archRadius, Math.PI, 0, true);
  archHole.lineTo(archHalfWidth, 0);
  archHole.lineTo(-archHalfWidth, 0);

  outer.holes.push(archHole);

  const bore = TUNNEL_HALF_DEPTH * 2;

  const massifGeo = new THREE.ExtrudeGeometry(outer, {
    depth: bore,
    bevelEnabled: false,
    curveSegments: _tier === 'low' ? 8 : 16
  });

  const massif = new THREE.Mesh(massifGeo, rockMat);

  massif.position.set(0, GROUND_Y, TUNNEL_BACK_Z);
  massif.castShadow = true;
  massif.receiveShadow = true;

  group.add(massif);

  // --- built portal frame at the entrance face ---------------------
  const portalRing = new THREE.Mesh(
    new THREE.TorusGeometry(archRadius + 0.35, 0.3, 8, 24, Math.PI),
    portalMat
  );

  portalRing.rotation.z = Math.PI;
  portalRing.position.set(0, GROUND_Y + archWallHeight, TUNNEL_ENTRANCE_Z + 0.15);
  group.add(portalRing);

  for (const side of [-1, 1]) {
    const jamb = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, archWallHeight + 0.3, 0.5),
      portalMat
    );

    jamb.position.set(
      side * (archHalfWidth + 0.35),
      GROUND_Y + (archWallHeight + 0.3) / 2,
      TUNNEL_ENTRANCE_Z + 0.15
    );

    jamb.castShadow = true;
    group.add(jamb);
  }

  const header = new THREE.Mesh(
    new THREE.BoxGeometry(archHalfWidth * 2 + 1.4, 0.6, 0.6),
    portalMat
  );

  header.position.set(0, GROUND_Y + archWallHeight + 0.3, TUNNEL_ENTRANCE_Z + 0.15);
  header.castShadow = true;
  group.add(header);

  // --- dark interior cap so the bore doesn't look hollow/see-through
  const capShape = new THREE.Shape();
  capShape.moveTo(-archHalfWidth * 0.97, 0);
  capShape.lineTo(-archHalfWidth * 0.97, archWallHeight * 0.98);
  capShape.absarc(0, archWallHeight * 0.98, archRadius * 0.97, Math.PI, 0, true);
  capShape.lineTo(archHalfWidth * 0.97, 0);
  capShape.lineTo(-archHalfWidth * 0.97, 0);

  const cap = new THREE.Mesh(
    new THREE.ShapeGeometry(capShape, 16),
    new THREE.MeshBasicMaterial({ color: 0x020202 })
  );

  cap.position.set(0, GROUND_Y, TUNNEL_BACK_Z + 1.4);
  group.add(cap);

  // --- scattered rock detail around the entrance, kept minimal -----
  const rockDetailMat = new THREE.MeshStandardMaterial({
    color: 0x5c564b,
    roughness: 1,
    flatShading: true
  });

  for (let i = 0; i < (_tier === 'low' ? 4 : 8); i++) {
    const rock = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.5 + (i % 3) * 0.35, 0),
      rockDetailMat
    );

    const side = i % 2 === 0 ? -1 : 1;

    rock.position.set(
      side * (archHalfWidth + 1.2 + (i % 3) * 1.6),
      GROUND_Y + 0.3,
      TUNNEL_ENTRANCE_Z - 1 - i * 1.3
    );

    rock.rotation.set(i * 0.6, i * 1.1, i * 0.3);
    rock.castShadow = true;
    rock.receiveShadow = true;

    group.add(rock);
  }

  // --- warm tunnel lights, intensity falling off with depth --------
  for (let z = TUNNEL_ENTRANCE_Z - 1.5; z >= TUNNEL_BACK_Z + 1.5; z -= 3) {
    const depthFactor = 1 - Math.abs(z - TUNNEL_ENTRANCE_Z) / bore;

    const light = new THREE.PointLight(
      0xffbd78,
      0.55 + depthFactor * 0.65,
      8.5
    );

    light.position.set(0, GROUND_Y + 2.6, z);
    group.add(light);
  }

  _scene.add(group);
}

/* ============================================================
   REAL WAP-7 TRAIN
   ============================================================ */

function _buildTrain() {
  _train = new THREE.Group();

  _train.name =
    'OUTLIERS_REAL_WAP7_TRAIN';

  /*
   * The important part:
   * We load the supplied GLTF model instead of creating
   * a fake locomotive from boxes/cylinders.
   */
  _loader.load(
    ASSET,

    (gltf) => {
      _trainModel = gltf.scene;

      _prepareTrainModel(
        _trainModel
      );

      _train.add(
        _trainModel
      );

      /*
       * The downloaded model may have a different
       * coordinate orientation/scale, so normalize it
       * automatically from its bounding box.
       */
      _fitTrainToScene(
        _trainModel
      );

      // Put the real locomotive in the hero position.
      _train.position.set(
        0,
        -0.1,
        -2.5
      );

      _train.rotation.y =
        Math.PI;

      _scene.add(_train);

      _createTrainDetails();

      _createHeadlights();

      _setTrainReady();
    },

    (progress) => {
      // Loading progress is intentionally silent.
      // The page can remain visually usable while the
      // actual GLTF asset is being downloaded.
      if (
        progress &&
        progress.total
      ) {
        const percent =
          progress.loaded /
          progress.total *
          100;

        _train.userData.loadProgress =
          percent;
      }
    },

    (error) => {
      console.error(
        '[OUTLIERS] WAP-7 GLTF failed to load:',
        error
      );

      _train.userData.loadError = true;

      /*
       * Deliberately DO NOT create a cartoon fallback.
       * If the real asset fails, we want the error visible
       * in the console rather than silently replacing it
       * with an unrealistic train.
       */
    }
  );

  _scene.add(_train);
}
/* ============================================================
   TRAIN MODEL PREPARATION
   ============================================================ */

function _prepareTrainModel(model) {
  model.traverse((object) => {
    if (!object.isMesh) return;

    object.castShadow = true;
    object.receiveShadow = true;

    // Auto-detect wheel/bogie meshes by name so the animation
    // loop has real geometry to rotate, without ever fabricating
    // replacement geometry for the real GLTF.
    if (/wheel|bogie|axle/i.test(object.name)) {
      _wheels.push(object);
    }

    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material];

    materials.forEach((material) => {
      if (!material) return;

      if (material.map) {
        material.map.colorSpace =
          THREE.SRGBColorSpace;

        if (_renderer) {
          material.map.anisotropy =
            Math.min(
              8,
              _renderer.capabilities.getMaxAnisotropy()
            );
        }

        material.map.needsUpdate = true;
      }

      if (
        material.normalMap &&
        material.normalMap.colorSpace !== undefined
      ) {
        material.normalMap.colorSpace =
          THREE.LinearSRGBColorSpace;
      }

      if ("roughness" in material) {
        material.roughness =
          Math.max(
            0.28,
            Math.min(
              0.82,
              material.roughness ?? 0.55
            )
          );
      }

      if ("metalness" in material) {
        material.metalness =
          Math.max(
            0,
            Math.min(
              1,
              material.metalness ?? 0.25
            )
          );
      }

      material.needsUpdate = true;
    });
  });
}


/* ============================================================
   FIT REAL GLTF MODEL
   ============================================================ */

function _fitTrainToScene(model) {
  const originalBox =
    new THREE.Box3().setFromObject(model);

  const originalSize =
    new THREE.Vector3();

  const originalCenter =
    new THREE.Vector3();

  originalBox.getSize(
    originalSize
  );

  originalBox.getCenter(
    originalCenter
  );

  /*
   * Automatically determine the model's
   * longest horizontal dimension.
   *
   * This prevents the GLTF from appearing
   * microscopic or enormous.
   */
  const horizontalLength =
    Math.max(
      originalSize.x,
      originalSize.z
    );

  if (
    horizontalLength > 0.001
  ) {
    const targetLength = 18;

    const scale =
      targetLength /
      horizontalLength;

    model.scale.multiplyScalar(
      scale
    );
  }

  /*
   * Recalculate bounds after scaling.
   */
  const box =
    new THREE.Box3().setFromObject(
      model
    );

  const center =
    new THREE.Vector3();

  box.getCenter(center);

  /*
   * Center the actual GLTF model.
   */
  model.position.x -=
    center.x;

  model.position.z -=
    center.z;

  /*
   * Place wheels/body naturally above
   * the railway track.
   */
  const finalBox =
    new THREE.Box3().setFromObject(
      model
    );

  model.position.y +=
    -finalBox.min.y +
    0.08;

  /*
   * Preserve original proportions.
   * No artificial stretching.
   */
}


/* ============================================================
   TRAIN DETAILS
   ============================================================ */

function _createTrainDetails() {
  if (!_trainModel) return;

  /*
   * Very subtle metal coupler.
   * This is supplementary geometry only;
   * the actual locomotive remains the GLTF.
   */

  const metal =
    new THREE.MeshStandardMaterial({
      color: 0x17191b,
      metalness: 0.88,
      roughness: 0.32
    });

  const coupler =
    new THREE.Mesh(
      new THREE.BoxGeometry(
        0.34,
        0.26,
        0.48
      ),
      metal
    );

  coupler.position.set(
    0,
    0.02,
    -9.15
  );

  coupler.castShadow = true;

  _trainModel.add(
    coupler
  );

  /*
   * Small underbody shadow mass.
   * Helps the locomotive sit naturally
   * on the rails.
   */
  const underbody =
    new THREE.Mesh(
      new THREE.BoxGeometry(
        1.7,
        0.12,
        7.0
      ),
      new THREE.MeshStandardMaterial({
        color: 0x111315,
        metalness: 0.45,
        roughness: 0.62
      })
    );

  underbody.position.set(
    0,
    -0.68,
    0
  );

  underbody.castShadow = true;

  _trainModel.add(
    underbody
  );
}


/* ============================================================
   REALISTIC HEADLIGHTS
   ============================================================ */

function _createHeadlights() {
  if (!_trainModel) return;

  const lensMaterial =
    new THREE.MeshStandardMaterial({
      color: 0xfff1c9,
      emissive: 0xffb54d,
      emissiveIntensity: 2.8,
      metalness: 0.05,
      roughness: 0.18
    });

  /*
   * The model's front is normalized toward
   * negative Z by the scene composition.
   */
  const leftLens =
    new THREE.Mesh(
      new THREE.SphereGeometry(
        0.115,
        20,
        14
      ),
      lensMaterial
    );

  const rightLens =
    new THREE.Mesh(
      new THREE.SphereGeometry(
        0.115,
        20,
        14
      ),
      lensMaterial
    );

  leftLens.position.set(
    -0.42,
    0.38,
    -8.96
  );

  rightLens.position.set(
    0.42,
    0.38,
    -8.96
  );

  _trainModel.add(
    leftLens,
    rightLens
  );

  /*
   * Actual illumination.
   */
  _headlightL =
    new THREE.SpotLight(
      0xffe6bd,
      0,
      55,
      Math.PI / 9,
      0.52,
      1.25
    );

  _headlightR =
    new THREE.SpotLight(
      0xffe6bd,
      0,
      55,
      Math.PI / 9,
      0.52,
      1.25
    );

  _headlightL.position.set(
    -0.42,
    0.38,
    -9.02
  );

  _headlightR.position.set(
    0.42,
    0.38,
    -9.02
  );

  const targetL =
    new THREE.Object3D();

  const targetR =
    new THREE.Object3D();

  targetL.position.set(
    -0.42,
    0.1,
    -42
  );

  targetR.position.set(
    0.42,
    0.1,
    -42
  );

  _trainModel.add(
    _headlightL,
    _headlightR,
    targetL,
    targetR
  );

  _headlightL.target =
    targetL;

  _headlightR.target =
    targetR;
}


/* ============================================================
   TRAIN READY STATE
   ============================================================ */

function _setTrainReady() {
  if (!_train) return;

  _train.userData.ready =
    true;

  _train.userData.interactive =
    true;

  /*
   * Headlights remain off until hover/click.
   */
  if (_headlightL)
    _headlightL.intensity = 0;

  if (_headlightR)
    _headlightR.intensity = 0;

  /*
   * Make sure the real model is visible.
   */
  _train.visible = true;

  console.info(
    '[OUTLIERS] REALISTIC WAP-7 READY'
  );
}


/* ============================================================
   POINTER INTERACTION
   ============================================================ */

function onPointerMove(event) {
  if (!_canvas) return;

  const rect =
    _canvas.getBoundingClientRect();

  if (
    rect.width <= 0 ||
    rect.height <= 0
  ) {
    return;
  }

  _mouse.x =
    (
      (event.clientX - rect.left) /
      rect.width
    ) * 2 - 1;

  _mouse.y =
    -(
      (event.clientY - rect.top) /
      rect.height
    ) * 2 + 1;
}


function onClick() {
  if (
    !_hovered ||
    _moving ||
    !_onTrainClick
  ) {
    return;
  }

  _onTrainClick();
}


function onTouch() {
  if (
    _moving ||
    !_onTrainClick
  ) {
    return;
  }

  /*
   * Mobile users should be able to start
   * the train journey with a simple tap.
   */
  _onTrainClick();
}


/* ============================================================
   JOURNEY
   ------------------------------------------------------------
   Retimed so the train's path actually intersects the tunnel:
   entrance face sits at TUNNEL_ENTRANCE_Z, back face at
   TUNNEL_BACK_Z. The train now travels past the entrance and
   well into the bore by the end of the sequence, instead of
   stopping short of a tunnel it could never reach.
   ============================================================ */

function startJourney(
  onProgressCallback
) {
  if (
    _moving ||
    !_train
  ) {
    return;
  }

  if (
    !_trainModel
  ) {
    console.warn(
      '[OUTLIERS] Real WAP-7 is still loading.'
    );

    return;
  }

  _moving = true;

  _hovered = false;

  document.body.style.cursor =
    'default';

  const gsap =
    window.gsap;

  if (!gsap) {
    console.error(
      '[OUTLIERS] GSAP is not available.'
    );

    return;
  }

  /*
   * Headlights power up as the train starts.
   */
  if (
    _headlightL &&
    _headlightR
  ) {
    gsap.to(
      [_headlightL, _headlightR],
      {
        intensity: 6,
        duration: 1.1,
        ease: 'power2.out'
      }
    );
  }

  /*
   * Main cinematic sequence.
   */
  const timeline =
    gsap.timeline({
      onComplete: () => {
        _moving = false;

        if (
          onProgressCallback
        ) {
          onProgressCallback(
            'complete'
          );
        }
      }
    });

  /*
   * SHOT 1
   * Slow realistic departure.
   */
  timeline.to(
    _train.position,
    {
      z: -15,
      duration: 4.0,
      ease: 'power1.in'
    },
    0
  );

  timeline.to(
    _camera.position,
    {
      x: -10.5,
      y: 3.2,
      z: 7.0,
      duration: 4.0,
      ease: 'power1.inOut'
    },
    0
  );

  /*
   * SHOT 2
   * Wider environmental reveal.
   */
  timeline.to(
    _train.position,
    {
      z: -38,
      duration: 4.5,
      ease: 'power1.inOut'
    },
    4
  );

  timeline.to(
    _camera.position,
    {
      x: -15.5,
      y: 6.2,
      z: -5,
      duration: 4.5,
      ease: 'power2.inOut'
    },
    4
  );

  /*
   * SHOT 3
   * Side-following railway shot, mountains now clearly visible.
   */
  timeline.to(
    _train.position,
    {
      z: -61,
      duration: 4.0,
      ease: 'power1.in'
    },
    8.5
  );

  timeline.to(
    _camera.position,
    {
      x: -7.5,
      y: 3.0,
      z: -39,
      duration: 4.0,
      ease: 'power2.inOut'
    },
    8.5
  );

  /*
   * SHOT 4
   * Tunnel approach — train closes in on TUNNEL_ENTRANCE_Z (-117).
   */
  timeline.to(
    _train.position,
    {
      z: -100,
      duration: 3.2,
      ease: 'power1.in'
    },
    12.5
  );

  timeline.to(
    _camera.position,
    {
      x: -4.2,
      y: 2.45,
      z: -80,
      duration: 3.2,
      ease: 'power1.inOut'
    },
    12.5
  );

  /*
   * Darkness begins as the entrance nears.
   */
  timeline.to(
    _ambient,
    {
      intensity: 0.11,
      duration: 1.5
    },
    14.0
  );

  timeline.to(
    _hemi,
    {
      intensity: 0.14,
      duration: 1.5
    },
    14.0
  );

  timeline.to(
    _sun,
    {
      intensity: 0.08,
      duration: 1.5
    },
    14.0
  );

  /*
   * Headlights become dominant.
   */
  timeline.to(
    [_headlightL, _headlightR],
    {
      intensity: 11,
      duration: 1.3,
      ease: 'power2.out'
    },
    14.0
  );

  /*
   * SHOT 5
   * Cross the entrance and travel into the bore.
   */
  timeline.to(
    _train.position,
    {
      z: -140,
      duration: 4.0,
      ease: 'power1.in'
    },
    15.7
  );

  timeline.to(
    _camera.position,
    {
      x: -2.8,
      y: 2.0,
      z: -105,
      duration: 4.0,
      ease: 'power1.inOut'
    },
    15.7
  );

  /*
   * Tunnel notification — fires just as the train reaches the portal.
   */
  timeline.call(
    () => {
      if (
        onProgressCallback
      ) {
        onProgressCallback(
          'tunnel'
        );
      }
    },
    [],
    16.6
  );

  /*
   * Final movement deep into the bore / darkness.
   */
  timeline.to(
    _train.position,
    {
      z: -165,
      duration: 4.0,
      ease: 'none'
    },
    19.7
  );

  /*
   * Camera holds back near the portal, watching the train
   * disappear into the mountain rather than clipping through rock.
   */
  timeline.to(
    _camera.position,
    {
      x: -1.2,
      y: 1.9,
      z: -120,
      duration: 4.0,
      ease: 'power1.in'
    },
    19.7
  );

  /*
   * Every frame keeps the cinematic camera
   * aimed toward the actual moving locomotive.
   */
  timeline.eventCallback(
    'onUpdate',
    () => {
      if (
        !_camera ||
        !_train
      ) {
        return;
      }

      const target =
        new THREE.Vector3(
          _train.position.x,
          1.0,
          _train.position.z - 3.5
        );

      _camera.lookAt(
        target
      );

      if (
        onProgressCallback
      ) {
        if (
          _train.position.z < -20 &&
          _journeyProgress < 1
        ) {
          _journeyProgress = 1;

          onProgressCallback(
            'journey'
          );
        }

        if (
          _train.position.z < -65 &&
          _journeyProgress < 2
        ) {
          _journeyProgress = 2;

          onProgressCallback(
            'approach'
          );
        }
      }
    }
  );
}


/* ============================================================
   SUNLIGHT MODE
   ============================================================ */

function setSunlightMode(
  enabled
) {
  if (
    !enabled ||
    !window.gsap
  ) {
    return;
  }

  const gsap =
    window.gsap;

  gsap.to(
    _ambient,
    {
      intensity: 0.52,
      duration: 2
    }
  );

  gsap.to(
    _hemi,
    {
      intensity: 0.7,
      duration: 2
    }
  );

  gsap.to(
    _sun,
    {
      intensity: 2.55,
      duration: 2
    }
  );

  if (
    _headlightL &&
    _headlightR
  ) {
    gsap.to(
      [_headlightL, _headlightR],
      {
        intensity: 2.8,
        duration: 2
      }
    );
  }

  gsap.to(
    _camera.position,
    {
      x: -7.2,
      y: 4.1,
      z: 11.5,
      duration: 3.5,
      ease: 'power2.inOut'
    }
  );

  gsap.to(
    _train.position,
    {
      z: -16,
      duration: 4,
      ease: 'power1.out'
    }
  );
}
/* ============================================================
   RENDER LOOP
   ============================================================ */

function animate() {
  if (!_renderer || !_scene || !_camera) {
    return;
  }

  _raf = requestAnimationFrame(animate);

  const delta = Math.min(
    _clock ? _clock.getDelta() : 0.016,
    0.05
  );

  _elapsed += delta;

  /*
   * ----------------------------------------------------------
   * REALISTIC TRAIN MOTION
   * ----------------------------------------------------------
   */

  if (_moving) {
    /*
     * Rotate every detected wheel.
     * This gives the train a physical sense of motion.
     */
    for (const wheel of _wheels) {
      if (!wheel) continue;

      wheel.rotation.x -= delta * 9.5;
    }
  } else {
    /*
     * Very subtle idle mechanical movement.
     * Not exaggerated/cartoonish.
     */
    for (const wheel of _wheels) {
      if (!wheel) continue;

      wheel.rotation.x -= delta * 0.15;
    }
  }

  /*
   * ----------------------------------------------------------
   * HEADLIGHT FLICKER / NATURAL LIGHT RESPONSE
   * ----------------------------------------------------------
   */

  if (
    _headlightL &&
    _headlightR &&
    !_moving
  ) {
    const breathing =
      1.0 +
      Math.sin(_elapsed * 1.8) * 0.035;

    _headlightL.intensity *=
      0.995;

    _headlightR.intensity *=
      0.995;

    /*
     * Don't let the idle light become completely
     * unstable. The multiplication above gives
     * a tiny natural variation.
     */
    if (_headlightL.intensity > 0.01) {
      _headlightL.intensity =
        Math.max(
          0,
          _headlightL.intensity *
          breathing
        );
    }

    if (_headlightR.intensity > 0.01) {
      _headlightR.intensity =
        Math.max(
          0,
          _headlightR.intensity *
          breathing
        );
    }
  }

  /*
   * ----------------------------------------------------------
   * IDLE CAMERA
   * ----------------------------------------------------------
   */

  if (
    _idleOrbit &&
    !_moving &&
    _camera
  ) {
    const radius = 17.0;

    const x =
      -7.5 +
      Math.sin(
        _elapsed * 0.085
      ) * 1.15;

    const y =
      3.35 +
      Math.sin(
        _elapsed * 0.11
      ) * 0.18;

    const z =
      12.5 +
      Math.cos(
        _elapsed * 0.085
      ) * 0.65;

    /*
     * Slow cinematic breathing rather than
     * a game-like spinning camera.
     */
    _camera.position.x =
      THREE.MathUtils.lerp(
        _camera.position.x,
        x,
        0.012
      );

    _camera.position.y =
      THREE.MathUtils.lerp(
        _camera.position.y,
        y,
        0.012
      );

    _camera.position.z =
      THREE.MathUtils.lerp(
        _camera.position.z,
        z,
        0.012
      );

    const target =
      new THREE.Vector3(
        0,
        1.15,
        -1.7
      );

    _camera.lookAt(target);
  }

  /*
   * ----------------------------------------------------------
   * HOVER EFFECT
   * ----------------------------------------------------------
   */

  updateHover();

  /*
   * ----------------------------------------------------------
   * RENDER
   * ----------------------------------------------------------
   */

  _renderer.render(
    _scene,
    _camera
  );
}


/* ============================================================
   HOVER DETECTION
   ============================================================ */

function updateHover() {
  if (
    !_renderer ||
    !_scene ||
    !_camera ||
    !_train
  ) {
    return;
  }

  /*
   * While the train is moving we don't want
   * click interactions.
   */
  if (_moving) {
    if (_hovered) {
      _hovered = false;

      if (_canvas) {
        _canvas.style.cursor =
          'default';
      }
    }

    return;
  }

  _raycaster.setFromCamera(
    _mouse,
    _camera
  );

  const intersections =
    _raycaster.intersectObject(
      _train,
      true
    );

  const nextHovered =
    intersections.length > 0 &&
    !_train.userData.loadError;

  if (
    nextHovered !== _hovered
  ) {
    _hovered =
      nextHovered;

    if (_canvas) {
      _canvas.style.cursor =
        _hovered
          ? 'pointer'
          : 'default';
    }

    /*
     * Subtle scale feedback.
     * No cartoon bounce.
     */
    if (
      window.gsap &&
      _train
    ) {
      window.gsap.killTweensOf(
        _train.scale
      );

      window.gsap.to(
        _train.scale,
        {
          x: _hovered
            ? 1.012
            : 1,
          y: _hovered
            ? 1.012
            : 1,
          z: _hovered
            ? 1.012
            : 1,
          duration: 0.28,
          ease: 'power2.out'
        }
      );
    }
  }
}


/* ============================================================
   RESIZE
   ============================================================ */

function resize() {
  if (
    !_renderer ||
    !_camera ||
    !_canvas
  ) {
    return;
  }

  const width =
    _canvas.clientWidth ||
    window.innerWidth;

  const height =
    _canvas.clientHeight ||
    window.innerHeight;

  if (
    width <= 0 ||
    height <= 0
  ) {
    return;
  }

  _camera.aspect =
    width / height;

  _camera.updateProjectionMatrix();

  _renderer.setSize(
    width,
    height,
    false
  );
}


/* ============================================================
   IDLE ORBIT
   ============================================================ */

export function setIdleOrbit(
  enabled
) {
  _idleOrbit =
    Boolean(enabled);
}


/* ============================================================
   PUBLIC SCENE OBJECTS
   ============================================================ */

export function getSceneObjects() {
  return {
    renderer: _renderer,
    scene: _scene,
    camera: _camera,
    train: _train,
    trainModel: _trainModel,
    wheels: _wheels,
    headlightL: _headlightL,
    headlightR: _headlightR
  };
}


/* ============================================================
   PUBLIC JOURNEY API
   ============================================================ */

export function triggerTrainJourney(
  callback
) {
  startJourney(callback);
}


/* ============================================================
   DISPOSE
   ============================================================ */

export function disposeScene() {
  if (_raf) {
    cancelAnimationFrame(
      _raf
    );

    _raf = null;
  }

  if (_canvas) {
    if (_moveHandler) {
      _canvas.removeEventListener(
        'mousemove',
        _moveHandler
      );
    }

    if (_clickHandler) {
      _canvas.removeEventListener(
        'click',
        _clickHandler
      );
    }

    if (_touchHandler) {
      _canvas.removeEventListener(
        'touchend',
        _touchHandler
      );
    }
  }

  if (_resizeHandler) {
    window.removeEventListener(
      'resize',
      _resizeHandler
    );
  }

  /*
   * Dispose all scene resources.
   */
  if (_scene) {
    _scene.traverse(
      (object) => {
        if (!object.isMesh) {
          return;
        }

        if (object.geometry) {
          object.geometry.dispose();
        }

        if (object.material) {
          const materials =
            Array.isArray(
              object.material
            )
              ? object.material
              : [object.material];

          for (
            const material
            of materials
          ) {
            disposeMaterial(
              material
            );
          }
        }
      }
    );
  }

  if (_renderer) {
    _renderer.dispose();

    _renderer.forceContextLoss?.();
  }

  _renderer = null;
  _scene = null;
  _camera = null;
  _clock = null;
  _canvas = null;

  _train = null;
  _trainModel = null;

  _headlightL = null;
  _headlightR = null;

  _sun = null;
  _hemi = null;
  _ambient = null;

  _stationLights = [];
  _wheels = [];

  _moving = false;
  _hovered = false;
  _elapsed = 0;
  _journeyProgress = 0;

  _onTrainClick = null;

  _mouse.set(
    -99,
    -99
  );
}


/* ============================================================
   MATERIAL DISPOSAL
   ============================================================ */

function disposeMaterial(
  material
) {
  if (!material) return;

  /*
   * Dispose textures referenced by the material.
   */
  const textureKeys = [
    'map',
    'alphaMap',
    'aoMap',
    'bumpMap',
    'displacementMap',
    'emissiveMap',
    'envMap',
    'lightMap',
    'metalnessMap',
    'normalMap',
    'roughnessMap',
    'clearcoatMap',
    'clearcoatNormalMap',
    'clearcoatRoughnessMap',
    'sheenColorMap',
    'sheenRoughnessMap',
    'specularMap',
    'transmissionMap'
  ];

  for (
    const key of textureKeys
  ) {
    const texture =
      material[key];

    if (
      texture &&
      texture.dispose
    ) {
      texture.dispose();
    }
  }

  material.dispose();
}


/* ============================================================
   DEBUG HELPERS
   ============================================================ */

function getTrainStatus() {
  return {
    exists:
      Boolean(_train),

    modelLoaded:
      Boolean(_trainModel),

    moving:
      _moving,

    hovered:
      _hovered,

    loadError:
      Boolean(
        _train?.userData?.loadError
      )
  };
}


/*
 * Expose a tiny debug object in development.
 *
 * This is intentionally harmless and makes it much easier
 * to diagnose GLTF loading from the browser console.
 */
if (
  typeof window !== 'undefined'
) {
  window.OUTLIERS_SCENE =
  {
    status:
      getTrainStatus,

    getObjects:
      getSceneObjects,

    start:
      () => startJourney(),

    sunlight:
      setSunlightMode
  };
}