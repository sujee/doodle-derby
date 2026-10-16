# Doodle Duel — Spec

A browser game: you draw, AI vision models (the Doodlebots) race to guess what it is.

## Setup
- Title screen with one Doodlebot card and a big **Play!** button; Play works at once with the Fake guesser. "+ Add a Doodlebot" adds up to **3 bots**.
- Provider dropdown (Fake guesser first, then A–Z, "OpenAI compatible" last):
  - **Fake guesser**: no API key; simulated guesses for trying the game.
  - **Anthropic**: API key, model.
  - OpenAI-compatible APIs, each with an editable base URL: **Baseten, Fireworks, Nebius Token Factory, Ollama Cloud, Ollama local** (no key), **OpenAI, Together, OpenAI compatible** (any URL).
- Base URL, the vision filter and Test sit under "More options".
- Model dropdown stays empty until "Load models" fetches the endpoint's list (`?verbose=true` first). Models are grouped by image support (provider metadata, Ollama capabilities, or a name guess marked "likely"); "Vision models only" filter is on by default. "Other…" lets you type a model name.
- Bots 2 and 3 default to "Same provider as Doodlebot #1", which reuses its provider, key and model list, so they only pick a model.
- "Test" button sends one tiny image request to check the key, browser access, and image support.
- API keys live in memory only. They are never saved, and are sent only to the chosen endpoint.

## Who doodles?
- **You** (default): you draw, the bots guess.
- **A bot**: a "Doodler bot" (any provider, Fake doodler with no key; "Same provider as Doodlebot #1" by default) draws the word and **you join the guessers**, typing guesses in a box under the canvas (sticky at the bottom on phones).
  - The doodler model returns strokes as JSON (`{"strokes": [[[x,y],...],...]}` on a 512×512 canvas; Anthropic uses structured outputs). Strokes are validated, clamped and capped, then animated onto the canvas over 8–15 s; the clock starts when drawing starts. The word is hidden until the round ends.
  - The next round's drawing is fetched during the current round, so later rounds start without waiting.
  - A failed drawing is retried once; then the round is skipped with a friendly message.
  - Scoring: the first correct guesser (a bot or You) +1, and the doodler +1 for every drawing that gets guessed. The doodler's row (stars, tokens, cost) takes the place of "You" under the lanes; You get a mint lane and a spot on the podium.

## Game
- 10 rounds. Words get harder as the game goes on:
  - Rounds 1–3: easy (ball, hat, sun…)
  - Rounds 4–7: medium (bicycle, umbrella, guitar…)
  - Rounds 8–10: hard (lighthouse, octopus, helicopter…)
- No word repeats within a game.
- Each round: the word is shown, and you have **30 seconds** to draw.
- About every 2.5 s, if the drawing changed and isn't empty, the same snapshot (white background, 512px JPEG) goes to every guesser.
- Each guesser has at most one request in flight. Its previous wrong guesses this round are included in the prompt.
- Each guess comes with the model's confidence (`<object> | <0-100>`). **Doodle Climb:** each bot sits on a 10-rung ladder at its latest confidence, leaps to the bell when it's right, and slides down when time runs out. Confidence is display-only.
- Each bot's last 3 guesses show with their times.
- After a round, the next one starts after a 5-second countdown (or press Next).
- **Pause** freezes the round or the countdown; **Stop** ends the game and shows results so far.

## Scoring
- First guesser to answer correctly: **+1** for that guesser, and the round ends.
- You: **+1** whenever any guesser gets your drawing.
- Time runs out: nobody scores.
- The end screen shows a podium (winner in the middle with a crown, ties share a place), then a folded round-by-round table.

## Matching
- A guess is cleaned up (lowercase, punctuation and articles removed, plural made singular) and must equal the word or one of its listed alternatives.
- Answers that arrive after the round ended are discarded. Requests still running when a round ends are cancelled.

## Tokens and cost
- Each bot's lane shows tokens in / out and cost so far, from the usage the provider reports.
- Results show a folded "Bot bill" receipt per bot (calls, tokens, cost) with a total. Requests cancelled when a round ends aren't counted.
- Prices (USD per 1M tokens) come from models.dev: a trimmed snapshot in `src/data/models-dev.json`, refreshed with `npm run pricing` and on every deploy. Fake and local Ollama bots are free; unknown models show "price unknown".
- models.dev's image-support data also fills in "accepts images" when a provider's model list doesn't say.

## Sharing
- "Share your doodles" on the results screen makes two images: **Doodles** (the 10 drawings with who guessed each and a funny wrong guess) and **Bot brains** (a table of every bot's guess trail per round, wrong guesses struck through, right ones circled, plus a "Wildest guess" award).
- Share (Web Share with both images, where supported), Download, Copy image, Copy text.

## Look and sound
- Whimsical sketchbook style: hand-drawn fonts (Gochi Hand, Patrick Hand, Fredoka), bright colors, robot Doodlebots, taped-paper canvas (the drawing surface stays pure white), pencil timer, confetti. Chalkboard theme in dark mode. Animations are off under reduced motion.
- Synthesized sound effects (Web Audio, no files). 🔊/🔇 toggle on every screen and the M key; the choice is remembered.

## Errors
- Rate limit: that guesser backs off and shows a badge; the game continues.
- Bad key, browser access blocked, or no image support: shown clearly on Test and in the feed.

## Tech
- Vite + TypeScript, plain DOM and canvas, no backend.
- Hosted on GitHub Pages, deployed by GitHub Actions on push to `main`.
- Local models (Ollama, LM Studio) need CORS enabled. Safari may block `http://localhost` from an https page.
