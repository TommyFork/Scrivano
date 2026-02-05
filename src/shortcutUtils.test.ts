import { describe, it, expect, beforeEach } from "vitest";
import {
  normalizeKeyCode,
  getModifiersFromEvent,
  formatKey,
  formatShortcutForDisplay,
  isModifierCode,
  createShortcutRecorder,
  type KeyboardEventLike,
  type ShortcutRecorder,
} from "./shortcutUtils";

// Helper to create mock keyboard events
function createKeyEvent(
  code: string,
  options: {
    metaKey?: boolean;
    ctrlKey?: boolean;
    altKey?: boolean;
    shiftKey?: boolean;
    key?: string;
  } = {}
): KeyboardEventLike {
  return {
    code,
    key: options.key,
    metaKey: options.metaKey ?? false,
    ctrlKey: options.ctrlKey ?? false,
    altKey: options.altKey ?? false,
    shiftKey: options.shiftKey ?? false,
  };
}

describe("isModifierCode", () => {
  it("returns true for Meta keys", () => {
    expect(isModifierCode("MetaLeft")).toBe(true);
    expect(isModifierCode("MetaRight")).toBe(true);
  });

  it("returns true for Shift keys", () => {
    expect(isModifierCode("ShiftLeft")).toBe(true);
    expect(isModifierCode("ShiftRight")).toBe(true);
  });

  it("returns true for Control keys", () => {
    expect(isModifierCode("ControlLeft")).toBe(true);
    expect(isModifierCode("ControlRight")).toBe(true);
  });

  it("returns true for Alt keys", () => {
    expect(isModifierCode("AltLeft")).toBe(true);
    expect(isModifierCode("AltRight")).toBe(true);
  });

  it("returns false for letter keys", () => {
    expect(isModifierCode("KeyA")).toBe(false);
    expect(isModifierCode("KeyL")).toBe(false);
    expect(isModifierCode("KeyZ")).toBe(false);
  });

  it("returns false for other keys", () => {
    expect(isModifierCode("Space")).toBe(false);
    expect(isModifierCode("Enter")).toBe(false);
    expect(isModifierCode("Digit1")).toBe(false);
  });
});

describe("normalizeKeyCode", () => {
  describe("letter keys", () => {
    it("converts KeyA-KeyZ to lowercase letters", () => {
      expect(normalizeKeyCode("KeyA")).toBe("a");
      expect(normalizeKeyCode("KeyL")).toBe("l");
      expect(normalizeKeyCode("KeyZ")).toBe("z");
    });
  });

  describe("digit keys", () => {
    it("converts Digit0-Digit9 to numbers", () => {
      expect(normalizeKeyCode("Digit0")).toBe("0");
      expect(normalizeKeyCode("Digit5")).toBe("5");
      expect(normalizeKeyCode("Digit9")).toBe("9");
    });
  });

  describe("function keys", () => {
    it("converts F1-F12 to lowercase", () => {
      expect(normalizeKeyCode("F1")).toBe("f1");
      expect(normalizeKeyCode("F5")).toBe("f5");
      expect(normalizeKeyCode("F12")).toBe("f12");
    });
  });

  describe("numpad keys", () => {
    it("converts Numpad0-Numpad9 to num0-num9", () => {
      expect(normalizeKeyCode("Numpad0")).toBe("num0");
      expect(normalizeKeyCode("Numpad5")).toBe("num5");
      expect(normalizeKeyCode("Numpad9")).toBe("num9");
    });
  });

  describe("special keys", () => {
    it("converts Space", () => {
      expect(normalizeKeyCode("Space")).toBe("space");
    });

    it("converts Enter", () => {
      expect(normalizeKeyCode("Enter")).toBe("enter");
    });

    it("converts arrow keys", () => {
      expect(normalizeKeyCode("ArrowUp")).toBe("up");
      expect(normalizeKeyCode("ArrowDown")).toBe("down");
      expect(normalizeKeyCode("ArrowLeft")).toBe("left");
      expect(normalizeKeyCode("ArrowRight")).toBe("right");
    });

    it("converts punctuation", () => {
      expect(normalizeKeyCode("Minus")).toBe("minus");
      expect(normalizeKeyCode("Equal")).toBe("equal");
      expect(normalizeKeyCode("BracketLeft")).toBe("[");
      expect(normalizeKeyCode("Semicolon")).toBe(";");
      expect(normalizeKeyCode("Comma")).toBe(",");
      expect(normalizeKeyCode("Period")).toBe(".");
      expect(normalizeKeyCode("Slash")).toBe("/");
    });
  });

  describe("modifier keys", () => {
    it("returns null for modifier keys", () => {
      expect(normalizeKeyCode("MetaLeft")).toBeNull();
      expect(normalizeKeyCode("MetaRight")).toBeNull();
      expect(normalizeKeyCode("ShiftLeft")).toBeNull();
      expect(normalizeKeyCode("ShiftRight")).toBeNull();
      expect(normalizeKeyCode("ControlLeft")).toBeNull();
      expect(normalizeKeyCode("ControlRight")).toBeNull();
      expect(normalizeKeyCode("AltLeft")).toBeNull();
      expect(normalizeKeyCode("AltRight")).toBeNull();
    });
  });

  describe("unknown keys", () => {
    it("returns null for unknown codes", () => {
      expect(normalizeKeyCode("Unknown")).toBeNull();
      expect(normalizeKeyCode("RandomKey")).toBeNull();
    });
  });
});

describe("getModifiersFromEvent", () => {
  it("returns empty array when no modifiers pressed", () => {
    const event = createKeyEvent("KeyA");
    expect(getModifiersFromEvent(event)).toEqual([]);
  });

  it("returns super when metaKey is true", () => {
    const event = createKeyEvent("KeyA", { metaKey: true });
    expect(getModifiersFromEvent(event)).toEqual(["super"]);
  });

  it("returns ctrl when ctrlKey is true", () => {
    const event = createKeyEvent("KeyA", { ctrlKey: true });
    expect(getModifiersFromEvent(event)).toEqual(["ctrl"]);
  });

  it("returns alt when altKey is true", () => {
    const event = createKeyEvent("KeyA", { altKey: true });
    expect(getModifiersFromEvent(event)).toEqual(["alt"]);
  });

  it("returns shift when shiftKey is true", () => {
    const event = createKeyEvent("KeyA", { shiftKey: true });
    expect(getModifiersFromEvent(event)).toEqual(["shift"]);
  });

  it("returns multiple modifiers in correct order", () => {
    const event = createKeyEvent("KeyA", {
      metaKey: true,
      shiftKey: true,
    });
    expect(getModifiersFromEvent(event)).toEqual(["super", "shift"]);
  });

  it("returns all modifiers in order: super, ctrl, alt, shift", () => {
    const event = createKeyEvent("KeyA", {
      metaKey: true,
      ctrlKey: true,
      altKey: true,
      shiftKey: true,
    });
    expect(getModifiersFromEvent(event)).toEqual(["super", "ctrl", "alt", "shift"]);
  });
});

describe("formatKey", () => {
  it("formats single letters as uppercase", () => {
    expect(formatKey("a")).toBe("A");
    expect(formatKey("l")).toBe("L");
    expect(formatKey("z")).toBe("Z");
  });

  it("formats numbers as-is", () => {
    expect(formatKey("0")).toBe("0");
    expect(formatKey("5")).toBe("5");
  });

  it("formats function keys as uppercase", () => {
    expect(formatKey("f1")).toBe("F1");
    expect(formatKey("f12")).toBe("F12");
  });

  it("formats numpad keys", () => {
    expect(formatKey("num0")).toBe("Num0");
    expect(formatKey("num5")).toBe("Num5");
  });

  it("formats special keys with symbols", () => {
    expect(formatKey("space")).toBe("Space");
    expect(formatKey("enter")).toBe("↩");
    expect(formatKey("escape")).toBe("⎋");
    expect(formatKey("up")).toBe("↑");
    expect(formatKey("down")).toBe("↓");
    expect(formatKey("backspace")).toBe("⌫");
  });

  it("formats modifier keys with symbols", () => {
    expect(formatKey("super")).toBe("⌘");
    expect(formatKey("shift")).toBe("⇧");
    expect(formatKey("ctrl")).toBe("⌃");
    expect(formatKey("alt")).toBe("⌥");
  });
});

describe("formatShortcutForDisplay", () => {
  it("formats single key without modifiers", () => {
    expect(formatShortcutForDisplay([], "a")).toBe("A");
    expect(formatShortcutForDisplay([], "space")).toBe("Space");
  });

  it("formats key with single modifier", () => {
    expect(formatShortcutForDisplay(["super"], "a")).toBe("⌘A");
    expect(formatShortcutForDisplay(["shift"], "l")).toBe("⇧L");
  });

  it("formats key with multiple modifiers", () => {
    expect(formatShortcutForDisplay(["super", "shift"], "space")).toBe("⌘⇧Space");
    expect(formatShortcutForDisplay(["ctrl", "alt"], "a")).toBe("⌃⌥A");
  });

  it("formats modifiers only (no key)", () => {
    expect(formatShortcutForDisplay(["super"], "")).toBe("⌘");
    expect(formatShortcutForDisplay(["super", "shift"], "")).toBe("⌘⇧");
  });

  it("handles all modifiers", () => {
    expect(formatShortcutForDisplay(["super", "ctrl", "alt", "shift"], "a")).toBe(
      "⌘⌃⌥⇧A"
    );
  });
});

describe("ShortcutRecorder", () => {
  let recorder: ShortcutRecorder;

  beforeEach(() => {
    recorder = createShortcutRecorder();
  });

  describe("initial state", () => {
    it("starts in idle state", () => {
      expect(recorder.state.type).toBe("idle");
    });

    it("has empty display initially", () => {
      expect(recorder.getDisplay()).toBe("");
    });

    it("has no recorded shortcut initially", () => {
      expect(recorder.getRecordedShortcut()).toBeNull();
    });
  });

  describe("start()", () => {
    it("transitions to recording state", () => {
      recorder.start();
      expect(recorder.state.type).toBe("recording");
    });

    it("clears display", () => {
      recorder.start();
      expect(recorder.getDisplay()).toBe("");
    });
  });

  describe("cancel()", () => {
    it("transitions back to idle state", () => {
      recorder.start();
      recorder.cancel();
      expect(recorder.state.type).toBe("idle");
    });

    it("clears recorded shortcut", () => {
      recorder.start();
      recorder.handleKeyDown(createKeyEvent("KeyA", { metaKey: true }));
      recorder.cancel();
      expect(recorder.getRecordedShortcut()).toBeNull();
    });
  });

  describe("handleKeyDown", () => {
    beforeEach(() => {
      recorder.start();
    });

    it("ignores events when not recording", () => {
      recorder.cancel();
      recorder.handleKeyDown(createKeyEvent("KeyA", { metaKey: true }));
      expect(recorder.state.type).toBe("idle");
    });

    it("records single letter key with Cmd modifier", () => {
      recorder.handleKeyDown(createKeyEvent("KeyA", { metaKey: true }));
      expect(recorder.getDisplay()).toBe("⌘A");
      expect(recorder.getRecordedShortcut()).toEqual({
        modifiers: ["super"],
        key: "a",
      });
    });

    it("records single letter key with Cmd+Shift", () => {
      recorder.handleKeyDown(
        createKeyEvent("KeyL", { metaKey: true, shiftKey: true })
      );
      expect(recorder.getDisplay()).toBe("⌘⇧L");
      expect(recorder.getRecordedShortcut()).toEqual({
        modifiers: ["super", "shift"],
        key: "l",
      });
    });

    it("records space with modifiers", () => {
      recorder.handleKeyDown(
        createKeyEvent("Space", { metaKey: true, shiftKey: true })
      );
      expect(recorder.getDisplay()).toBe("⌘⇧Space");
      expect(recorder.getRecordedShortcut()).toEqual({
        modifiers: ["super", "shift"],
        key: "space",
      });
    });

    it("records key without modifiers", () => {
      recorder.handleKeyDown(createKeyEvent("KeyL"));
      expect(recorder.getDisplay()).toBe("L");
      expect(recorder.getRecordedShortcut()).toEqual({
        modifiers: [],
        key: "l",
      });
    });

    it("shows only modifiers when modifier key is pressed", () => {
      recorder.handleKeyDown(createKeyEvent("MetaLeft", { metaKey: true }));
      expect(recorder.getDisplay()).toBe("⌘");
      expect(recorder.getRecordedShortcut()).toBeNull();
    });

    it("shows multiple modifiers as they are held", () => {
      recorder.handleKeyDown(
        createKeyEvent("ShiftLeft", { metaKey: true, shiftKey: true })
      );
      expect(recorder.getDisplay()).toBe("⌘⇧");
    });

    it("updates recorded shortcut when new key is pressed", () => {
      recorder.handleKeyDown(createKeyEvent("KeyA", { metaKey: true }));
      expect(recorder.getRecordedShortcut()?.key).toBe("a");

      // Press a different key (simulating user changing their mind)
      recorder.handleKeyDown(createKeyEvent("KeyB", { metaKey: true }));
      expect(recorder.getRecordedShortcut()?.key).toBe("b");
      expect(recorder.getDisplay()).toBe("⌘B");
    });

    it("records function keys", () => {
      recorder.handleKeyDown(createKeyEvent("F5", { metaKey: true }));
      expect(recorder.getDisplay()).toBe("⌘F5");
      expect(recorder.getRecordedShortcut()).toEqual({
        modifiers: ["super"],
        key: "f5",
      });
    });

    it("records arrow keys", () => {
      recorder.handleKeyDown(createKeyEvent("ArrowUp", { ctrlKey: true }));
      expect(recorder.getDisplay()).toBe("⌃↑");
      expect(recorder.getRecordedShortcut()).toEqual({
        modifiers: ["ctrl"],
        key: "up",
      });
    });
  });

  describe("handleKeyUp", () => {
    beforeEach(() => {
      recorder.start();
    });

    it("ignores events when not recording", () => {
      recorder.cancel();
      recorder.handleKeyUp(createKeyEvent("KeyA"));
      expect(recorder.state.type).toBe("idle");
    });

    it("completes recording when all keys released after valid shortcut", () => {
      // Press Cmd+L
      recorder.handleKeyDown(createKeyEvent("KeyL", { metaKey: true }));
      // Release L (Cmd still held)
      recorder.handleKeyUp(createKeyEvent("KeyL", { metaKey: true }));
      expect(recorder.state.type).toBe("recording");

      // Release Cmd (no modifiers held)
      recorder.handleKeyUp(createKeyEvent("MetaLeft"));
      expect(recorder.state.type).toBe("complete");
      expect(recorder.getRecordedShortcut()).toEqual({
        modifiers: ["super"],
        key: "l",
      });
    });

    it("stays in recording mode when only modifiers released", () => {
      // Press Cmd
      recorder.handleKeyDown(createKeyEvent("MetaLeft", { metaKey: true }));
      // Release Cmd without pressing any other key
      recorder.handleKeyUp(createKeyEvent("MetaLeft"));
      expect(recorder.state.type).toBe("recording");
    });

    it("records shortcut when non-modifier released without prior keydown", () => {
      // Somehow a non-modifier keyup fires without a proper keydown
      // The fallback behavior records it with empty modifiers
      recorder.handleKeyUp(createKeyEvent("KeyA"));
      expect(recorder.state.type).toBe("complete");
      expect(recorder.getRecordedShortcut()).toEqual({
        modifiers: [],
        key: "a",
      });
    });

    it("does not complete while modifiers still held", () => {
      recorder.handleKeyDown(createKeyEvent("KeyL", { metaKey: true, shiftKey: true }));
      // Release L but Cmd+Shift still held
      recorder.handleKeyUp(createKeyEvent("KeyL", { metaKey: true, shiftKey: true }));
      expect(recorder.state.type).toBe("recording");

      // Release Shift but Cmd still held
      recorder.handleKeyUp(createKeyEvent("ShiftLeft", { metaKey: true }));
      expect(recorder.state.type).toBe("recording");

      // Release Cmd - now all keys released
      recorder.handleKeyUp(createKeyEvent("MetaLeft"));
      expect(recorder.state.type).toBe("complete");
    });
  });

  describe("full recording sequences", () => {
    beforeEach(() => {
      recorder.start();
    });

    it("records Cmd+Shift+Space", () => {
      // Press Cmd
      recorder.handleKeyDown(createKeyEvent("MetaLeft", { metaKey: true }));
      expect(recorder.getDisplay()).toBe("⌘");

      // Press Shift while holding Cmd
      recorder.handleKeyDown(
        createKeyEvent("ShiftLeft", { metaKey: true, shiftKey: true })
      );
      expect(recorder.getDisplay()).toBe("⌘⇧");

      // Press Space while holding Cmd+Shift
      recorder.handleKeyDown(
        createKeyEvent("Space", { metaKey: true, shiftKey: true })
      );
      expect(recorder.getDisplay()).toBe("⌘⇧Space");

      // Release Space
      recorder.handleKeyUp(
        createKeyEvent("Space", { metaKey: true, shiftKey: true })
      );
      expect(recorder.state.type).toBe("recording");

      // Release Shift
      recorder.handleKeyUp(createKeyEvent("ShiftLeft", { metaKey: true }));
      expect(recorder.state.type).toBe("recording");

      // Release Cmd
      recorder.handleKeyUp(createKeyEvent("MetaLeft"));
      expect(recorder.state.type).toBe("complete");
      expect(recorder.getRecordedShortcut()).toEqual({
        modifiers: ["super", "shift"],
        key: "space",
      });
    });

    it("records single key (L) without modifiers", () => {
      recorder.handleKeyDown(createKeyEvent("KeyL"));
      expect(recorder.getDisplay()).toBe("L");

      recorder.handleKeyUp(createKeyEvent("KeyL"));
      expect(recorder.state.type).toBe("complete");
      expect(recorder.getRecordedShortcut()).toEqual({
        modifiers: [],
        key: "l",
      });
    });

    it("records Ctrl+Alt+Delete", () => {
      recorder.handleKeyDown(createKeyEvent("ControlLeft", { ctrlKey: true }));
      recorder.handleKeyDown(
        createKeyEvent("AltLeft", { ctrlKey: true, altKey: true })
      );
      recorder.handleKeyDown(
        createKeyEvent("Delete", { ctrlKey: true, altKey: true })
      );
      expect(recorder.getDisplay()).toBe("⌃⌥⌦");

      recorder.handleKeyUp(createKeyEvent("Delete", { ctrlKey: true, altKey: true }));
      recorder.handleKeyUp(createKeyEvent("AltLeft", { ctrlKey: true }));
      recorder.handleKeyUp(createKeyEvent("ControlLeft"));

      expect(recorder.state.type).toBe("complete");
      expect(recorder.getRecordedShortcut()).toEqual({
        modifiers: ["ctrl", "alt"],
        key: "delete",
      });
    });

    it("handles rapid key changes", () => {
      // User presses Cmd+A, then quickly changes to Cmd+B
      recorder.handleKeyDown(createKeyEvent("KeyA", { metaKey: true }));
      expect(recorder.getRecordedShortcut()?.key).toBe("a");

      recorder.handleKeyDown(createKeyEvent("KeyB", { metaKey: true }));
      expect(recorder.getRecordedShortcut()?.key).toBe("b");

      recorder.handleKeyUp(createKeyEvent("KeyB", { metaKey: true }));
      recorder.handleKeyUp(createKeyEvent("MetaLeft"));

      expect(recorder.state.type).toBe("complete");
      expect(recorder.getRecordedShortcut()?.key).toBe("b");
    });
  });

  describe("edge cases", () => {
    beforeEach(() => {
      recorder.start();
    });

    it("handles modifier-only sequences without error", () => {
      recorder.handleKeyDown(createKeyEvent("MetaLeft", { metaKey: true }));
      recorder.handleKeyUp(createKeyEvent("MetaLeft"));
      // Should still be recording, waiting for actual key
      expect(recorder.state.type).toBe("recording");
    });

    it("records last pressed key when multiple keys pressed", () => {
      // This simulates the scenario where someone presses multiple letter keys
      recorder.handleKeyDown(createKeyEvent("KeyA", { metaKey: true }));
      recorder.handleKeyDown(createKeyEvent("KeyB", { metaKey: true }));

      recorder.handleKeyUp(createKeyEvent("KeyA", { metaKey: true }));
      recorder.handleKeyUp(createKeyEvent("KeyB", { metaKey: true }));
      recorder.handleKeyUp(createKeyEvent("MetaLeft"));

      expect(recorder.state.type).toBe("complete");
      // Should have the last pressed key
      expect(recorder.getRecordedShortcut()?.key).toBe("b");
    });
  });

  describe("macOS system shortcut interception scenarios", () => {
    beforeEach(() => {
      recorder.start();
    });

    it("records shortcut when Cmd+L keydown is intercepted", () => {
      // User presses Cmd
      recorder.handleKeyDown(createKeyEvent("MetaLeft", { metaKey: true }));
      expect(recorder.getDisplay()).toBe("⌘");

      // L is intercepted by macOS - no keydown fires
      // But keyup might still fire for L when released
      recorder.handleKeyUp(createKeyEvent("KeyL", { metaKey: true }));
      expect(recorder.getDisplay()).toBe("⌘L");

      // User releases Cmd
      recorder.handleKeyUp(createKeyEvent("MetaLeft"));
      expect(recorder.state.type).toBe("complete");
      expect(recorder.getRecordedShortcut()).toEqual({
        modifiers: ["super"],
        key: "l",
      });
    });

    it("allows retry after intercepted shortcut by recording again", () => {
      // First attempt: Cmd+L intercepted, recorded on keyup
      recorder.handleKeyDown(createKeyEvent("MetaLeft", { metaKey: true }));
      recorder.handleKeyUp(createKeyEvent("KeyL", { metaKey: true }));
      recorder.handleKeyUp(createKeyEvent("MetaLeft"));
      expect(recorder.state.type).toBe("complete");

      recorder.start();

      // Second attempt: Cmd+K (not intercepted)
      recorder.handleKeyDown(createKeyEvent("MetaLeft", { metaKey: true }));
      recorder.handleKeyDown(createKeyEvent("KeyK", { metaKey: true }));
      expect(recorder.getDisplay()).toBe("⌘K");

      recorder.handleKeyUp(createKeyEvent("KeyK", { metaKey: true }));
      recorder.handleKeyUp(createKeyEvent("MetaLeft"));

      expect(recorder.state.type).toBe("complete");
      expect(recorder.getRecordedShortcut()).toEqual({
        modifiers: ["super"],
        key: "k",
      });
    });

    it("records shortcut when keyup fires after modifiers release", () => {
      // Cmd pressed
      recorder.handleKeyDown(createKeyEvent("MetaLeft", { metaKey: true }));

      // Cmd released before keyup for L arrives
      recorder.handleKeyUp(createKeyEvent("MetaLeft"));

      // L keyup fires even though keydown was intercepted (edge case)
      recorder.handleKeyUp(createKeyEvent("KeyL"));
      expect(recorder.state.type).toBe("complete");
      expect(recorder.getRecordedShortcut()).toEqual({
        modifiers: ["super"],
        key: "l",
      });
    });

    it("successfully records after multiple failed attempts", () => {
      // First failed attempt
      recorder.handleKeyDown(createKeyEvent("MetaLeft", { metaKey: true }));
      recorder.handleKeyUp(createKeyEvent("MetaLeft"));

      // Second failed attempt
      recorder.handleKeyDown(createKeyEvent("ShiftLeft", { shiftKey: true }));
      recorder.handleKeyUp(createKeyEvent("ShiftLeft"));

      // Still recording
      expect(recorder.state.type).toBe("recording");

      // Successful attempt
      recorder.handleKeyDown(createKeyEvent("KeyJ", { metaKey: true }));
      recorder.handleKeyUp(createKeyEvent("KeyJ", { metaKey: true }));
      recorder.handleKeyUp(createKeyEvent("MetaLeft"));

      expect(recorder.state.type).toBe("complete");
      expect(recorder.getRecordedShortcut()?.key).toBe("j");
    });
  });

  describe("quick successive key presses", () => {
    beforeEach(() => {
      recorder.start();
    });

    it("correctly captures shortcut when keys are pressed rapidly", () => {
      // Simulate rapid Cmd+Shift+Space
      recorder.handleKeyDown(createKeyEvent("MetaLeft", { metaKey: true }));
      recorder.handleKeyDown(
        createKeyEvent("ShiftLeft", { metaKey: true, shiftKey: true })
      );
      recorder.handleKeyDown(
        createKeyEvent("Space", { metaKey: true, shiftKey: true })
      );

      // All released at once (simulating key repeat)
      recorder.handleKeyUp(
        createKeyEvent("Space", { metaKey: true, shiftKey: true })
      );
      recorder.handleKeyUp(createKeyEvent("ShiftLeft", { metaKey: true }));
      recorder.handleKeyUp(createKeyEvent("MetaLeft"));

      expect(recorder.state.type).toBe("complete");
      expect(recorder.getRecordedShortcut()).toEqual({
        modifiers: ["super", "shift"],
        key: "space",
      });
    });

    it("handles key release in different order than press", () => {
      recorder.handleKeyDown(createKeyEvent("MetaLeft", { metaKey: true }));
      recorder.handleKeyDown(
        createKeyEvent("ShiftLeft", { metaKey: true, shiftKey: true })
      );
      recorder.handleKeyDown(
        createKeyEvent("KeyA", { metaKey: true, shiftKey: true })
      );

      // Release in reverse order
      recorder.handleKeyUp(createKeyEvent("MetaLeft", { shiftKey: true }));
      recorder.handleKeyUp(createKeyEvent("ShiftLeft"));

      expect(recorder.state.type).toBe("complete");
      expect(recorder.getRecordedShortcut()).toEqual({
        modifiers: ["super", "shift"],
        key: "a",
      });
    });
  });
});
