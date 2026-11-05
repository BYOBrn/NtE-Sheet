/**
 * Not the End — Modulo Foundry VTT v13
 */

import { NTEActorSheet, NTETokenBagApp, registerTokenBagSocket } from "./sheets/actor-sheet.js";
import { registerColorSettings, applyColors, NTEColorDialog } from "./color-settings.js";

const MODULE = "not-the-end";

Hooks.once("init", () => {
  Handlebars.registerHelper("nte_add", (a, b) => Number(a) + Number(b));

  registerColorSettings();
  game.settings.registerMenu(MODULE, "colorMenu", {
    name:       "Personalizza colori",
    label:      "Apri editor colori",
    hint:       "Cambia i colori della scheda",
    icon:       "fas fa-palette",
    type:       NTEColorDialog,
    restricted: true,
  });

  foundry.applications.apps.DocumentSheetConfig.registerSheet(
    foundry.documents.Actor,
    MODULE,
    NTEActorSheet,
    {
      types:       ["character"],
      makeDefault: true,
      label:       "Scheda Personaggio",
    }
  );
});

Hooks.once("ready", async () => {
  applyColors();
  registerTokenBagSocket();

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
