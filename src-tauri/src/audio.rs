use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use hound::{WavSpec, WavWriter};
use std::sync::{Arc, Mutex};
use std::path::PathBuf;
use std::sync::mpsc::{self, Sender, Receiver};
use std::thread;

pub enum RecordingCommand {
    Stop(Sender<Result<PathBuf, String>>),
}

pub struct RecordingHandle {
    command_sender: Sender<RecordingCommand>,
}

impl RecordingHandle {
    pub fn stop(self) -> Result<PathBuf, String> {
        let (result_sender, result_receiver) = mpsc::channel();
        self.command_sender
            .send(RecordingCommand::Stop(result_sender))
            .map_err(|_| "Failed to send stop command".to_string())?;
        result_receiver.recv().map_err(|_| "Failed to receive result".to_string())?
    }
}

pub fn start_recording() -> Result<RecordingHandle, String> {
    let (command_sender, command_receiver): (Sender<RecordingCommand>, Receiver<RecordingCommand>) = mpsc::channel();

    thread::spawn(move || {
        run_recording(command_receiver);
    });

    Ok(RecordingHandle { command_sender })
}

fn run_recording(command_receiver: Receiver<RecordingCommand>) {
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

    let err_fn = |err| eprintln!("Audio stream error: {}", err);

    let stream = match config.sample_format() {
        cpal::SampleFormat::F32 => {
            let samples_clone = Arc::clone(&samples);
            device.build_input_stream(
                &config.into(),
                move |data: &[f32], _: &cpal::InputCallbackInfo| {
                    let mut s = samples_clone.lock().unwrap();
                    // Convert to mono if stereo
                    for chunk in data.chunks(channels as usize) {
                        let mono = chunk.iter().sum::<f32>() / chunk.len() as f32;
                        s.push(mono);
                    }
                },
                err_fn,
                None,
            )
        }
        cpal::SampleFormat::I16 => {
            let samples_clone = Arc::clone(&samples);
            device.build_input_stream(
                &config.into(),
                move |data: &[i16], _: &cpal::InputCallbackInfo| {
                    let mut s = samples_clone.lock().unwrap();
                    for chunk in data.chunks(channels as usize) {
                        let mono: f32 = chunk.iter()
                            .map(|&sample| sample as f32 / i16::MAX as f32)
                            .sum::<f32>() / chunk.len() as f32;
                        s.push(mono);
                    }
                },
                err_fn,
                None,
            )
        }
        cpal::SampleFormat::U16 => {
            let samples_clone = Arc::clone(&samples);
            device.build_input_stream(
                &config.into(),
                move |data: &[u16], _: &cpal::InputCallbackInfo| {
                    let mut s = samples_clone.lock().unwrap();
                    for chunk in data.chunks(channels as usize) {
                        let mono: f32 = chunk.iter()
                            .map(|&sample| (sample as f32 - 32768.0) / 32768.0)
                            .sum::<f32>() / chunk.len() as f32;
                        s.push(mono);
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

        let samples_data = samples.lock().unwrap();

        if samples_data.len() < 1000 {
            let _ = sender.send(Err("Recording too short - hold the key longer".to_string()));
            return;
        }

        // Create temp file path
        let temp_dir = std::env::temp_dir();
        let file_path = temp_dir.join("scrivano_recording.wav");

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
                writer.write_sample(amplitude)
                    .map_err(|e| format!("Failed to write sample: {}", e))?;
            }

            writer.finalize()
                .map_err(|e| format!("Failed to finalize WAV: {}", e))?;

            Ok(file_path)
        })();

        let _ = sender.send(result);
    }
}
