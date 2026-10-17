# Working on Doodle Duel

Instructions for AI agents (and humans) working in this repo. See SPEC.md for what the game does.

## Two folders: preview and dev

The user tests a **stable preview** while the agent works in a **separate dev folder**. Files in
the preview folder never change underneath the user.

| Folder | Path | Git branch | Dev server | Who uses it |
|---|---|---|---|---|
| **preview** | `draw-game/draw-claude` | `main` | http://localhost:5173 (launch config `preview`) | The user plays and tests here |
| **dev** | `draw-game/draw-claude-dev` (a git worktree of the same repo) | `dev` | http://localhost:5174 (launch config `dev`) | The agent edits, builds and tests here |

The two folders sit side by side (same depth), so nothing done in one can touch the other.
List them with `git worktree list`. Run each dev server from its own folder.

### Rules

1. **Never edit files in the preview folder** (except during a promotion, below). All work happens in `draw-claude-dev`.
2. **Commit in dev** in small, meaningful steps.
3. **Before asking to promote**, in dev:
   - `npm test` passes,
   - `npm run build` passes (it type-checks too),
   - the change is play-tested on http://localhost:5174 (desktop and phone width; with Fake bots / mocked APIs).
4. **Promote only after the user says yes.** Ask with a short summary of what changes.
5. **Promotion is a copy, not a merge:** from the preview folder (`draw-claude`), copy the dev files over it, then commit there so it can be rolled back:

   ```bash
   rsync -a --delete --exclude .git --exclude node_modules --exclude dist ../draw-claude-dev/ ./
   ```
   ```bash
   npm install   # only if package.json changed
   ```
   ```bash
   git add -A && git commit -m "Promote dev: <summary>"
   ```

   Then tell the user to reload http://localhost:5173.
6. **Rollback** (only when the user asks): `git reset --hard HEAD~1` in the preview folder undoes the last promotion.
7. After promoting, dev already has everything preview has; just keep working there.

## Commands

```bash
npm run dev        # Vite dev server (use the launch configs for the right port)
npm test           # Vitest: unit, provider (mocked HTTP), engine and UI tests
npm run build      # type-check + production build into dist/
npm run pricing    # refresh src/data/models-dev.json from models.dev
```

## Best practices

- **Never use real API keys** in tests or play-tests. Use the Fake guesser / Fake doodler, or mock `fetch`.
- **API keys never leave memory:** not saved, not logged, not sent anywhere but the chosen provider. Debug logging must keep hiding `authorization` / `x-api-key` headers.
- **Game rules live in `src/engine.ts`** and stay DOM-free (clock, board and events are injected). Put new rules there with tests; `src/game.ts` only renders.
- **Test what you change.** New logic gets unit tests; provider changes get mocked-HTTP tests; game-flow changes get engine tests with a fake clock.
- **UI checks:** desktop and phone (375 px), light and dark (chalkboard) themes, `prefers-reduced-motion`. No horizontal scroll.
- **The drawing surface stays pure white** (models see the snapshot). Decorations go around it, never on it.
- **Keep the style:** colors and fonts come from the CSS tokens in `src/style.css`; API keys, URLs and model IDs use the plain font.
- **Don't push, deploy or publish** anything without asking (GitHub, Pages, etc.).
- **Write commit messages that say why**, not just what.
