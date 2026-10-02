/** Name fragments that mean "this Ollama tag draws pictures" when the server
 *  omits capabilities (Ollama before the capabilities field existed). */
const IMAGE_NAME = /qwen[-_ ]?image|z-image|flux|imagegen|stable-diffusion|\bsdxl\b/i;

/** Drawn by stable-diffusion.cpp on the laptop, not by Ollama. */
export const QWEN_IMAGE_MODEL = 'qwen-image-2.1';

/** Image drawers the parlor runs on the laptop. Ollama never sees these names. */
export const LAPTOP_IMAGE_MODELS = ['qwen-image-2.1', 'z-image-turbo'] as const;

export function laptopImageModel(name: string): (typeof LAPTOP_IMAGE_MODELS)[number] | null {
  const bare = name.replace(/:latest$/, '');
  return (LAPTOP_IMAGE_MODELS as readonly string[]).includes(bare)
    ? bare as (typeof LAPTOP_IMAGE_MODELS)[number]
    : null;
}

const MODEL_LABELS: Record<string, string> = {
  'laptop-qwen3': 'Qwen3 8B',
  'laptop-qwen35': 'Qwen3.5 4B',
  'laptop-coder': 'Coder 7B',
  'laptop-coder-3b': 'Coder 3B',
  'laptop-coder-30b': 'Coder 30B',
  'laptop-gemma4': 'Gemma 4 E2B',
  'qwen-image-2.1': 'Qwen Image 2.1',
  'z-image-turbo': 'Z-Image Turbo',
  'gpt-oss:20b': 'gpt-oss 20B',
};

export function isImageModel(name: string, capabilities?: string[]): boolean {
  if (capabilities && capabilities.length > 0) return capabilities.includes('image');
  return IMAGE_NAME.test(name);
}

export function classifyModels(models: { name: string; capabilities?: string[] }[]): { chat: string[]; image: string[] } {
  const chat: string[] = [];
  const image: string[] = [];
  for (const model of models) {
    if (!model.name) continue;
    if (isImageModel(model.name, model.capabilities)) image.push(model.name);
    else chat.push(model.name);
  }
  return { chat, image };
}

/** Drop the raw Hugging Face tags. The short aliases are the same weights with a 32k window, and the long names do not fit the picker. */
export function parlorModelLists(models: { name: string; capabilities?: string[] }[]): { chat: string[]; image: string[] } {
  const usable = models.filter((model) => !model.name.startsWith('hf.co/'));
  const lists = classifyModels(usable);
  for (const name of LAPTOP_IMAGE_MODELS) {
    if (!lists.image.includes(name)) lists.image.push(name);
  }
  return lists;
}

export function parlorModelLabel(name: string): string {
  const bare = name.replace(/:latest$/, '');
  return MODEL_LABELS[name] ?? MODEL_LABELS[bare] ?? bare;
}

/** Sampling progress from stable-diffusion.cpp, e.g. `12/20 - 33.91s/it`. Tensor-load bars use MB/s and are ignored. */
export function parseImageProgress(line: string): { step: number; total: number; secondsPerStep: number } | null {
  const cleaned = line.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '');
  const match = cleaned.match(/(\d+)\s*\/\s*(\d+)\s+-\s+([\d.]+)s\/it/);
  if (!match) return null;
  const step = Number(match[1]);
  const total = Number(match[2]);
  const secondsPerStep = Number(match[3]);
  if (!Number.isFinite(step) || !Number.isFinite(total) || total < 1 || step < 1 || step > total) return null;
  if (!Number.isFinite(secondsPerStep)) return null;
  return { step, total, secondsPerStep };
}
