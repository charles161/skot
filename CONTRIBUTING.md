# Contributing to Skot

Thanks for helping make Skot faster and sharper!

## Quick Dev Loop

```bash
pnpm install
pnpm dev
```

## Checks Before Opening a PR

All changes should keep these green:

```bash
pnpm typecheck
pnpm run lint
pnpm test
TRUST_PROXY=none pnpm build
```

If you add a user-facing component or route, register it in `verify/features.yml` with an end-to-end Playwright check in `verify/features/` (`python3 -m pytest verify/features --launch -v`).

## Guidelines

- **Keep local-first & zero-key fallbacks working:** Skot must remain fully usable without API keys.
- **No stock icon libraries or raw emoji in UI strings:** Draw new icons in `src/brand/icons/index.tsx` (checked by `src/brand/no-stock-icons.test.ts`).
- **Write a failing test first** for bug fixes and new behaviors.
- **Never commit secrets or `.env.local` files** (CI runs full-history Gitleaks on every PR).

## License

By contributing, you agree that your contributions will be licensed under the [Apache License 2.0](LICENSE).
