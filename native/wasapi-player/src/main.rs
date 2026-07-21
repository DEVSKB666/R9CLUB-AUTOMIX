use std::env;
use std::io::{self, Read};
use std::ptr;
use std::slice;
use std::thread;
use std::time::Duration;
use windows::Win32::Media::Audio::{
    AUDCLNT_SHAREMODE_EXCLUSIVE, AUDCLNT_STREAMFLAGS_NOPERSIST, IAudioClient,
    IAudioRenderClient, IMMDeviceEnumerator, MMDeviceEnumerator, WAVEFORMATEX,
    WAVEFORMATEXTENSIBLE, WAVEFORMATEXTENSIBLE_0, eConsole, eRender,
};
use windows::Win32::Media::KernelStreaming::{
    KSDATAFORMAT_SUBTYPE_PCM, SPEAKER_FRONT_LEFT, SPEAKER_FRONT_RIGHT, WAVE_FORMAT_EXTENSIBLE,
};
use windows::Win32::Media::Multimedia::KSDATAFORMAT_SUBTYPE_IEEE_FLOAT;
use windows::Win32::System::Com::{
    CLSCTX_ALL, COINIT_MULTITHREADED, CoCreateInstance, CoInitializeEx, CoUninitialize,
};

const CHANNELS: u16 = 2;
const BITS_PER_SAMPLE: u16 = 32;

struct ComGuard;
impl Drop for ComGuard {
    fn drop(&mut self) {
        unsafe { CoUninitialize() };
    }
}

fn format_for(sample_rate: u32, encoding: &str) -> WAVEFORMATEXTENSIBLE {
    let block_align = CHANNELS * (BITS_PER_SAMPLE / 8);
    WAVEFORMATEXTENSIBLE {
        Format: WAVEFORMATEX {
            wFormatTag: WAVE_FORMAT_EXTENSIBLE as u16,
            nChannels: CHANNELS,
            nSamplesPerSec: sample_rate,
            nAvgBytesPerSec: sample_rate * u32::from(block_align),
            nBlockAlign: block_align,
            wBitsPerSample: BITS_PER_SAMPLE,
            cbSize: 22,
        },
        Samples: WAVEFORMATEXTENSIBLE_0 { wValidBitsPerSample: BITS_PER_SAMPLE },
        dwChannelMask: SPEAKER_FRONT_LEFT | SPEAKER_FRONT_RIGHT,
        SubFormat: if encoding == "f32le" { KSDATAFORMAT_SUBTYPE_IEEE_FLOAT } else { KSDATAFORMAT_SUBTYPE_PCM },
    }
}

unsafe fn open_client() -> windows::core::Result<(IAudioClient, i64)> {
    unsafe { CoInitializeEx(None, COINIT_MULTITHREADED).ok()? };
    let enumerator: IMMDeviceEnumerator =
        unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)? };
    let device = unsafe { enumerator.GetDefaultAudioEndpoint(eRender, eConsole)? };
    let client: IAudioClient = unsafe { device.Activate(CLSCTX_ALL, None)? };
    let mut minimum_period = 0_i64;
    unsafe { client.GetDevicePeriod(None, Some(&mut minimum_period))? };
    Ok((client, minimum_period))
}

fn main() {
    if let Err(error) = run() {
        eprintln!("{{\"event\":\"error\",\"message\":{:?}}}", error.to_string());
        std::process::exit(1);
    }
}

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = env::args().collect();
    let probe = args.iter().any(|arg| arg == "--probe");
    let sample_rate = args
        .windows(2)
        .find(|pair| pair[0] == "--rate")
        .and_then(|pair| pair[1].parse::<u32>().ok())
        .unwrap_or(48_000);

    let _com = ComGuard;
    let (client, minimum_period) = unsafe { open_client()? };
    let mix_pointer = unsafe { client.GetMixFormat()? };
    let mix_format = unsafe { ptr::read_unaligned(mix_pointer) };
    let mix_extensible = unsafe { ptr::read_unaligned(mix_pointer as *const WAVEFORMATEXTENSIBLE) };
    let mix_tag = mix_format.wFormatTag;
    let mix_channels = mix_format.nChannels;
    let mix_rate = mix_format.nSamplesPerSec;
    let mix_bits = mix_format.wBitsPerSample;
    eprintln!(
        "{{\"event\":\"device\",\"mixTag\":{},\"mixChannels\":{},\"mixRate\":{},\"mixBits\":{}}}",
        mix_tag, mix_channels, mix_rate, mix_bits
    );
    let requested_encoding = args
        .windows(2)
        .find(|pair| pair[0] == "--format")
        .map(|pair| pair[1].as_str());
    let mix_subformat = mix_extensible.SubFormat;
    let mix_encoding = if mix_subformat == KSDATAFORMAT_SUBTYPE_IEEE_FLOAT {
        Some("f32le")
    } else if mix_subformat == KSDATAFORMAT_SUBTYPE_PCM {
        Some("s32le")
    } else {
        None
    };
    let mix_supported = mix_channels == CHANNELS
        && mix_rate == sample_rate
        && mix_bits == BITS_PER_SAMPLE
        && mix_encoding.is_some()
        && unsafe { client.IsFormatSupported(AUDCLNT_SHAREMODE_EXCLUSIVE, mix_pointer, None).is_ok() };
    let encodings = ["f32le", "s32le"];
    let generated = encodings.iter().copied().find_map(|encoding| {
            if requested_encoding.is_some_and(|requested| requested != encoding) {
                return None;
            }
            let candidate = format_for(sample_rate, encoding);
            let wave_format = &candidate as *const WAVEFORMATEXTENSIBLE as *const WAVEFORMATEX;
            unsafe { client.IsFormatSupported(AUDCLNT_SHAREMODE_EXCLUSIVE, wave_format, None).is_ok() }
                .then_some((candidate, encoding))
        });
    let (format, encoding) = if mix_supported
        && requested_encoding.is_none_or(|requested| Some(requested) == mix_encoding)
    {
        (mix_extensible, mix_encoding.unwrap())
    } else {
        generated.ok_or("Default output does not support 32-bit stereo WASAPI Exclusive at this sample rate")?
    };
    let requested_period = minimum_period.max(100_000);
    let wave_format = &format as *const WAVEFORMATEXTENSIBLE as *const WAVEFORMATEX;
    unsafe {
        client.Initialize(
            AUDCLNT_SHAREMODE_EXCLUSIVE,
            AUDCLNT_STREAMFLAGS_NOPERSIST,
            requested_period,
            requested_period,
            wave_format,
            None,
        )?;
    }
    let buffer_frames = unsafe { client.GetBufferSize()? };
    let latency = unsafe { client.GetStreamLatency()? };
    if probe {
        println!(
            "{{\"available\":true,\"sampleRate\":{},\"sampleFormat\":\"{}\",\"bufferFrames\":{},\"latencyMs\":{:.3}}}",
            sample_rate,
            encoding,
            buffer_frames,
            latency as f64 / 10_000.0
        );
        return Ok(());
    }

    let render: IAudioRenderClient = unsafe { client.GetService()? };
    let bytes_per_frame = usize::from(CHANNELS * (BITS_PER_SAMPLE / 8));
    let mut input = io::stdin().lock();
    let mut started = false;
    let mut underruns = 0_u64;
    let sleep_time = Duration::from_secs_f64((buffer_frames as f64 / sample_rate as f64 / 3.0).max(0.001));

    loop {
        let padding = unsafe { client.GetCurrentPadding()? };
        let available = buffer_frames.saturating_sub(padding);
        if available == 0 {
            thread::sleep(sleep_time);
            continue;
        }
        if started && available == buffer_frames {
            underruns += 1;
            eprintln!("{{\"event\":\"stats\",\"underruns\":{}}}", underruns);
        }

        let byte_count = available as usize * bytes_per_frame;
        let target = unsafe { render.GetBuffer(available)? };
        let bytes = unsafe { slice::from_raw_parts_mut(target, byte_count) };
        let mut filled = 0;
        while filled < byte_count {
            match input.read(&mut bytes[filled..])? {
                0 => break,
                count => filled += count,
            }
        }
        if filled < byte_count {
            bytes[filled..].fill(0);
        }
        unsafe { render.ReleaseBuffer(available, 0)? };
        if !started {
            unsafe { client.Start()? };
            started = true;
            eprintln!(
                "{{\"event\":\"started\",\"sampleRate\":{},\"bufferFrames\":{},\"latencyMs\":{:.3}}}",
                sample_rate,
                buffer_frames,
                latency as f64 / 10_000.0
            );
        }
        if filled < byte_count {
            thread::sleep(Duration::from_secs_f64(buffer_frames as f64 / sample_rate as f64));
            break;
        }
        thread::sleep(sleep_time);
    }

    if started {
        unsafe { client.Stop()? };
    }
    Ok(())
}
