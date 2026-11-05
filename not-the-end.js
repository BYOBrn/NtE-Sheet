/**
 * Not the End — Modulo Foundry VTT v13
 */

import { NTEActorSheet, NTETokenBagApp } from "./sheets/actor-sheet.js";
import { registerColorSettings, applyColors, NTEColorDialog } from "./color-settings.js";

const MODULE = "not-the-end";

Hooks.once("init", () => {
  console.log("Not the End | Inizializzazione modulo");

  Handlebars.registerHelper("nte_add", (a, b) => Number(a) + Number(b));

  // Impostazioni colori + menu (i menu vanno registrati in init)
  registerColorSettings();
  game.settings.registerMenu(MODULE, "colorMenu", {
    name:       "NTE.Colors.Menu",
    label:      "NTE.Colors.MenuLabel",
    hint:       "NTE.Colors.MenuHint",
    icon:       "fas fa-palette",
    type:       NTEColorDialog,
    restricted: true,   // le impostazioni sono world-scope: solo GM
  });

  // Registrazione sheet (API v13)
  foundry.applications.apps.DocumentSheetConfig.registerSheet(
    foundry.documents.Actor,
    MODULE,
    NTEActorSheet,
    {
      types:       ["character"],
      makeDefault: true,
      label:       "NTE.Sheet.Label",
    }
  );
});

Hooks.once("ready", async () => {
  console.log("Not the End | Modulo pronto.");
  applyColors();

  // Rimuove la sheet forzata (es. SWB) dai personaggi: solo GM, solo type "character"
  if (game.user.isGM) {
    for (const actor of game.actors) {
      if (actor.type !== "character") continue;
      const current = actor.getFlag("core", "sheetClass");
      if (!current || current === `${MODULE}.NTEActorSheet`) continue;
      await actor.unsetFlag("core", "sheetClass");
    }
  }
});

globalThis.NTEActorSheet  = NTEActorSheet;
globalThis.NTETokenBagApp = NTETokenBagApp;
globalThis.NTEColorDialog = NTEColorDialog;
