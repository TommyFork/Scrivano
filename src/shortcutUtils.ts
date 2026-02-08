// Shortcut recording and formatting utilities

export const MOD_SYMBOLS: Record<string, string> = {
  super: "⌘",
  shift: "⇧",
  ctrl: "⌃",
  alt: "⌥",
};

export const KEY_SYMBOLS: Record<string, string> = {
  space: "Space",
  enter: "↩",
  escape: "⎋",
  tab: "⇥",
  up: "↑",
  down: "↓",
  left: "←",
  right: "→",
  backspace: "⌫",
  delete: "⌦",
  home: "Home",
  end: "End",
  pageup: "PgUp",
  pagedown: "PgDn",
  insert: "Ins",
  minus: "-",
  equal: "=",
  backquote: "`",
};

// Special keys mapping from browser code to our normalized key
const SPECIAL_KEYS: Record<string, string> = {
  Space: "space",
  Enter: "enter",
  Tab: "tab",
  Escape: "escape",
  Backspace: "backspace",
  Delete: "delete",
  Insert: "insert",
  Home: "home",
  End: "end",
  PageUp: "pageup",
  PageDown: "pagedown",
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  Minus: "minus",
  Equal: "equal",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Backquote: "backquote",
  Comma: ",",
  Period: ".",
  Slash: "/",
};

export interface KeyboardEventLike {
  code: string;
  key?: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

export interface RecordedShortcut {
  modifiers: string[];
  key: string;
}

/**
 * Check if a key code represents a modifier key
 */
export function isModifierCode(code: string): boolean {
  return (
    code.startsWith("Meta") ||
    code.startsWith("Shift") ||
    code.startsWith("Control") ||
    code.startsWith("Alt")
  );
}

/**
 * Convert browser key code to our normalized key (non-modifier keys only)
 * Returns null for modifier keys
 */
export function normalizeKeyCode(code: string, key?: string): string | null {
  // Skip modifier keys - we get those from event properties
  if (isModifierCode(code)) {
    return null;
  }

  // Prefer actual character for letter keys to respect keyboard layout
  if (key && key.length === 1 && /^[a-zA-Z]$/.test(key)) {
    return key.toLowerCase();
  }

  // Letter keys (A-Z) - KeyA -> a, KeyB -> b, etc.
  if (/^Key[A-Z]$/.test(code)) {
    return code.charAt(3).toLowerCase();
  }

  // Digit keys (0-9) - Digit0 -> 0, Digit1 -> 1, etc.
  if (/^Digit[0-9]$/.test(code)) {
    return code.charAt(5);
  }

  // Function keys (F1-F12)
  if (/^F([1-9]|1[0-2])$/.test(code)) {
    return code.toLowerCase();
  }

  // Numpad keys - Numpad0 -> num0, etc.
  if (/^Numpad\d$/.test(code)) {
    return "num" + code.charAt(6);
  }

  // Special keys
  return SPECIAL_KEYS[code] || null;
}

/**
 * Get modifiers from keyboard event properties
 */
export function getModifiersFromEvent(e: KeyboardEventLike): string[] {
  const mods: string[] = [];
  if (e.metaKey) mods.push("super");
  if (e.ctrlKey) mods.push("ctrl");
  if (e.altKey) mods.push("alt");
  if (e.shiftKey) mods.push("shift");
  return mods;
}

/**
 * Format a single key for display
 */
export function formatKey(key: string): string {
  if (MOD_SYMBOLS[key]) return MOD_SYMBOLS[key];
  if (KEY_SYMBOLS[key]) return KEY_SYMBOLS[key];
  if (key.length === 1) return key.toUpperCase();
  if (key.startsWith("f") && /^f\d+$/.test(key)) return key.toUpperCase();
  if (key.startsWith("num")) return "Num" + key.charAt(3);
  return key;
}

/**
 * Format shortcut for display
 */
export function formatShortcutForDisplay(modifiers: string[], key: string): string {
  const modParts = modifiers.map((m) => MOD_SYMBOLS[m] || m);
  const keyPart = key ? formatKey(key) : "";
  return modParts.join("") + keyPart;
}

/**
 * State machine for recording shortcuts
 */
export type RecordingState =
  | { type: "idle" }
  | { type: "recording"; display: string; recorded: RecordedShortcut | null }
  | { type: "complete"; shortcut: RecordedShortcut }
  | { type: "error"; message: string };

export interface ShortcutRecorder {
  state: RecordingState;
  handleKeyDown(e: KeyboardEventLike): void;
  handleKeyUp(e: KeyboardEventLike): void;
  start(): void;
  cancel(): void;
  getDisplay(): string;
  getRecordedShortcut(): RecordedShortcut | null;
}

export function createShortcutRecorder(): ShortcutRecorder {
  let state: RecordingState = { type: "idle" };
  let recorded: RecordedShortcut | null = null;
  let lastNonEmptyModifiers: string[] = [];

  return {
    get state() {
      return state;
    },

    handleKeyDown(e: KeyboardEventLike) {
      if (state.type !== "recording") return;

      const mainKey = normalizeKeyCode(e.code, e.key);
      const modifiers = getModifiersFromEvent(e);
      if (modifiers.length > 0) {
        lastNonEmptyModifiers = modifiers;
      }

      if (mainKey) {
        // Non-modifier key pressed - record the combination
        recorded = { modifiers, key: mainKey };
        state = {
          type: "recording",
          display: formatShortcutForDisplay(modifiers, mainKey),
          recorded,
        };
      } else {
        // Just a modifier - update display
        state = {
          type: "recording",
          display: formatShortcutForDisplay(modifiers, ""),
          recorded,
        };
      }
    },

    handleKeyUp(e: KeyboardEventLike) {
      if (state.type !== "recording") return;

      const modifiers = getModifiersFromEvent(e);
      const mainKey = normalizeKeyCode(e.code, e.key);
      if (modifiers.length > 0) {
        lastNonEmptyModifiers = modifiers;
      }

      if (mainKey && !recorded) {
        const fallbackModifiers = modifiers.length > 0 ? modifiers : lastNonEmptyModifiers;
        recorded = { modifiers: fallbackModifiers, key: mainKey };
        state = {
          type: "recording",
          display: formatShortcutForDisplay(fallbackModifiers, mainKey),
          recorded,
        };
      }

      // Check if all keys are released
      if (modifiers.length === 0) {
        if (recorded && recorded.key) {
          // Valid shortcut recorded
          state = { type: "complete", shortcut: recorded };
        } else if (!isModifierCode(e.code)) {
          // Released a non-modifier but nothing was recorded
          state = { type: "error", message: "No shortcut detected. Try again." };
        }
        // If only modifiers were pressed and released, stay in recording mode
      }
    },

    start() {
      recorded = null;
      lastNonEmptyModifiers = [];
      state = { type: "recording", display: "", recorded: null };
    },

    cancel() {
      recorded = null;
      lastNonEmptyModifiers = [];
      state = { type: "idle" };
    },

    getDisplay(): string {
      if (state.type === "recording") {
        return state.display;
      }
      if (state.type === "complete") {
        return formatShortcutForDisplay(state.shortcut.modifiers, state.shortcut.key);
      }
      return "";
    },

    getRecordedShortcut(): RecordedShortcut | null {
      if (state.type === "complete") {
        return state.shortcut;
      }
      return recorded;
    },
  };
}
