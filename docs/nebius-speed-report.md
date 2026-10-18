# Why is MiniCPM-V-4.5 so fast on Nebius Token Factory?

*Measured 2026-10-18 from the developer's machine, with Doodle Duel's own prompt and the "thinking off" settings from `src/providers/openaiCompat.ts` (commit 4540c0c).*

## Short answer

MiniCPM-V-4.5 is fast because it is a **small model doing a tiny job**, and most of the time that remains is the **network trip**. It is the fastest of the 7 models tested (about 370 ms per guess), but **Qwen3.8-27B is practically tied** (about 380 ms).

## How it was measured

- **Drawing:** a 512×512 black-on-white sketch of a house (walls, roof, door, window), sent as a PNG data URL.
- **Prompt:** the game's own (`promptFor([])`): "guess the object, reply `name | confidence`".
- **Settings:** the game's thinking-off settings for non-OpenAI hosts: `chat_template_kwargs: { enable_thinking: false, thinking: false }` plus `reasoning_effort: "low"`.
- **Runs:** 5 streamed requests per model (`stream: true`). The table shows medians.
  - **First token** is the time until the first piece of the answer (or of the thinking) arrives.
  - **Total** is the time until the response ends.
- **Network floor:** `GET /v1/models`, which runs no model, takes a median of **216 ms** from this machine.

## Results

| Model | First token | Total | Tokens in / out | Size and weights | Region |
|---|---|---|---|---|---|
| **openbmb/MiniCPM-V-4_5** | 335 ms | **372 ms** | 287 / 7 | small (about 8B), fp16 | eu-north1 |
| Qwen/Qwen3.8-27B | 367 ms | 381 ms | 342 / 7 | 27B dense, fp4 | us-central1 |
| moonshotai/Kimi-K3 | 474 ms | 492 ms | 456 / 11 | large MoE, fp4 | eu-west2 |
| nvidia/Nemotron-3.5-Super-VL | 613 ms | 622 ms | 346 / 7 | bf16 | us-north1 |
| deepseek-ai/DeepSeek-V4.1-Flash | 654 ms | 667 ms | 257 / 5 | MoE, fp8 | us-north1 |
| zai-org/GLM-5.3-Flash | 717 ms | 718 ms | 444 / 6 | 320B MoE, 18B active, fp4 | us-north1 |
| meta-models/muse-spark-open | 405 ms | 1197 ms | 576 / 119 | 816B MoE, 42B active, fp4 | us-north1 |

Sizes, quantization and regions come from Nebius's `/v1/models?verbose=true` listing. MiniCPM's parameter count isn't in that listing (Nebius calls it a "compact multimodal model"); "about 8B" is from memory of the model's published card. All 8 image models on Nebius named the house correctly; Kimi-K2.6 was tested for correctness but not timed.

## Why MiniCPM is quick

1. **About 215 ms of every request is just the network.** A request that runs no model takes 216 ms, so MiniCPM's own work is only about 150 ms.
2. **It is a small model.** Reading the image and prompt (prefill) takes very little compute compared with 27B–816B models.
3. **It reads the drawing in fewer tokens:** 287 input tokens, against 340–576 for most others. This helps, but less than model size: DeepSeek uses even fewer (257) and is still slower.
4. **No thinking, tiny answer.** With thinking off it answers in about 7 tokens ("house | 100"). Thinking matters most here: Muse Spark can't fully turn thinking off (it rejects `reasoning_effort: "none"`, and "low" is its minimum), so it still writes about 119 tokens and takes 1.2 s.

## What doesn't explain it

- **Region.** MiniCPM runs in Finland and Qwen3.8 in the US, yet they are 10 ms apart. The location of the inference servers barely shows up from this machine.
- **"Uniquely fast."** Earlier single runs (0.4 s against 0.6–1.1 s) made the gap look bigger. With thinking off, Qwen3.8 is just as fast.

## Thinking-off settings, per model (output tokens for one guess)

| Model | No settings | Template flags only | `reasoning_effort: "low"` only | Both (what the game sends) |
|---|---|---|---|---|
| Qwen3.8-27B | 179 | 7 | 50 | 7 |
| GLM-5.3-Flash | 39 | 46 (ignored) | 6 | 6 |
| Muse Spark | 248 | 292 (ignored) | 76 | 78 (can't go lower) |

The other five models (DeepSeek, Kimi K2.6 / K3, Nemotron, MiniCPM) answer in 5–11 tokens with both settings. MiniCPM rejects `reasoning_effort: "none"` with a 400, so the game sends "low".

## Takeaways for Doodle Duel

- **For a fast, cheap bot**, MiniCPM-V-4.5 and Qwen3.8-27B are equally quick. On Nebius's list prices, MiniCPM's output is cheaper and Qwen's input is cheaper.
- **Speed says nothing about guessing skill.** Every model got the simple house right; comparing them needs harder drawings, ideally real ones from play.
- **Thinking off matters more than model choice** for latency: it takes Qwen3.8 from 179 output tokens to 7.

## Reproducing

The scripts are in `node_modules/.cache/nebius/` (not committed). They read `NEBIUS_API_KEY` from `draw-claude/.env` and never print it.

```bash
npx vite-node node_modules/.cache/nebius/timing.ts "openbmb/MiniCPM-V-4_5,Qwen/Qwen3.8-27B"
```
