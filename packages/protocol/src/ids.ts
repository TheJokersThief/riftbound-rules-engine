import { z } from 'zod'

type Brand<T extends string> = string & { readonly _brand: T }

export type PlayerId      = Brand<'PlayerId'>
export type CardId        = Brand<'CardId'>
export type CardDefId     = Brand<'CardDefId'>
export type ZoneId        = Brand<'ZoneId'>
export type BattlefieldId = Brand<'BattlefieldId'>
export type AbilityId     = Brand<'AbilityId'>
export type DecisionId    = Brand<'DecisionId'>
export type GameId        = Brand<'GameId'>
export type MatchId       = Brand<'MatchId'>

const brandedString = <T extends string>() =>
  z.string().transform(s => s as Brand<T>)

export const PlayerIdSchema      = brandedString<'PlayerId'>()
export const CardIdSchema        = brandedString<'CardId'>()
export const CardDefIdSchema     = brandedString<'CardDefId'>()
export const ZoneIdSchema        = brandedString<'ZoneId'>()
export const BattlefieldIdSchema = brandedString<'BattlefieldId'>()
export const AbilityIdSchema     = brandedString<'AbilityId'>()
export const DecisionIdSchema    = brandedString<'DecisionId'>()
export const GameIdSchema        = brandedString<'GameId'>()
export const MatchIdSchema       = brandedString<'MatchId'>()
