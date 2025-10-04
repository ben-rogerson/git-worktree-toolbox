- **Avoid default exports**; use named exports exclusively across all source files.
- **NEVER use `any` type, use types**. Look up types rather than guessing.
- **It's okay to break code when refactoring**. We are in pre-production. Do not use fallbacks.
- **ALWAYS throw errors early and often.** Do not use fallbacks.
- At the end of the changes you make, run a `npm run lint` to check for errors and fix them.

Keep the README.md file up to date with the latest changes / installation instructions.
