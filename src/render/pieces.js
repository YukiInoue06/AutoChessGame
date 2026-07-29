/**
 * チェスのコマの 3D モデルを手続き的に生成する。
 *
 * 外部モデルファイルは使わず、回転体（LatheGeometry）＋プリミティブの組み合わせで
 * 6種類のコマをすべて作る。1マス = 1.0 ユニットのスケール。
 */

import * as THREE from "three";

const V2 = (x, y) => new THREE.Vector2(x, y);
const SEG = 32;

function lathe(profile) {
  const g = new THREE.LatheGeometry(profile.map(([x, y]) => V2(x, y)), SEG);
  g.computeVertexNormals();
  return g;
}

/** すべてのコマで共通の台座シルエット */
function baseProfile(r = 0.3) {
  return [
    [0.0, 0.0],
    [r, 0.0],
    [r, 0.05],
    [r * 0.93, 0.075],
    [r * 0.66, 0.11],
    [r * 0.56, 0.15],
  ];
}

/** 円柱状のくびれ（首）を継ぎ足す */
function stem(points, { from, to, rFrom, rTo, waist = 0.82 }) {
  const mid = (from + to) / 2;
  points.push([rFrom, from]);
  points.push([Math.min(rFrom, rTo) * waist, mid]);
  points.push([rTo, to]);
  return points;
}

// ---------------------------------------------------------------- プロファイル

function pawnProfile() {
  const p = baseProfile(0.3);
  stem(p, { from: 0.15, to: 0.4, rFrom: 0.168, rTo: 0.13, waist: 0.72 });
  p.push([0.185, 0.435], [0.2, 0.465], [0.2, 0.5], [0.13, 0.535], [0.115, 0.55], [0.0, 0.55]);
  return p;
}

function rookProfile() {
  const p = baseProfile(0.32);
  stem(p, { from: 0.15, to: 0.5, rFrom: 0.185, rTo: 0.185, waist: 0.86 });
  p.push([0.235, 0.545], [0.245, 0.6], [0.225, 0.63], [0.225, 0.72], [0.0, 0.72]);
  return p;
}

function bishopProfile() {
  const p = baseProfile(0.3);
  stem(p, { from: 0.15, to: 0.42, rFrom: 0.17, rTo: 0.115, waist: 0.66 });
  p.push([0.155, 0.45], [0.165, 0.48], [0.12, 0.51]);
  // 司教帽（ミトラ）
  p.push([0.155, 0.56], [0.175, 0.63], [0.165, 0.72], [0.115, 0.82], [0.05, 0.88], [0.0, 0.9]);
  return p;
}

function knightProfile() {
  const p = baseProfile(0.31);
  stem(p, { from: 0.15, to: 0.36, rFrom: 0.175, rTo: 0.15, waist: 0.78 });
  p.push([0.19, 0.4], [0.19, 0.44], [0.16, 0.47], [0.0, 0.47]);
  return p;
}

function queenProfile() {
  const p = baseProfile(0.32);
  stem(p, { from: 0.15, to: 0.52, rFrom: 0.18, rTo: 0.12, waist: 0.62 });
  p.push([0.17, 0.56], [0.185, 0.6], [0.14, 0.64]);
  // 王冠のカップ
  p.push([0.175, 0.72], [0.215, 0.85], [0.2, 0.89], [0.13, 0.86], [0.0, 0.86]);
  return p;
}

function kingProfile() {
  const p = baseProfile(0.32);
  stem(p, { from: 0.15, to: 0.56, rFrom: 0.18, rTo: 0.125, waist: 0.62 });
  p.push([0.175, 0.6], [0.19, 0.64], [0.145, 0.68]);
  p.push([0.185, 0.76], [0.215, 0.9], [0.2, 0.94], [0.135, 0.91], [0.0, 0.91]);
  return p;
}

// ---------------------------------------------------------------- 装飾パーツ

function addMesh(group, geo, mat, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0 } = {}) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  m.castShadow = true;
  m.receiveShadow = false;
  group.add(m);
  return m;
}

/** ルークの狭間（クレネル） */
function addBattlements(group, mat) {
  const geo = new THREE.BoxGeometry(0.1, 0.11, 0.1);
  const r = 0.175;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    addMesh(group, geo, mat, {
      x: Math.cos(a) * r,
      y: 0.765,
      z: Math.sin(a) * r,
      ry: -a,
    });
  }
}

/** クイーン／キングの王冠の玉 */
function addCoronet(group, mat, y, radius, count, ballR) {
  const geo = new THREE.SphereGeometry(ballR, 14, 10);
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    addMesh(group, geo, mat, {
      x: Math.cos(a) * radius,
      y,
      z: Math.sin(a) * radius,
    });
  }
}

/** ナイトの馬の頭部（箱と円柱の組み合わせ） */
function addHorseHead(group, mat) {
  const head = new THREE.Group();

  // 首
  const neck = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.34, 0.2), mat);
  neck.position.set(0, 0.15, -0.01);
  neck.rotation.x = -0.2;
  head.add(neck);

  // 頭頂〜鼻筋
  const skull = new THREE.Mesh(new THREE.BoxGeometry(0.175, 0.17, 0.26), mat);
  skull.position.set(0, 0.31, 0.06);
  skull.rotation.x = 0.28;
  head.add(skull);

  // マズル
  const muzzle = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.115, 0.19), mat);
  muzzle.position.set(0, 0.3, 0.2);
  muzzle.rotation.x = 0.5;
  head.add(muzzle);

  // 頬
  const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.155, 0.12, 0.15), mat);
  jaw.position.set(0, 0.215, 0.13);
  jaw.rotation.x = -0.15;
  head.add(jaw);

  // たてがみ
  const mane = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.4, 0.13), mat);
  mane.position.set(0, 0.26, -0.13);
  mane.rotation.x = -0.32;
  head.add(mane);

  // 耳
  const earGeo = new THREE.ConeGeometry(0.038, 0.1, 8);
  for (const sx of [-1, 1]) {
    const ear = new THREE.Mesh(earGeo, mat);
    ear.position.set(sx * 0.06, 0.42, -0.01);
    ear.rotation.x = 0.1;
    head.add(ear);
  }

  head.position.y = 0.4;
  head.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });
  group.add(head);
  return head;
}

const PROFILES = {
  pawn: pawnProfile,
  rook: rookProfile,
  bishop: bishopProfile,
  knight: knightProfile,
  queen: queenProfile,
  king: kingProfile,
};

// 生成したジオメトリはコマ種ごとに使い回す。
// userData.shared を立てておき、ユニット破棄時に dispose されないようにする。
const geoCache = new Map();
function bodyGeometry(typeId) {
  if (!geoCache.has(typeId)) geoCache.set(typeId, markShared(lathe(PROFILES[typeId]())));
  return geoCache.get(typeId);
}

function markShared(geo) {
  geo.userData.shared = true;
  return geo;
}

const sharedGeo = {
  get finial() {
    return (sharedGeo._f ??= markShared(new THREE.SphereGeometry(0.075, 16, 12)));
  },
  get crossV() {
    return (sharedGeo._cv ??= markShared(new THREE.BoxGeometry(0.055, 0.2, 0.055)));
  },
  get crossH() {
    return (sharedGeo._ch ??= markShared(new THREE.BoxGeometry(0.15, 0.055, 0.055)));
  },
  get bishopTip() {
    return (sharedGeo._bt ??= markShared(new THREE.SphereGeometry(0.055, 14, 10)));
  },
};

/**
 * コマの 3D モデルを生成する。
 * @param {string} typeId
 * @param {{body: THREE.Material, accent: THREE.Material}} materials
 * @returns {THREE.Group} 原点が足元、+Z が正面
 */
export function createPieceModel(typeId, materials) {
  const g = new THREE.Group();
  const { body, accent } = materials;

  const mesh = new THREE.Mesh(bodyGeometry(typeId), body);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  g.add(mesh);

  switch (typeId) {
    case "rook":
      addBattlements(g, body);
      break;

    case "bishop":
      addMesh(g, sharedGeo.bishopTip, accent, { y: 0.925 });
      break;

    case "knight":
      addHorseHead(g, body);
      break;

    case "queen":
      addCoronet(g, accent, 0.905, 0.155, 7, 0.05);
      addMesh(g, sharedGeo.finial, accent, { y: 0.965 });
      break;

    case "king":
      addCoronet(g, accent, 0.95, 0.145, 5, 0.045);
      addMesh(g, sharedGeo.crossV, accent, { y: 1.05 });
      addMesh(g, sharedGeo.crossH, accent, { y: 1.09 });
      break;

    case "pawn":
      addMesh(g, new THREE.SphereGeometry(0.155, 20, 14), body, { y: 0.63 });
      break;

    default:
      break;
  }

  return g;
}

/** コマのおおよその高さ（HPバーの配置に使う） */
export const PIECE_HEIGHT = {
  pawn: 0.82,
  rook: 0.88,
  bishop: 0.98,
  knight: 0.92,
  queen: 1.06,
  king: 1.18,
};

export { sharedGeo };
