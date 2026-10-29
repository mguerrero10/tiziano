namespace StudentHub.Api;

internal static class EnvFile
{
    public static void Load(params string[] paths)
    {
        foreach (var path in paths)
        {
            if (!File.Exists(path))
            {
                continue;
            }

            foreach (var raw in File.ReadAllLines(path))
            {
                var line = raw.Trim();
                if (line.Length == 0 || line.StartsWith('#'))
                {
                    continue;
                }

                var separator = line.IndexOf('=');
                if (separator <= 0)
                {
                    continue;
                }

                var key = line[..separator].Trim();
                var value = line[(separator + 1)..].Trim().Trim('"').Trim('\'');
                Environment.SetEnvironmentVariable(key, value);
            }
        }
    }
}
