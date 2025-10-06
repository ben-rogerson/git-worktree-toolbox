- **Avoid default exports**; use named exports exclusively across all source files.
- **NEVER use `any` type, use types**. Look up types rather than guessing.
- **It's okay to break code when refactoring**. We are in pre-production. Do not use fallbacks.
- **ALWAYS throw errors early and often.** Do not use fallbacks.
- At the end of the changes you make, create three more todos and run through them:
  - Run `npm run lint` to check for errors and fix them.
  - Add additional tests or edit existing tests to cover the new/adjusted functionality.
  - Run `npm run test` to check for tests and fix them.

Keep the README.md file up to date with the latest changes / installation instructions.

## Metadata Management

- Extract schemas when duplicated >2 places (prevents drift)
- Add deletion methods when adding CRUD (prevents orphaned files)
- Batch operations: use `Promise.allSettled`, return `{ succeeded, failed }`
- Delete metadata immediately after resource removal (not in cleanup jobs)
- Keep async consistency even if implementation could be sync (future-proof)
