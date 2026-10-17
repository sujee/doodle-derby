import { defineConfig } from 'vite';

// Relative base so the build works under any GitHub Pages path (/<repo>/).
export default defineConfig({
  base: './',
  server: {
    // The dev worktree lives in .worktrees/: its edits must not reload the preview server.
    watch: { ignored: ['**/.worktrees/**'] },
  },
});
