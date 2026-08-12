/**
 * 音まわり。
 *
 * 音源ファイルは持たず、WebAudio で**その場で合成**する。
 *   - 読み込み待ちがない（アセットが増えない）
 *   - 単一ファイルに固めても外部リクエストが発生しない
 *   - 音色をコードで調整できる
 *
 * ブラウザの自動再生規制があるので、AudioContext は
 * 最初のタップ（unlock）まで作らない。
 */

const KEY = "autochess.sound";

/** 音の状態。all=BGM+SE / se=SEのみ / off=全部なし */
export const SoundMode = { ALL: "all", SE: "se", OFF: "off" };
const MODES = [SoundMode.ALL, SoundMode.SE, SoundMode.OFF];

const storage = {
  get(key, fallback) {
    try {
      return localStorage.getItem(key) ?? fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* 保存できない環境では諦める */
    }
  },
};

/** 半音差から周波数へ（A4 = 440Hz を基準に、A3 を 0 とする） */
const hz = (semi) => 220 * 2 ** (semi / 12);

// 音階の位置（A マイナー）。数字は A3 からの半音
const A = 0, C = 3, D = 5, E = 7, F = 8, G = 10;

/**
 * バトル用。16分音符 × 16 を1小節として、4小節（Am - Am - F - G）で回る。
 * kick/snare/hat は鳴らす位置、bass と arp は半音の位置（null は休符）。
 */
const BATTLE = {
  bpm: 132,
  steps: 64,
  kick: [0, 6, 8, 14, 16, 22, 24, 32, 38, 40, 46, 48, 54, 56, 62],
  snare: [4, 12, 20, 28, 36, 44, 52, 60],
  chords: [
    [A, C, E], // Am
    [A, C, E],
    [F - 12, A, C], // F
    [G - 12, D, G], // G
  ],
  /** 小節の中でベースを置く位置 */
  bassAt: [0, 3, 6, 8, 11, 14],
  /** 小節の中でアルペジオを置く位置 */
  arpAt: [2, 4, 6, 10, 12, 14],
};

/** ホーム・準備フェーズ用。ゆっくりした和音と、たまに鳴る単音だけ */
const CALM = {
  bpm: 76,
  steps: 32,
  chords: [
    [A - 12, C, E],
    [F - 24, C, F],
    [C - 12, E, G],
    [G - 12, D, G],
  ],
  arpAt: [0, 5, 8, 13, 16, 21, 24, 29],
};

/** 曲の定義。書き出して聴き比べられるように公開しておく */
export const TRACKS = { battle: BATTLE, calm: CALM };

export class Sound {
  constructor() {
    /** @type {AudioContext|null} */
    this.ctx = null;
    this.mode = MODES.includes(storage.get(KEY, "")) ? storage.get(KEY, "") : SoundMode.ALL;
    /** いま鳴らしたい曲。unlock 前でも受け付けて、鳴らせるようになったら再生する */
    this.track = null;
    this._timer = 0;
    this._step = 0;
    this._nextTime = 0;
    this._noise = null;
  }

  get muted() {
    return this.mode === SoundMode.OFF;
  }
  get bgmOn() {
    return this.mode === SoundMode.ALL;
  }
  get seOn() {
    return this.mode !== SoundMode.OFF;
  }

  /** 🔊 → 🔈（SEのみ）→ 🔇 と切り替える */
  cycleMode() {
    this.mode = MODES[(MODES.indexOf(this.mode) + 1) % MODES.length];
    storage.set(KEY, this.mode);
    if (this.bgmOn) this._startMusic();
    else this._stopMusic();
    return this.mode;
  }

  /**
   * 最初のユーザー操作で呼ぶ。ここで初めて AudioContext を作る。
   * 2回目以降は suspend からの復帰だけ行う。
   */
  unlock() {
    const Ctor = window.AudioContext ?? window.webkitAudioContext;
    if (!Ctor) return;
    if (!this.ctx) {
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.9;
      // 音が重なっても割れないように軽く潰す
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 5;
      this.master.connect(comp).connect(this.ctx.destination);

      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0.42;
      this.musicGain.connect(this.master);

      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = 1.15;
      this.sfxGain.connect(this.master);

      if (this.bgmOn && this.track) this._startMusic();
    }
    if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
  }

  /** タブが隠れている間は止める（裏で鳴り続けないように） */
  bindVisibility() {
    document.addEventListener("visibilitychange", () => {
      if (!this.ctx) return;
      if (document.hidden) this.ctx.suspend();
      else if (!this.muted) this.ctx.resume().catch(() => {});
    });
  }

  // ------------------------------------------------------------------ 音源

  /** ホワイトノイズ（打楽器と効果音の芯に使う） */
  _noiseBuffer() {
    if (this._noise) return this._noise;
    const len = this.ctx.sampleRate * 0.6;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this._noise = buf;
    return buf;
  }

  /**
   * 単音。
   * @param {number} t 鳴らす時刻（ctx.currentTime 基準）
   */
  _tone(t, freq, { type = "sine", dur = 0.18, gain = 0.3, to = null, out = null, attack = 0.006 } = {}) {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(out ?? this.sfxGain);
    o.start(t);
    o.stop(t + dur + 0.02);
    return o;
  }

  /** ノイズ一発（打撃音・シャリ音） */
  _hit(t, { dur = 0.1, gain = 0.3, freq = 2000, type = "highpass", out = null } = {}) {
    const s = this.ctx.createBufferSource();
    s.buffer = this._noiseBuffer();
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(out ?? this.sfxGain);
    s.start(t);
    s.stop(t + dur + 0.02);
  }

  // ------------------------------------------------------------------ 効果音

  /**
   * 効果音を鳴らす。名前が未知なら何もしない。
   * @param {"tap"|"buy"|"sell"|"error"|"place"|"reroll"|"levelup"|"merge"|"select"|"battleStart"|"win"|"lose"|"gameover"|"point"} name
   * @param {number} delay 何秒あとに鳴らすか（書き出しや連続再生に使う）
   */
  sfx(name, delay = 0) {
    if (!this.seOn) return;
    this.unlock();
    if (!this.ctx) return;
    const t = this.ctx.currentTime + 0.001 + delay;

    switch (name) {
      case "tap":
        this._tone(t, 900, { type: "triangle", dur: 0.05, gain: 0.16, to: 1200 });
        this._hit(t, { dur: 0.03, gain: 0.07, freq: 3500 });
        break;

      case "place":
        this._tone(t, 200, { type: "sine", dur: 0.12, gain: 0.3, to: 120 });
        this._hit(t, { dur: 0.05, gain: 0.12, freq: 1200 });
        break;

      case "buy":
        this._tone(t, hz(E + 12), { type: "square", dur: 0.07, gain: 0.16 });
        this._tone(t + 0.06, hz(A + 24), { type: "square", dur: 0.12, gain: 0.16 });
        this._tone(t + 0.06, hz(E + 24), { type: "triangle", dur: 0.14, gain: 0.1 });
        break;

      case "sell":
        this._tone(t, hz(A + 12), { type: "triangle", dur: 0.08, gain: 0.16 });
        this._tone(t + 0.07, hz(E), { type: "triangle", dur: 0.14, gain: 0.14 });
        break;

      case "error":
        this._tone(t, 150, { type: "square", dur: 0.14, gain: 0.14, to: 110 });
        break;

      case "reroll":
        this._hit(t, { dur: 0.22, gain: 0.16, freq: 900, type: "bandpass" });
        this._tone(t, 420, { type: "triangle", dur: 0.2, gain: 0.1, to: 900 });
        break;

      case "levelup":
        [A, E, A + 12, C + 12].forEach((n, i) =>
          this._tone(t + i * 0.06, hz(n + 12), { type: "triangle", dur: 0.2, gain: 0.16 }),
        );
        break;

      // ★アップ。きらきらさせて特別扱いにする
      case "merge":
        [A + 12, C + 12, E + 12, A + 24].forEach((n, i) =>
          this._tone(t + i * 0.05, hz(n + 12), { type: "sine", dur: 0.3, gain: 0.16 }),
        );
        this._hit(t + 0.1, { dur: 0.3, gain: 0.06, freq: 6000 });
        break;

      case "select":
        this._tone(t, hz(C + 12), { type: "triangle", dur: 0.1, gain: 0.16 });
        this._tone(t + 0.08, hz(G + 12), { type: "triangle", dur: 0.18, gain: 0.16 });
        break;

      case "battleStart":
        this._tone(t, 120, { type: "sawtooth", dur: 0.5, gain: 0.18, to: 480 });
        this._hit(t + 0.42, { dur: 0.3, gain: 0.3, freq: 400, type: "lowpass" });
        this._tone(t + 0.42, hz(A - 12), { type: "sine", dur: 0.4, gain: 0.4, to: 45 });
        break;

      case "win":
        [A, C + 1, E, A + 12].forEach((n, i) =>
          this._tone(t + i * 0.1, hz(n + 12), { type: "triangle", dur: 0.5, gain: 0.2 }),
        );
        break;

      case "lose":
        [E, D, C, A].forEach((n, i) =>
          this._tone(t + i * 0.12, hz(n), { type: "triangle", dur: 0.4, gain: 0.18 }),
        );
        break;

      case "gameover":
        [A, F - 12, E - 12, A - 12].forEach((n, i) =>
          this._tone(t + i * 0.22, hz(n), { type: "sawtooth", dur: 0.8, gain: 0.14 }),
        );
        break;

      // ポイント獲得。上へ駆け上がる
      case "point":
        for (let i = 0; i < 6; i++) {
          this._tone(t + i * 0.05, hz(A + 12 + i * 2), {
            type: "sine",
            dur: 0.22,
            gain: 0.14,
          });
        }
        break;

      default:
        break;
    }
  }

  // -------------------------------------------------------------------- BGM

  /**
   * 曲を切り替える。null で停止。
   * @param {"battle"|"calm"|null} track
   */
  music(track) {
    if (this.track === track) return;
    this.track = track;
    this._stopMusic();
    if (track && this.bgmOn) this._startMusic();
  }

  _startMusic() {
    if (!this.track || !this.ctx || this._timer) return;
    this._step = 0;
    this._nextTime = this.ctx.currentTime + 0.08;
    // 先読みして少し先の音を予約していく（setInterval のゆらぎを吸収するため）
    this._timer = setInterval(() => this._schedule(), 25);
  }

  _stopMusic() {
    clearInterval(this._timer);
    this._timer = 0;
  }

  _schedule() {
    const def = TRACKS[this.track];
    if (!def || !this.ctx) return this._stopMusic();
    if (this.ctx.state !== "running") {
      // タブが隠れている間などは進めない（復帰時に一気に鳴らないように）
      this._nextTime = this.ctx.currentTime + 0.08;
      return;
    }
    const stepDur = 60 / def.bpm / 4;
    while (this._nextTime < this.ctx.currentTime + 0.12) {
      this._playStep(def, this._step, this._nextTime);
      this._step = (this._step + 1) % def.steps;
      this._nextTime += stepDur;
    }
  }

  _playStep(def, step, t) {
    const out = this.musicGain;
    const bar = Math.floor(step / 16) % def.chords.length;
    const chord = def.chords[bar];
    const inBar = step % 16;

    if (def === BATTLE) {
      if (def.kick.includes(step)) {
        this._tone(t, 150, { type: "sine", dur: 0.16, gain: 0.9, to: 45, out, attack: 0.002 });
      }
      if (def.snare.includes(step)) {
        this._hit(t, { dur: 0.12, gain: 0.32, freq: 1600, out });
      }
      // ハイハットは裏拍だけ。表を抜くと走って聴こえる
      if (step % 2 === 1) {
        this._hit(t, { dur: 0.03, gain: 0.1, freq: 7000, out });
      }
      if (def.bassAt.includes(inBar)) {
        this._tone(t, hz(chord[0] - 24), {
          type: "sawtooth",
          dur: 0.16,
          gain: 0.5,
          out,
          attack: 0.004,
        });
      }
      if (def.arpAt.includes(inBar)) {
        const n = chord[(Math.floor(inBar / 2) + bar) % chord.length];
        this._tone(t, hz(n + 12), { type: "square", dur: 0.12, gain: 0.12, out });
      }
      return;
    }

    // CALM: 和音を小節頭で伸ばし、その上に単音を散らす
    if (inBar === 0) {
      for (const n of chord) {
        this._tone(t, hz(n), { type: "sine", dur: 2.4, gain: 0.22, out, attack: 0.5 });
      }
    }
    if (def.arpAt.includes(step)) {
      const n = chord[(step / 4) % chord.length | 0];
      this._tone(t, hz(n + 24), { type: "triangle", dur: 0.9, gain: 0.1, out, attack: 0.05 });
    }
  }
}
