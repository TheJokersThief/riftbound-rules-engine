export interface KeywordExpansion {
  kind: 'ability' | 'property' | 'costModifier'
}

export interface KeywordRegistry {
  get(name: string): KeywordExpansion | null
}

export const keywordRegistry: KeywordRegistry = {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  get: (_name) => null, // empty for now
}
