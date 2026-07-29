/**
 * 3D ステージ（レンダラ / カメラ / ライト / チェス盤）のセットアップ。
 */

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { SIZE, isLightTile, allTiles } from "../core/board.js";

export const TILE = 1;
export const BOARD_HALF = (SIZE * TILE) / 2;

export const COLORS = {
  player: 0x5ad2ff,
  enemy: 0xff6b6b,
  tileLight: 0xd9d3c4,
  tileDark: 0x394358,
  frame: 0x1b2133,
  bg: 0x0a0d16,
};

/** 盤上の座標 -> ワールド座標 */
export function worldOf(tile, y = 0) {
  return new THREE.Vector3(
    (tile.c - (SIZE - 1) / 2) * TILE,
    y,
    (tile.r - (SIZE - 1) / 2) * TILE,
  );
}

function makeBackgroundTexture() {
  const cv = document.createElement("canvas");
  cv.width = 32;
  cv.height = 256;
  const ctx = cv.getContext("2d");
  const grd = ctx.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, "#131b33");
  grd.addColorStop(0.45, "#0b1020");
  grd.addColorStop(1, "#04060d");
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, 32, 256);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 盤の下に敷く柔らかい光の円（接地感を出す） */
function makeGlowDisc() {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 256;
  const ctx = cv.getContext("2d");
  const g = ctx.createRadialGradient(128, 128, 10, 128, 128, 128);
  g.addColorStop(0, "rgba(90,140,220,0.55)");
  g.addColorStop(0.5, "rgba(60,90,160,0.18)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;

  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(26, 26),
    new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = -0.24;
  return mesh;
}

function buildBoard() {
  const board = new THREE.Group();
  const tileMeshes = [];

  const tileGeo = new THREE.BoxGeometry(TILE * 0.985, 0.16, TILE * 0.985);
  const lightMat = new THREE.MeshStandardMaterial({
    color: COLORS.tileLight,
    roughness: 0.72,
    metalness: 0.05,
  });
  const darkMat = new THREE.MeshStandardMaterial({
    color: COLORS.tileDark,
    roughness: 0.6,
    metalness: 0.16,
  });

  for (const t of allTiles()) {
    const mesh = new THREE.Mesh(tileGeo, isLightTile(t.c, t.r) ? lightMat : darkMat);
    const p = worldOf(t);
    mesh.position.set(p.x, -0.08, p.z);
    mesh.receiveShadow = true;
    mesh.userData.tile = t;
    board.add(mesh);
    tileMeshes.push(mesh);
  }

  // 外枠
  const frameMat = new THREE.MeshStandardMaterial({
    color: COLORS.frame,
    roughness: 0.42,
    metalness: 0.45,
  });
  const outer = SIZE * TILE + 1.0;
  const frame = new THREE.Mesh(new THREE.BoxGeometry(outer, 0.34, outer), frameMat);
  frame.position.y = -0.18;
  frame.receiveShadow = true;
  board.add(frame);

  // 枠の縁取り（発光ライン）
  const edgeMat = new THREE.LineBasicMaterial({ color: 0x6f9fe0, transparent: true, opacity: 0.7 });
  const e = BOARD_HALF + 0.12;
  const edge = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-e, 0.02, -e),
      new THREE.Vector3(e, 0.02, -e),
      new THREE.Vector3(e, 0.02, e),
      new THREE.Vector3(-e, 0.02, e),
    ]),
    edgeMat,
  );
  board.add(edge);

  return { board, tileMeshes };
}

/** マスのハイライト板（64枚を使い回す） */
function buildHighlights(parent) {
  const geo = new THREE.PlaneGeometry(TILE * 0.9, TILE * 0.9);
  const meshes = new Map();
  for (const t of allTiles()) {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    const m = new THREE.Mesh(geo, mat);
    const p = worldOf(t);
    m.position.set(p.x, 0.015, p.z);
    m.rotation.x = -Math.PI / 2;
    m.renderOrder = 2;
    m.visible = false;
    parent.add(m);
    meshes.set(`${t.c},${t.r}`, m);
  }
  return meshes;
}

export function createStage(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;

  const scene = new THREE.Scene();
  scene.background = makeBackgroundTexture();
  scene.fog = new THREE.Fog(COLORS.bg, 22, 44);

  const camera = new THREE.PerspectiveCamera(44, 1, 0.1, 120);
  camera.position.set(0, 9.2, -10.2);

  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 0.2, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.075;
  controls.enablePan = false;
  controls.minDistance = 7.5;
  controls.maxDistance = 22;
  controls.minPolarAngle = 0.18;
  controls.maxPolarAngle = 1.32;
  controls.rotateSpeed = 0.72;
  // 右ドラッグでも回転させる（パンは無効なので割り当てを変えておく）
  controls.mouseButtons = {
    LEFT: THREE.MOUSE.ROTATE,
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT: THREE.MOUSE.ROTATE,
  };
  controls.update();

  // --- ライト ---
  scene.add(new THREE.HemisphereLight(0x9fc4ff, 0x0e1220, 0.75));
  scene.add(new THREE.AmbientLight(0xffffff, 0.18));

  const key = new THREE.DirectionalLight(0xfff2d8, 2.1);
  key.position.set(6.5, 13, -5.5);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 40;
  const d = 8.5;
  Object.assign(key.shadow.camera, { left: -d, right: d, top: d, bottom: -d });
  key.shadow.camera.updateProjectionMatrix();
  key.shadow.bias = -0.0009;
  key.shadow.normalBias = 0.02;
  scene.add(key);

  const fill = new THREE.DirectionalLight(0x8fb6ff, 0.55);
  fill.position.set(-7, 6, 7);
  scene.add(fill);

  // 陣営カラーのリムライト
  const allyRim = new THREE.PointLight(COLORS.player, 18, 15, 2);
  allyRim.position.set(0, 2.6, -6.2);
  scene.add(allyRim);
  const enemyRim = new THREE.PointLight(COLORS.enemy, 18, 15, 2);
  enemyRim.position.set(0, 2.6, 6.2);
  scene.add(enemyRim);

  // --- 盤 ---
  const { board, tileMeshes } = buildBoard();
  scene.add(board);
  scene.add(makeGlowDisc());

  const highlights = buildHighlights(scene);

  // --- ユニットや演出を入れる層 ---
  const unitLayer = new THREE.Group();
  const fxLayer = new THREE.Group();
  scene.add(unitLayer, fxLayer);

  // --- レイキャスト ---
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  /** 画面座標から盤上のマスを取得 */
  function pickTile(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.intersectObjects(tileMeshes, false)[0];
    return hit ? hit.object.userData.tile : null;
  }

  /** 画面座標からユニット（unitLayer の子）を取得 */
  function pickUnit(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(unitLayer.children, true);
    for (const h of hits) {
      let o = h.object;
      while (o && !o.userData.unitRoot) o = o.parent;
      if (o) return o.userData.unitRoot;
    }
    return null;
  }

  /** マスのハイライト表示 */
  function highlight(tiles, color, opacity = 0.32) {
    clearHighlights();
    for (const t of tiles) {
      const m = highlights.get(`${t.c},${t.r}`);
      if (!m) continue;
      m.visible = true;
      m.material.color.setHex(color);
      m.material.opacity = opacity;
    }
  }

  function clearHighlights() {
    for (const m of highlights.values()) {
      m.visible = false;
      m.material.opacity = 0;
    }
  }

  function highlightOne(tile, color, opacity = 0.5) {
    const m = highlights.get(`${tile.c},${tile.r}`);
    if (!m) return;
    m.visible = true;
    m.material.color.setHex(color);
    m.material.opacity = opacity;
  }

  /**
   * 画面比率が変わっても盤全体が収まるように、カメラの最短距離を計算して押し出す。
   * 縦長のスマホでは自動的に引きの画になる。
   */
  function fitCamera() {
    const halfFov = THREE.MathUtils.degToRad(camera.fov) / 2;
    const halfBoard = BOARD_HALF + 0.9; // 枠のぶんの余白
    const needH = halfBoard / (Math.tan(halfFov) * camera.aspect); // 横方向で必要な距離
    const needV = (halfBoard * 0.78) / Math.tan(halfFov); // 傾けて見るぶん縦は短くなる
    const need = Math.min(Math.max(needH, needV), 30);

    // 既定はぴったり収まる距離。寄って見たい人のために少しだけ近づけるようにしておく
    controls.minDistance = Math.max(7.5, need * 0.5);
    controls.maxDistance = Math.max(need * 1.7, 22);

    const offset = camera.position.clone().sub(controls.target);
    if (offset.length() < need) {
      camera.position.copy(controls.target).add(offset.setLength(need));
    }
    controls.update();
  }

  function resize() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    fitCamera();
  }
  window.addEventListener("resize", resize);
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  resize();

  return {
    renderer,
    scene,
    camera,
    controls,
    board,
    unitLayer,
    fxLayer,
    pickTile,
    pickUnit,
    highlight,
    highlightOne,
    clearHighlights,
    resize,
    render: () => {
      controls.update();
      renderer.render(scene, camera);
    },
  };
}
