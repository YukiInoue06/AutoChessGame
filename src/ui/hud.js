/**
 * DOM 側の UI（ヘッダー・ログ・インスペクタ・各種オーバーレイ）。
 *
 * オーバーレイは Promise を返すので、ゲーム進行側は
 * `const picks = await hud.showRosterSelect()` のように書ける。
 */

import {
  STAT_MAX,
  UNIT_TYPES,
  CHESS_IDS,
  JOB_IDS,
  buildStats,
  cssColorOf,
} from "../core/units.js";
import { TRAITS, activeTraits } from "../core/traits.js";
import {
  Phase,
  MAX_LEVEL,
  REROLL_COST,
  XP_BUY_COST,
  XP_BUY_AMOUNT,
  shopOddsFor,
} from "../core/game.js";

const $ = (id) => document.getElementById(id);
const clamp01 = (v) => Math.max(0, Math.min(1, v));

const PHASE_LABEL = {
  [Phase.SELECT]: "編成フェーズ",
  [Phase.PREP]: "準備フェーズ",
  [Phase.BATTLE]: "バトル中",
  [Phase.RESULT]: "リザルト",
  [Phase.GAMEOVER]: "ゲームオーバー",
};

export class Hud {
  constructor({ onStart, onSpeedToggle, onHelp, onShop }) {
    this.el = {
      round: $("statRound"),
      life: $("statLife"),
      streak: $("statStreak"),
      gold: $("statGold"),
      level: $("statLevel"),
      xp: $("statXp"),
      toast: $("toast"),
      btnShop: $("btnShop"),
      phaseBadge: $("phaseBadge"),
      phaseText: $("phaseText"),
      actionbar: $("actionbar"),
      actionHint: $("actionHint"),
      btnStart: $("btnStart"),
      btnSpeed: $("btnSpeed"),
      btnHelp: $("btnHelp"),
      logPanel: $("logPanel"),
      logList: $("logList"),
      overlay: $("overlay"),
      overlayPanel: $("overlayPanel"),
      inspector: $("inspector"),
      inspGlyph: $("inspGlyph"),
      inspName: $("inspName"),
      inspStars: $("inspStars"),
      inspStats: $("inspStats"),
      traits: $("traits"),
      traitList: $("traitList"),
      inspTraits: $("inspTraits"),
      inspSkillName: $("inspSkillName"),
      inspSkillText: $("inspSkillText"),
      inspMove: $("inspMove"),
    };

    this.el.btnStart.addEventListener("click", () => onStart());
    this.el.btnSpeed.addEventListener("click", () => onSpeedToggle());
    this.el.btnHelp.addEventListener("click", () => onHelp());
    this.el.btnShop.addEventListener("click", () => onShop());

    this._announceEl = document.createElement("div");
    Object.assign(this._announceEl.style, {
      position: "fixed",
      left: "50%",
      top: "34%",
      transform: "translate(-50%, -50%)",
      fontSize: "clamp(30px, 6vw, 62px)",
      fontWeight: "900",
      letterSpacing: "0.06em",
      pointerEvents: "none",
      opacity: "0",
      textShadow: "0 6px 30px rgba(0,0,0,0.75)",
      zIndex: "15",
      whiteSpace: "nowrap",
    });
    document.body.appendChild(this._announceEl);
    this._setupTraitPopover();
    this._setupUnitSheet();
  }

  // ------------------------------------------------------- ユニットの詳細シート

  /** 縦画面かどうか。カードを詰めるぶん、詳細はタップで出す */
  get isNarrow() {
    return matchMedia("(max-width: 640px)").matches;
  }

  _setupUnitSheet() {
    const back = document.createElement("div");
    back.className = "sheetback";
    back.hidden = true;
    const sheet = document.createElement("div");
    sheet.className = "unitsheet";
    sheet.id = "unitSheet";
    back.appendChild(sheet);
    document.body.appendChild(back);
    this._sheetBack = back;
    this._sheet = sheet;

    back.addEventListener("click", (ev) => {
      if (ev.target === back) this.closeUnitSheet();
    });
    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape" && !back.hidden && this._pop.hidden) {
        ev.stopPropagation();
        this.closeUnitSheet();
      }
    });
  }

  closeUnitSheet() {
    this._sheetBack.hidden = true;
    this._sheet.replaceChildren();
  }

  /**
   * ユニット1体の詳細（ステータス・スキル・特性）を下から出す。
   * 狭い画面ではカードに乗せきれない情報をここへ寄せている。
   *
   * @param {string} typeId
   * @param {{star?:number, place?:string|null,
   *          actions?:{label:string, cls?:string, disabled?:boolean, run:() => void}[]}} opts
   */
  showUnitSheet(typeId, { star = 1, place = null, actions = [] } = {}) {
    const t = UNIT_TYPES[typeId];
    const s = buildStats(typeId, { star });
    const hue = cssColorOf(typeId);

    const rows = [
      ["HP", s.maxHp],
      ["攻撃力", s.atk],
      ["攻撃速度", `${s.attackSpeed.toFixed(2)} 回/秒`],
      ["射程", `${s.range} マス`],
      ["防御", s.armor],
      ["魔法防御", s.resist],
    ];

    this._sheet.innerHTML = `
      <div class="unitsheet__head">
        <span class="unitsheet__glyph" style="color:${hue};box-shadow:inset 0 0 0 2px ${hue}55">${t.glyph}</span>
        <div class="unitsheet__id">
          <div class="unitsheet__name">${t.name}${
            star > 1 ? ` <span class="unitsheet__stars">${"★".repeat(star)}</span>` : ""
          }</div>
          <div class="unitsheet__role">${t.role}${place ? ` ・ ${place}` : ""}</div>
        </div>
        <span class="unitsheet__cost" data-tier="${t.cost}">${t.cost}G</span>
      </div>
      <div class="unitsheet__traits">${traitChips(t.traits)}</div>
      <dl class="unitsheet__stats">
        ${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}
      </dl>
      <div class="unitsheet__skill">
        <b>${t.skill.name}</b>
        <p>${t.skill.text}</p>
      </div>
      <div class="unitsheet__move">移動: ${t.moveText}${
        t.auraText ? `<br>${t.auraText}` : ""
      }</div>
      <div class="unitsheet__actions"></div>
    `;

    const bar = this._sheet.querySelector(".unitsheet__actions");
    for (const a of actions) {
      const btn = document.createElement("button");
      btn.className = `btn ${a.cls ?? ""}`;
      btn.textContent = a.label;
      btn.disabled = !!a.disabled;
      btn.addEventListener("click", () => {
        this.closeUnitSheet();
        a.run();
      });
      bar.appendChild(btn);
    }
    const close = document.createElement("button");
    close.className = "btn";
    close.textContent = "閉じる";
    close.addEventListener("click", () => this.closeUnitSheet());
    bar.appendChild(close);

    this._sheetBack.hidden = false;
  }

  // ------------------------------------------------------------ 特性の詳細

  /**
   * 特性チップ（パネル・カード・インスペクタ）をクリックすると
   * 全段階の効果を出すポップオーバー。
   *
   * ホバーの title 属性だとタッチ端末で読めないので、
   * 3か所から同じものを開けるようにひとつだけ作って使い回す。
   */
  _setupTraitPopover() {
    /** @type {Map<string, {count:number, tierIndex:number, ids:string[]}>} */
    this._traitState = new Map();

    const pop = document.createElement("div");
    pop.className = "traitpop";
    pop.id = "traitPop";
    pop.hidden = true;
    document.body.appendChild(pop);
    this._pop = pop;

    // チップはオーバーレイの中にも出るので、拾うのは document 側で1回だけ
    document.addEventListener(
      "click",
      (ev) => {
        const chip = ev.target.closest?.("[data-trait]");
        if (chip) {
          // ショップのカードの上にも乗るので、購入クリックには伝えない
          ev.preventDefault();
          ev.stopPropagation();
          this.showTraitInfo(chip.dataset.trait, chip);
          return;
        }
        if (!pop.hidden && !ev.target.closest?.(".traitpop")) this.closeTraitInfo();
      },
      true,
    );

    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape" && !pop.hidden) {
        // 同じ document に付いている詳細シートの Esc まで走らせない
        // （stopPropagation では同一要素の他のリスナーは止まらない）
        ev.stopImmediatePropagation();
        this.closeTraitInfo();
        return;
      }
      // span なので Enter / Space では click が飛ばない。自分で拾う
      if (ev.key !== "Enter" && ev.key !== " ") return;
      const chip = ev.target.closest?.("[data-trait]");
      if (!chip) return;
      ev.preventDefault();
      ev.stopPropagation();
      this.showTraitInfo(chip.dataset.trait, chip);
    });

    addEventListener("resize", () => this.closeTraitInfo());
  }

  closeTraitInfo() {
    this._pop.hidden = true;
    this._pop.replaceChildren();
  }

  /**
   * 特性の全段階を出す。
   * @param {string} id 特性 ID
   * @param {Element} anchor この要素の近くに出す
   */
  showTraitInfo(id, anchor) {
    const trait = TRAITS[id];
    if (!trait) return;
    const state = this._traitState.get(id);
    const count = state?.count ?? 0;
    const have = new Set(state?.ids ?? []);

    const tiers = trait.tiers
      .map((t, i) => {
        const reached = count >= t.need;
        const isTop = reached && i === (state?.tierIndex ?? -1);
        return `<li data-state="${isTop ? "active" : reached ? "reached" : "locked"}">
          <span class="traitpop__need">${t.need}種</span>
          <span class="traitpop__effect">${t.text}</span>
        </li>`;
      })
      .join("");

    // その特性を持つユニット。盤に出ているものは色付きで示す
    const members = [...CHESS_IDS, ...JOB_IDS]
      .filter((uid) => UNIT_TYPES[uid].traits?.includes(id))
      .map((uid) => {
        const on = have.has(uid);
        return `<span class="traitpop__unit" data-on="${on}"${
          on ? ` style="color:${cssColorOf(uid)}"` : ""
        }>${UNIT_TYPES[uid].name}</span>`;
      })
      .join("");

    this._pop.innerHTML = `
      <div class="traitpop__head" style="--hue:${trait.color}">
        <span class="traitpop__dot"></span>
        <span class="traitpop__name">${trait.name}</span>
        <span class="traitpop__kind">${trait.kind === "origin" ? "出自" : "職能"}</span>
        <span class="traitpop__count">盤上 ${count}種</span>
      </div>
      <p class="traitpop__desc">${trait.desc}</p>
      <ul class="traitpop__tiers">${tiers}</ul>
      <div class="traitpop__members">
        <span class="traitpop__membersLabel">この特性を持つユニット</span>
        <div class="traitpop__unitList">${members}</div>
      </div>
    `;
    this._pop.hidden = false;
    this._placePopover(anchor);
  }

  /** アンカーの近くに、画面からはみ出さないように置く */
  _placePopover(anchor) {
    const pop = this._pop;
    const a = anchor.getBoundingClientRect();
    const p = pop.getBoundingClientRect();
    const pad = 10;
    const clamp = (v, max) => Math.max(pad, Math.min(v, max - pad));

    let left;
    let top;
    if (a.right + pad + p.width <= innerWidth - pad) {
      left = a.right + pad; // 右に出す
    } else if (a.left - pad - p.width >= pad) {
      left = a.left - p.width - pad; // 左に出す
    } else {
      // 横に入らない（縦画面など）ので、下か上へ回す
      left = clamp(a.left + a.width / 2 - p.width / 2, innerWidth - p.width);
      top =
        a.bottom + pad + p.height <= innerHeight - pad
          ? a.bottom + pad
          : a.top - p.height - pad;
    }
    if (top === undefined) top = a.top + a.height / 2 - p.height / 2;

    pop.style.left = `${clamp(left, innerWidth - p.width)}px`;
    pop.style.top = `${clamp(top, innerHeight - p.height)}px`;
  }

  // ------------------------------------------------------------ ヘッダー等

  setStats(game) {
    this.el.round.textContent = game.round;
    this.el.life.textContent = "♥".repeat(Math.max(0, game.life)) || "0";
    this.el.streak.textContent = game.streak;
    this.el.gold.textContent = game.gold;
    this.el.level.textContent = game.level;
    const need = game.xpToNext;
    this.el.xp.style.width = need ? `${Math.min(100, (game.xp / need) * 100)}%` : "100%";
    this.el.xp.dataset.max = need ? "false" : "true";
  }

  /**
   * 特性パネルを描く。
   * @param {ReturnType<typeof activeTraits>} list
   */
  setTraits(list) {
    this.el.traits.hidden = !list.length;
    this.el.traitList.replaceChildren();

    // ポップオーバーが「いま何種そろっているか」を出せるように控えておく
    this._traitState = new Map(
      list.map(({ trait, count, tierIndex, ids }) => [trait.id, { count, tierIndex, ids }]),
    );
    this.closeTraitInfo();

    for (const { trait, count, tier, next } of list) {
      const li = document.createElement("li");
      li.className = "trait";
      li.style.setProperty("--hue", trait.color);
      li.dataset.active = tier ? "true" : "false";
      li.dataset.trait = trait.id;
      li.tabIndex = 0;
      li.title = `${trait.name} — クリックで全段階を表示`;
      li.innerHTML = `
        <span class="trait__dot"></span>
        <span class="trait__name">${trait.name}
          <span class="trait__tier">${
            tier ? tier.text : `あと${next.need - count}種で発動`
          }</span>
        </span>
        <span class="trait__count">${count}${next ? ` / ${next.need}` : ""}</span>
      `;
      this.el.traitList.appendChild(li);
    }
  }

  /** 短いメッセージを一瞬だけ出す（コスト上限に引っかかった時など） */
  toast(text) {
    const el = this.el.toast;
    el.textContent = text;
    el.dataset.show = "true";
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => {
      el.dataset.show = "false";
    }, 2200);
  }

  setPhase(phase) {
    this.el.phaseText.textContent = PHASE_LABEL[phase] ?? phase;
    this.el.phaseBadge.dataset.phase = phase;
    this.el.logPanel.dataset.visible = phase === Phase.BATTLE ? "true" : "false";
  }

  setActionBar({ visible, hint, label = "バトル開始", disabled = false }) {
    this.el.actionbar.dataset.hidden = visible ? "false" : "true";
    if (hint !== undefined) this.el.actionHint.innerHTML = hint;
    this.el.btnStart.textContent = label;
    this.el.btnStart.disabled = disabled;
  }

  setSpeedLabel(mult) {
    this.el.btnSpeed.textContent = `▶ ${mult.toFixed(1)}x`;
  }

  // ------------------------------------------------------------------ ログ

  log(html) {
    const li = document.createElement("li");
    li.innerHTML = html;
    this.el.logList.appendChild(li);
    while (this.el.logList.children.length > 40) {
      this.el.logList.removeChild(this.el.logList.firstChild);
    }
    this.el.logList.scrollTop = this.el.logList.scrollHeight;
  }

  clearLog() {
    this.el.logList.replaceChildren();
  }

  announce(text, tone = "info") {
    const el = this._announceEl;
    const color =
      tone === "danger" ? "#ff7a7a" : tone === "good" ? "#7ef2a8" : "#ffffff";
    el.textContent = text;
    el.style.color = color;
    el.animate(
      [
        { opacity: 0, transform: "translate(-50%,-50%) scale(1.35)" },
        { opacity: 1, transform: "translate(-50%,-50%) scale(1)", offset: 0.22 },
        { opacity: 1, transform: "translate(-50%,-50%) scale(1)", offset: 0.7 },
        { opacity: 0, transform: "translate(-50%,-58%) scale(0.96)" },
      ],
      { duration: 1400, easing: "cubic-bezier(.2,.9,.3,1)" },
    );
  }

  // -------------------------------------------------------------- インスペクタ

  /** @param {object|null} unit battle.js のユニット実体 */
  showInspector(unit) {
    if (!unit) {
      this.el.inspector.hidden = true;
      return;
    }
    const d = unit.def;
    this.el.inspector.hidden = false;
    this.el.inspGlyph.textContent = unit.team === "player" ? d.glyph : d.glyphDark;
    this.el.inspGlyph.style.color = cssColorOf(unit.typeId);
    this.el.inspGlyph.style.boxShadow = `inset 0 0 0 2px ${cssColorOf(unit.typeId)}55`;
    this.el.inspName.textContent = d.name;
    this.el.inspName.style.color = unit.team === "player" ? "#5ad2ff" : "#ff6b6b";
    this.el.inspStars.textContent = "★".repeat(unit.star);
    this.el.inspTraits.innerHTML = traitChips(d.traits);

    const rows = [
      ["HP", `${Math.ceil(unit.hp)} / ${unit.maxHp}`],
      ["攻撃力", Math.round(unit.baseAtk * (1 + unit.atkMulPerm))],
      ["攻撃速度", `${unit.attackSpeed.toFixed(2)} 回/秒`],
      ["射程", `${unit.range} マス`],
      ["防御", unit.armor + unit.armorBonus],
      ["魔法防御", unit.resist],
      ["マナ", `${Math.floor(unit.mana)} / ${unit.manaMax}`],
    ];
    if (unit.shield > 0) rows.push(["シールド", Math.round(unit.shield)]);

    this.el.inspStats.replaceChildren();
    for (const [k, v] of rows) {
      const dt = document.createElement("dt");
      dt.textContent = k;
      const dd = document.createElement("dd");
      dd.textContent = v;
      this.el.inspStats.append(dt, dd);
    }

    this.el.inspSkillName.textContent = `${d.skill.name}（${unit.manaMax}マナ）`;
    this.el.inspSkillText.textContent = d.skill.text;
    this.el.inspMove.textContent = `移動: ${d.moveText}${d.auraText ? " / " + d.auraText : ""}`;
  }

  // ---------------------------------------------------------- オーバーレイ

  /**
   * オーバーレイを開く。
   *
   * パネルの DOM は使い回しているので、前の画面が張ったイベントリスナーが
   * 残っていると次の画面のクリックを拾ってしまう（兵舎の売却処理が
   * リザルト画面で走る、など）。開くたびに AbortController を作り替え、
   * リスナーは必ず this._overlaySignal を渡して登録する。
   */
  _openOverlay(html) {
    this._overlayAbort?.abort();
    this._overlayAbort = new AbortController();
    this._overlaySignal = this._overlayAbort.signal;
    this.el.overlayPanel.innerHTML = html;
    this.el.overlay.hidden = false;
    return this.el.overlayPanel;
  }

  /** オーバーレイ内でイベントを購読する（閉じると自動で外れる） */
  _on(target, type, fn) {
    target.addEventListener(type, fn, { signal: this._overlaySignal });
  }

  closeOverlay() {
    this._overlayAbort?.abort();
    this._overlayAbort = null;
    this.el.overlay.hidden = true;
    this.el.overlayPanel.replaceChildren();
  }

  /** タイトル画面 */
  showTitle(best) {
    return new Promise((resolve) => {
      const p = this._openOverlay(`
        <h1 class="title">AUTO CHESS ARENA</h1>
        <p class="subtitle">チェス盤オートバトル ・ 全20種</p>
        <p>
          ショップでユニットを雇い、盤に並べて、あとは見守るだけ。
          コマは<b>それぞれの動き方</b>で敵に迫り、マナが満ちるとスキルを放ちます。
        </p>
        <h3>ルール</h3>
        <ol class="helplist">
          <li><b>ショップ</b> — 5枠の品揃えから雇う。リロールで引き直せる</li>
          <li><b>レベル</b> — 盤に出せる人数＝レベル。経験値で上がり、高コストも出やすくなる</li>
          <li><b>合成</b> — 同じユニットが3体そろうと自動で★アップ</li>
          <li><b>特性</b> — 盤の顔ぶれでバフが発動。左のパネルの特性名を押すと効果が出る</li>
          <li><b>準備</b> — 手前3列にドラッグで配置。控え列に置いた分は戦わない</li>
          <li><b>バトル</b> — 自動で戦闘。全滅させれば勝ち。負けるとライフが1減る</li>
        </ol>
        <div class="overlay__actions">
          <span class="overlay__note">${best > 0 ? `自己ベスト: ラウンド ${best} 突破` : "初挑戦"}</span>
          <button class="btn btn--primary" data-act="start">ゲームスタート</button>
        </div>
      `);
      this._on(p.querySelector('[data-act="start"]'), "click", () => {
        this.closeOverlay();
        resolve();
      });
    });
  }

  /** 遊びかた（いつでも閉じられる） */
  showHelp() {
    const p = this._openOverlay(`
      <h2>遊びかた</h2>
      <h3>操作</h3>
      <ul class="helplist">
        <li><b>ドラッグ</b> — 準備フェーズ中、自分のコマを手前3列に配置。味方どうしは入れ替えになります</li>
        <li><b>控え列へドラッグ</b> — 盤のさらに手前の列が控え。出撃メンバーから外れます</li>
        <li><b>クリック</b> — コマの詳細（ステータス・スキル）を表示</li>
        <li><b>右ドラッグ / ホイール</b> — カメラの回転とズーム</li>
        <li><kbd>Space</kbd> — バトル開始 / 速度切替</li>
      </ul>
      <h3>ショップとレベル</h3>
      <ul class="helplist">
        <li>ショップの<b>5枠</b>はレベルに応じた確率で抽選されます。${REROLL_COST}Gで引き直し、ラウンドごとに無料で更新</li>
        <li><b>盤に出せる人数＝レベル</b>。${XP_BUY_COST}Gで${XP_BUY_AMOUNT}exp買えるほか、ラウンドごとに自動で入ります</li>
        <li>レベルが上がると<b>高コストのユニットが出やすく</b>なります（5コストはレベル7から）</li>
        <li>同じユニットが<b>3体そろうと自動で★アップ</b>。★2が3体そろえば★3になります</li>
        <li>控えに置いたユニットは戦闘に出ませんが、合成の数には入ります</li>
        <li>収入はラウンドごとに基本10G＋勝利4G＋連勝ボーナス（最大5G）</li>
      </ul>
      <h3>特性（組み合わせバフ）</h3>
      <ul class="helplist">
        <li>ユニットには<b>出自</b>と<b>職能</b>の特性が1つずつあり、盤に出した<b>種類数</b>で段階が決まります</li>
        <li>同じユニットを何体並べても<b>種類数は1</b>。★アップは種類数に影響しません</li>
        <li><b>特性名をクリック</b>すると全段階の効果が出ます（パネル・ショップのカード・コマの詳細のどこからでも）</li>
        <li>効果はその特性を持つ本人だけに乗ります。ただし<b>支援</b>と<b>王家</b>の最大段階は味方全体に効きます</li>
        <li><b>敵にも同じルールでバフがかかります</b>。相手の編成が揃っているほど手強くなります</li>
      </ul>
      <h3>戦闘のしくみ</h3>
      <ul class="helplist">
        <li>各コマは<b>いちばん近い敵</b>を狙い、それぞれの移動パターンで近づきます</li>
        <li>射程内に入ると自動で攻撃。攻撃と被弾で<b>マナ</b>が溜まります</li>
        <li>マナが満タンになると<b>スキル</b>を発動（足元のリングが金色に光ります）</li>
        <li>物理ダメージは防御、魔法ダメージは魔法防御で軽減されます</li>
        <li>チェスのコマは本家どおりの動き方、RPGジョブは役割に合わせた動き方をします</li>
        <li>40秒経過で<b>サドンデス</b>。全員がじわじわ削られます</li>
      </ul>
      <div class="overlay__actions">
        <button class="btn btn--primary" data-act="close">閉じる</button>
      </div>
    `);
    this._on(p.querySelector('[data-act="close"]'), "click", () => this.closeOverlay());
  }

  /**
   * ショップ。
   * 5枠の品揃えはレベルに応じた確率で抽選され、リロールで引き直せる。
   * 同じユニットが3体そろうと自動で★アップ（合成）する。
   *
   * @param {object} game
   * @param {{onChange?: () => void, first?: boolean}} opts
   * @returns {Promise<void>} 閉じたら解決する
   */
  showShop(game, { onChange = () => {}, first = false } = {}) {
    return new Promise((resolve) => {
      const p = this._openOverlay(`
        <div class="shop__head">
          <div>
            <h2>ショップ</h2>
            <p class="shop__sub" id="shopSub"></p>
          </div>
          <div class="shop__wallet">
            <span class="shop__gold" id="shopGold">0</span>
            <span class="shop__goldLabel">ゴールド</span>
          </div>
        </div>

        <div class="shop__bar">
          <div class="shop__level">
            <button type="button" class="shop__levelHead" data-act="odds"
              aria-expanded="false" aria-controls="shopOdds">
              <span>レベル <b id="shopLevel">3</b></span>
              <span id="shopXp"></span>
              <span class="shop__caret" aria-hidden="true">▾</span>
            </button>
            <span class="xpbar xpbar--wide"><span class="xpbar__fill" id="shopXpBar"></span></span>
            <div class="shop__odds" id="shopOdds" hidden></div>
          </div>
          <div class="shop__buttons">
            <button class="btn btn--gold" data-act="xp">
              経験値を買う <span class="btn__sub">${XP_BUY_COST}G で ${XP_BUY_AMOUNT}exp</span>
            </button>
            <button class="btn" data-act="reroll">
              リロール <span class="btn__sub">${REROLL_COST}G</span>
            </button>
          </div>
        </div>

        <h3 id="shopSlotsHead">品揃え</h3>
        <div class="roster roster--shop" id="shopSlots"></div>

        <h3>所持ユニット</h3>
        <div class="roster roster--owned" id="shopOwned"></div>

        <div class="overlay__actions">
          <span class="overlay__note" id="shopNote"></span>
          <button class="btn btn--primary" data-act="close">
            ${first ? "盤に配置する" : "閉じる"}
          </button>
        </div>
      `);

      const slots = p.querySelector("#shopSlots");
      const owned = p.querySelector("#shopOwned");
      const closeBtn = p.querySelector('[data-act="close"]');

      const render = () => {
        // --- 品揃え ---
        slots.replaceChildren();
        game.shop.forEach((typeId, i) => {
          if (!typeId) {
            const empty = document.createElement("div");
            empty.className = "card card--sold";
            empty.innerHTML = '<span class="card__soldTag">売切</span>';
            slots.appendChild(empty);
            return;
          }
          const cost = UNIT_TYPES[typeId].cost;
          const locked = game.gold < cost || game.isRosterFull;
          // 狭い画面はカードをタップすると詳細が出るので、購入はボタンに分ける
          const card = this._unitCard(typeId, {
            shop: true,
            actions: this.isNarrow
              ? [{ act: "buy", label: `雇う ${cost}G`, cls: "cardbtn--buy", disabled: locked }]
              : null,
          });
          card.dataset.slot = String(i);
          card.dataset.disabled = locked ? "true" : "false";
          slots.appendChild(card);
        });

        // --- 所持ユニット ---
        owned.replaceChildren();
        if (!game.roster.length) {
          const empty = document.createElement("p");
          empty.className = "shop__empty";
          empty.textContent = "まだ1体も居ません。上から雇いましょう。";
          owned.appendChild(empty);
        }
        for (const entry of game.roster) {
          const card = this._unitCard(entry.typeId, {
            star: entry.star,
            shop: true,
            place: entry.onBoard ? "出撃" : "控え",
            actions: [
              { act: "sell", label: `売却 ${game.refundOf(entry)}G`, cls: "cardbtn--sell" },
            ],
          });
          card.dataset.entryId = String(entry.id);
          owned.appendChild(card);
        }

        // --- 数値表示 ---
        p.querySelector("#shopGold").textContent = game.gold;
        p.querySelector("#shopLevel").textContent = game.level;
        const need = game.xpToNext;
        p.querySelector("#shopXp").textContent = need
          ? `${game.xp} / ${need} exp`
          : "最大レベル";
        p.querySelector("#shopXpBar").style.width = need
          ? `${Math.min(100, (game.xp / need) * 100)}%`
          : "100%";
        p.querySelector("#shopOdds").innerHTML = shopOddsFor(game.level)
          .map(
            (pct, i) =>
              `<span class="odds ${pct === 0 ? "odds--zero" : ""}">` +
              `<b>${i + 1}</b>コスト ${pct}%</span>`,
          )
          .join("");
        p.querySelector("#shopSlotsHead").textContent = this.isNarrow
          ? "品揃え — タップで詳細"
          : "品揃え — クリックで購入";
        p.querySelector("#shopSub").innerHTML =
          `ラウンド ${game.round} ／ 盤に出せるのは <b>レベルと同じ ${game.maxUnits} 体</b>`;
        p.querySelector("#shopNote").textContent = game.isRosterFull
          ? "所持数がいっぱいです"
          : `所持 ${game.roster.length} 体 — 出撃 ${game.squad.length} / 控え ${game.bench.length}`;
        p.querySelector('[data-act="xp"]').disabled =
          game.level >= MAX_LEVEL || game.gold < XP_BUY_COST;
        p.querySelector('[data-act="reroll"]').disabled = game.gold < REROLL_COST;
        closeBtn.disabled = first && game.squad.length === 0;
        onChange();
      };

      // フォーカス移動でパネルがスクロールするのを防ぐ
      this._on(p, "mousedown", (e) => {
        if (e.target.closest(".card")) e.preventDefault();
      });

      const buy = (slot) => {
        const res = game.buySlot(slot);
        if (res.ok) {
          const name = UNIT_TYPES[res.entry.typeId].name;
          this.toast(
            res.merged ? `${name} が ★${res.merged} に合体!` : `${name} を雇った`,
          );
        } else {
          this.toast(res.reason);
        }
        render();
      };

      const sell = (entry) => {
        this.toast(`${UNIT_TYPES[entry.typeId].name} を ${game.refundOf(entry)}G で売却`);
        game.sell(entry);
        render();
      };

      this._on(p, "click", (e) => {
        // カードの中のボタン（雇う / 売却）
        const btn = e.target.closest(".cardbtn");
        if (btn) {
          const host = btn.closest(".card");
          if (btn.dataset.act === "buy") {
            if (!btn.disabled) buy(Number(host.dataset.slot));
            return;
          }
          const entry = game.byId(Number(host.dataset.entryId));
          if (entry) sell(entry);
          return;
        }

        const card = e.target.closest(".card");
        if (!card) return;

        // 所持ユニット
        if (card.dataset.entryId !== undefined) {
          if (!this.isNarrow) return; // 横画面はカード内のボタンから
          const entry = game.byId(Number(card.dataset.entryId));
          if (!entry) return;
          this.showUnitSheet(entry.typeId, {
            star: entry.star,
            place: entry.onBoard ? "出撃中" : "控え",
            actions: [
              {
                label: `売却 ${game.refundOf(entry)}G`,
                cls: "btn--sell",
                run: () => sell(entry),
              },
            ],
          });
          return;
        }

        // 品揃え
        if (card.dataset.slot === undefined) return;
        const slot = Number(card.dataset.slot);
        const typeId = game.shop[slot];
        if (!typeId) return;

        // 狭い画面はカードに情報が乗らないので、本体タップで詳細を出す
        // （購入はカード内の「雇う」ボタン）
        if (this.isNarrow) {
          this.showUnitSheet(typeId);
          return;
        }
        if (card.dataset.disabled === "true") return;
        buy(slot);
      });

      // 抽選確率はレベルをタップしたときだけ出す（普段は畳んで縦を稼ぐ）
      const oddsBtn = p.querySelector('[data-act="odds"]');
      const oddsBox = p.querySelector("#shopOdds");
      oddsBox.hidden = this.isNarrow; // 横に広い画面は最初から開いておく
      oddsBtn.setAttribute("aria-expanded", String(!oddsBox.hidden));
      this._on(oddsBtn, "click", () => {
        oddsBox.hidden = !oddsBox.hidden;
        oddsBtn.setAttribute("aria-expanded", String(!oddsBox.hidden));
      });

      this._on(p.querySelector('[data-act="reroll"]'), "click", () => {
        const res = game.reroll();
        if (!res.ok) this.toast(res.reason);
        render();
      });

      this._on(p.querySelector('[data-act="xp"]'), "click", () => {
        const res = game.buyXp();
        if (!res.ok) this.toast(res.reason);
        else if (res.levelUps) this.toast(`レベル ${game.level} に上がった!`);
        render();
      });

      this._on(closeBtn, "click", () => {
        this.closeOverlay();
        resolve();
      });

      render();
    });
  }
  /**
   * ユニットカード。
   * actions を渡すと、クリックできるボタンを内側に持つ静的カードになる
   * （ボタンの入れ子を避けるため、その場合は div で作る）。
   */
  _unitCard(
    typeId,
    { star = 1, badge = "", shop = false, place = null, actions = null } = {},
  ) {
    const t = UNIT_TYPES[typeId];
    const s = buildStats(typeId, { star });
    const card = document.createElement(actions ? "div" : "button");
    if (!actions) card.type = "button";
    card.className = actions ? "card card--static" : "card";
    card.dataset.id = typeId;
    if (shop) {
      badge += `<span class="card__cost" data-tier="${t.cost}">${t.cost}G</span>`;
      if (place) badge += `<span class="card__place">${place}</span>`;
    }
    card.title = `${t.name}（${t.role}）\n移動: ${t.moveText}\n${t.skill.name}: ${t.skill.text}`;
    const hue = cssColorOf(typeId);
    card.style.setProperty("--hue", hue);
    card.innerHTML = `
      <div class="card__glyph" style="color:${hue}">${t.glyph}</div>
      <div class="card__name">${t.name}${star > 1 ? ` <span style="color:#f5c451">${"★".repeat(star)}</span>` : ""}</div>
      <div class="card__role">${t.role}</div>
      <div class="card__traits">${traitChips(t.traits)}</div>
      <div class="card__bars">
        ${bar("HP", clamp01(s.maxHp / (STAT_MAX.hp * star)), "hp")}
        ${bar("ATK", clamp01(s.atk / (STAT_MAX.atk * star)), "atk")}
        ${bar("RNG", clamp01(t.range / STAT_MAX.range), "rng")}
      </div>
      <div class="card__skill"><b>${t.skill.name}</b>${t.skill.text}</div>
      ${badge}
      ${
        actions
          ? `<div class="card__actions">${actions
              .map(
                (a) =>
                  `<button type="button" class="cardbtn ${a.cls ?? ""}" data-act="${a.act}"` +
                  `${a.disabled ? " disabled" : ""}>${a.label}</button>`,
              )
              .join("")}</div>`
          : ""
      }
    `;
    return card;
  }

  /**
   * ラウンド結果。
   * ★アップはショップでの3体合成に一本化したので、ここでは報酬を配らない。
   *
   * @returns {Promise<{action:'continue'|'shop'}>}
   */
  showRoundResult({ win, round, enemyName, mvp, life, income, gold, level }) {
    return new Promise((resolve) => {
      const p = this._openOverlay(`
        <div class="result-tag ${win ? "result-tag--win" : "result-tag--lose"}">
          ${win ? "VICTORY" : "DEFEAT"}
        </div>
        <h2>ラウンド ${round} ${win ? "突破" : "敗北"}</h2>
        <p style="margin-top:2px">
          ${
            win
              ? `<b>${enemyName}</b> を退けた。${mvp ? `MVP は <b style="color:#5ad2ff">${mvp.name}</b>（${mvp.damage} ダメージ）。` : ""}`
              : `<b>${enemyName}</b> に敗れた。残りライフ <b style="color:#ff6b6b">${"♥".repeat(life)}</b>`
          }
        </p>
        <p class="income">
          収入 <b>+${income.gain}G</b>
          <span class="income__break">
            （基本 ${income.base}${income.win ? ` ／ 勝利 +${income.win}` : ""}${income.streak ? ` ／ 連勝 +${income.streak}` : ""}）
          </span>
          → 所持 <b style="color:#f5c451">${gold}G</b>
        </p>
        <p class="income income--xp">
          経験値 <b>+${income.xp}</b>
          ${income.levelUps ? `→ <b style="color:#7ef2a8">レベル ${level} に上がった!</b>` : `／ 現在レベル ${level}`}
          <span class="income__break">（レベル＝盤に出せる人数）</span>
        </p>
        <p class="result-hint">
          ショップの品揃えは引き直されています。同じユニットを3体そろえると★アップします。
        </p>
        <div class="overlay__actions">
          <button class="btn btn--gold" data-act="shop">ショップへ</button>
          <button class="btn btn--primary" data-act="next">次へ</button>
        </div>
      `);

      const finish = (action) => {
        this.closeOverlay();
        resolve({ action });
      };
      this._on(p.querySelector('[data-act="next"]'), "click", () => finish("continue"));
      this._on(p.querySelector('[data-act="shop"]'), "click", () => finish("shop"));
    });
  }

  showGameOver({ round, best }) {
    return new Promise((resolve) => {
      const p = this._openOverlay(`
        <div class="result-tag result-tag--lose">GAME OVER</div>
        <h2>ラウンド ${round} で力尽きた</h2>
        <p>突破ラウンド数: <b>${round - 1}</b> ／ 自己ベスト: <b style="color:#f5c451">${best}</b></p>
        <p>編成と配置を変えれば結果は変わる。もう一度挑もう。</p>
        <div class="overlay__actions">
          <button class="btn btn--gold" data-act="retry">最初から挑戦する</button>
        </div>
      `);
      this._on(p.querySelector('[data-act="retry"]'), "click", () => {
        this.closeOverlay();
        resolve();
      });
    });
  }
}

/** 特性名の小さなチップ */
function traitChips(ids = []) {
  return ids
    .map((id) => {
      const t = TRAITS[id];
      if (!t) return "";
      return `<span class="traitchip" data-trait="${t.id}" role="button" tabindex="0"
        title="${t.name} — クリックで効果を表示" style="color:${t.color}">${t.name}</span>`;
    })
    .join("");
}

function bar(label, ratio, kind) {
  return `<div class="bar"><span>${label}</span>
    <span class="bar__track"><span class="bar__fill bar__fill--${kind}" style="width:${(ratio * 100).toFixed(0)}%"></span></span>
  </div>`;
}
