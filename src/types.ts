export interface ShortcutInfo {
  modifiers: string[];
  key: string;
  display: string;
}

export interface ApiKeyStatus {
  openai_configured: boolean;
  groq_configured: boolean;
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

export type SectionId = "model" | "shortcut" | "apikeys";
