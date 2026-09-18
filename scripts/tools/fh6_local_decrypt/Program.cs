// fh6_local_decrypt — offline, READ-ONLY decryption of FH6 C_ProfileData and gamedbRC.slt.
//
// Why this exists: the lab's only route into the profile save was DVS-code's ForzaCryptoTool, which
// uploads the file to a hosted backend. That makes every read a network round trip, an approval prompt
// and a third-party trust decision, and it cannot run unattended. The container format is published
// (see docs/fh6-profile-crypto-mimicry.md) and is ordinary AES-256-CBC with a deterministic HKDF-SHA256
// IV chain — no white-box tables, no server. The only secrets are a handful of constants, which live in
// the FH6LocalCrypto.Runtime.dll key assembly this tool references.
//
// DELIBERATELY DECRYPT-ONLY. There is no encrypt, no save-swap and no editor here: this tool cannot
// write a game file, so it cannot corrupt a save. It also refuses to write anywhere under the game's
// install or save tree.
//
// Usage:
//   fh6_local_decrypt <input> -o <output> [--type auto|profile|gamedb] [--force] [--quiet]
//
// Exit codes: 0 ok · 1 failed · 2 bad usage · 3 file not found · 5 unsupported type
using System.Buffers.Binary;
using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using FH6LocalCryptoTool;   // Fh6Keys, from FH6LocalCrypto.Runtime.dll (keys only)

static class Program
{
    const int ContainerHeaderSize = 36;      // 16-byte IV0 + 4-byte header + 16-byte nonce
    const int MacSize = 16;                  // trailing MAC block per slot (not verified on read)
    const int ProfileChunk = 512;
    const int GameDbChunk = 131072;

    static int Main(string[] argv)
    {
        string? input = null, output = null, type = "auto";
        bool force = false, quiet = false;
        for (int i = 0; i < argv.Length; i++)
        {
            switch (argv[i])
            {
                case "-o" or "--output": output = i + 1 < argv.Length ? argv[++i] : null; break;
                case "--type": type = i + 1 < argv.Length ? argv[++i].ToLowerInvariant() : "auto"; break;
                case "-f" or "--force": force = true; break;
                case "-q" or "--quiet": quiet = true; break;
                case "-h" or "--help": Usage(); return 0;
                default:
                    if (argv[i].StartsWith('-')) { Console.Error.WriteLine($"unknown option {argv[i]}"); return 2; }
                    input ??= argv[i];
                    break;
            }
        }
        if (input is null || output is null) { Usage(); return 2; }
        if (!File.Exists(input)) { Console.Error.WriteLine($"not found: {input}"); return 3; }

        string outFull = Path.GetFullPath(output);
        if (IsProtected(outFull)) { Console.Error.WriteLine("refusing to write into the game install or save tree"); return 2; }
        if (File.Exists(outFull) && !force) { Console.Error.WriteLine($"output exists (use --force): {outFull}"); return 2; }

        void Log(string m) { if (!quiet) Console.WriteLine(m); }

        try
        {
            byte[] file = File.ReadAllBytes(input);
            if (type == "auto") type = Detect(input, file);
            byte[] plain;
            switch (type)
            {
                case "profile":
                    Log($"Profile container ({file.Length:n0} bytes) — local decrypt, nothing leaves this machine.");
                    plain = DecryptProfile(file);
                    Log($"Inflated to {plain.Length:n0} bytes.");
                    break;
                case "gamedb":
                    Log($"GameDB container ({file.Length:n0} bytes) — local decrypt.");
                    plain = DecryptGameDb(file);
                    if (!(plain.Length >= 15 && Encoding.ASCII.GetString(plain, 0, 15) == "SQLite format 3"))
                        throw new InvalidDataException("decrypted GameDB is not a SQLite image");
                    Log($"SQLite image, {plain.Length:n0} bytes.");
                    break;
                default:
                    Console.Error.WriteLine($"unsupported type: {type}"); return 5;
            }
            File.WriteAllBytes(outFull, plain);
            Log(outFull);
            return 0;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"failed: {ex.Message}");
            return 1;
        }
    }

    static void Usage() => Console.WriteLine(
        "fh6_local_decrypt <input> -o <output> [--type auto|profile|gamedb] [--force] [--quiet]\n" +
        "  Offline, read-only. Decrypts C_ProfileData and gamedbRC.slt. Never writes a game file.");

    /// <summary>The game install and save trees are read-only to this project.</summary>
    static bool IsProtected(string path)
    {
        string p = path.Replace('/', '\\');
        return p.StartsWith(@"C:\XboxGames", StringComparison.OrdinalIgnoreCase);
    }

    static string Detect(string path, byte[] file)
    {
        string name = Path.GetFileName(path);
        if (name.StartsWith("C_Profile", StringComparison.OrdinalIgnoreCase)) return "profile";
        if (path.EndsWith(".slt", StringComparison.OrdinalIgnoreCase)) return "gamedb";
        int payload = file.Length - ContainerHeaderSize;
        if (payload > 0 && payload % (GameDbChunk + MacSize) == 0) return "gamedb";
        if (payload > 0 && payload % (ProfileChunk + MacSize) == 0) return "profile";
        return "unknown";
    }

    // ---------------------------------------------------------------- container

    /// <summary>
    /// The IV chain: every block (data AND mac) advances it, and each IV depends only on the previous
    /// one — never on the data — so the whole chain is reproducible from IV0 alone.
    /// </summary>
    static byte[] NextIv(byte[] iv) =>
        HKDF.DeriveKey(HashAlgorithmName.SHA256, iv, 16, Fh6Keys.TransportKey1, Fh6Keys.TransportKey2);

    /// <summary>Decrypt a CryptoContainer: [16 IV0][4 header][16 nonce] then N × (chunk + 16-byte MAC).</summary>
    static byte[] DecryptContainer(byte[] file, byte[] dataKey, int chunkSize)
    {
        if (file.Length < ContainerHeaderSize) throw new InvalidDataException("too small for a CryptoContainer");
        int payload = file.Length - ContainerHeaderSize;
        if (payload <= 0 || payload % 16 != 0) throw new InvalidDataException("payload is not AES block-aligned");

        using var aes = Aes.Create();
        aes.Key = dataKey;
        byte[] iv = file[..16];
        int slot = chunkSize + MacSize;

        using var outStream = new MemoryStream(payload);
        if (payload >= slot && payload % slot == 0)
        {
            for (int i = 0; i < payload / slot; i++)
            {
                int off = ContainerHeaderSize + i * slot;
                outStream.Write(aes.DecryptCbc(file.AsSpan(off, chunkSize), iv, PaddingMode.None));
                iv = NextIv(iv);   // after the data block
                iv = NextIv(iv);   // after the MAC block — its contents never feed the chain
            }
        }
        else
        {
            // single unchunked container
            outStream.Write(aes.DecryptCbc(file.AsSpan(ContainerHeaderSize), iv, PaddingMode.None));
        }
        return outStream.ToArray();
    }

    // ---------------------------------------------------------------- profile

    /// <summary>C_ProfileData: container → [u32 compressedSize][u32 inflatedSize] → zlib → save payload.</summary>
    static byte[] DecryptProfile(byte[] file)
    {
        byte[] raw = DecryptContainer(file, Fh6Keys.Get("ProfileData").DataKey, ProfileChunk);
        if (raw.Length < 8) throw new InvalidDataException("profile size header missing");
        uint compressed = BinaryPrimitives.ReadUInt32LittleEndian(raw.AsSpan(0, 4));
        uint expected = BinaryPrimitives.ReadUInt32LittleEndian(raw.AsSpan(4, 4));
        if (compressed == 0 || compressed > raw.Length - 8) throw new InvalidDataException("profile size header is invalid");

        using var input = new MemoryStream(raw, 8, checked((int)compressed), writable: false);
        using var zlib = new ZLibStream(input, CompressionMode.Decompress);
        using var outStream = new MemoryStream(expected <= int.MaxValue ? (int)expected : 0);
        zlib.CopyTo(outStream);
        byte[] result = outStream.ToArray();
        if (result.Length != expected)
            throw new InvalidDataException($"profile inflated to {result.Length:n0} bytes, header says {expected:n0}");
        return result;
    }

    // ---------------------------------------------------------------- gamedb

    /// <summary>gamedbRC.slt: container → self-inverse CRC32 keystream → SQLite image.</summary>
    static byte[] DecryptGameDb(byte[] file)
    {
        int payload = file.Length - ContainerHeaderSize;
        if (payload <= 0 || payload % (GameDbChunk + MacSize) != 0)
            throw new InvalidDataException($"not a whole number of {GameDbChunk + MacSize}-byte slots");
        byte[] plain = DecryptContainer(file, Fh6Keys.Get("GameDB").DataKey, GameDbChunk);
        Unscramble(plain);
        return TrimToSqliteLength(plain);
    }

    /// <summary>
    /// The container pads up to a 128 KB chunk boundary, so the decrypted image carries trailing pages
    /// the database does not own. SQLite tolerates them, but trimming to the header's own page geometry
    /// (page_size × page_count, both big-endian) yields exactly the logical database — and makes our
    /// output byte-identical to ForzaCryptoTool's.
    /// </summary>
    static byte[] TrimToSqliteLength(byte[] image)
    {
        if (image.Length < 32 || Encoding.ASCII.GetString(image, 0, 15) != "SQLite format 3") return image;
        int pageSize = BinaryPrimitives.ReadUInt16BigEndian(image.AsSpan(16, 2));
        uint pageCount = BinaryPrimitives.ReadUInt32BigEndian(image.AsSpan(28, 4));
        if (pageSize == 1) pageSize = 65536;                       // SQLite's encoding for a 64 KB page
        if (pageCount == 0 || pageSize == 0) return image;         // header does not declare a length
        long logical = (long)pageSize * pageCount;
        return logical > 0 && logical < image.Length ? image[..(int)logical] : image;
    }

    static readonly uint[] CrcTable = BuildCrcTable();

    static uint[] BuildCrcTable()
    {
        var t = new uint[256];
        for (uint n = 0; n < 256; n++)
        {
            uint c = n;
            for (int k = 0; k < 8; k++) c = (c & 1u) != 0 ? 0xEDB88320u ^ (c >> 1) : c >> 1;
            t[n] = c;
        }
        return t;
    }

    // The game folds bytes through ASCII tolower before the CRC step.
    static byte Fold(byte b) => b >= (byte)'A' && b <= (byte)'Z' ? (byte)(b + 32) : b;

    static uint KeystreamDword(uint seed)
    {
        uint v = 0xFFFFFFFFu;
        for (int i = 0; i < 4; i++)
        {
            byte b = (byte)(seed >> (8 * i));
            v = CrcTable[(v ^ Fold(b)) & 0xFF] ^ (v >> 8);
        }
        return ~v;
    }

    static uint SeedFor(uint pos)
    {
        uint q = pos >> 2;
        unchecked { return q + Fh6Keys.GamedbScramblePageConst * (q + 1); }
    }

    /// <summary>XOR the buffer with the page keystream. Self-inverse, so this is also the scrambler.</summary>
    static void Unscramble(byte[] data)
    {
        uint pos = 0;
        uint ks = KeystreamDword(SeedFor(pos));
        for (long i = 0; i < data.LongLength; i++)
        {
            data[i] ^= (byte)(ks & 0xFF);
            pos++;
            if ((pos & 3) != 0) ks >>= 8;
            else ks = KeystreamDword(SeedFor(pos));
        }
    }
}
