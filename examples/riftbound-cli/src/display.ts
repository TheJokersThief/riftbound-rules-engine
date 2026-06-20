import type { GameState } from "@thejokersthief/riftbound-engine";
import type { CardCatalog } from "@thejokersthief/riftbound-card-catalog";
import type { Action, GameEvent, PlayerId, CardId } from "@thejokersthief/riftbound-protocol";

function cardName(state: GameState, catalog: CardCatalog, cardId: CardId): string {
  const inst = state.cards[cardId];
  if (!inst) return String(cardId);
  const def = catalog.find(inst.defId);
  return def?.name ?? String(inst.defId);
}

export function printHeader(turnNumber: number, activePlayer: string): void {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  Turn ${turnNumber} — active: ${activePlayer}`);
  console.log("=".repeat(60));
}

export function printBoard(state: GameState, humanId: PlayerId, catalog: CardCatalog): void {
  const human = state.players[humanId];
  const oppId = state.playerIds.find((p) => p !== humanId);
  const opp = oppId ? state.players[oppId] : undefined;
  if (!human) return;

  const filled = human.runePool.filter((s) => s.filled).length;
  console.log(`\nYour points: ${human.points}   Runes: ${filled}/${human.runePool.length}`);
  console.log("Your hand:");
  if (human.hand.length === 0) console.log("  (empty)");
  for (const cid of human.hand) {
    const inst = state.cards[cid];
    const def = inst ? catalog.find(inst.defId) : null;
    const cost = def?.playCost;
    const costStr = cost ? ` (E${cost.energy}/P${cost.power})` : "";
    console.log(`  - ${cardName(state, catalog, cid)}${costStr}`);
  }

  if (opp && oppId) {
    const oppFilled = opp.runePool.filter((s) => s.filled).length;
    console.log(
      `\nOpponent (${String(oppId)}): points ${opp.points}, hand ${opp.hand.length}, ` +
        `runes ${oppFilled}/${opp.runePool.length}`,
    );
  }

  console.log("\nBattlefields:");
  for (const [bfId, bf] of Object.entries(state.battlefields)) {
    if (!bf) continue;
    const unitNames = bf.units.map((u) => cardName(state, catalog, u)).join(", ") || "(empty)";
    console.log(`  ${bfId} — controller: ${bf.controllerId ?? "none"} — units: ${unitNames}`);
  }
}

export function printEvents(events: GameEvent[], state: GameState, catalog: CardCatalog): void {
  for (const ev of events) {
    switch (ev.type) {
      case "CardDrawn":
        console.log(`  . ${String(ev.playerId)} draws a card`);
        break;
      case "CardPlayed":
        console.log(`  . ${cardName(state, catalog, ev.cardId)} is played`);
        break;
      case "CardKilled":
        console.log(`  . ${cardName(state, catalog, ev.cardId)} is destroyed`);
        break;
      case "CardMoved":
        console.log(`  . ${cardName(state, catalog, ev.cardId)} moves ${ev.fromZone} -> ${ev.toZone}`);
        break;
      case "DamageDealt":
        console.log(
          `  . ${cardName(state, catalog, ev.sourceId)} deals ${ev.amount} damage` +
            `${ev.bonus ? ` (+${ev.bonus} bonus)` : ""} to ${cardName(state, catalog, ev.targetId)}`,
        );
        break;
      case "PointScored":
        console.log(`  . ${String(ev.playerId)} scores a point (${ev.method})`);
        break;
      case "ControlChanged":
        console.log(`  . ${ev.battlefieldId} is now controlled by ${String(ev.newControllerId)}`);
        break;
      case "PhaseStarted":
        console.log(`  . phase: ${ev.phase}`);
        break;
      case "TurnStarted":
        console.log(`  . turn ${ev.turnNumber} starts — active: ${String(ev.activePlayerId)}`);
        break;
      case "TurnEnded":
        console.log(`  . turn ${ev.turnNumber} ends`);
        break;
      case "RuneChanneled":
        console.log(`  . ${String(ev.playerId)} channels a rune`);
        break;
      case "GameEnded":
        console.log(`  . game ended — winner: ${String(ev.winner)}`);
        break;
      default:
        console.log(`  . ${ev.type}`);
    }
  }
}

export function printActions(actions: Action[], state: GameState, catalog: CardCatalog): void {
  console.log("\nYour options:");
  actions.forEach((a, i) => {
    let detail = "";
    if (a.type === "PlayCard") {
      detail = ` ${cardName(state, catalog, a.cardId)}`;
    } else if (a.type === "ChooseTargets") {
      detail = a.targets.length
        ? ` -> ${a.targets.map((t) => cardName(state, catalog, t)).join(", ")}`
        : " -> (no targets)";
    } else if (a.type === "ChooseBattlefield") {
      detail = ` ${catalog.find(a.cardDefId)?.name ?? a.cardDefId}`;
    } else if (a.type === "ChooseOne") {
      detail = ` option ${a.index + 1}`;
    } else if (a.type === "ChooseYesNo") {
      detail = ` ${a.choice ? "Yes" : "No"}`;
    }
    console.log(`  [${i + 1}] ${a.type}${detail}`);
  });
}
