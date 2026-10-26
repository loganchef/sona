import type { ProviderSettings, VoiceSettings } from '@/types';

/**
 * binrc/desk is an OpenAI-compatible model gateway, not a Sona-only backend.
 * The shared `api.binrc.com` host already serves other cloud APIs, so the
 * model service owns the `/models/v1` prefix instead of the generic `/v1`
 * root. Sona appends `/models`, `/audio/transcriptions`, and
 * `/chat/completions` to this base.
 */
export const BINRC_DESK_BASE_URL = 'https://api.binrc.com/models/v1';

export interface ProviderPreset {
  id: string;
  label: string;
  baseUrl: string;
  model: string;
  hint: string;
  needsKey: boolean;
}

/** ASR presets: all speak OpenAI's `/audio/transcriptions`. */
export const ASR_PRESETS: ProviderPreset[] = [
  {
    id: 'none',
    label: '未配置',
    baseUrl: '',
    model: '',
    hint: '选择一家服务并填入密钥；也可以填自己的 OpenAI 兼容网关。',
    needsKey: false,
  },
  {
    id: 'binrc-desk',
    label: 'binrc/desk',
    baseUrl: BINRC_DESK_BASE_URL,
    model: '',
    hint: '一个 key 接入多家 ASR 与整理模型；密钥与模型列表在 desk.binrc.com 管理。',
    needsKey: true,
  },
  {
    id: 'siliconflow',
    label: '硅基流动 · SenseVoice',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'FunAudioLLM/SenseVoiceSmall',
    hint: '国内直连、按量计费很低，适合中文与中英混说。',
    needsKey: true,
  },
  {
    id: 'groq',
    label: 'Groq · Whisper',
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'whisper-large-v3-turbo',
    hint: '速度极快、额度免费，国内需要能访问外网。',
    needsKey: true,
  },
  {
    id: 'dashscope',
    label: '阿里云百炼 · Qwen3-ASR',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen3-asr-flash',
    hint: '中文识别强，兼容模式走 OpenAI 协议。',
    needsKey: true,
  },
  {
    id: 'openai',
    label: 'OpenAI · gpt-4o-transcribe',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini-transcribe',
    hint: '多语言稳定，国内需要代理。',
    needsKey: true,
  },
  {
    id: 'custom',
    label: '自定义兼容服务',
    baseUrl: '',
    model: '',
    hint: 'faster-whisper、FunASR、one-api 等自建网关都行。',
    needsKey: false,
  },
];

/** Polish presets: OpenAI chat completions. */
export const POLISH_PRESETS: ProviderPreset[] = [
  {
    id: 'none',
    label: '未配置（只做转写）',
    baseUrl: '',
    model: '',
    hint: '不配置润色时，Sona 只把识别结果写进光标。',
    needsKey: false,
  },
  {
    id: 'binrc-desk',
    label: 'binrc/desk',
    baseUrl: BINRC_DESK_BASE_URL,
    model: '',
    hint: '一个 key 接入多家整理模型；密钥与模型列表在 desk.binrc.com 管理。',
    needsKey: true,
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    hint: '便宜、中文整理稳，日常听写首选。',
    needsKey: true,
  },
  {
    id: 'qwen',
    label: '通义千问 · 百炼',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
    hint: '与 ASR 同一把百炼密钥，少管一个账号。',
    needsKey: true,
  },
  {
    id: 'kimi',
    label: 'Kimi · Moonshot',
    baseUrl: 'https://api.moonshot.cn/v1',
    model: 'moonshot-v1-8k',
    hint: '长句、长提示词整理表现好。',
    needsKey: true,
  },
  {
    id: 'glm',
    label: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4-flash',
    hint: '国内直连、有免费额度。',
    needsKey: true,
  },
  {
    id: 'siliconflow',
    label: '硅基流动',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'Qwen/Qwen3-8B',
    hint: '一个账号同时供 ASR 与润色，账单合并。',
    needsKey: true,
  },
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4.1-mini',
    hint: '结构化提示词模式效果最稳。',
    needsKey: true,
  },
  {
    id: 'custom',
    label: '自定义兼容服务',
    baseUrl: '',
    model: '',
    hint: 'vLLM、Ollama、LiteLLM、one-api 都可。',
    needsKey: false,
  },
];

export function presetById(presets: ProviderPreset[], id: string): ProviderPreset | undefined {
  // `sona` was the preset id in the first preview build; keep old settings usable.
  const lookup = id === 'sona' ? 'binrc-desk' : id;
  return presets.find((preset) => preset.id === lookup);
}

/** Apply a preset while keeping a key the user already typed. */
export function withPreset(current: ProviderSettings, preset: ProviderPreset): ProviderSettings {
  return {
    preset: preset.id,
    baseUrl: preset.baseUrl,
    model: preset.model,
    apiKey: current.apiKey,
  };
}

/**
 * A provider is usable only when the endpoint, the model *and* any key the
 * preset requires are present. Without the key check the setup checklist goes
 * green for a service that will reject the first dictation.
 */
export function isConfigured(provider: ProviderSettings, presets?: ProviderPreset[]): boolean {
  if (provider.baseUrl.trim().length === 0 || provider.model.trim().length === 0) return false;
  const preset = presets ? presetById(presets, provider.preset) : undefined;
  if (preset?.needsKey && provider.apiKey.trim().length === 0) return false;
  return true;
}

/** Recognition is ready through the cloud provider or through a local server. */
export function isAsrReady(voice: VoiceSettings): boolean {
  if (
    voice.localAsr.enabled &&
    voice.localAsr.baseUrl.trim().length > 0 &&
    voice.localAsr.model.trim().length > 0
  ) {
    return true;
  }
  return isConfigured(voice.asr, ASR_PRESETS);
}

export function maskKey(key: string): string {
  const trimmed = key.trim();
  if (!trimmed) return '';
  if (trimmed.length <= 8) return '••••';
  return `${trimmed.slice(0, 4)}••••${trimmed.slice(-4)}`;
}
