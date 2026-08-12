/**
 * DOM 側の UI（ヘッダー・ログ・インスペクタ・各種オーバーレイ）。
 *
 * オーバーレイは Promise を返すので、ゲーム進行側は
 * `const picks = await hud.showRosterSelect()` のように書ける。
 */

import {
  STAT_MAX,
  UNIT_TYPES,
  UNIT_IDS,
  buildStats,
  cssColorOf,
  rarityInfo,
  rarityOf,
} from "../core/units.js";
import { TRAITS, activeTraits } from "../core/traits.js";
import {
  Phase,
  MAX_LEVEL,
  XP_BUY_COST,
  XP_BUY_AMOUNT,
  shopOddsFor,
} from "../core/game.js";

const $ = (id) => document.getElementById(id);
const clamp01 = (v) => Math.max(0, Math.min(1, v));

export class Hud {
  constructor({
    onStart,
    onSpeedToggle,
    onHelp,
    onShop,
    onEnemyInfo = () => {},
    onBenchToggle = () => {},
    sound = null,
  }) {
    /** @type {import("../audio/sound.js").Sound|null} */
    this.sound = sound;
    this.el = {
      round: $("statRound"),
      life: $("statLife"),
      streak: $("statStreak"),
      gold: $("statGold"),
      level: $("statLevel"),
      xp: $("statXp"),
      toast: $("toast"),
      btnShop: $("btnShop"),
      btnBench: $("btnBench"),
      opening: $("statOpening"),
      actionbar: $("actionbar"),
      actionHint: $("actionHint"),
      btnStart: $("btnStart"),
      btnSpeed: $("btnSpeed"),
      btnSound: $("btnSound"),
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
    this.el.btnBench.addEventListener("click", () => onBenchToggle());
    this._setupSound();
    // ヒントは毎回 innerHTML で描き直すので、委譲で拾う
    this.el.actionHint.addEventListener("click", (e) => {
      if (e.target.closest('[data-act="enemyInfo"]')) onEnemyInfo();
    });

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

    // 縦画面のインスペクタは既定でたたんである。叩くと詳細まで開く
    this.el.inspector.addEventListener("click", (e) => {
      if (e.target.closest("[data-trait]")) return; // 特性チップは別処理
      const el = this.el.inspector;
      el.dataset.expanded = el.dataset.expanded === "true" ? "false" : "true";
    });
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
  showUnitSheet(typeId, { star = 1, place = null, actions = [], power = 1 } = {}) {
    const t = UNIT_TYPES[typeId];
    const s = buildStats(typeId, { star, power });
    const hue = cssColorOf(typeId);
    const rar = rarityOf(typeId);

    const rows = [
      ["HP", s.maxHp],
      ["攻撃力", s.atk],
      ["攻撃速度", `${s.attackSpeed.toFixed(2)} 回/秒`],
      ["射程", `${s.range} マス`],
      ["防御", s.armor],
      ["魔法防御", s.resist],
    ];

    // 相手のコマは買えるものではないので、値札は出さない
    const foe = place === "敵";

    this._sheet.style.setProperty("--rarity", rar.color);
    this._sheet.dataset.rarity = rar.id;
    this._sheet.innerHTML = `
      <div class="unitsheet__head">
        <span class="unitsheet__glyph" style="color:${hue};box-shadow:inset 0 0 0 2px ${hue}55">${
          foe ? t.glyphDark : t.glyph
        }</span>
        <div class="unitsheet__id">
          <div class="unitsheet__name"${foe ? ' style="color:#ff6b6b"' : ""}>${t.name}${
            star > 1 ? ` <span class="unitsheet__stars">${"★".repeat(star)}</span>` : ""
          }</div>
          <div class="unitsheet__role">
            <span class="unitsheet__rarity">${rar.name}</span> ・ ${t.role}${
              place ? ` ・ ${place}` : ""
            }
          </div>
        </div>
        ${foe ? "" : `<span class="unitsheet__cost">${t.cost}G</span>`}
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
    const members = UNIT_IDS
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

    for (const entry of list) this.el.traitList.appendChild(this._traitItem(entry));
  }

  /** 特性パネルの1行。敵の編成表でも同じものを使う */
  _traitItem({ trait, count, tier, next }) {
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
    return li;
  }

  /**
   * 次の相手の編成。
   * 特性は敵にも同じルールで乗るので、何が発動しているかまで見せる。
   *
   * @param {{name:string, star:number, power:number, units:{typeId:string}[]}} wave
   */
  showEnemyInfo(wave) {
    if (!wave) return;
    const list = activeTraits(
      wave.units.map((u) => ({ typeId: u.typeId, def: UNIT_TYPES[u.typeId] })),
    );
    const active = list.filter((t) => t.tier);

    const p = this._openOverlay(`
      <div class="shop__head">
        <h2>次の相手</h2>
        <p class="shop__sub">
          <b style="color:#ff6b6b">${wave.name}</b> ・ ★${wave.star} ・ ${wave.units.length}体
        </p>
      </div>
      <h3>発動している特性${active.length ? "" : " — なし"}</h3>
      <ul class="traits__list traits__list--flat" id="enemyTraits"></ul>
      <h3>編成 — タップで詳細</h3>
      <div class="roster roster--enemy" id="enemyUnits"></div>
      <p class="shop__hint">
        盤の上の相手のコマを直接タップしても、同じ詳細が出ます。
      </p>
      <div class="overlay__actions">
        <button class="btn btn--primary" data-act="close">閉じる</button>
      </div>
    `);

    const traitBox = p.querySelector("#enemyTraits");
    if (active.length) {
      for (const entry of active) traitBox.appendChild(this._traitItem(entry));
    } else {
      traitBox.remove();
    }

    const box = p.querySelector("#enemyUnits");
    // 同じ種類が複数いるので、まとめて「×2」で出す
    const seen = new Map();
    for (const u of wave.units) seen.set(u.typeId, (seen.get(u.typeId) ?? 0) + 1);
    for (const [typeId, n] of seen) {
      const card = this._unitCard(typeId, {
        star: wave.star,
        power: wave.power,
        dark: true,
        badge: n > 1 ? `<span class="card__count">×${n}</span>` : "",
      });
      card.dataset.enemy = typeId;
      box.appendChild(card);
    }

    this._on(box, "click", (e) => {
      const card = e.target.closest(".card");
      if (!card?.dataset.enemy) return;
      this.showUnitSheet(card.dataset.enemy, {
        star: wave.star,
        power: wave.power,
        place: "敵",
      });
    });

    this._on(p.querySelector('[data-act="close"]'), "click", () => this.closeOverlay());
  }

  /**
   * 選んでいるコマを控え/盤へ移すボタン。
   * 控え列は狙いにくいので、確実な導線を用意しておく。
   * @param {{onBoard:boolean, name:string}|null} picked
   */
  setBenchToggle(picked) {
    const el = this.el.btnBench;
    el.hidden = !picked;
    if (!picked) return;
    el.textContent = picked.onBoard ? `${picked.name} を控えへ` : `${picked.name} を出す`;
  }

  /**
   * 音の配線。
   *   - 最初のタップで AudioContext を作る（自動再生規制のため）
   *   - 押せるものはすべて委譲でタップ音を鳴らす（data-sfx で音を変えられる）
   *   - 🔊 ボタンで BGM+SE → SEのみ → 消音 と切り替える
   */
  _setupSound() {
    const btn = this.el.btnSound;
    if (!this.sound) {
      if (btn) btn.hidden = true;
      return;
    }

    window.addEventListener("pointerdown", () => this.sound.unlock(), { capture: true });
    this.sound.bindVisibility();

    // 押せるものならタップ音。data-sfx="off" を付けたものだけ黙らせる
    document.addEventListener(
      "pointerdown",
      (e) => {
        const el = e.target.closest(
          "button, .card, .opening__head, .traitchip, .trait, .shop__levelHead",
        );
        if (!el || el.disabled || el.dataset.sfx === "off") return;
        this.sound.sfx(el.dataset.sfx || "tap");
      },
      { capture: true },
    );

    const LABEL = {
      all: { icon: "🔊", title: "音: BGM + 効果音" },
      se: { icon: "🔈", title: "音: 効果音のみ" },
      off: { icon: "🔇", title: "音: 消音" },
    };
    const paint = () => {
      const l = LABEL[this.sound.mode] ?? LABEL.all;
      btn.textContent = l.icon;
      btn.title = `${l.title}（押すと切替）`;
    };
    btn.dataset.sfx = "off"; // 切替後の状態が分かるよう、押した音は下で鳴らす
    btn.addEventListener("click", () => {
      this.sound.unlock();
      this.sound.cycleMode();
      paint();
      this.sound.sfx("tap");
    });
    paint();
  }

  /** 効果音。音が無効なら何も起きない */
  se(name) {
    this.sound?.sfx(name);
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

  /** 戦況ログはバトル中だけ出す */
  setPhase(phase) {
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

  /**
   * ホーム画面。ここから始めて、力尽きたらここへ戻ってくる。
   *
   * @param {{best:number, points:number, gained?:number|null}} state
   *   gained … 直前のランで得たポイント（戻ってきた直後だけ出す）
   * @returns {Promise<void>} プレイを押したら解決する
   */
  showHome({ best = 0, points = 0, gained = null } = {}) {
    return new Promise((resolve) => {
      // 初挑戦のときだけ、ここにルールの要点も出す
      const firstTime = best === 0 && points === 0;

      const render = () => {
        const p = this._openOverlay(`
          <h1 class="title">AUTO CHESS ARENA</h1>
          <p class="subtitle">チェス盤オートバトル ・ 全26種</p>

          <div class="home__stats">
            <div class="home__stat home__stat--points">
              <span class="home__statLabel">ポイント</span>
              <span class="home__statValue">${points.toLocaleString("ja-JP")}</span>
              ${gained ? `<span class="home__statGain">+${gained.toLocaleString("ja-JP")}</span>` : ""}
            </div>
            <div class="home__stat">
              <span class="home__statLabel">自己ベスト</span>
              <span class="home__statValue">${best > 0 ? `R${best}` : "—"}</span>
              <span class="home__statSub">${best > 0 ? "突破ラウンド" : "まだ挑戦していません"}</span>
            </div>
          </div>

          <p class="home__lead">
            ショップでユニットを雇い、盤に並べて、あとは見守るだけ。
            コマは<b>それぞれの動き方</b>で敵に迫り、マナが満ちるとスキルを放ちます。
            力尽きるまでのラウンド数と編成の厚さが<b>ポイント</b>になります。
          </p>
          ${
            firstTime
              ? `<h3>ルール</h3>
                 <ol class="helplist">
                   <li><b>ショップ</b> — 5枠の品揃えから雇う。リロールで引き直せる</li>
                   <li><b>レベル</b> — 盤に出せる人数＝レベル。上位レアリティも出やすくなる</li>
                   <li><b>合成</b> — 同じユニットが3体そろうと自動で★アップ</li>
                   <li><b>特性</b> — 盤の顔ぶれでバフが発動。特性名を押すと効果が出る</li>
                   <li><b>定跡</b> — 開幕と R6/R12/R18 で1つ選ぶ。ラン全体に効き、積み重なる</li>
                   <li><b>バトル</b> — 自動で戦闘。負けるとライフが1減り、0でゲームオーバー</li>
                 </ol>`
              : ""
          }

          <div class="overlay__actions overlay__actions--home">
            <button class="btn" data-act="help">遊びかた</button>
            <button class="btn btn--primary btn--play" data-act="play">▶ プレイ</button>
          </div>
        `);
        this._on(p.querySelector('[data-act="play"]'), "click", () => {
          this.closeOverlay();
          resolve();
        });
        // 遊びかたは同じオーバーレイを使うので、閉じたらホームを描き直す
        this._on(p.querySelector('[data-act="help"]'), "click", () =>
          this.showHelp({ onClose: render }),
        );
      };

      render();
    });
  }

  /**
   * オープニング（開幕定跡）を選ぶ。ランの最初に一度だけ。
   *
   * @param {object[]} choices openings.js の定義
   * @returns {Promise<object>} 選んだもの
   */
  showOpeningSelect({
    choices,
    first = false,
    taken = [],
    rerollsLeft = 0,
    onReroll,
    squad = [],
    traits = [],
  }) {
    return new Promise((resolve) => {
      const active = traits.filter((t) => t.tier);
      const p = this._openOverlay(`
        <div class="shop__head">
          <h2>${first ? "開幕の定跡" : "定跡を1つ足す"}</h2>
          <p class="shop__sub">
            ${first ? "ラン全体に効きます" : `いま${taken.length}個 ／ 積み重なります`}
          </p>
        </div>
        ${
          // 初回は手持ちが無いので出さない。以降は空でも出して現状が分かるようにする
          first && !squad.length && !active.length
            ? ""
            : `<div class="pickstate">
                 <div class="pickstate__row" id="pickUnits"></div>
                 <div class="pickstate__row" id="pickTraits"></div>
               </div>`
        }
        <div class="openings openings--pick" id="openingList"></div>
        <div class="overlay__actions overlay__actions--pick">
          <button class="btn" data-act="reroll" id="openingReroll"></button>
          <button class="btn btn--primary" id="openingTake" disabled>定跡を選ぶ</button>
        </div>
      `);

      // --- いまの編成（これを見て定跡を選べるように）
      const unitBox = p.querySelector("#pickUnits");
      if (unitBox) {
        if (squad.length) {
          unitBox.innerHTML =
            `<span class="pickstate__label">編成</span>` +
            squad
              .map(
                (u) =>
                  `<span class="pickchip" style="--hue:${cssColorOf(u.typeId)}">` +
                  `${UNIT_TYPES[u.typeId].glyph}${UNIT_TYPES[u.typeId].name}` +
                  `${u.star > 1 ? `<b>★${u.star}</b>` : ""}</span>`,
              )
              .join("");
        } else {
          unitBox.innerHTML = `<span class="pickstate__label">編成</span>
            <span class="pickstate__empty">まだ1体も居ません</span>`;
        }
      }
      const traitBox = p.querySelector("#pickTraits");
      if (traitBox) {
        traitBox.innerHTML =
          `<span class="pickstate__label">特性</span>` +
          (active.length
            ? active
                .map(
                  (t) =>
                    `<span class="pickchip pickchip--trait" style="--hue:${t.trait.color}">` +
                    `${t.trait.name}<b>${t.count}</b></span>`,
                )
                .join("")
            : `<span class="pickstate__empty">発動しているものはありません</span>`);
      }

      const box = p.querySelector("#openingList");
      const rerollBtn = p.querySelector("#openingReroll");
      const takeBtn = p.querySelector("#openingTake");
      let left = rerollsLeft;
      /** いま開いて選んでいる定跡 */
      let chosen = null;

      const setChosen = (o, card) => {
        chosen = o;
        for (const c of box.children) c.dataset.open = "false";
        if (card) card.dataset.open = "true";
        takeBtn.disabled = !o;
        takeBtn.textContent = o ? `${o.name} にする` : "定跡を選ぶ";
      };

      const render = (list) => {
        box.replaceChildren();
        for (const o of list) {
          // 既定はたたんだ状態。叩くと説明と効果が開き、決定は下のボタンで行う
          const card = document.createElement("div");
          card.className = "opening opening--fold";
          card.dataset.open = "false";
          card.style.setProperty("--tint", o.color);
          card.innerHTML = `
            <button type="button" class="opening__head">
              <span class="opening__icon">${o.icon}</span>
              <span class="opening__id">
                <span class="opening__name">${o.name}</span>
                <span class="opening__en">${o.en}</span>
              </span>
              <span class="opening__tags">${o.effects.length}件</span>
              <span class="opening__caret" aria-hidden="true">▾</span>
            </button>
            <div class="opening__body">
              <p class="opening__desc">${o.desc}</p>
              <ul class="opening__effects">
                ${o.effects.map((t) => `<li>${t}</li>`).join("")}
              </ul>
            </div>
          `;
          this._on(card.querySelector(".opening__head"), "click", () => {
            setChosen(card.dataset.open === "true" ? null : o, card);
          });
          box.appendChild(card);
        }
        setChosen(null, null);
        rerollBtn.textContent = `引き直す（残り${left}）`;
        rerollBtn.disabled = left <= 0;
      };

      this._on(takeBtn, "click", () => {
        if (!chosen) return;
        this.se("select");
        this.closeOverlay();
        resolve(chosen);
      });

      this._on(rerollBtn, "click", () => {
        const res = onReroll?.();
        if (!res?.ok) {
          this.toast(res?.reason ?? "引き直せません");
          this.se("error");
          return;
        }
        this.se("reroll");
        left = res.left;
        render(res.choices);
      });

      render(choices);
    });
  }

  /** いま効いている定跡をヘッダーに出す。押すと効果を出す */
  setOpenings(list) {
    const el = this.el.opening;
    if (!el) return;
    this._openings = list ?? [];
    el.hidden = !this._openings.length;
    if (!this._openings.length) return;
    const last = this._openings[this._openings.length - 1];
    const name =
      this._openings.length > 1 ? `${last.name} +${this._openings.length - 1}` : last.name;
    // 絵柄は常に、名前は幅に余裕があるときだけ（スマホでは CSS で隠す）
    el.innerHTML =
      `<span class="openingtag__icon">${this._openings.map((o) => o.icon ?? "♟").join("")}</span>` +
      `<span class="openingtag__name">${name}</span>`;
    el.title = `定跡 ${this._openings.length}個 — クリックで効果を表示`;
    if (!el.dataset.wired) {
      el.dataset.wired = "1";
      el.addEventListener("click", () => this.showOpeningInfo());
    }
  }

  /** 選んだ定跡の効果を見返す */
  showOpeningInfo() {
    const list = this._openings ?? [];
    if (!list.length) return;
    const p = this._openOverlay(`
      <div class="shop__head">
        <h2>いま効いている定跡</h2>
        <p class="shop__sub">${list.length}個</p>
      </div>
      <div class="openings openings--taken">
        ${list
          .map(
            (o) => `
          <div class="opening opening--static">
            <div class="opening__name">${o.name}</div>
            <div class="opening__en">${o.en}</div>
            <ul class="opening__effects">
              ${o.effects.map((t) => `<li>${t}</li>`).join("")}
            </ul>
          </div>`,
          )
          .join("")}
      </div>
      <p class="shop__hint">定跡はラン中ずっと効いていて、途中で変えることはできません。</p>
      <div class="overlay__actions">
        <button class="btn btn--primary" data-act="close">閉じる</button>
      </div>
    `);
    this._on(p.querySelector('[data-act="close"]'), "click", () => this.closeOverlay());
  }

  /** 遊びかた（いつでも閉じられる） */
  /** @param {{onClose?: () => void}} opts 閉じたあとに別の画面へ戻したいとき用 */
  showHelp({ onClose = null } = {}) {
    const p = this._openOverlay(`
      <h2>遊びかた</h2>
      <h3>操作</h3>
      <ul class="helplist">
        <li><b>タップして、置きたいマスをタップ</b> — 準備フェーズ中の配置。ドラッグでも同じことができます</li>
        <li>味方のいるマスへ置くと<b>入れ替え</b>。盤のさらに手前の列が<b>控え</b>で、そこへ置くと出撃メンバーから外れます</li>
        <li>コマは<b>マスのどこを叩いても</b>掴めます。細いコマを正確に突く必要はありません</li>
        <li>コマを選ぶと下に<b>「◯◯ を控えへ」</b>ボタンが出ます。控え列を狙わなくても入れ替えられます</li>
        <li><b>クリック</b> — コマの詳細（ステータス・スキル）を表示。<b>相手のコマも見られます</b></li>
        <li><b>「次の相手は ◯◯」</b> — 押すと相手の編成と、相手側で発動している特性が出ます</li>
        <li><b>ホイール / 2本指ピンチ</b> — ズーム（盤の向きは固定です）</li>
        <li><kbd>Space</kbd> — バトル開始 / 速度切替</li>
        <li><b>🔊</b> — 押すたびに BGM+効果音 → 効果音のみ → 消音 と切り替わります</li>
      </ul>
      <h3>ショップとレベル</h3>
      <ul class="helplist">
        <li>ショップの<b>5枠</b>はレベルに応じた確率で抽選されます。ラウンドごとに無料で更新</li>
        <li><b>予約</b> — 枠の左上の 📍 を押すと、その枠だけリロールとラウンド跨ぎで残せます（1枠のみ）</li>
        <li><b>盤に出せる人数＝レベル</b>。${XP_BUY_COST}Gで${XP_BUY_AMOUNT}exp買えるほか、ラウンドごとに自動で入ります</li>
        <li>レベルが上がると<b>高コストのユニットが出やすく</b>なります（5コストはレベル7から）</li>
        <li>同じユニットが<b>3体そろうと自動で★アップ</b>。★2が3体そろえば★3になります</li>
        <li>控えに置いたユニットは戦闘に出ませんが、合成の数には入ります</li>
        <li>収入はラウンドごとに基本10G＋勝利4G＋連勝ボーナス（最大5G）</li>
      </ul>
      <h3>定跡</h3>
      <ul class="helplist">
        <li>ランの最初と、<b>ラウンド6 / 12 / 18</b> の区切りで、3つの候補から1つ選びます</li>
        <li>選んだものは<b>積み上がって</b>ラン中ずっと効きます。途中で捨てることはできません</li>
        <li>候補は<b>ラン全体で2回まで引き直せます</b>。一度取った定跡は候補に出ません</li>
        <li>ゴールドやライフ、リロールの値段、ショップの枠、相手の強さなどが変わります</li>
        <li>特性の<b>種類数に下駄</b>をはかせる定跡もあります（ユニットが0体でも1種として数えます）</li>
        <li>候補は<b>タップすると説明と効果が開きます</b>。開いてから「この定跡にする」で決定します</li>
        <li>選ぶ画面には<b>いまの編成と発動中の特性</b>が出るので、噛み合うものを選べます</li>
        <li>効果を見返したいときは、画面上のヘッダーにある定跡の絵柄を押してください</li>
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
      <h3>ポイント</h3>
      <ul class="helplist">
        <li>ライフが尽きるとホーム画面に戻り、そのランの成果が<b>ポイント</b>になって貯まります</li>
        <li>内訳は<b>突破ラウンド×12</b>と<b>編成の価値×3</b>（＋自己ベスト更新で50）</li>
        <li>編成の価値はユニットの<b>コスト×3^(★-1)</b>の合計。控えのユニットも数に入ります</li>
        <li>ポイントと自己ベストはブラウザに保存されます（使いみちは今後追加予定）</li>
      </ul>
      <div class="overlay__actions">
        <button class="btn btn--primary" data-act="close">閉じる</button>
      </div>
    `);
    this._on(p.querySelector('[data-act="close"]'), "click", () => {
      if (onClose) onClose();
      else this.closeOverlay();
    });
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
          <h2>ショップ</h2>
          <p class="shop__sub" id="shopSub"></p>
        </div>

        <div class="shop__bar">
          <div class="shop__level">
            <div class="shop__levelTop">
              <button type="button" class="shop__levelHead" data-act="odds"
                aria-expanded="false" aria-controls="shopOdds">
                <span>レベル <b id="shopLevel">3</b></span>
                <span id="shopXp"></span>
                <span class="shop__caret" aria-hidden="true">▾</span>
              </button>
              <span class="shop__wallet"><b id="shopGold">0</b>G</span>
            </div>
            <span class="xpbar xpbar--wide"><span class="xpbar__fill" id="shopXpBar"></span></span>
            <div class="shop__odds" id="shopOdds" hidden></div>
          </div>
          <div class="shop__buttons">
            <button class="btn btn--gold" data-act="xp">
              経験値を買う <span class="btn__sub">${XP_BUY_COST}G で ${XP_BUY_AMOUNT}exp</span>
            </button>
            <button class="btn" data-act="reroll">
              リロール <span class="btn__sub" id="shopRerollCost">${game.rerollCost}G</span>
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
            keep: game.locked === i,
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
          .map((pct, i) => {
            const r = rarityInfo(i + 1);
            return (
              `<span class="odds ${pct === 0 ? "odds--zero" : ""}">` +
              `<b style="color:${r.color}">${r.name}</b> ${pct}%</span>`
            );
          })
          .join("");
        p.querySelector("#shopSlotsHead").textContent = this.isNarrow
          ? "品揃え — タップで詳細"
          : "品揃え — クリックで購入";
        p.querySelector("#shopSub").innerHTML =
          `R${game.round} ・ 盤に <b>${game.maxUnits}体</b>まで`;
        p.querySelector("#shopNote").textContent = game.isRosterFull
          ? "所持数がいっぱいです"
          : `所持 ${game.roster.length} 体 — 出撃 ${game.squad.length} / 控え ${game.bench.length}`;
        p.querySelector('[data-act="xp"]').disabled =
          game.level >= MAX_LEVEL || game.gold < XP_BUY_COST;
        p.querySelector("#shopRerollCost").textContent = `${game.rerollCost}G`;
        p.querySelector('[data-act="reroll"]').disabled = game.gold < game.rerollCost;
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
          this.se(res.merged ? "merge" : "buy");
        } else {
          this.toast(res.reason);
          this.se("error");
        }
        render();
      };

      const sell = (entry) => {
        this.toast(`${UNIT_TYPES[entry.typeId].name} を ${game.refundOf(entry)}G で売却`);
        this.se("sell");
        game.sell(entry);
        render();
      };

      this._on(p, "click", (e) => {
        // 枠の予約（リロールとラウンド跨ぎで残る枠を1つだけ選べる）
        const keepBtn = e.target.closest('[data-act="keep"]');
        if (keepBtn) {
          const slot = Number(keepBtn.closest(".card").dataset.slot);
          const res = game.toggleLock(slot);
          if (!res.ok) this.toast(res.reason);
          else {
            this.toast(
              res.locked === null
                ? "予約を解除した"
                : `${UNIT_TYPES[game.shop[slot]].name} の枠を予約した`,
            );
          }
          render();
          return;
        }

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
        if (!res.ok) {
          this.toast(res.reason);
          this.se("error");
        } else {
          this.se("reroll");
        }
        render();
      });

      this._on(p.querySelector('[data-act="xp"]'), "click", () => {
        const res = game.buyXp();
        if (!res.ok) {
          this.toast(res.reason);
          this.se("error");
        } else if (res.levelUps) {
          this.toast(`レベル ${game.level} に上がった!`);
          this.se("levelup");
        }
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
    {
      star = 1,
      badge = "",
      shop = false,
      place = null,
      actions = null,
      power = 1,
      dark = false,
      keep = null,
    } = {},
  ) {
    const t = UNIT_TYPES[typeId];
    const s = buildStats(typeId, { star, power });
    // 中にボタンを置くときは、button の入れ子を避けて div で作る
    const nested = !!actions || keep !== null;
    const card = document.createElement(nested ? "div" : "button");
    if (!nested) card.type = "button";
    card.className = nested ? "card card--static" : "card";
    if (keep !== null) {
      card.dataset.kept = keep ? "true" : "false";
      badge +=
        `<button type="button" class="card__keep" data-act="keep"` +
        ` aria-pressed="${keep}" title="${keep ? "予約をやめる" : "この枠を予約する"}">` +
        `${keep ? "📌" : "📍"}</button>`;
    }
    card.dataset.id = typeId;
    if (shop) {
      badge += `<span class="card__cost">${t.cost}G</span>`;
      if (place) badge += `<span class="card__place">${place}</span>`;
    }
    const rar = rarityOf(typeId);
    card.title =
      `${t.name}（${rar.name} / ${t.role}）\n移動: ${t.moveText}\n${t.skill.name}: ${t.skill.text}`;
    const hue = cssColorOf(typeId);
    card.style.setProperty("--hue", hue);
    // 縁の色はレアリティ。中の差し色（--hue）は種類の識別用で別もの
    card.style.setProperty("--rarity", rar.color);
    card.dataset.rarity = rar.id;
    card.innerHTML = `
      <div class="card__glyph" style="color:${hue}">${dark ? t.glyphDark : t.glyph}</div>
      <div class="card__name">${t.name}${star > 1 ? ` <span style="color:#f5c451">${"★".repeat(star)}</span>` : ""}</div>
      <div class="card__rarity">${rar.name}</div>
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

  /**
   * ゲームオーバー。獲得ポイントの内訳を出してからホームへ返す。
   *
   * @param {{round:number, best:number, earned?:object|null, points?:number}} p
   *   earned … points.js の scoreRun の戻り値
   *   points … 加算後の総ポイント
   */
  showGameOver({ round, best, earned = null, points = 0 }) {
    return new Promise((resolve) => {
      const p = this._openOverlay(`
        <div class="result-tag result-tag--lose">GAME OVER</div>
        <h2>ラウンド ${round} で力尽きた</h2>
        <p>突破ラウンド数: <b>${round - 1}</b> ／ 自己ベスト: <b style="color:#f5c451">${best}</b></p>
        ${
          earned
            ? `<div class="earn">
                 <div class="earn__head">
                   <span class="earn__label">獲得ポイント</span>
                   <span class="earn__total">+${earned.total.toLocaleString("ja-JP")}</span>
                 </div>
                 <ul class="earn__rows">
                   ${earned.rows
                     .map(
                       (r) =>
                         `<li><span>${r.label}</span><b>+${r.value.toLocaleString("ja-JP")}</b></li>`,
                     )
                     .join("")}
                 </ul>
                 <div class="earn__foot">
                   通算 <b>${points.toLocaleString("ja-JP")}</b> ポイント
                 </div>
               </div>`
            : ""
        }
        <p>編成と配置を変えれば結果は変わる。もう一度挑もう。</p>
        <div class="overlay__actions">
          <button class="btn btn--gold" data-act="retry">ホームへ戻る</button>
        </div>
      `);
      // 内訳が出たところでポイントの音を重ねる
      if (earned?.total) setTimeout(() => this.se("point"), 260);

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
