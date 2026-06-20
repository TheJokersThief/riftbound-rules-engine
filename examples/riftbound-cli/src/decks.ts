import { readFile } from "node:fs/promises";
import { toCardDefId } from "@thejokersthief/riftbound-protocol";
import type { CardDefId } from "@thejokersthief/riftbound-protocol";
import type { DeckConfig } from "@thejokersthief/riftbound-engine";

// Same rune/unit pool as examples/riftbound-example/src/index.ts — real
// CardDefIds from the committed cards.json snapshot.
const RUNE_IDS: CardDefId[] = [
  "ogn-007-298", "ogn-007a-298", "ogn-042-298", "ogn-042a-298", "ogn-089a-298",
  "ogn-089-298", "ogn-126a-298", "ogn-126-298", "ogn-166-298", "ogn-166a-298",
].map(toCardDefId);

const UNIT_POOL: CardDefId[] = [
  "ogn-001-298", "ogs-001-024", "unl-001-219", "sfd-002-221", "ogn-002-298",
  "unl-002-219", "ogn-003-298", "unl-003-219", "ogs-004-024", "unl-004-219",
  "ogs-005-024", "unl-005-219", "ogs-006-024", "sfd-006-221", "ogn-004-298",
].map(toCardDefId);

function buildMainDeck(): CardDefId[] {
  const deck: CardDefId[] = [];
  let i = 0;
  while (deck.length < 40) {
    deck.push(UNIT_POOL[i % UNIT_POOL.length]!);
    i++;
  }
  return deck;
}

export const DEFAULT_HUMAN_DECK: DeckConfig = {
  legendId: toCardDefId("ogs-017-024"),
  championId: toCardDefId("ogs-021-024"),
  battlefields: [toCardDefId("unl-t01"), toCardDefId("unl-t03"), toCardDefId("unl-205-219")],
  mainDeck: buildMainDeck(),
  runeDeck: RUNE_IDS,
};

export const DEFAULT_AI_DECK: DeckConfig = {
  legendId: toCardDefId("ogs-019-024"),
  championId: toCardDefId("ogs-023-024"),
  battlefields: [toCardDefId("unl-206-219"), toCardDefId("sfd-207-221"), toCardDefId("unl-207-219")],
  mainDeck: buildMainDeck(),
  runeDeck: RUNE_IDS,
};

interface RawDeck {
  legendId: string;
  championId: string;
  battlefields: string[];
  mainDeck: string[];
  runeDeck: string[];
}

export async function loadDeckFromFile(path: string): Promise<DeckConfig> {
  const text = await readFile(path, "utf8");
  let raw: RawDeck;
  try {
    raw = JSON.parse(text) as RawDeck;
  } catch (err) {
    throw new Error(`Deck file ${path} is not valid JSON: ${(err as Error).message}`);
  }
  if (typeof raw.legendId !== "string") throw new Error(`Deck ${path}: missing legendId`);
  if (typeof raw.championId !== "string") throw new Error(`Deck ${path}: missing championId`);
  if (!Array.isArray(raw.battlefields) || raw.battlefields.length !== 3) {
    throw new Error(`Deck ${path}: battlefields must be exactly 3 IDs`);
  }
  if (!Array.isArray(raw.mainDeck) || raw.mainDeck.length < 40 || raw.mainDeck.length > 60) {
    throw new Error(`Deck ${path}: mainDeck must have 40-60 cards`);
  }
  if (!Array.isArray(raw.runeDeck) || raw.runeDeck.length !== 10) {
    throw new Error(`Deck ${path}: runeDeck must have exactly 10 runes`);
  }
  return {
    legendId: toCardDefId(raw.legendId),
    championId: toCardDefId(raw.championId),
    battlefields: [
      toCardDefId(raw.battlefields[0]!),
      toCardDefId(raw.battlefields[1]!),
      toCardDefId(raw.battlefields[2]!),
    ],
    mainDeck: raw.mainDeck.map(toCardDefId),
    runeDeck: raw.runeDeck.map(toCardDefId),
  };
}
