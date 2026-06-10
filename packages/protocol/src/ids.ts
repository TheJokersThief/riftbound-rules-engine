import { z } from "zod";

type Brand<T extends string> = string & { readonly _brand: T };

export type PlayerId = Brand<"PlayerId">;
export type CardId = Brand<"CardId">;
export type CardDefId = Brand<"CardDefId">;
export type ZoneId = Brand<"ZoneId">;
export type BattlefieldId = Brand<"BattlefieldId">;
export type AbilityId = Brand<"AbilityId">;
export type DecisionId = Brand<"DecisionId">;
export type GameId = Brand<"GameId">;
export type MatchId = Brand<"MatchId">;

const brandedString = <T extends string>() => z.string().transform((s) => s as Brand<T>);

export const PlayerIdSchema = brandedString<"PlayerId">();
export const CardIdSchema = brandedString<"CardId">();
export const CardDefIdSchema = brandedString<"CardDefId">();
export const ZoneIdSchema = brandedString<"ZoneId">();
export const BattlefieldIdSchema = brandedString<"BattlefieldId">();
export const AbilityIdSchema = brandedString<"AbilityId">();
export const DecisionIdSchema = brandedString<"DecisionId">();
export const GameIdSchema = brandedString<"GameId">();
export const MatchIdSchema = brandedString<"MatchId">();

export const toPlayerId = (s: string): PlayerId => PlayerIdSchema.parse(s);
export const toCardId = (s: string): CardId => CardIdSchema.parse(s);
export const toCardDefId = (s: string): CardDefId => CardDefIdSchema.parse(s);
export const toZoneId = (s: string): ZoneId => ZoneIdSchema.parse(s);
export const toBattlefieldId = (s: string): BattlefieldId => BattlefieldIdSchema.parse(s);
export const toGameId = (s: string): GameId => GameIdSchema.parse(s);
export const toMatchId = (s: string): MatchId => MatchIdSchema.parse(s);
export const toDecisionId = (s: string): DecisionId => DecisionIdSchema.parse(s);

export function typedObjectKeys<K extends string, V>(record: Record<K, V>): K[] {
  return Object.keys(record) as K[];
}
