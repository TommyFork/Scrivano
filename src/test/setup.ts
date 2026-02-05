import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// Mock Tauri's core API
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

// Mock Tauri's event API
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
  emit: vi.fn(),
}));

// Mock Tauri's plugin opener
vi.mock("@tauri-apps/plugin-opener", () => ({
  open: vi.fn(),
}));

// Mock Tauri's global shortcut plugin
vi.mock("@tauri-apps/plugin-global-shortcut", () => ({
  register: vi.fn(),
  unregister: vi.fn(),
  isRegistered: vi.fn(),
}));

// Mock Tauri's window API
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(() => ({
    onFocusChanged: vi.fn(() => Promise.resolve(() => {})),
  })),
}));
