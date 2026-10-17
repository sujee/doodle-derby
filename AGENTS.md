# Working on Doodle Duel

Instructions for AI agents (and humans) working in this repo. See SPEC.md for what the game does.

## Two folders: preview and dev

The user tests a **stable preview** while the agent works in a **separate dev folder**. Files in
the preview folder never change underneath the user.

| Folder | Path | Git branch | Dev server | Who uses it |
|---|---|---|---|---|
| **preview** | `draw-claude/main` | `main` | http://localhost:5173 (launch config `preview`) | The user plays and tests here |
| **dev** | `draw-claude/dev` (a git worktree of the same repo) | `dev` | http://localhost:5174 (launch config `dev`) | The agent edits, builds and tests here |

The two folders sit side by side (same depth), so nothing done in one can touch the other.
The top folder `draw-claude` is not a git repo: it only holds `main/` and `dev/`, plus the
launch configs (`draw-claude/.claude/launch.json`) that start each dev server in its own folder.
List them with `git worktree list`. Run each dev server from its own folder.

### Rules

1. **Never edit or commit in the preview folder**, except the promotion merge below. All work happens in `dev`.
2. **Commit in dev** in small, meaningful steps.
3. **Before asking to promote**, in dev:
   - `npm test` passes,
   - `npm run build` passes (it type-checks too),
   - the change is play-tested on http://localhost:5174 (desktop and phone width; with Fake bots / mocked APIs).
4. **Promote only after the user says yes.** Ask with a short summary of what changes.
5. **Promotion is a git merge:** commit everything in dev first (`git status` clean), then from
   the preview folder (`main`) merge the `dev` branch with a merge commit, so the promotion is one
   commit that can be rolled back:

   ```bash
   git merge --no-ff dev -m "Promote dev: <summary>"
   ```
   ```bash
   npm install   # only if package.json changed
   ```

   Then tell the user to reload http://localhost:5173. Main only ever gets these merges, so
   conflicts should not happen; if one does, stop (`git merge --abort`) and ask the user.
6. **Rollback** (only when the user asks): `git reset --hard HEAD~1` in the preview folder undoes
   the last promotion (`HEAD~1` of a merge commit is the main it was merged into). The commits stay
   on `dev`.
7. After promoting, dev already has everything preview has; just keep working there. After a
   rollback, keep working in dev as usual; the next promotion merges the commits again.

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
