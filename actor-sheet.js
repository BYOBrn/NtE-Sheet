/**
 * Not the End — Actor Sheet (DocumentSheetV2, Foundry v13) + Sacchetto Token
 */

const { ApplicationV2, DocumentSheetV2, HandlebarsApplicationMixin } = foundry.applications.api;
const MODULE = "not-the-end";
const SOCKET = `module.${MODULE}`;

// Alveare 3-4-5-4-3 = 19 esagoni ('a' abilità, 'q' qualità, 'arc' archetipo)
const HIVE_ROWS = [
  ["a", "a", "a"],
  ["a", "q", "q", "a"],
  ["a", "q", "arc", "q", "a"],
  ["a", "q", "q", "a"],
  ["a", "a", "a"],
];
const HIVE_LABELS = { a: "Abilità", q: "Qualità", arc: "Archetipo" };

// Geometria alveare (px) — deve combaciare con .nte-hive / .nte-hex nel CSS
const HIVE_W = 560, HEX_W = 110, STEP_X = 108, STEP_Y = 96, HIVE_TOP = 20;

function defaultFlags() {
  return {
    concetto:   "",
    rischio:    "",
    appunti:    "",
    equip:      "",
    sventure:   Array.from({ length: 4 }, () => ({ testo: "", checked: false })),
    confusione: [false],
    adrenalina: [false],
    lezioni:    ["", "", "", ""],
    // hive_{riga}_{colonna}_testo / _checked: letti on demand
  };
}

export class NTEActorSheet extends HandlebarsApplicationMixin(DocumentSheetV2) {

  static DEFAULT_OPTIONS = {
    classes:  ["nte-sheet-window"],
    position: { width: 780, height: 920 },
    window:   { resizable: true },
    actions:  { openTokenBag: NTEActorSheet.#openTokenBag },
  };

  static PARTS = {
    sheet: { template: `modules/${MODULE}/templates/actor-sheet.hbs` },
  };

  #tokenBag = null;

  get title() { return this.document?.name ?? "Scheda"; }

  _f() {
    return foundry.utils.mergeObject(
      defaultFlags(),
      foundry.utils.deepClone(this.document?.flags?.[MODULE] ?? {}),
      { inplace: false }
    );
  }

  _buildHive(flags) {
    const hive = [];
    HIVE_ROWS.forEach((row, ri) => {
      row.forEach((type, ci) => {
        hive.push({
          ri, ci, type,
          left:    Math.round(HIVE_W / 2 - HEX_W / 2 + (ci - (row.length - 1) / 2) * STEP_X),
          top:     HIVE_TOP + ri * STEP_Y,
          label:   HIVE_LABELS[type],
          testo:   flags[`hive_${ri}_${ci}_testo`] ?? "",
          checked: !!flags[`hive_${ri}_${ci}_checked`],
        });
      });
    });
    return hive;
  }

  async _prepareContext(options) {
    const ctx = await super._prepareContext(options);
    const flags = this._f();
    return { ...ctx, actor: this.document, flags, hive: this._buildHive(flags) };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this._activateListeners();
  }

  _activateListeners() {
    const el = this.element;

    el.querySelector(".nte-name")?.addEventListener("change", async ev => {
      await this.document.update({ name: ev.currentTarget.value });
    });

    el.querySelector(".nte-avatar")?.addEventListener("click", () => {
      const FP = foundry.applications.apps.FilePicker.implementation;
      new FP({
        type:     "image",
        current:  this.document.img,
        callback: async path => { await this.document.update({ img: path }); },
      }).browse();
    });

    el.querySelectorAll("input[data-flag]:not([type=checkbox]), textarea[data-flag]").forEach(f => {
      f.addEventListener("change", ev => this._setFlag(ev.currentTarget.dataset.flag, ev.currentTarget.value));
    });

    el.querySelectorAll("input[type=checkbox][data-flag]").forEach(f => {
      f.addEventListener("change", ev => this._setFlag(ev.currentTarget.dataset.flag, ev.currentTarget.checked));
    });

    el.querySelectorAll(".nte-hex-text[data-ri][data-ci]").forEach(f => {
      f.addEventListener("change", ev => {
        const { ri, ci } = ev.currentTarget.dataset;
        return this.document.setFlag(MODULE, `hive_${ri}_${ci}_testo`, ev.currentTarget.value);
      });
    });

    el.querySelectorAll(".nte-dot[data-ri][data-ci]").forEach(dot => {
      dot.addEventListener("click", ev => {
        const { ri, ci } = ev.currentTarget.dataset;
        const key = `hive_${ri}_${ci}_checked`;
        return this.document.setFlag(MODULE, key, !this.document.getFlag(MODULE, key));
      });
    });
  }

  async _setFlag(key, value) {
    const parts = key.split(".");
    if (parts.length === 1) return this.document.setFlag(MODULE, key, value);
    const arr = foundry.utils.deepClone(this._f()[parts[0]] ?? []);
    const idx = Number(parts[1]);
    if (parts.length === 2) arr[idx] = value;
    else if (parts.length === 3) arr[idx] = { ...(arr[idx] ?? {}), [parts[2]]: value };
    else return;
    return this.document.setFlag(MODULE, parts[0], arr);
  }

  static #openTokenBag(event, target) {
    this.#tokenBag ??= new NTETokenBagApp(this.document);
    this.#tokenBag.render({ force: true });
  }
}

// ====================================================================
// SACCHETTO TOKEN
// 1. Inserisci token: ⚪ positivi, ⚫ negativi, ❓ casuali (max 4 per tipo)
// 2. Prima estrazione: 1 token, poi scegli se fermarti o rischiare
// 3. Se rischi, si estrae fino a un totale di 5 token
// I rimanenti vengono inviati al GM via socket: il messaggio lo crea il client GM.
// ====================================================================

const SYMBOL = { pos: "⚪", neg: "⚫", rnd: "❓" };
const NAME   = { pos: "Positivi", neg: "Negativi", rnd: "Casuali" };
const TYPES  = ["pos", "neg", "rnd"];
const MAX_PER_TYPE = 4;
const RISK_TOTAL   = 5;
const esc = s => Handlebars.Utils.escapeExpression(s);

const symbols = list => list.map(t => SYMBOL[t]).join(" ") || "—";

function countOf(list, type) { return list.filter(t => t === type).length; }

/** Crea il messaggio per il GM (solo whisper ai GM). Eseguito sul client GM. */
async function postRemainingToGM({ actorName, userName, inserted, drawn, decision, remaining }) {
  const azione = decision === "risk" ? "ha rischiato" : "si è fermato";
  const ins = TYPES.map(t => `${SYMBOL[t]} ${inserted[t]}`).join(", ");
  const rest = `${SYMBOL.pos} ${countOf(remaining, "pos")}, ${SYMBOL.neg} ${countOf(remaining, "neg")} (totale ${remaining.length})`;
  await ChatMessage.create({
    whisper: ChatMessage.getWhisperRecipients("GM").map(u => u.id),
    speaker: { alias: "Sacchetto" },
    content: `<div class="nte-chat-draw"><b>${esc(actorName)}</b> (${esc(userName)}) ${azione}: ${symbols(drawn)}<br>Inseriti: ${ins}<br>Rimasti: ${rest}</div>`,
  });
}

export function registerTokenBagSocket() {
  game.socket.on(SOCKET, async data => {
    if (data?.type !== "tokenBagRemaining") return;
    if (game.user !== game.users.activeGM) return;   // risponde un solo GM
    await postRemainingToGM(data);
  });
}

function sendRemainingToGM(data) {
  if (game.user.isGM) return postRemainingToGM(data);
  game.socket.emit(SOCKET, { type: "tokenBagRemaining", ...data });
}

export class NTETokenBagApp extends ApplicationV2 {

  static DEFAULT_OPTIONS = {
    classes:  ["nte-token-bag-window"],
    window:   { resizable: false },
    position: { width: 360, height: "auto" },
    actions:  {
      adjust: NTETokenBagApp.#adjust,
      start:  NTETokenBagApp.#start,
      stop:   NTETokenBagApp.#stop,
      risk:   NTETokenBagApp.#risk,
      reset:  NTETokenBagApp.#reset,
    },
  };

  _phase    = "setup";                       // setup | choice | done
  _sel      = { pos: 0, neg: 0, rnd: 0 };    // token scelti dal player
  _inserted = { pos: 0, neg: 0, rnd: 0 };
  _bag      = [];
  _drawn    = [];
  _decision = null;

  constructor(actor, options = {}) {
    super({ id: `nte-token-bag-${actor.id}`, ...options });
    this._actor = actor;
  }

  get title() { return `Sacchetto — ${this._actor.name}`; }

  async _renderHTML(context, options) {
    if (this._phase === "choice") return this._htmlChoice();
    if (this._phase === "done")   return this._htmlDone();
    return this._htmlSetup();
  }

  /** ApplicationV2 non ha un _replaceHTML di default. */
  _replaceHTML(result, content, options) {
    content.innerHTML = result;
  }

  _htmlSetup() {
    const total = TYPES.reduce((n, t) => n + this._sel[t], 0);
    const rows = TYPES.map(t => `
      <div class="nte-tb-count ${t}">
        <span class="nte-tb-label">${SYMBOL[t]} Token ${NAME[t]}</span>
        <div class="nte-tb-controls">
          <button type="button" class="nte-tb-btn" data-action="adjust" data-type="${t}" data-delta="-1" ${this._sel[t] <= 0 ? "disabled" : ""}>−</button>
          <span class="nte-tb-num">${this._sel[t]}</span>
          <button type="button" class="nte-tb-btn" data-action="adjust" data-type="${t}" data-delta="1" ${this._sel[t] >= MAX_PER_TYPE ? "disabled" : ""}>+</button>
        </div>
      </div>`).join("");
    return `<div class="nte-tokenbag">
      <div class="nte-tb-counts">${rows}</div>
      <div class="nte-tb-total">Nel sacchetto: <strong>${total}</strong> (max ${MAX_PER_TYPE} per tipo)</div>
      <div class="nte-tb-draw-area">
        <button type="button" class="nte-tb-draw-btn" data-action="start" ${total === 0 ? "disabled" : ""}>🎲 Estrai</button>
      </div>
    </div>`;
  }

  _htmlChoice() {
    return `<div class="nte-tokenbag">
      <div class="nte-tb-hint">Primo token estratto:</div>
      <div class="nte-tb-symbols">${symbols(this._drawn)}</div>
      <div class="nte-tb-hint">Ti fermi o rischi? Rischiando si estrae fino a ${RISK_TOTAL} token in totale.</div>
      <div class="nte-tb-draw-row">
        <button type="button" class="nte-tb-draw-btn" data-action="stop">✋ Mi fermo</button>
        <button type="button" class="nte-tb-draw-btn" data-action="risk">🎲 Rischio</button>
      </div>
    </div>`;
  }

  _htmlDone() {
    const pos = countOf(this._drawn, "pos"), neg = countOf(this._drawn, "neg");
    return `<div class="nte-tokenbag">
      <div class="nte-tb-hint">${this._decision === "risk" ? "Hai rischiato" : "Ti sei fermato"}:</div>
      <div class="nte-tb-symbols">${symbols(this._drawn)}</div>
      <div class="nte-tb-total">${SYMBOL.pos} ${pos} — ${SYMBOL.neg} ${neg}</div>
      <div class="nte-tb-draw-area">
        <button type="button" class="nte-tb-draw-btn" data-action="reset">Nuovo sacchetto</button>
      </div>
    </div>`;
  }

  /** Sacchetto mescolato (Fisher-Yates). I casuali diventano ⚪ o ⚫ a 50%. */
  _buildBag(sel) {
    const bag = [...Array(sel.pos).fill("pos"), ...Array(sel.neg).fill("neg")];
    for (let i = 0; i < sel.rnd; i++) bag.push(Math.random() < 0.5 ? "pos" : "neg");
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
    return bag;
  }

  async _finish(decision) {
    this._decision = decision;
    this._phase = "done";

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this._actor }),
      content: `<div class="nte-chat-draw"><b>${esc(this._actor.name)}</b> ${decision === "risk" ? "rischia" : "si ferma"}:<br><span class="nte-chat-token">${symbols(this._drawn)}</span></div>`,
    });

    sendRemainingToGM({
      actorName: this._actor.name,
      userName:  game.user.name,
      inserted:  { ...this._inserted },
      drawn:     [...this._drawn],
      decision,
      remaining: [...this._bag],
    });

    this.render();
  }

  static #adjust(event, target) {
    const { type, delta } = target.dataset;
    this._sel[type] = Math.min(MAX_PER_TYPE, Math.max(0, this._sel[type] + Number(delta)));
    this.render();
  }

  static async #start() {
    this._inserted = { ...this._sel };
    this._bag = this._buildBag(this._sel);
    if (!this._bag.length) return;
    this._drawn = [this._bag.pop()];
    if (!this._bag.length) return this._finish("stop");   // niente da rischiare
    this._phase = "choice";
    this.render();
  }

  static async #stop() { return this._finish("stop"); }

  static async #risk() {
    while (this._drawn.length < RISK_TOTAL && this._bag.length) this._drawn.push(this._bag.pop());
    return this._finish("risk");
  }

  static #reset() {
    this._phase = "setup";
    this._sel = { pos: 0, neg: 0, rnd: 0 };
    this._bag = [];
    this._drawn = [];
    this._decision = null;
    this.render();
  }
}