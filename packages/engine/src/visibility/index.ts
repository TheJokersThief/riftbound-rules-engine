import type { CardCatalog } from "@thejokersthief/riftbound-card-catalog";
import type {
  CardId,
  CardInstanceView,
  ChainItemView,
  OpponentView,
  PlayerId,
  PlayerView,
  RuneSlotView,
  SelfView,
  SharedView,
} from "@thejokersthief/riftbound-protocol";
import { PlayerViewSchema } from "@thejokersthief/riftbound-protocol";
import type { GameState, RuneSlot } from "../state/types.js";

function toCardInstanceView(
  cardId: CardId,
  state: GameState,
  catalog: CardCatalog,
  hidden: boolean,
): CardInstanceView {
  if (hidden) {
    return {
      cardId,
      defId: null,
      exhausted: false,
      buffAmount: 0,
      keywords: [],
      counters: {},
      hidden: true,
      faceDown: true,
    };
  }
  const inst = state.cards[cardId];
  if (!inst) {
    return {
      cardId,
      defId: null,
      exhausted: false,
      buffAmount: 0,
      keywords: [],
      counters: {},
      hidden: true,
      faceDown: false,
    };
  }
  const def = catalog.find(inst.defId);
  const baseKeywords = def?.keywords ?? [];
  return {
    cardId,
    defId: inst.defId,
    exhausted: inst.exhausted,
    buffAmount: inst.buffAmount,
    keywords: [...baseKeywords, ...inst.keywords],
    counters: inst.counters,
    hidden: false,
    faceDown: inst.faceDown,
  };
}

function toRuneSlotView(slot: RuneSlot, state: GameState): RuneSlotView {
  if (!slot.filled || slot.runeCardId === null) {
    return { filled: false, runeDefId: null };
  }
  const runeInst = state.cards[slot.runeCardId];
  return { filled: true, runeDefId: runeInst?.defId ?? null };
}

function activeBattlefieldCardId(state: GameState, playerId: PlayerId): CardId | null {
  const bfs = Object.values(state.battlefields);
  const controlled = bfs.find((bf) => bf != null && bf.controllerId === playerId);
  return controlled?.cardId ?? bfs[0]?.cardId ?? null;
}

export function viewFor(state: GameState, playerId: PlayerId, catalog: CardCatalog): PlayerView {
  const opponentId = state.playerIds[0] === playerId ? state.playerIds[1]! : state.playerIds[0]!;

  const selfPlayer = state.players[playerId]!;
  const oppPlayer = state.players[opponentId]!;

  const self: SelfView = {
    playerId,
    hand: selfPlayer.hand.map((id) => toCardInstanceView(id, state, catalog, false)),
    mainDeck: { count: selfPlayer.mainDeck.length },
    runeDeck: { count: selfPlayer.runeDeck.length },
    runePool: selfPlayer.runePool.map((slot) => toRuneSlotView(slot, state)),
    legend: toCardInstanceView(selfPlayer.legendZone, state, catalog, false),
    champion: toCardInstanceView(selfPlayer.championZone, state, catalog, false),
    battlefield: (() => {
      const bfCardId = activeBattlefieldCardId(state, playerId);
      return bfCardId ? toCardInstanceView(bfCardId, state, catalog, false) : null;
    })(),
    base: selfPlayer.base.map((id) => toCardInstanceView(id, state, catalog, false)),
    resources: selfPlayer.resources,
    points: selfPlayer.points,
  };

  const opponent: OpponentView = {
    playerId: opponentId,
    handCount: oppPlayer.hand.length,
    mainDeck: { count: oppPlayer.mainDeck.length },
    runeDeck: { count: oppPlayer.runeDeck.length },
    runePool: oppPlayer.runePool.map((slot) => toRuneSlotView(slot, state)),
    legend: toCardInstanceView(oppPlayer.legendZone, state, catalog, false),
    champion: toCardInstanceView(oppPlayer.championZone, state, catalog, false),
    battlefield: (() => {
      const bfCardId = activeBattlefieldCardId(state, opponentId);
      return bfCardId ? toCardInstanceView(bfCardId, state, catalog, false) : null;
    })(),
    base: oppPlayer.base.map((id) => {
      const card = state.cards[id];
      return toCardInstanceView(id, state, catalog, card?.faceDown ?? false);
    }),
    resources: oppPlayer.resources,
    points: oppPlayer.points,
  };

  const shared: SharedView = {
    gameId: state.gameId,
    matchId: state.matchId,
    turnNumber: state.turnNumber,
    activePlayerId: state.activePlayerId,
    phase: state.phase,
    chain: state.chain.items.map(
      (item): ChainItemView => ({
        cardId: item.sourceId,
        defId: item.defId,
        controllerId: item.controller,
        resolved: item.resolved,
      }),
    ),
    pendingDecision: state.pendingDecision,
    matchRecord: { wins: {} },
  };

  const view: PlayerView = { self, opponent, shared };

  if (process.env["NODE_ENV"] !== "production") {
    const result = PlayerViewSchema.safeParse(view);
    if (!result.success) {
      throw new Error(`viewFor validation failed: ${JSON.stringify(result.error.issues)}`);
    }
  }

  return view;
}
