default:
    just --list

# Run all checks (mirrors CI)
ci: typecheck lint format test verify-catalog

typecheck:
    pnpm nx run-many --target=typecheck --all

lint:
    pnpm nx run-many --target=lint --all

format:
    pnpm nx run-many --target=format --all

test:
    pnpm vitest run

# Refresh the card catalog snapshot from the live riftdex endpoint
refresh-catalog:
    pnpm --filter @thejokersthief/riftbound-card-catalog run refresh

# Compile cards.json → compiled-catalog.json
compile-cards:
    pnpm --filter @thejokersthief/riftbound-card-compiler run compile

# Validate committed compiled-catalog.json (parse rate + round-trip check)
verify-catalog:
    pnpm --filter @thejokersthief/riftbound-card-compiler run verify-catalog

# Install all dependencies
install:
    pnpm install

# Run the example game
example:
    pnpm --filter @thejokersthief/riftbound-example start
