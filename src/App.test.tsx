import { render, screen, waitFor } from "@testing-library/react";
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
    mockedInvoke.mockResolvedValue("");
    mockedListen.mockResolvedValue(() => {});
  });

  it("renders initial state correctly", async () => {
    render(<App />);

    expect(screen.getByText("Awaiting thy voice")).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("Speak unto the aether with Cmd+Shift+Space")
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
    const user = userEvent.setup();
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
    await user.clear(textarea);
    await user.type(textarea, "Modified text");

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
});
