function parseSilenceOutput(output, fallbackDuration = 0) {
  const starts = [...output.matchAll(/silence_start:\s*(-?[\d.]+)/g)].map((match) => Number(match[1]));
  const ends = [...output.matchAll(/silence_end:\s*([\d.]+)/g)].map((match) => Number(match[1]));
  const durationMatch = output.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
  const duration = durationMatch
    ? Number(durationMatch[1]) * 3600 + Number(durationMatch[2]) * 60 + Number(durationMatch[3])
    : fallbackDuration;
  const trimStart = starts[0] !== undefined && starts[0] < 0.1 ? (ends[0] || 0) : 0;
  const lastStart = starts.at(-1);
  const trimEnd = lastStart !== undefined && duration - lastStart < Math.max(15, duration * 0.15)
    ? Math.max(0, duration - lastStart)
    : 0;
  return { trimStart, trimEnd, duration };
}

function buildFilter(tracks, options = {}) {
  const sampleRate = options.sampleRate || Math.max(44100, ...tracks.map((track) => track.sampleRate || 0));
  const filters = [];
  const durations = [];
  tracks.forEach((track, index) => {
    const trimStart = track.trimStart || 0;
    const trimEnd = track.trimEnd || 0;
    const end = Math.max(trimStart + 0.1, track.duration - trimEnd);
    const delay = Math.max(0, Math.round((track.offset || 0) * 1000));
    filters.push(`[${index}:a]atrim=start=${trimStart}:end=${end},asetpts=PTS-STARTPTS,aresample=${sampleRate}:resampler=swr:filter_size=64:phase_shift=10:exact_rational=1,aformat=sample_fmts=dblp:channel_layouts=stereo,adelay=${delay}|${delay}[a${index}]`);
    durations.push(end - trimStart);
  });

  if (tracks.length === 1) return { filter: filters.join(';'), output: '[a0]', duration: durations[0], sampleRate };
  const inputs = tracks.map((_track, index) => `[a${index}]`).join('');
  filters.push(`${inputs}amix=inputs=${tracks.length}:duration=longest:dropout_transition=0:normalize=0[mix]`);
  const duration = Math.max(...tracks.map((track, index) => (track.offset || 0) + durations[index]));
  return { filter: filters.join(';'), output: '[mix]', duration, sampleRate };
}

function estimatePcmBytes(duration, sampleRate, channels = 2, bytesPerSample = 4) {
  const safeDuration = Math.max(0, Number(duration) || 0);
  const safeRate = Math.max(1, Math.round(Number(sampleRate) || 44100));
  const safeChannels = Math.max(1, Math.round(Number(channels) || 2));
  const safeBytesPerSample = Math.max(1, Math.round(Number(bytesPerSample) || 4));
  return Math.ceil(safeDuration * safeRate) * safeChannels * safeBytesPerSample + 114;
}

const supportedMp3Bitrates = new Set([128, 192, 256, 320]);

function mp3SampleRateFor(sourceSampleRate) {
  const rate = Math.max(44100, Math.round(Number(sourceSampleRate) || 48000));
  if (rate <= 48000) return rate === 44100 ? 44100 : 48000;
  return rate % 44100 === 0 ? 44100 : 48000;
}

function getExportProfile(options = {}, sourceSampleRate = 48000) {
  const requestedFormat = String(options.format || 'wav').toLowerCase();
  const format = ['wav', 'flac', 'mp3'].includes(requestedFormat) ? requestedFormat : 'wav';
  const requestedBitrate = Math.round(Number(options.bitrateKbps) || 320);
  const bitrateKbps = supportedMp3Bitrates.has(requestedBitrate) ? requestedBitrate : 320;
  const masterSampleRate = Math.max(44100, Math.round(Number(sourceSampleRate) || 48000));

  if (format === 'flac') {
    return {
      format,
      extension: 'flac',
      dialogName: 'FLAC 24-bit Lossless',
      quality: '24-bit PCM · Lossless Compression',
      lossless: true,
      sampleRate: masterSampleRate,
      expectedCodecs: ['flac'],
      codecArgs: ['-c:a', 'flac', '-sample_fmt', 's32', '-bits_per_raw_sample', '24', '-compression_level', '12'],
    };
  }
  if (format === 'mp3') {
    return {
      format,
      extension: 'mp3',
      dialogName: `MP3 ${bitrateKbps} kbps`,
      quality: `${bitrateKbps} kbps CBR · Lossy`,
      lossless: false,
      bitrateKbps,
      sampleRate: mp3SampleRateFor(masterSampleRate),
      expectedCodecs: ['mp3', 'mp3float', 'mp3fixed'],
      codecArgs: ['-c:a', 'libmp3lame', '-b:a', `${bitrateKbps}k`],
    };
  }
  return {
    format: 'wav',
    extension: 'wav',
    dialogName: 'WAV 32-bit Float Master',
    quality: '32-bit Float PCM · Lossless Master',
    lossless: true,
    sampleRate: masterSampleRate,
    expectedCodecs: ['pcm_f32le'],
    codecArgs: ['-c:a', 'pcm_f32le', '-rf64', 'auto'],
  };
}

function estimateExportBytes(duration, profile) {
  if (profile.format === 'mp3') {
    return Math.ceil(Math.max(0, Number(duration) || 0) * profile.bitrateKbps * 1000 / 8) + 128 * 1024;
  }
  if (profile.format === 'flac') {
    // Use an uncompressed 24-bit ceiling so the disk-space guard remains conservative.
    return estimatePcmBytes(duration, profile.sampleRate, 2, 3) + 128 * 1024;
  }
  return estimatePcmBytes(duration, profile.sampleRate);
}

function parseRenderVerification(output, expected = {}) {
  const durationMatch = output.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
  const duration = durationMatch
    ? Number(durationMatch[1]) * 3600 + Number(durationMatch[2]) * 60 + Number(durationMatch[3])
    : 0;
  const streamLines = output.split(/\r?\n/).filter((line) => /Audio:/.test(line));
  const streamLine = streamLines[0] || '';
  const codec = streamLine.match(/Audio:\s*([^,\s]+)/)?.[1] || '';
  const sampleRate = Number(streamLine.match(/(\d+)\s*Hz/)?.[1] || 0);
  const channelLabel = streamLine.match(/Hz,\s*([^,]+)/)?.[1]?.trim() || '';
  const channels = /stereo/i.test(channelLabel) ? 2 : /mono/i.test(channelLabel) ? 1 : 0;
  const peakMatches = [...output.matchAll(/Peak level dB:\s*(-?inf|[-+\d.]+)/gi)];
  const peakText = peakMatches.at(-1)?.[1];
  const peakDb = peakText?.toLowerCase() === '-inf' ? -Infinity : Number(peakText);
  const expectedDuration = Number(expected.duration) || 0;
  const durationDelta = expectedDuration ? Math.abs(duration - expectedDuration) : 0;
  const bitrateKbps = Number(streamLine.match(/(\d+)\s*kb\/s/i)?.[1] || 0);
  const expectedCodecs = expected.codecs || [expected.codec || 'pcm_f32le'];
  const checks = {
    codec: expectedCodecs.includes(codec),
    sampleRate: sampleRate === (Number(expected.sampleRate) || sampleRate),
    channels: channels === (Number(expected.channels) || 2),
    duration: duration > 0 && (!expectedDuration || durationDelta <= Math.max(0.08, expectedDuration * 0.0001)),
  };
  if (expected.bitrateKbps) checks.bitrate = Math.abs(bitrateKbps - Number(expected.bitrateKbps)) <= 8;
  return {
    passed: Object.values(checks).every(Boolean),
    codec,
    sampleRate,
    channels,
    channelLabel,
    duration,
    durationDelta,
    sampleCount: Math.round(duration * sampleRate),
    peakDb: Number.isNaN(peakDb) ? null : peakDb,
    bitrateKbps,
    checks,
  };
}

module.exports = { buildFilter, estimateExportBytes, estimatePcmBytes, getExportProfile, parseRenderVerification, parseSilenceOutput };
