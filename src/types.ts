export interface ShortcutInfo {
  modifiers: string[];
  key: string;
  display: string;
}

export interface ApiKeyStatus {
  openai_configured: boolean;
  groq_configured: boolean;
  openai_source: string | null;
  groq_source: string | null;
}

export interface ProviderInfo {
  id: string;
  name: string;
  model: string;
  available: boolean;
}

export interface TranscriptionSettings {
  provider: string;
  model: string;
}

export interface AudioDeviceInfo {
  name: string;
  is_default: boolean;
}

export type SectionId = "model" | "shortcut" | "apikeys" | "audio";
