import { describe, expect, it } from "vitest";
import { createZip, crc32, ZIP_EPOCH, type ZipEntry } from "./zip";

const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const END_OF_CENTRAL_DIRECTORY_SIZE = 22;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function zipBytes(entries: ZipEntry[], when?: Date): Promise<Uint8Array> {
  const blob = when === undefined ? createZip(entries) : createZip(entries, when);
  // Node 22 gives Blob.arrayBuffer(), so the writer's output can be read back
  // without any browser plumbing.
  return new Uint8Array(await blob.arrayBuffer());
}

function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

interface ReadEntry {
  path: string;
  data: Uint8Array;
  crc: number;
  method: number;
  flags: number;
  /** read separately from the central directory: the two headers must agree */
  centralFlags: number;
  versionNeeded: number;
  compressedSize: number;
  uncompressedSize: number;
  dosTime: number;
  dosDate: number;
}

interface ReadArchive {
  entries: ReadEntry[];
  entryCount: number;
  centralDirectoryOffset: number;
  centralDirectorySize: number;
}

/**
 * A deliberately independent mini-reader: it walks the central directory the
 * way a real unzip does (EOCD -> central directory -> relative offset of each
 * local header) instead of trusting the order createZip() happened to write.
 * If any of those cross-references is wrong, this throws.
 */
function readZip(bytes: Uint8Array): ReadArchive {
  const view = viewOf(bytes);

  let eocd = -1;
  for (let i = bytes.length - END_OF_CENTRAL_DIRECTORY_SIZE; i >= 0; i--) {
    if (view.getUint32(i, true) === END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("no end-of-central-directory record found");

  const entryCount = view.getUint16(eocd + 10, true);
  const centralDirectorySize = view.getUint32(eocd + 12, true);
  const centralDirectoryOffset = view.getUint32(eocd + 16, true);

  const entries: ReadEntry[] = [];
  let p = centralDirectoryOffset;
  for (let i = 0; i < entryCount; i++) {
    if (view.getUint32(p, true) !== CENTRAL_DIRECTORY_SIGNATURE) {
      throw new Error(`central directory entry ${i} has a bad signature`);
    }
    const crc = view.getUint32(p + 16, true);
    const compressedSize = view.getUint32(p + 20, true);
    const uncompressedSize = view.getUint32(p + 24, true);
    const nameLength = view.getUint16(p + 28, true);
    const extraLength = view.getUint16(p + 30, true);
    const commentLength = view.getUint16(p + 32, true);
    const localOffset = view.getUint32(p + 42, true);
    const path = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLength));

    if (view.getUint32(localOffset, true) !== LOCAL_FILE_HEADER_SIGNATURE) {
      throw new Error(`local header for "${path}" has a bad signature`);
    }
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const localName = decoder.decode(
      bytes.subarray(localOffset + 30, localOffset + 30 + localNameLength)
    );
    if (localName !== path) {
      throw new Error(`name mismatch: central "${path}" vs local "${localName}"`);
    }
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;

    entries.push({
      path,
      data: bytes.slice(dataStart, dataStart + compressedSize),
      crc,
      method: view.getUint16(localOffset + 8, true),
      flags: view.getUint16(localOffset + 6, true),
      centralFlags: view.getUint16(p + 8, true),
      versionNeeded: view.getUint16(localOffset + 4, true),
      compressedSize,
      uncompressedSize,
      dosTime: view.getUint16(localOffset + 10, true),
      dosDate: view.getUint16(localOffset + 12, true)
    });

    p += 46 + nameLength + extraLength + commentLength;
  }

  if (p - centralDirectoryOffset !== centralDirectorySize) {
    throw new Error("central directory size does not match the walked entries");
  }
  return { entries, entryCount, centralDirectoryOffset, centralDirectorySize };
}

const sampleEntries: ZipEntry[] = [
  { path: "arenas/test-map.json", data: encoder.encode('{\n  "id": "arena.test-map"\n}\n') },
  { path: "skyboxes/test-map.webp", data: new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 255, 128]) },
  { path: "manifest-snippet.json", data: encoder.encode('{ "files": [] }') }
];

describe("crc32", () => {
  // Known-answer vectors for the IEEE polynomial. These pin the table and the
  // final xor; a subtly wrong CRC produces an archive that only fails at unzip.
  it("matches published check values", () => {
    expect(crc32(encoder.encode(""))).toBe(0x00000000);
    expect(crc32(encoder.encode("a"))).toBe(0xe8b7be43);
    expect(crc32(encoder.encode("123456789"))).toBe(0xcbf43926);
    expect(crc32(encoder.encode("The quick brown fox jumps over the lazy dog"))).toBe(0x414fa339);
  });

  it("handles binary data, not just text", () => {
    expect(crc32(new Uint8Array(4))).toBe(0x2144df1c);
    expect(crc32(new Uint8Array(Array.from({ length: 256 }, (_, i) => i)))).toBe(0x29058c73);
  });

  it("returns an unsigned 32-bit value", () => {
    // 0xE8B7BE43 has the high bit set — a signed result would come back negative.
    expect(crc32(encoder.encode("a"))).toBeGreaterThan(0);
    expect(crc32(encoder.encode("a"))).toBeLessThanOrEqual(0xffffffff);
  });
});

describe("createZip record structure", () => {
  it("starts with a local file header and ends with an EOCD record", async () => {
    const bytes = await zipBytes(sampleEntries);
    const view = viewOf(bytes);
    expect(view.getUint32(0, true)).toBe(LOCAL_FILE_HEADER_SIGNATURE);
    expect(view.getUint32(bytes.length - END_OF_CENTRAL_DIRECTORY_SIZE, true)).toBe(
      END_OF_CENTRAL_DIRECTORY_SIGNATURE
    );
  });

  it("records the entry count in the EOCD and points it at a real central directory", async () => {
    const bytes = await zipBytes(sampleEntries);
    const view = viewOf(bytes);
    const eocd = bytes.length - END_OF_CENTRAL_DIRECTORY_SIZE;

    expect(view.getUint16(eocd + 8, true)).toBe(sampleEntries.length); // on this disk
    expect(view.getUint16(eocd + 10, true)).toBe(sampleEntries.length); // total

    const centralDirectoryOffset = view.getUint32(eocd + 16, true);
    const centralDirectorySize = view.getUint32(eocd + 12, true);
    expect(view.getUint32(centralDirectoryOffset, true)).toBe(CENTRAL_DIRECTORY_SIGNATURE);
    // The directory must run exactly up to the EOCD record.
    expect(centralDirectoryOffset + centralDirectorySize).toBe(eocd);
  });

  it("stores entries uncompressed with matching sizes and no flags", async () => {
    const { entries } = readZip(await zipBytes(sampleEntries));
    expect(entries).toHaveLength(sampleEntries.length);
    entries.forEach((entry, i) => {
      expect(entry.versionNeeded).toBe(20);
      expect(entry.flags).toBe(0);
      expect(entry.method).toBe(0);
      expect(entry.compressedSize).toBe(entry.uncompressedSize);
      expect(entry.uncompressedSize).toBe(sampleEntries[i]?.data.length);
      expect(entry.crc).toBe(crc32(sampleEntries[i]?.data ?? new Uint8Array(0)));
    });
  });

  it("emits a valid empty archive when there are no entries", async () => {
    const bytes = await zipBytes([]);
    expect(bytes.length).toBe(END_OF_CENTRAL_DIRECTORY_SIZE);
    const archive = readZip(bytes);
    expect(archive.entryCount).toBe(0);
    expect(archive.centralDirectorySize).toBe(0);
    expect(archive.centralDirectoryOffset).toBe(0);
  });
});

describe("createZip round trip", () => {
  it("recovers every file name and its bytes exactly", async () => {
    const { entries } = readZip(await zipBytes(sampleEntries));
    expect(entries.map((e) => e.path)).toEqual([
      "arenas/test-map.json",
      "skyboxes/test-map.webp",
      "manifest-snippet.json"
    ]);
    entries.forEach((entry, i) => {
      expect(Array.from(entry.data)).toEqual(Array.from(sampleEntries[i]?.data ?? []));
    });
  });

  it("round-trips a payload with high bytes and zero bytes untouched", async () => {
    const data = new Uint8Array(1024);
    for (let i = 0; i < data.length; i++) data[i] = (i * 37) & 0xff;
    const { entries } = readZip(await zipBytes([{ path: "skyboxes/noise.webp", data }]));
    expect(entries[0]?.path).toBe("skyboxes/noise.webp");
    expect(Array.from(entries[0]?.data ?? [])).toEqual(Array.from(data));
  });

  it("encodes file names as UTF-8", async () => {
    const path = "arenas/naïve-café.json";
    const { entries } = readZip(await zipBytes([{ path, data: encoder.encode("{}") }]));
    expect(entries[0]?.path).toBe(path);
  });

  // Decoding the name with a UTF-8 reader proves nothing on its own — it round
  // trips whether or not the archive declares the encoding. What a real
  // extractor keys off is general-purpose bit 11; without it the name is
  // formally CP437 and Info-ZIP/Python render "café" as "caf├⌐", so the file no
  // longer matches the path the manifest snippet hands the integrator. Arena
  // ids are only constrained by startsWith("arena."), so this is reachable.
  it("declares non-ASCII names as UTF-8 via general-purpose bit 11", async () => {
    const { entries } = readZip(
      await zipBytes([{ path: "arenas/café.json", data: encoder.encode("{}") }])
    );
    expect((entries[0]?.flags ?? 0) & 0x0800).toBe(0x0800);
    // The central directory is the copy most readers trust; it must agree.
    expect(entries[0]?.centralFlags).toBe(entries[0]?.flags);
  });

  it("leaves the encoding flag clear for ASCII names, where CP437 agrees", async () => {
    const { entries } = readZip(await zipBytes(sampleEntries));
    for (const entry of entries) {
      expect(entry.flags & 0x0800).toBe(0);
      expect(entry.centralFlags).toBe(entry.flags);
    }
  });
});

describe("createZip determinism", () => {
  it("produces identical bytes for identical input", async () => {
    const first = await zipBytes(sampleEntries);
    const second = await zipBytes(sampleEntries);
    expect(Array.from(first)).toEqual(Array.from(second));
  });

  it("defaults to the fixed DOS epoch rather than the wall clock", async () => {
    const { entries } = readZip(await zipBytes(sampleEntries));
    // 1980-01-01T00:00:00Z packs to date ((0)<<9 | 1<<5 | 1) = 33, time 0.
    for (const entry of entries) {
      expect(entry.dosDate).toBe(33);
      expect(entry.dosTime).toBe(0);
    }
    expect(ZIP_EPOCH.getUTCFullYear()).toBe(1980);
  });

  it("packs an explicit date into the DOS date/time fields", async () => {
    const when = new Date(Date.UTC(2024, 4, 17, 13, 45, 22));
    const { entries } = readZip(await zipBytes(sampleEntries, when));
    // date = (2024-1980)<<9 | 5<<5 | 17, time = 13<<11 | 45<<5 | 22>>1
    expect(entries[0]?.dosDate).toBe(((2024 - 1980) << 9) | (5 << 5) | 17);
    expect(entries[0]?.dosTime).toBe((13 << 11) | (45 << 5) | 11);
  });

  it("clamps a pre-1980 date instead of wrapping the year field", async () => {
    const { entries } = readZip(
      await zipBytes(sampleEntries, new Date(Date.UTC(1970, 0, 1, 0, 0, 0)))
    );
    expect(entries[0]?.dosDate).toBe((0 << 9) | (1 << 5) | 1);
  });
});

describe("createZip guards", () => {
  it("rejects an entry with an empty path", () => {
    expect(() => createZip([{ path: "", data: encoder.encode("x") }])).toThrow(/empty path/);
  });
});
