/**
 * Whether a model accepts image input:
 * - yes / no: the provider's model metadata says so
 * - likely: no metadata, but the name matches a known vision model family
 * - unknown: no way to tell (the Test button will find out)
 */
export type Vision = 'yes' | 'likely' | 'no' | 'unknown';
export type ModelInfo = { id: string; vision: Vision };

// Families known to accept images.
const VISION_NAME =
  /(vision|[-_/.]vl\b|[-_]vl[-_]|vl\d|llava|bakllava|pixtral|gemma-?3|gemma3|llama-?4|llama4|llama-3\.2-(11|90)b|gpt-4o|gpt-4\.1|gpt-5|\bo[34]\b|\bo[34]-|claude|gemini|qvq|minicpm-?v|internvl|molmo|phi-?4-?multimodal|phi-3\.5-vision|kimi-?vl|glm-4\.?\d*v|mistral-(small|medium)-3|moondream|granite-vision|llama3\.2-vision)/i;

// Models that are clearly not chat-with-images, even if the family name matches.
const NOT_CHAT = /(embed|tts|whisper|transcribe|audio|realtime|dall-e|gpt-image|moderation|rerank|guard|search)/i;

export function visionFromName(id: string): Vision {
  if (NOT_CHAT.test(id)) return 'no';
  return VISION_NAME.test(id) ? 'likely' : 'unknown';
}

/**
 * Read image support from an OpenAI-style /models entry. Providers put it in different places,
 * so check the shapes we know about and fall back to the name.
 */
export function visionFromMetadata(m: Record<string, any>): Vision {
  const lists = [
    m.architecture?.input_modalities,
    m.input_modalities,
    m.modalities?.input,
    m.capabilities?.input_modalities,
  ];
  for (const l of lists) {
    if (Array.isArray(l)) return l.some((x) => String(x).toLowerCase() === 'image') ? 'yes' : 'no';
  }
  // "text+image->text" style strings.
  for (const mod of [m.architecture?.modality, m.modality]) {
    if (typeof mod === 'string' && mod.includes('->')) return /image/i.test(mod.split('->')[0]) ? 'yes' : 'no';
  }
  const flags = [m.supports_image_input, m.supports_vision, m.capabilities?.vision, m.capabilities?.image_input];
  for (const f of flags) if (typeof f === 'boolean') return f ? 'yes' : 'no';
  if (Array.isArray(m.capabilities)) return m.capabilities.includes('vision') ? 'yes' : visionFromName(m.id);
  return visionFromName(String(m.id));
}

const RANK: Record<Vision, number> = { yes: 0, likely: 1, unknown: 2, no: 3 };

export function sortModels(models: ModelInfo[]): ModelInfo[] {
  return [...models].sort((a, b) => RANK[a.vision] - RANK[b.vision] || a.id.localeCompare(b.id));
}
