using System.Text.Json;
using NAudio.Wave;

sealed class PipeWaveProvider : IWaveProvider
{
    private readonly Stream input;
    public WaveFormat WaveFormat { get; }
    public volatile bool Ended;

    public PipeWaveProvider(Stream input, int sampleRate)
    {
        this.input = input;
        WaveFormat = WaveFormat.CreateIeeeFloatWaveFormat(sampleRate, 2);
    }

    public int Read(byte[] buffer, int offset, int count)
    {
        var filled = 0;
        while (filled < count)
        {
            var read = input.Read(buffer, offset + filled, count - filled);
            if (read == 0) { Ended = true; break; }
            filled += read;
        }
        if (filled < count) Array.Clear(buffer, offset + filled, count - filled);
        return count;
    }
}

static class Program
{
    static string? Argument(string[] args, string name)
    {
        var index = Array.IndexOf(args, name);
        return index >= 0 && index + 1 < args.Length ? args[index + 1] : null;
    }

    [STAThread]
    static int Main(string[] args)
    {
        try
        {
            var drivers = AsioOut.GetDriverNames();
            if (args.Contains("--list"))
            {
                Console.WriteLine(JsonSerializer.Serialize(new { available = drivers.Length > 0, drivers }));
                return 0;
            }

            var driver = Argument(args, "--driver") ?? drivers.FirstOrDefault()
                ?? throw new InvalidOperationException("No ASIO driver is installed");
            var sampleRate = int.TryParse(Argument(args, "--rate"), out var parsedRate) ? parsedRate : 48000;
            using var asio = new AsioOut(driver);
            var provider = new PipeWaveProvider(Console.OpenStandardInput(), sampleRate);
            asio.Init(provider);
            var bufferFrames = Math.Max(1, asio.FramesPerBuffer);
            var latencyFrames = Math.Max(bufferFrames, asio.PlaybackLatency);
            var latencyMs = latencyFrames * 1000d / sampleRate;

            if (args.Contains("--probe"))
            {
                Console.WriteLine(JsonSerializer.Serialize(new { available = true, driver, sampleRate, sampleFormat = "f32le", bufferFrames, latencyMs }));
                return 0;
            }

            asio.Play();
            Console.Error.WriteLine(JsonSerializer.Serialize(new { @event = "started", backend = "asio", driver, sampleRate, bufferFrames, latencyMs }));
            while (!provider.Ended && asio.PlaybackState == PlaybackState.Playing) Thread.Sleep(25);
            Thread.Sleep(Math.Max(20, (int)Math.Ceiling(latencyMs * 2)));
            asio.Stop();
            return 0;
        }
        catch (Exception error)
        {
            Console.Error.WriteLine(JsonSerializer.Serialize(new { @event = "error", message = error.Message }));
            return 1;
        }
    }
}
