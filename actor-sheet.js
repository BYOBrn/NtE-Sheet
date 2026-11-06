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
// SACCHETTO TOKEN (stessa logica della macro Token Bag)
// 1. Aggiungi gettoni: positivi ⚪️, negativi ⚫️, casuali (50% / 50%)
// 2. Estrai da 1 a 4 gettoni
// 3. "Risk It": estrai altri gettoni fino a un totale di 5, oppure fermati
// 4. I rimanenti vengono inviati solo ai GM (whisper) via socket:
//    il messaggio lo crea il client GM, il giocatore non li vede.
// Il sacchetto resta in memoria finché la pagina è aperta (uno per personaggio).
// ====================================================================

const POS = "⚪️";
const NEG = "⚫️";
const FIRST_MAX  = 4;   // massimo gettoni alla prima estrazione
const RISK_TOTAL = 5;   // totale se si rischia
const BAG_IMG = `modules/${MODULE}/assets/token-bag.webp`;

const BAGS = new Map();   // actor.id → array di gettoni
function bagOf(actor) {
  if (!BAGS.has(actor.id)) BAGS.set(actor.id, []);
  return BAGS.get(actor.id);
}

function shuffle(bag) {
  for (let i = bag.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [bag[i], bag[j]] = [bag[j], bag[i]];
  }
}

// --- Invio ai GM: il messaggio viene creato dal client GM scelto ---
function sendRemainingTokensToGM(bag, actorName) {
  const content = `${actorName} — gettoni rimanenti nel sacchetto: ${bag.join(", ") || "— (vuoto) —"}`;

  // Un solo GM pubblica il messaggio (per evitare duplicati)
  const activeGM = game.users.find(u => u.active && u.isGM) ?? game.users.find(u => u.isGM);
  if (!activeGM) return ui.notifications.warn("Nessun GM online: impossibile inviare il riepilogo.");

  const gmIDs = game.users.filter(u => u.isGM).map(u => u.id);
  if (game.user.id === activeGM.id) {
    return ChatMessage.create({ content, whisper: gmIDs, speaker: { alias: "Sacchetto" } });
  }
  game.socket.emit(SOCKET, { action: "post-remaining", content, targetGmId: activeGM.id });
}

export function registerTokenBagSocket() {
  game.socket.on(SOCKET, data => {
    if (data?.action !== "post-remaining") return;
    if (!game.user.isGM || game.user.id !== data.targetGmId) return;
    const gmIDs = game.users.filter(u => u.isGM).map(u => u.id);
    ChatMessage.create({ content: data.content, whisper: gmIDs, speaker: { alias: "Sacchetto" } });
  });
}

export class NTETokenBagApp extends ApplicationV2 {

  static DEFAULT_OPTIONS = {
    classes:  ["nte-token-bag-window"],
    window:   { resizable: false },
    position: { width: 380, height: "auto" },
    actions:  {
      add:     NTETokenBagApp.#add,
      extract: NTETokenBagApp.#extract,
      skip:    NTETokenBagApp.#skip,
      riskYes: NTETokenBagApp.#riskYes,
      riskNo:  NTETokenBagApp.#riskNo,
      clear:   NTETokenBagApp.#clear,
    },
  };

  _phase = "add";    // add | extract | risk
  _drawn = [];
  _last  = "";

  constructor(actor, options = {}) {
    super({ id: `nte-token-bag-${actor.id}`, ...options });
    this._actor = actor;
  }

  get title() { return `Sacchetto — ${this._actor.name}`; }
  get _bag()  { return bagOf(this._actor); }

  // ---------- Rendering ----------
  async _renderHTML(context, options) {
    let body;
    if (this._phase === "extract")   body = this._htmlExtract();
    else if (this._phase === "risk") body = this._htmlRisk();
    else                             body = this._htmlAdd();
    return `<div class="nte-tokenbag">
      <img class="nte-tb-banner" src="${BAG_IMG}" alt="Sacchetto" />
      ${body}
    </div>`;
  }

  /** ApplicationV2 non ha un _replaceHTML di default. */
  _replaceHTML(result, content, options) {
    content.innerHTML = result;
  }

  _htmlAdd() {
    return `
      <div class="nte-tb-hint">Aggiungi gettoni al sacchetto</div>
      <div class="nte-tb-form">
        <label>Gettoni Positivi (${POS}) <input type="number" name="posTokens" value="0" min="0" /></label>
        <label>Gettoni Negativi (${NEG}) <input type="number" name="negTokens" value="0" min="0" /></label>
        <label>Gettoni Casuali (❓) <input type="number" name="randomTokens" value="0" min="0" /></label>
      </div>
      ${this._last ? `<div class="nte-tb-hint">Ultimo risultato: ${this._last}</div>` : ""}
      <div class="nte-tb-draw-row">
        <button type="button" class="nte-tb-draw-btn" data-action="add">Aggiungi</button>
        <button type="button" class="nte-tb-draw-btn nte-tb-secondary" data-action="clear">Svuota</button>
      </div>`;
  }

  _htmlExtract() {
    return `
      <div class="nte-tb-hint">Estrai gettoni dal sacchetto</div>
      <div class="nte-tb-form">
        <label>Quanti gettoni estrarre? (max ${FIRST_MAX})
          <input type="number" name="numTokens" value="1" min="1" max="${FIRST_MAX}" />
        </label>
      </div>
      <div class="nte-tb-draw-row">
        <button type="button" class="nte-tb-draw-btn" data-action="extract">Estrai</button>
        <button type="button" class="nte-tb-draw-btn nte-tb-secondary" data-action="skip">Annulla</button>
      </div>`;
  }

  _htmlRisk() {
    return `
      <div class="nte-tb-hint">Risk It</div>
      <div class="nte-tb-hint">Hai estratto ${this._drawn.length} gettoni finora:</div>
      <div class="nte-tb-symbols">${this._drawn.join(" ")}</div>
      <div class="nte-tb-hint">Vuoi rischiare ed estrarre altri gettoni fino ad arrivare a un totale di ${RISK_TOTAL}?</div>
      <div class="nte-tb-draw-row">
        <button type="button" class="nte-tb-draw-btn" data-action="riskYes">Sì, rischio</button>
        <button type="button" class="nte-tb-draw-btn nte-tb-secondary" data-action="riskNo">No, mi fermo qui</button>
      </div>`;
  }

  // ---------- Logica ----------
  _say(content) {
    return ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: this._actor }), content });
  }

  _addTokens(pos, neg, rnd) {
    const bag = this._bag;
    for (let i = 0; i < pos; i++) bag.push(POS);
    for (let i = 0; i < neg; i++) bag.push(NEG);
    for (let i = 0; i < rnd; i++) bag.push(Math.random() < 0.5 ? POS : NEG);
    shuffle(bag);
  }

  async _pull(n) {
    const bag = this._bag;
    const out = [];
    for (let i = 0; i < n; i++) {
      if (!bag.length) {
        await this._say("Il sacchetto è vuoto: impossibile estrarre altri gettoni.");
        break;
      }
      out.push(bag.pop());   // il sacchetto è già mescolato
    }
    return out;
  }

  /** Fine processo: invia i rimanenti ai GM e torna alla schermata iniziale. */
  _finish(lastText = "") {
    this._last = lastText;
    this._drawn = [];
    this._phase = "add";
    sendRemainingTokensToGM(this._bag, this._actor.name);
    this.render();
  }

  _num(name) {
    return parseInt(this.element.querySelector(`[name="${name}"]`)?.value, 10);
  }

  // ---------- Azioni ----------
  static async #add() {
    const [pos, neg, rnd] = ["posTokens", "negTokens", "randomTokens"].map(n => this._num(n));
    if (![pos, neg, rnd].every(n => Number.isInteger(n) && n >= 0)) {
      return ui.notifications.warn("Input non valido: inserisci numeri ≥ 0.");
    }
    this._addTokens(pos, neg, rnd);
    await this._say("Gettoni aggiunti al sacchetto.");
    this._phase = "extract";
    this.render();
  }

  static async #extract() {
    const n = this._num("numTokens");
    if (!Number.isInteger(n) || n < 1 || n > FIRST_MAX) {
      return ui.notifications.warn(`Inserisci un numero di gettoni da 1 a ${FIRST_MAX}.`);
    }
    const out = await this._pull(n);
    if (!out.length) {
      await this._say("Nessun gettone estratto.");
      return this._finish();
    }
    this._drawn = out;
    await this._say(`Gettoni estratti: ${out.join(", ")}`);
    this._phase = "risk";
    this.render();
  }

  /** Annulla l'estrazione: invia comunque lo stato residuo. */
  static #skip() { this._finish(); }

  static async #riskYes() {
    const needed = Math.max(0, RISK_TOTAL - this._drawn.length);
    const more = await this._pull(needed);
    const all = this._drawn.concat(more);
    await this._say(more.length < needed
      ? `Il sacchetto non aveva abbastanza gettoni. Totale ora: ${all.join(", ")}`
      : `Gettoni totali (${RISK_TOTAL}): ${all.join(", ")}`);
    this._finish(all.join(" "));
  }

  static async #riskNo() {
    await this._say(`Ti fermi con ${this._drawn.length} gettoni: ${this._drawn.join(", ")}`);
    this._finish(this._drawn.join(" "));
  }

  static #clear() {
    this._bag.length = 0;
    this._last = "";
    ui.notifications.info("Sacchetto svuotato.");
    this.render();
  }
}