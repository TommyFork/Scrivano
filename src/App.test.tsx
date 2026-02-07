import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import App from "./App";

// Get mocked functions
const mockedInvoke = invoke as Mock;
const mockedListen = listen as Mock;

describe("App", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default mock implementations
    mockedInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_api_key_status")
        return Promise.resolve({
          openai_configured: true,
          groq_configured: false,
          openai_source: "keychain",
          groq_source: null,
        });
      if (cmd === "get_available_providers")
        return Promise.resolve([
          {
            id: "openai",
            name: "OpenAI Whisper",
            model: "whisper-1",
            available: true,
          },
          {
            id: "groq",
            name: "Groq Whisper",
            model: "whisper-large-v3-turbo",
            available: false,
          },
        ]);
      if (cmd === "get_transcription_settings")
        return Promise.resolve({
          provider: "openai",
          model: "whisper-1",
        });
      if (cmd === "get_shortcut")
        return Promise.resolve({
          modifiers: ["super", "shift"],
          key: "space",
          display: "⌘⇧Space",
        });
      return Promise.resolve("");
    });
    mockedListen.mockResolvedValue(() => {});
  });

  it("renders initial state correctly", async () => {
    render(<App />);

    expect(screen.getByText("Awaiting thy voice")).toBeInTheDocument();
    expect(
screen.getByPlaceholderText("Speak unto the aether with ⌘⇧Space")
    ).toBeInTheDocument();
    expect(screen.getByText(/Summon the scribe:/)).toBeInTheDocument();
  });

  it("fetches initial transcription and recording status on mount", async () => {
    mockedInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_transcription") return Promise.resolve("Hello world");
      if (cmd === "get_recording_status") return Promise.resolve(false);
      return Promise.resolve("");
    });

    render(<App />);

    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalledWith("get_transcription");
      expect(mockedInvoke).toHaveBeenCalledWith("get_recording_status");
    });
  });

  it("sets up event listeners on mount", async () => {
    render(<App />);

    await waitFor(() => {
      expect(mockedListen).toHaveBeenCalledWith(
        "recording-status",
        expect.any(Function)
      );
      expect(mockedListen).toHaveBeenCalledWith(
        "transcription",
        expect.any(Function)
      );
      expect(mockedListen).toHaveBeenCalledWith(
        "transcription-status",
        expect.any(Function)
      );
      expect(mockedListen).toHaveBeenCalledWith("error", expect.any(Function));
    });
  });

  it("displays transcription in textarea when available", async () => {
    mockedInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_transcription") return Promise.resolve("Test transcription");
      if (cmd === "get_recording_status") return Promise.resolve(false);
      return Promise.resolve("");
    });

    render(<App />);

    await waitFor(() => {
      const textarea = screen.getByRole("textbox");
      expect(textarea).toHaveValue("Test transcription");
    });
  });

  it("textarea is always visible and editable", async () => {
    mockedInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_transcription") return Promise.resolve("Some text");
      if (cmd === "get_recording_status") return Promise.resolve(false);
      return Promise.resolve("");
    });

    render(<App />);

    await waitFor(() => {
      const textarea = screen.getByRole("textbox");
      expect(textarea).toBeInTheDocument();
      expect(textarea).not.toBeDisabled();
    });
  });

  it("enables copy button when transcription exists", async () => {
    mockedInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_transcription") return Promise.resolve("Some text");
      if (cmd === "get_recording_status") return Promise.resolve(false);
      return Promise.resolve("");
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Duplicate")).not.toBeDisabled();
    });
  });

  it("disables copy button when no transcription", async () => {
    mockedInvoke.mockResolvedValue("");

    render(<App />);

    expect(screen.getByText("Duplicate")).toBeDisabled();
  });

  it("copies transcription to clipboard when Duplicate is clicked", async () => {
    const user = userEvent.setup();
    mockedInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_transcription") return Promise.resolve("Copy me");
      if (cmd === "get_recording_status") return Promise.resolve(false);
      if (cmd === "copy_to_clipboard") return Promise.resolve();
      return Promise.resolve("");
    });

    render(<App />);

    await waitFor(() => {
      const textarea = screen.getByRole("textbox");
      expect(textarea).toHaveValue("Copy me");
    });

    await user.click(screen.getByText("Duplicate"));

    expect(mockedInvoke).toHaveBeenCalledWith("copy_to_clipboard", {
      text: "Copy me",
    });
  });

  it("allows user to edit text in textarea", async () => {
    mockedInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_transcription") return Promise.resolve("Original");
      if (cmd === "get_recording_status") return Promise.resolve(false);
      return Promise.resolve("");
    });

    render(<App />);

    await waitFor(() => {
      const textarea = screen.getByRole("textbox");
      expect(textarea).toHaveValue("Original");
    });

    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "Modified text" } });

    expect(textarea).toHaveValue("Modified text");
  });

  it("displays error message when error occurs", async () => {
    mockedInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_transcription") return Promise.resolve("text");
      if (cmd === "get_recording_status") return Promise.resolve(false);
      if (cmd === "copy_to_clipboard")
        return Promise.reject("Copy failed");
      return Promise.resolve("");
    });

    const user = userEvent.setup();
    render(<App />);

    await waitFor(() => {
      const textarea = screen.getByRole("textbox");
      expect(textarea).toHaveValue("text");
    });

    await user.click(screen.getByText("Duplicate"));

    await waitFor(() => {
      expect(screen.getByText("Copy failed")).toBeInTheDocument();
    });
  });

  it("shows recording indicator when recording", async () => {
    mockedInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_transcription") return Promise.resolve("");
      if (cmd === "get_recording_status") return Promise.resolve(true);
      return Promise.resolve("");
    });

    render(<App />);

    await waitFor(() => {
      const indicator = document.querySelector(".status-indicator.recording");
      expect(indicator).toBeInTheDocument();
    });
  });

it("updates status message after copying", async () => {
    const user = userEvent.setup();
    mockedInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_transcription") return Promise.resolve("text");
      if (cmd === "get_recording_status") return Promise.resolve(false);
      if (cmd === "copy_to_clipboard") return Promise.resolve();
      return Promise.resolve("");
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Awaiting thy voice")).toBeInTheDocument();
    });

    await user.click(screen.getByText("Duplicate"));

    await waitFor(() => {
      expect(screen.getByText("'Tis copied!")).toBeInTheDocument();
    });
  });

  it("hides window when Escape key is pressed", async () => {
    render(<App />);

    fireEvent.keyDown(document, { key: "Escape" });

    expect(mockedInvoke).toHaveBeenCalledWith("hide_window");
  });

  it("does not hide window for other keys", async () => {
    render(<App />);

    // Clear any previous calls from component mount
    mockedInvoke.mockClear();

    fireEvent.keyDown(document, { key: "Enter" });
    fireEvent.keyDown(document, { key: "a" });

    expect(mockedInvoke).not.toHaveBeenCalledWith("hide_window");
  });

  describe("Settings and Shortcut Recording", () => {
    beforeEach(() => {
      mockedInvoke.mockImplementation((cmd: string) => {
        if (cmd === "get_transcription") return Promise.resolve("");
        if (cmd === "get_recording_status") return Promise.resolve(false);
        if (cmd === "get_shortcut")
          return Promise.resolve({
            modifiers: ["super", "shift"],
            key: "space",
            display: "⌘⇧Space",
          });
        if (cmd === "get_api_key_status")
          return Promise.resolve({
            openai_configured: true,
            groq_configured: false,
            openai_source: "keychain",
            groq_source: null,
          });
        if (cmd === "get_available_providers")
          return Promise.resolve([
            {
              id: "openai",
              name: "OpenAI Whisper",
              model: "whisper-1",
              available: true,
            },
            {
              id: "groq",
              name: "Groq Whisper",
              model: "whisper-large-v3-turbo",
              available: false,
            },
          ]);
        if (cmd === "get_transcription_settings")
          return Promise.resolve({
            provider: "openai",
            model: "whisper-1",
          });
        return Promise.resolve("");
      });
    });

    it("opens settings when gear button is clicked", async () => {
      const user = userEvent.setup();
      render(<App />);

      await waitFor(() => {
        expect(screen.getByTitle("Settings")).toBeInTheDocument();
      });

      await user.click(screen.getByTitle("Settings"));

      expect(screen.getByText("Configuration")).toBeInTheDocument();
      expect(screen.getByText("Recording Shortcut")).toBeInTheDocument();
    });

    it("shows current shortcut in settings", async () => {
      const user = userEvent.setup();
      render(<App />);

      await waitFor(() => {
        expect(screen.getByTitle("Settings")).toBeInTheDocument();
      });

      await user.click(screen.getByTitle("Settings"));

      await waitFor(() => {
        expect(screen.getByText("⌘⇧Space")).toBeInTheDocument();
      });
    });

    it("enters recording mode when Change button is clicked", async () => {
      const user = userEvent.setup();
      render(<App />);

      await waitFor(() => {
        expect(screen.getByTitle("Settings")).toBeInTheDocument();
      });

      await user.click(screen.getByTitle("Settings"));

      await waitFor(() => {
        expect(screen.getByText("Change")).toBeInTheDocument();
      });

      await user.click(screen.getByText("Change"));

      expect(screen.getByPlaceholderText("Press thy keys...")).toBeInTheDocument();
      expect(screen.getByText("Cease")).toBeInTheDocument();
    });

    it("shows Cease button during recording mode", async () => {
      const user = userEvent.setup();
      render(<App />);

      await user.click(screen.getByTitle("Settings"));

      await waitFor(() => {
        expect(screen.getByText("Change")).toBeInTheDocument();
      });

      await user.click(screen.getByText("Change"));

      // Should show recording input and Cease button
      expect(screen.getByPlaceholderText("Press thy keys...")).toBeInTheDocument();
      expect(screen.getByText("Cease")).toBeInTheDocument();
    });

    it("returns to main view when Return button is clicked", async () => {
      const user = userEvent.setup();
      render(<App />);

      await user.click(screen.getByTitle("Settings"));

      await waitFor(() => {
        expect(screen.getByText("Return")).toBeInTheDocument();
      });

      await user.click(screen.getByText("Return"));

      // Should be back on main screen
      expect(screen.getByText("Awaiting thy voice")).toBeInTheDocument();
    });

    it("records shortcut on keyboard input", async () => {
      const user = userEvent.setup();
      render(<App />);

      await user.click(screen.getByTitle("Settings"));

      await waitFor(() => {
        expect(screen.getByText("Change")).toBeInTheDocument();
      });

      await user.click(screen.getByText("Change"));

      // Verify input is shown
      expect(screen.getByPlaceholderText("Press thy keys...")).toBeInTheDocument();

      // Simulate Cmd+K keydown
      await user.keyboard("{Meta>}k{/Meta}");

      await waitFor(() => {
        // After keys released, should show pending shortcut with Inscribe button
        expect(screen.queryByText("Inscribe")).toBeInTheDocument();
      });
    });

    it("saves shortcut when Inscribe button is clicked", async () => {
      const user = userEvent.setup();
      mockedInvoke.mockImplementation((cmd: string, args?: unknown) => {
        if (cmd === "get_transcription") return Promise.resolve("");
        if (cmd === "get_recording_status") return Promise.resolve(false);
        if (cmd === "get_shortcut")
          return Promise.resolve({
            modifiers: ["super", "shift"],
            key: "space",
            display: "⌘⇧Space",
          });
        if (cmd === "get_api_key_status")
          return Promise.resolve({
            openai_configured: true,
            groq_configured: false,
            openai_source: "keychain",
            groq_source: null,
          });
        if (cmd === "get_available_providers")
          return Promise.resolve([
            {
              id: "openai",
              name: "OpenAI Whisper",
              model: "whisper-1",
              available: true,
            },
            {
              id: "groq",
              name: "Groq Whisper",
              model: "whisper-large-v3-turbo",
              available: false,
            },
          ]);
        if (cmd === "get_transcription_settings")
          return Promise.resolve({
            provider: "openai",
            model: "whisper-1",
          });
        if (cmd === "set_shortcut") {
          const { modifiers, key } = args as {
            modifiers: string[];
            key: string;
          };
          return Promise.resolve({
            modifiers,
            key,
            display: "⌘K",
          });
        }
        return Promise.resolve("");
      });

      render(<App />);

      await user.click(screen.getByTitle("Settings"));

      await waitFor(() => {
        expect(screen.getByText("Change")).toBeInTheDocument();
      });

      await user.click(screen.getByText("Change"));

      // Type the shortcut
      await user.keyboard("{Meta>}k{/Meta}");

      await waitFor(() => {
        expect(screen.queryByText("Inscribe")).toBeInTheDocument();
      });

      await user.click(screen.getByText("Inscribe"));

      expect(mockedInvoke).toHaveBeenCalledWith("set_shortcut", {
        modifiers: expect.any(Array),
        key: "k",
      });
    });
  });
});
