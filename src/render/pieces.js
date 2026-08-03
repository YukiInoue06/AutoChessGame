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
  /** コマの根元に巻く識別色のリング */
  get collar() {
    return (sharedGeo._co ??= markShared(new THREE.TorusGeometry(0.285, 0.03, 8, 28)));
  },
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


// ============================================================ RPGジョブ（ローポリ）

/**
 * ジョブ系ユニットの素体。低ポリゴンの人型で、
 * 頭・胴・肩・腰と台座だけを持つ。あとは職ごとの装備を足していく。
 */
function figure(g, { body, accent }, { skirt = 0.26, cape = false } = {}) {
  addMesh(g, new THREE.CylinderGeometry(0.3, 0.33, 0.07, 6), body, { y: 0.035 });
  addMesh(g, new THREE.CylinderGeometry(0.17, 0.27, skirt, 6), body, {
    y: 0.07 + skirt / 2,
  });
  const waist = 0.07 + skirt;
  addMesh(g, new THREE.BoxGeometry(0.29, 0.05, 0.22), accent, { y: waist + 0.02 });
  addMesh(g, new THREE.BoxGeometry(0.3, 0.26, 0.2), body, { y: waist + 0.17 });

  // 腕。武器を持たせたときに宙に浮かず、体と繋がって見える
  for (const sx of [-1, 1]) {
    addMesh(g, new THREE.BoxGeometry(0.08, 0.25, 0.1), body, {
      x: sx * 0.195,
      y: waist + 0.15,
      rz: sx * 0.1,
    });
  }

  addMesh(g, new THREE.BoxGeometry(0.4, 0.09, 0.22), accent, { y: waist + 0.32 });
  addMesh(g, new THREE.BoxGeometry(0.1, 0.05, 0.1), accent, { y: waist + 0.39 });
  addMesh(g, new THREE.DodecahedronGeometry(0.115), body, { y: waist + 0.48 });

  if (cape) {
    addMesh(g, new THREE.BoxGeometry(0.3, 0.4, 0.04), accent, {
      y: waist + 0.14,
      z: -0.13,
      rx: 0.1,
    });
  }
  return { headY: waist + 0.48, shoulderY: waist + 0.32, handY: waist + 0.12 };
}

// --- 装備パーツ ---

/** 片手剣（右手） */
function sword(g, mats, { x = 0.24, y = 0.5, tilt = -0.35, len = 0.32 } = {}) {
  addMesh(g, new THREE.BoxGeometry(0.045, len, 0.02), mats.accent, {
    x,
    y: y + len / 2,
    rz: tilt,
  });
  addMesh(g, new THREE.BoxGeometry(0.13, 0.03, 0.045), mats.body, { x, y, rz: tilt });
  addMesh(g, new THREE.BoxGeometry(0.035, 0.1, 0.035), mats.body, {
    x: x + Math.sin(tilt) * 0.06,
    y: y - 0.05,
    rz: tilt,
  });
}

/** 盾（左手） */
function shield(g, mats, { x = -0.25, y = 0.5 } = {}) {
  addMesh(g, new THREE.BoxGeometry(0.04, 0.27, 0.21), mats.accent, { x, y });
  addMesh(g, new THREE.OctahedronGeometry(0.055), mats.body, { x: x - 0.03, y });
}

/** 長柄武器 */
function polearm(g, mats, { x = 0.24, y = 0.15, len = 0.72, tip = "cone" } = {}) {
  addMesh(g, new THREE.CylinderGeometry(0.021, 0.021, len, 6), mats.body, {
    x,
    y: y + len / 2,
  });
  const top = y + len;
  if (tip === "cone") {
    addMesh(g, new THREE.ConeGeometry(0.05, 0.14, 5), mats.accent, { x, y: top + 0.06 });
  } else {
    addMesh(g, new THREE.BoxGeometry(0.04, 0.19, 0.16), mats.accent, {
      x,
      y: top - 0.05,
      z: 0.07,
    });
  }
}

/** 杖 */
function staff(g, mats, { x = 0.23, y = 0.12, len = 0.62, orb = 0.062 } = {}) {
  addMesh(g, new THREE.CylinderGeometry(0.02, 0.02, len, 6), mats.body, {
    x,
    y: y + len / 2,
  });
  addMesh(g, new THREE.IcosahedronGeometry(orb), mats.accent, { x, y: y + len + 0.05 });
}

/** 弓 */
function bow(g, mats, { x = 0.25, y = 0.52 } = {}) {
  addMesh(g, new THREE.TorusGeometry(0.16, 0.018, 5, 9, Math.PI * 1.15), mats.body, {
    x,
    y,
    ry: Math.PI / 2,
    rz: Math.PI / 2 - 0.3,
  });
  addMesh(g, new THREE.BoxGeometry(0.006, 0.3, 0.006), mats.accent, { x: x - 0.02, y });
}

/** フード・とんがり帽子 */
function hood(g, mats, { y, r = 0.15, h = 0.22, useAccent = true } = {}) {
  addMesh(g, new THREE.ConeGeometry(r, h, 6), useAccent ? mats.accent : mats.body, {
    y: y + h / 2 - 0.04,
  });
}

/** 兜 */
function helm(g, mats, { y, crest = false } = {}) {
  addMesh(g, new THREE.CylinderGeometry(0.113, 0.125, 0.1, 6), mats.accent, { y: y + 0.03 });
  if (crest) {
    addMesh(g, new THREE.BoxGeometry(0.03, 0.13, 0.17), mats.accent, { y: y + 0.13 });
  }
}

/** 2本の角 */
function horns(g, mats, { y }) {
  for (const sx of [-1, 1]) {
    addMesh(g, new THREE.ConeGeometry(0.035, 0.15, 4), mats.accent, {
      x: sx * 0.085,
      y: y + 0.09,
      rz: sx * 0.5,
    });
  }
}

// --- 獣・魔族のパーツ ---

/**
 * 四足の胴体・脚・首。獣系の土台。
 * 原点は足元、+Z が正面。
 */
function quadruped(g, { body, accent }, { bodyLen = 0.44, bodyH = 0.2, legH = 0.19, slim = true } = {}) {
  const w = slim ? 0.2 : 0.26;
  const legT = slim ? 0.06 : 0.08;
  // 脚（前後×左右）
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      addMesh(g, new THREE.BoxGeometry(legT, legH, legT), body, {
        x: sx * (w / 2 - 0.01),
        y: legH / 2,
        z: sz * (bodyLen / 2 - 0.06),
      });
    }
  }
  // 胴
  addMesh(g, new THREE.BoxGeometry(w, bodyH, bodyLen), body, { y: legH + bodyH / 2 });
  // 背中の差し色
  addMesh(g, new THREE.BoxGeometry(w * 0.5, 0.03, bodyLen * 0.8), accent, {
    y: legH + bodyH,
  });
  // 首と頭
  const neckY = legH + bodyH + 0.05;
  addMesh(g, new THREE.BoxGeometry(w * 0.55, 0.14, 0.12), body, {
    y: neckY,
    z: bodyLen / 2 - 0.06,
    rx: -0.3,
  });
  addMesh(g, new THREE.BoxGeometry(w * 0.6, 0.15, 0.17), body, {
    y: neckY + 0.11,
    z: bodyLen / 2 - 0.02,
  });
  return { headY: neckY + 0.11, headZ: bodyLen / 2 - 0.02, backY: legH + bodyH };
}

/** 鼻面（獣の顔の先） */
function muzzle(g, { accent }, { y, z, len = 0.13, r = 0.055 }) {
  addMesh(g, new THREE.CylinderGeometry(r * 0.7, r, len, 6), accent, {
    y,
    z: z + len / 2,
    rx: Math.PI / 2,
  });
}

/** 尻尾 */
function tail(g, { accent }, { y, z, len = 0.2, tilt = -0.6 }) {
  addMesh(g, new THREE.CylinderGeometry(0.02, 0.045, len, 5), accent, {
    y: y + len * 0.25,
    z,
    rx: tilt,
  });
}

/** 蝙蝠の翼（魔族） */
function batWings(g, { accent }, { y, span = 0.3, tilt = 0.5 }) {
  for (const sx of [-1, 1]) {
    addMesh(g, new THREE.BoxGeometry(span, 0.035, 0.22), accent, {
      x: sx * (span / 2 + 0.08),
      y,
      z: -0.1,
      rz: sx * tilt,
      ry: sx * 0.3,
    });
    // 翼の骨
    addMesh(g, new THREE.BoxGeometry(span * 0.9, 0.02, 0.02), accent, {
      x: sx * (span / 2 + 0.08),
      y: y + 0.05,
      z: -0.06,
      rz: sx * tilt,
    });
  }
}

/** ジョブごとのモデル定義 */
const JOB_BUILDERS = {
  warrior(g, m) {
    const f = figure(g, m);
    helm(g, m, { y: f.headY, crest: true });
    sword(g, m, { y: 0.48 });
    shield(g, m, { y: 0.48 });
  },

  paladin(g, m) {
    const f = figure(g, m, { skirt: 0.3, cape: true });
    helm(g, m, { y: f.headY, crest: true });
    shield(g, m, { x: -0.26, y: 0.52 });
    // 大剣を垂直に構える
    addMesh(g, new THREE.BoxGeometry(0.055, 0.46, 0.025), m.accent, { x: 0.25, y: 0.64 });
    addMesh(g, new THREE.BoxGeometry(0.17, 0.035, 0.05), m.body, { x: 0.25, y: 0.41 });
  },

  archer(g, m) {
    const f = figure(g, m, { skirt: 0.24 });
    hood(g, m, { y: f.headY, r: 0.14, h: 0.2 });
    bow(g, m, { y: 0.54 });
    // 背中の矢筒
    addMesh(g, new THREE.CylinderGeometry(0.055, 0.05, 0.2, 6), m.accent, {
      y: 0.56,
      z: -0.15,
      rx: 0.35,
    });
  },

  cleric(g, m) {
    const f = figure(g, m, { skirt: 0.32 });
    hood(g, m, { y: f.headY, r: 0.145, h: 0.19 });
    staff(g, m, { x: 0.22, y: 0.1, len: 0.6, orb: 0 });
    // 杖の先の十字
    addMesh(g, new THREE.BoxGeometry(0.035, 0.15, 0.035), m.accent, { x: 0.22, y: 0.76 });
    addMesh(g, new THREE.BoxGeometry(0.12, 0.035, 0.035), m.accent, { x: 0.22, y: 0.79 });
  },

  wizard(g, m) {
    const f = figure(g, m, { skirt: 0.34 });
    hood(g, m, { y: f.headY, r: 0.17, h: 0.3 });
    staff(g, m, { x: 0.23, y: 0.1, len: 0.66, orb: 0.075 });
  },

  thief(g, m) {
    const f = figure(g, m, { skirt: 0.22 });
    hood(g, m, { y: f.headY, r: 0.135, h: 0.18 });
    // 短剣を左右に
    for (const sx of [-1, 1]) {
      addMesh(g, new THREE.BoxGeometry(0.035, 0.19, 0.018), m.accent, {
        x: sx * 0.23,
        y: 0.5,
        rz: sx * 0.55,
      });
    }
  },

  dragoon(g, m) {
    const f = figure(g, m, { skirt: 0.28, cape: true });
    helm(g, m, { y: f.headY });
    horns(g, m, { y: f.headY });
    polearm(g, m, { x: 0.25, y: 0.12, len: 0.78 });
  },

  ninja(g, m) {
    const f = figure(g, m, { skirt: 0.22 });
    // 覆面
    addMesh(g, new THREE.BoxGeometry(0.19, 0.07, 0.19), m.accent, { y: f.headY - 0.01 });
    addMesh(g, new THREE.BoxGeometry(0.05, 0.06, 0.3), m.accent, {
      y: f.headY + 0.02,
      z: -0.12,
      rx: -0.5,
    });
    // 背中の直刀
    addMesh(g, new THREE.BoxGeometry(0.03, 0.4, 0.02), m.accent, {
      y: 0.6,
      z: -0.13,
      rz: 0.45,
    });
  },

  berserker(g, m) {
    const f = figure(g, m, { skirt: 0.26 });
    horns(g, m, { y: f.headY });
    // 両手斧
    addMesh(g, new THREE.CylinderGeometry(0.024, 0.024, 0.5, 6), m.body, {
      x: 0.26,
      y: 0.42,
      rz: -0.2,
    });
    addMesh(g, new THREE.BoxGeometry(0.05, 0.22, 0.19), m.accent, { x: 0.33, y: 0.66 });
  },

  sniper(g, m) {
    const f = figure(g, m, { skirt: 0.24 });
    // つばの広い帽子
    addMesh(g, new THREE.CylinderGeometry(0.19, 0.19, 0.02, 8), m.accent, {
      y: f.headY + 0.05,
    });
    addMesh(g, new THREE.CylinderGeometry(0.09, 0.1, 0.1, 6), m.accent, {
      y: f.headY + 0.1,
    });
    // 長い銃
    addMesh(g, new THREE.BoxGeometry(0.045, 0.05, 0.52), m.accent, {
      x: 0.2,
      y: 0.54,
      rx: -0.12,
    });
    addMesh(g, new THREE.CylinderGeometry(0.022, 0.022, 0.09, 6), m.body, {
      x: 0.2,
      y: 0.6,
      z: 0.02,
      rx: Math.PI / 2,
    });
  },

  summoner(g, m) {
    const f = figure(g, m, { skirt: 0.34, cape: true });
    hood(g, m, { y: f.headY, r: 0.16, h: 0.24 });
    // 浮遊する魔法陣＋核
    addMesh(g, new THREE.TorusGeometry(0.11, 0.016, 5, 10), m.accent, {
      x: 0.26,
      y: 0.66,
      rx: Math.PI / 2,
    });
    addMesh(g, new THREE.IcosahedronGeometry(0.055), m.accent, { x: 0.26, y: 0.66 });
  },

  bard(g, m) {
    const f = figure(g, m, { skirt: 0.26 });
    // 羽根つき帽子
    addMesh(g, new THREE.CylinderGeometry(0.13, 0.14, 0.08, 6), m.accent, {
      y: f.headY + 0.06,
    });
    addMesh(g, new THREE.ConeGeometry(0.025, 0.22, 4), m.accent, {
      x: 0.08,
      y: f.headY + 0.16,
      rz: -0.7,
    });
    // リュート
    addMesh(g, new THREE.BoxGeometry(0.17, 0.2, 0.06), m.accent, {
      x: 0.16,
      y: 0.48,
      rz: 0.3,
    });
    addMesh(g, new THREE.BoxGeometry(0.035, 0.26, 0.035), m.body, {
      x: 0.27,
      y: 0.63,
      rz: 0.3,
    });
  },

  icemage(g, m) {
    const f = figure(g, m, { skirt: 0.32 });
    hood(g, m, { y: f.headY, r: 0.16, h: 0.26 });
    staff(g, m, { x: 0.23, y: 0.1, len: 0.6, orb: 0 });
    // 杖の先の氷晶（八面体を3つ）
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      addMesh(g, new THREE.OctahedronGeometry(0.045), m.accent, {
        x: 0.23 + Math.cos(a) * 0.045,
        y: 0.74 + Math.sin(a) * 0.045,
        z: Math.sin(a) * 0.03,
      });
    }
  },

  guardian(g, m) {
    const f = figure(g, m, { skirt: 0.3 });
    helm(g, m, { y: f.headY });
    // 面覆い
    addMesh(g, new THREE.BoxGeometry(0.12, 0.06, 0.05), m.accent, {
      y: f.headY - 0.02,
      z: 0.09,
    });
    polearm(g, m, { x: 0.26, y: 0.1, len: 0.8, tip: "axe" });
    // 大型の盾
    addMesh(g, new THREE.BoxGeometry(0.05, 0.32, 0.23), m.accent, { x: -0.27, y: 0.47 });
  },

  // ------------------------------------------------------------ 獣（四足）
  wolf(g, m) {
    const f = quadruped(g, m, { bodyLen: 0.44, bodyH: 0.17, legH: 0.2, slim: true });
    // 尖った耳と細い鼻面
    muzzle(g, m, { y: f.headY - 0.01, z: f.headZ + 0.07, len: 0.14 });
    for (const sx of [-1, 1]) {
      addMesh(g, new THREE.ConeGeometry(0.045, 0.11, 4), m.accent, {
        x: sx * 0.06,
        y: f.headY + 0.11,
        z: f.headZ - 0.02,
      });
    }
    tail(g, m, { y: f.backY - 0.04, z: -0.26, len: 0.2, tilt: -0.5 });
  },

  bear(g, m) {
    const f = quadruped(g, m, { bodyLen: 0.46, bodyH: 0.26, legH: 0.17, slim: false });
    muzzle(g, m, { y: f.headY - 0.02, z: f.headZ + 0.07, len: 0.11, r: 0.07 });
    // 丸い耳
    for (const sx of [-1, 1]) {
      addMesh(g, new THREE.SphereGeometry(0.055, 10, 8), m.accent, {
        x: sx * 0.09,
        y: f.headY + 0.09,
        z: f.headZ - 0.04,
      });
    }
    // 肩の盛り上がり
    addMesh(g, new THREE.SphereGeometry(0.12, 10, 8), m.body, { y: f.backY, z: -0.04 });
  },

  griffon(g, m) {
    const f = quadruped(g, m, { bodyLen: 0.4, bodyH: 0.19, legH: 0.19, slim: true });
    // 鷲の頭
    addMesh(g, new THREE.SphereGeometry(0.1, 10, 8), m.accent, { y: f.headY, z: f.headZ });
    addMesh(g, new THREE.ConeGeometry(0.045, 0.13, 6), m.body, {
      y: f.headY - 0.02,
      z: f.headZ + 0.11,
      rx: Math.PI / 2,
    });
    // 広げた翼
    for (const sx of [-1, 1]) {
      addMesh(g, new THREE.BoxGeometry(0.3, 0.04, 0.18), m.accent, {
        x: sx * 0.24,
        y: f.backY + 0.02,
        z: -0.04,
        rz: sx * 0.5,
        ry: sx * 0.25,
      });
    }
    tail(g, m, { y: f.backY - 0.04, z: -0.24, len: 0.16, tilt: -0.9 });
  },

  // ------------------------------------------------------------ 魔族（人型）
  imp(g, m) {
    // 小柄。頭が大きく、羽と尻尾がある
    addMesh(g, new THREE.CylinderGeometry(0.22, 0.25, 0.06, 6), m.body, { y: 0.03 });
    addMesh(g, new THREE.CylinderGeometry(0.13, 0.19, 0.2, 6), m.body, { y: 0.16 });
    addMesh(g, new THREE.BoxGeometry(0.22, 0.18, 0.15), m.body, { y: 0.35 });
    addMesh(g, new THREE.DodecahedronGeometry(0.115), m.accent, { y: 0.55 });
    horns(g, m, { y: 0.55 });
    batWings(g, m, { y: 0.4, span: 0.2, tilt: 0.7 });
    tail(g, m, { y: 0.22, z: -0.16, len: 0.16, tilt: -0.7 });
  },

  succubus(g, m) {
    const f = figure(g, m, { skirt: 0.3 });
    horns(g, m, { y: f.headY });
    batWings(g, m, { y: f.shoulderY - 0.02, span: 0.3, tilt: 0.45 });
    tail(g, m, { y: 0.22, z: -0.2, len: 0.22, tilt: -0.6 });
  },

  demonlord(g, m) {
    const f = figure(g, m, { skirt: 0.34, cape: true });
    // 大きく反った角
    for (const sx of [-1, 1]) {
      addMesh(g, new THREE.ConeGeometry(0.05, 0.24, 5), m.accent, {
        x: sx * 0.1,
        y: f.headY + 0.15,
        rz: sx * 0.7,
      });
    }
    batWings(g, m, { y: f.shoulderY, span: 0.4, tilt: 0.35 });
    // 大剣
    addMesh(g, new THREE.BoxGeometry(0.07, 0.56, 0.03), m.accent, { x: 0.27, y: 0.72 });
    addMesh(g, new THREE.BoxGeometry(0.2, 0.04, 0.06), m.body, { x: 0.27, y: 0.44 });
    tail(g, m, { y: 0.26, z: -0.22, len: 0.24, tilt: -0.5 });
  },

  golem(g, m) {
    // 人型だが石の塊。手足が太い
    addMesh(g, new THREE.CylinderGeometry(0.31, 0.34, 0.08, 6), m.body, { y: 0.04 });
    addMesh(g, new THREE.BoxGeometry(0.3, 0.24, 0.24), m.body, { y: 0.2 });
    addMesh(g, new THREE.BoxGeometry(0.38, 0.3, 0.28), m.body, { y: 0.47 });
    addMesh(g, new THREE.DodecahedronGeometry(0.12), m.accent, { y: 0.72 });
    for (const sx of [-1, 1]) {
      addMesh(g, new THREE.BoxGeometry(0.12, 0.34, 0.14), m.body, {
        x: sx * 0.26,
        y: 0.42,
        rz: sx * 0.12,
      });
    }
  },
};

/** ジョブ系のモデルを作る */
function createJobModel(typeId, materials) {
  const g = new THREE.Group();
  JOB_BUILDERS[typeId](g, materials);
  return g;
}

export const JOB_MODEL_IDS = Object.keys(JOB_BUILDERS);

/**
 * コマの 3D モデルを生成する。
 * @param {string} typeId
 * @param {{body: THREE.Material, accent: THREE.Material}} materials
 * @returns {THREE.Group} 原点が足元、+Z が正面
 */
export function createPieceModel(typeId, materials) {
  if (JOB_BUILDERS[typeId]) return createJobModel(typeId, materials);

  const g = new THREE.Group();
  const { body, accent } = materials;

  const mesh = new THREE.Mesh(bodyGeometry(typeId), body);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  g.add(mesh);

  // 根元の識別色リング。チェスのコマは差し色の面積が小さく、
  // 20種類も並ぶと見分けづらいので、足元に色を1本入れておく
  addMesh(g, sharedGeo.collar, accent, { y: 0.085, rx: Math.PI / 2 });

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
  warrior: 1.0,
  paladin: 1.1,
  archer: 0.98,
  cleric: 1.02,
  wizard: 1.14,
  thief: 0.9,
  dragoon: 1.06,
  ninja: 0.92,
  berserker: 1.0,
  sniper: 1.04,
  summoner: 1.12,
  bard: 1.02,
  icemage: 1.1,
  guardian: 1.06,
  wolf: 0.7,
  bear: 0.75,
  griffon: 0.72,
  imp: 0.72,
  succubus: 1.02,
  demonlord: 1.14,
  golem: 0.9,
};

export { sharedGeo };
