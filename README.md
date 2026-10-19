# Doodle Derby

<p align="center">
  <a href="https://sujee.github.io/doodle-derby/">
    <img alt="Play live" src="assets/play-live-short.svg" height="44">
  </a>
</p>

<p align="center"><b>You draw, AI vision models race to guess what it is.</b><br>
<a href="https://sujee.github.io/doodle-derby/">Play it in your browser</a>: no install. Pick <b>Fake guesser</b> to play without an API key.</p>

See [SPEC.md](SPEC.md) for how the game works.

## Run locally

```bash
npm install
npm run dev
```

Pick **Fake guesser** to play without an API key.

Refresh token prices from models.dev:

```bash
npm run pricing
```

## Deploy

Push to `main`. In the repo's **Settings → Pages**, set **Source** to **GitHub Actions** once.
