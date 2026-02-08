use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use hound::{WavSpec, WavWriter};
use parking_lot::Mutex;
use std::path::PathBuf;
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::Arc;
use std::thread;

pub enum RecordingCommand {
    Stop(Sender<Result<PathBuf, String>>),
}

pub struct RecordingHandle {
    command_sender: Sender<RecordingCommand>,
    audio_levels: Arc<Mutex<Vec<f32>>>,
}

impl RecordingHandle {
    pub fn get_audio_levels_arc(&self) -> Arc<Mutex<Vec<f32>>> {
        Arc::clone(&self.audio_levels)
    }

    pub fn stop(self) -> Result<PathBuf, String> {
        let (result_sender, result_receiver) = mpsc::channel();
        self.command_sender
            .send(RecordingCommand::Stop(result_sender))
            .map_err(|_| "Failed to send stop command".to_string())?;
        result_receiver
            .recv()
            .map_err(|_| "Failed to receive result".to_string())?
    }
}

pub fn start_recording() -> Result<RecordingHandle, String> {
    let (command_sender, command_receiver): (Sender<RecordingCommand>, Receiver<RecordingCommand>) =
        mpsc::channel();
    let audio_levels: Arc<Mutex<Vec<f32>>> = Arc::new(Mutex::new(vec![0.2; 3]));
    let audio_levels_clone = Arc::clone(&audio_levels);

    thread::spawn(move || {
        run_recording(command_receiver, audio_levels_clone);
    });

    Ok(RecordingHandle {
        command_sender,
        audio_levels,
    })
}

fn run_recording(command_receiver: Receiver<RecordingCommand>, audio_levels: Arc<Mutex<Vec<f32>>>) {
    let host = cpal::default_host();
    let device = match host.default_input_device() {
        Some(d) => d,
        None => {
            if let Ok(RecordingCommand::Stop(sender)) = command_receiver.recv() {
                let _ = sender.send(Err("No input device available".to_string()));
            }
            return;
        }
    };

    let config = match device.default_input_config() {
        Ok(c) => c,
        Err(e) => {
            if let Ok(RecordingCommand::Stop(sender)) = command_receiver.recv() {
                let _ = sender.send(Err(format!("Failed to get input config: {}", e)));
            }
            return;
        }
    };

    let sample_rate = config.sample_rate().0;
    let channels = config.channels();
    let samples: Arc<Mutex<Vec<f32>>> = Arc::new(Mutex::new(Vec::new()));

    // For computing audio levels - we'll track RMS over recent samples
    let level_window: Arc<Mutex<Vec<f32>>> = Arc::new(Mutex::new(Vec::new()));

    let err_fn = |err| tracing::error!("Audio stream error: {}", err);

    /// Process mono samples: store for WAV output and track levels for the indicator.
    fn process_mono_samples(
        mono: f32,
        samples: &mut Vec<f32>,
        level_window: &mut Vec<f32>,
        audio_levels: &Arc<Mutex<Vec<f32>>>,
    ) {
        samples.push(mono);
        level_window.push(mono.abs());
        // Update audio levels periodically (every ~512 mono samples)
        if level_window.len() >= 512 {
            update_audio_levels(level_window, audio_levels);
            level_window.clear();
        }
    }

    let stream = match config.sample_format() {
        cpal::SampleFormat::F32 => {
            let samples_clone = Arc::clone(&samples);
            let level_window_clone = Arc::clone(&level_window);
            let audio_levels_clone = Arc::clone(&audio_levels);
            device.build_input_stream(
                &config.into(),
                move |data: &[f32], _: &cpal::InputCallbackInfo| {
                    let mut s = samples_clone.lock();
                    let mut lw = level_window_clone.lock();
                    for chunk in data.chunks(channels as usize) {
                        let mono = chunk.iter().sum::<f32>() / chunk.len() as f32;
                        process_mono_samples(mono, &mut s, &mut lw, &audio_levels_clone);
                    }
                },
                err_fn,
                None,
            )
        }
        cpal::SampleFormat::I16 => {
            let samples_clone = Arc::clone(&samples);
            let level_window_clone = Arc::clone(&level_window);
            let audio_levels_clone = Arc::clone(&audio_levels);
            device.build_input_stream(
                &config.into(),
                move |data: &[i16], _: &cpal::InputCallbackInfo| {
                    let mut s = samples_clone.lock();
                    let mut lw = level_window_clone.lock();
                    for chunk in data.chunks(channels as usize) {
                        let mono: f32 = chunk
                            .iter()
                            .map(|&sample| sample as f32 / i16::MAX as f32)
                            .sum::<f32>()
                            / chunk.len() as f32;
                        process_mono_samples(mono, &mut s, &mut lw, &audio_levels_clone);
                    }
                },
                err_fn,
                None,
            )
        }
        cpal::SampleFormat::U16 => {
            let samples_clone = Arc::clone(&samples);
            let level_window_clone = Arc::clone(&level_window);
            let audio_levels_clone = Arc::clone(&audio_levels);
            device.build_input_stream(
                &config.into(),
                move |data: &[u16], _: &cpal::InputCallbackInfo| {
                    let mut s = samples_clone.lock();
                    let mut lw = level_window_clone.lock();
                    for chunk in data.chunks(channels as usize) {
                        let mono: f32 = chunk
                            .iter()
                            .map(|&sample| (sample as f32 - 32768.0) / 32768.0)
                            .sum::<f32>()
                            / chunk.len() as f32;
                        process_mono_samples(mono, &mut s, &mut lw, &audio_levels_clone);
                    }
                },
                err_fn,
                None,
            )
        }
        _ => {
            if let Ok(RecordingCommand::Stop(sender)) = command_receiver.recv() {
                let _ = sender.send(Err("Unsupported sample format".to_string()));
            }
            return;
        }
    };

    let stream = match stream {
        Ok(s) => s,
        Err(e) => {
            if let Ok(RecordingCommand::Stop(sender)) = command_receiver.recv() {
                let _ = sender.send(Err(format!("Failed to build stream: {}", e)));
            }
            return;
        }
    };

    if let Err(e) = stream.play() {
        if let Ok(RecordingCommand::Stop(sender)) = command_receiver.recv() {
            let _ = sender.send(Err(format!("Failed to start stream: {}", e)));
        }
        return;
    }

    // Wait for stop command
    if let Ok(RecordingCommand::Stop(sender)) = command_receiver.recv() {
        // Give a moment for final samples to arrive
        std::thread::sleep(std::time::Duration::from_millis(100));

        // Stop the stream by dropping it
        drop(stream);

        let samples_data = samples.lock();

        if samples_data.len() < 1000 {
            let _ = sender.send(Err("Recording too short - hold the key longer".to_string()));
            return;
        }

        // Create unique temp file path to prevent symlink attacks and race conditions
        let temp_dir = std::env::temp_dir();
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let pid = std::process::id();
        let file_path = temp_dir.join(format!("scrivano_{}_{}.wav", timestamp, pid));

        // Write WAV file
        let spec = WavSpec {
            channels: 1,
            sample_rate,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };

        let result = (|| -> Result<PathBuf, String> {
            let mut writer = WavWriter::create(&file_path, spec)
                .map_err(|e| format!("Failed to create WAV file: {}", e))?;

            for &sample in samples_data.iter() {
                let amplitude = (sample * i16::MAX as f32) as i16;
                writer
                    .write_sample(amplitude)
                    .map_err(|e| format!("Failed to write sample: {}", e))?;
            }

            writer
                .finalize()
                .map_err(|e| format!("Failed to finalize WAV: {}", e))?;

            Ok(file_path)
        })();

        let _ = sender.send(result);
    }
}

/// Compute 3 audio level bars from recent samples
/// Each bar represents a different frequency-ish band (simulated via sample position)
fn update_audio_levels(samples: &[f32], audio_levels: &Arc<Mutex<Vec<f32>>>) {
    if samples.is_empty() {
        return;
    }

    let chunk_size = samples.len() / 3;
    if chunk_size == 0 {
        return;
    }

    let mut levels = Vec::with_capacity(3);

    for i in 0..3 {
        let start = i * chunk_size;
        let end = if i == 2 {
            samples.len()
        } else {
            (i + 1) * chunk_size
        };
        let chunk = &samples[start..end];

        // Compute RMS for this chunk
        let rms: f32 = (chunk.iter().map(|&s| s * s).sum::<f32>() / chunk.len() as f32).sqrt();

        // Scale to 0-1 range with some amplification for visibility
        // Normal speech is around 0.01-0.1 RMS, so we amplify
        let scaled = (rms * 10.0).min(1.0);

        // Add some minimum height and smoothing
        let level = 0.15 + scaled * 0.85;
        levels.push(level);
    }

    *audio_levels.lock() = levels;
}
