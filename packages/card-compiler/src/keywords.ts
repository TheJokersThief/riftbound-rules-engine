export interface KeywordExpansion {
  kind: 'ability' | 'property' | 'costModifier'
}

export interface KeywordRegistry {
  get(name: string): KeywordExpansion | null
}

export const keywordRegistry: KeywordRegistry = {
  get: (_name) => null,
}
