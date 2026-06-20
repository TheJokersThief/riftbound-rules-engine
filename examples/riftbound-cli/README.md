# Riftbound CLI — Play Against the AI

An interactive terminal game: you versus a greedy CPU opponent, using real
compiled card effects from the card catalog.

## Run

From the repo root:

    pnpm --filter @thejokersthief/riftbound-cli start

You play the default human deck (legend `ogs-017-024`); the CPU plays the
default AI deck (legend `ogs-019-024`). On each of your turns the board prints
and you pick an action by number. The CPU acts automatically.

## Custom decks

Pass JSON deck files:

    pnpm --filter @thejokersthief/riftbound-cli start \
      --human-deck ./my-deck.json --ai-deck ./cpu-deck.json

### Deck JSON format

    {
      "legendId": "ogs-017-024",
      "championId": "ogs-021-024",
      "battlefields": ["unl-t01", "unl-t03", "unl-205-219"],
      "mainDeck": ["ogn-001-298", "... 40-60 card IDs ..."],
      "runeDeck": ["ogn-007-298", "... exactly 10 rune IDs ..."]
    }

All values are raw card-definition ID strings. `battlefields` must have exactly
3 entries, `mainDeck` 40-60, `runeDeck` exactly 10. Invalid decks fail fast with
a descriptive error.

## Known v1 limitations

- **Deploy-and-contest is automatic.** When you end your turn, your base units
  are deployed to a contested battlefield and combat is resolved for you. There
  is no manual "send to showdown" choice yet.
- **Single game**, not a best-of-three match.
- **The AI is greedy**, not strategic: it always plays the first available card
  and targets the first candidate.
- **Piped/non-interactive stdin can only answer one prompt.** Node's
  `readline` interface closes as soon as a non-TTY input stream (a file or a
  `printf | ...` pipe) reaches EOF, regardless of how many lines remain
  unread, so scripted "feed N answers via a pipe" smoke tests will only ever
  resolve the first prompt before the game exits cleanly (no crash). Play
  interactively in a real terminal to reach a full game.
