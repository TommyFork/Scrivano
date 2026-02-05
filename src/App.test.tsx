import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App";

// Get mocked functions
const mockedInvoke = invoke as Mock;
const mockedListen = listen as Mock;
const mockedGetCurrentWindow = getCurrentWindow as Mock;

describe("App", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default mock implementations
    mockedInvoke.mockResolvedValue("");
    mockedListen.mockResolvedValue(() => {});
  });

  it("renders initial state correctly", async () => {
    render(<App />);

    expect(screen.getByText("Awaiting thy voice")).toBeInTheDocument();
    expect(
      screen.getByText("Speak unto the aether with Cmd+Shift+Space")
    ).toBeInTheDocument();
    expect(screen.getByText("Summon the scribe: Cmd+Shift+Space")).toBeInTheDocument();
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

  it("displays transcription when available", async () => {
    mockedInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_transcription") return Promise.resolve("Test transcription");
      if (cmd === "get_recording_status") return Promise.resolve(false);
      return Promise.resolve("");
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Test transcription")).toBeInTheDocument();
    });
  });

  it("enables copy and edit buttons when transcription exists", async () => {
    mockedInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_transcription") return Promise.resolve("Some text");
      if (cmd === "get_recording_status") return Promise.resolve(false);
      return Promise.resolve("");
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Duplicate")).not.toBeDisabled();
      expect(screen.getByText("Amend")).not.toBeDisabled();
    });
  });

  it("disables copy and edit buttons when no transcription", async () => {
    mockedInvoke.mockResolvedValue("");

    render(<App />);

    expect(screen.getByText("Duplicate")).toBeDisabled();
    expect(screen.getByText("Amend")).toBeDisabled();
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
      expect(screen.getByText("Copy me")).toBeInTheDocument();
    });

    await user.click(screen.getByText("Duplicate"));

    expect(mockedInvoke).toHaveBeenCalledWith("copy_to_clipboard", {
      text: "Copy me",
    });
  });

  it("enters edit mode when Amend is clicked", async () => {
    const user = userEvent.setup();
    mockedInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_transcription") return Promise.resolve("Edit me");
      if (cmd === "get_recording_status") return Promise.resolve(false);
      return Promise.resolve("");
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Edit me")).toBeInTheDocument();
    });

    await user.click(screen.getByText("Amend"));

    // In edit mode, should show textarea and different buttons
    expect(screen.getByRole("textbox")).toBeInTheDocument();
    expect(screen.getByText("Inscribe")).toBeInTheDocument();
    expect(screen.getByText("Withdraw")).toBeInTheDocument();
  });

  it("exits edit mode without saving when Withdraw is clicked", async () => {
    const user = userEvent.setup();
    mockedInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_transcription") return Promise.resolve("Original text");
      if (cmd === "get_recording_status") return Promise.resolve(false);
      return Promise.resolve("");
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Original text")).toBeInTheDocument();
    });

    await user.click(screen.getByText("Amend"));
    await user.click(screen.getByText("Withdraw"));

    // Should be back to normal view
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByText("Original text")).toBeInTheDocument();
  });

  it("saves edited text when Inscribe is clicked", async () => {
    const user = userEvent.setup();
    mockedInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_transcription") return Promise.resolve("Original");
      if (cmd === "get_recording_status") return Promise.resolve(false);
      if (cmd === "paste_text") return Promise.resolve();
      return Promise.resolve("");
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Original")).toBeInTheDocument();
    });

    await user.click(screen.getByText("Amend"));

    const textarea = screen.getByRole("textbox");
    await user.clear(textarea);
    await user.type(textarea, "Modified text");

    await user.click(screen.getByText("Inscribe"));

    expect(mockedInvoke).toHaveBeenCalledWith("paste_text", {
      text: "Modified text",
    });
    expect(screen.getByText("Modified text")).toBeInTheDocument();
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
      expect(screen.getByText("text")).toBeInTheDocument();
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

  it("hides window when Escape key is pressed", async () => {
    const mockHide = vi.fn();
    mockedGetCurrentWindow.mockReturnValue({ hide: mockHide });

    render(<App />);

    fireEvent.keyDown(document, { key: "Escape" });

    expect(mockHide).toHaveBeenCalled();
  });

  it("does not hide window for other keys", async () => {
    const mockHide = vi.fn();
    mockedGetCurrentWindow.mockReturnValue({ hide: mockHide });

    render(<App />);

    fireEvent.keyDown(document, { key: "Enter" });
    fireEvent.keyDown(document, { key: "a" });

    expect(mockHide).not.toHaveBeenCalled();
  });
});
