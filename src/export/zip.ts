/**
 * A hand-rolled, dependency-free ZIP writer.
 *
 * The builder ships zero runtime dependencies beyond @babylonjs/core and zod,
 * so pulling in jszip (~100 kB, its own deflate implementation) to emit one
 * three-file archive is a bad trade. What we need is the simplest archive the
 * format allows, and this module is exactly that: **STORE only, no
 * compression**. The payload is a small JSON file plus an already-compressed
 * .webp panorama, so deflate would shave a rounding error off the download
 * while costing hundreds of lines of Huffman coding.
 *
 * Layout emitted (APPNOTE.TXT §4.3):
 *
 *   [local file header + file name + raw data] × n
 *   [central directory file header + file name] × n
 *   [end of central directory record]
 *
 * Everything is little-endian, written through a DataView so the byte order is
 * explicit rather than inherited from the host.
 */

/** One file in the archive. `path` uses forward slashes, e.g. "arenas/map.json". */
export interface ZipEntry {
  path: string;
  data: Uint8Array;
}

const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;

/** Fixed-size prefixes of each record, before the variable-length file name. */
const LOCAL_HEADER_SIZE = 30;
const CENTRAL_HEADER_SIZE = 46;
const END_OF_CENTRAL_DIRECTORY_SIZE = 22;

/** 2.0 — the lowest version that covers plain stored/deflated entries. */
const VERSION_NEEDED = 20;
/** Compression method 0 = stored. */
const METHOD_STORE = 0;

/**
 * General-purpose bit 11 ("language encoding flag", APPNOTE.TXT §4.4.4).
 *
 * With this bit clear, the format says the file name is CP437; extractors take
 * that literally. We always emit UTF-8 bytes, so for a name outside ASCII the
 * two disagree and a real extractor mojibakes it — Info-ZIP and Python's
 * zipfile both turn "arenas/café.json" into "arenas/caf├⌐.json", which then no
 * longer matches the path the manifest snippet tells the integrator to use.
 * Arena ids are only constrained by `startsWith("arena.")`, so a non-ASCII slug
 * is reachable from ordinary input, not a theoretical case.
 *
 * Set only when the name actually needs it: pure-ASCII names stay bit-for-bit
 * as before, which keeps maximum compatibility with ancient extractors.
 */
const FLAG_UTF8_NAMES = 0x0800;

/** True when any byte is outside ASCII, i.e. where CP437 and UTF-8 diverge. */
function needsUtf8Flag(name: Uint8Array): boolean {
  return name.some((byte) => byte > 0x7f);
}

/** uint16 file-name length and uint32 size fields cap what this writer can emit. */
const MAX_NAME_BYTES = 0xffff;
const MAX_ENTRY_BYTES = 0xffffffff;

/**
 * Default timestamp stamped into every entry: 1980-01-01T00:00:00Z, the start
 * of the DOS epoch that ZIP timestamps are measured from.
 *
 * Using a fixed date rather than "now" is deliberate. Archives built from the
 * same arena must be byte-for-byte identical, so exports are diffable, cacheable
 * and — the reason it matters here — testable: a test can assert on exact bytes
 * without the clock making it flaky. Callers that genuinely want a wall-clock
 * timestamp pass one explicitly to createZip().
 */
export const ZIP_EPOCH: Date = new Date(Date.UTC(1980, 0, 1, 0, 0, 0));

/**
 * CRC-32 lookup table (IEEE 802.3 polynomial, reflected form 0xEDB88320).
 *
 * Built once at module load: 256 entries is cheap enough that lazy
 * initialization would only add a branch to the inner loop.
 */
const CRC_TABLE: readonly number[] = buildCrcTable();

function buildCrcTable(): number[] {
  const table: number[] = new Array<number>(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let bit = 0; bit < 8; bit++) {
      c = (c & 1) === 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
}

/**
 * CRC-32 (IEEE) of a byte range, as an unsigned 32-bit number.
 *
 * ZIP stores a checksum per entry, and unzip tools verify it — a wrong CRC
 * makes an otherwise well-formed archive report corruption, so this is the one
 * piece of the format worth pinning to known-answer vectors in tests.
 */
export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    // The index is masked to 0..255, so the lookup always hits; `?? 0` exists
    // only to satisfy noUncheckedIndexedAccess.
    crc = (crc >>> 8) ^ (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

interface DosDateTime {
  /** packed (year-1980)<<9 | month<<5 | day */
  date: number;
  /** packed hours<<11 | minutes<<5 | (seconds/2) */
  time: number;
}

/**
 * Pack a Date into the two 16-bit DOS fields ZIP uses for timestamps.
 *
 * UTC components, never local ones: DOS timestamps carry no timezone, so
 * reading local time would make the same Date produce different archives
 * depending on where the build ran. The year is clamped to the representable
 * 1980–2107 window rather than allowed to wrap into a nonsense date.
 */
function toDosDateTime(when: Date): DosDateTime {
  const year = Math.min(2107, Math.max(1980, when.getUTCFullYear()));
  return {
    date: ((year - 1980) << 9) | ((when.getUTCMonth() + 1) << 5) | when.getUTCDate(),
    // DOS time has two-second resolution — the low bit of `seconds` is dropped.
    time: (when.getUTCHours() << 11) | (when.getUTCMinutes() << 5) | (when.getUTCSeconds() >>> 1)
  };
}

/**
 * Build a ZIP archive containing `entries`, in the order given.
 *
 * `when` defaults to ZIP_EPOCH so output is deterministic; pass a Date only if
 * the archive should carry a real modification time.
 *
 * Throws if an entry cannot be represented by the plain (non-ZIP64) record
 * fields, so a silently truncated header can never reach the author's disk.
 */
export function createZip(entries: ZipEntry[], when: Date = ZIP_EPOCH): Blob {
  const encoder = new TextEncoder();
  // File names are UTF-8 bytes, declared as such via bit 11 whenever they leave
  // ASCII (see FLAG_UTF8_NAMES). ASCII names keep flags 0, where CP437 and
  // UTF-8 agree byte for byte.
  const names = entries.map((entry) => encoder.encode(entry.path));

  entries.forEach((entry, i) => {
    const name = names[i];
    if (name === undefined || name.length === 0) {
      throw new Error(`zip entry ${i} has an empty path`);
    }
    if (name.length > MAX_NAME_BYTES) {
      throw new Error(`zip entry path is too long to encode: ${entry.path}`);
    }
    if (entry.data.length > MAX_ENTRY_BYTES) {
      throw new Error(`zip entry exceeds the 4 GiB limit of a non-ZIP64 archive: ${entry.path}`);
    }
  });

  const dos = toDosDateTime(when);
  const crcs = entries.map((entry) => crc32(entry.data));
  // Per entry, because the local header and the central directory must agree —
  // an extractor that reads one and trusts the other would otherwise disagree
  // with itself about the encoding.
  const flags = names.map((name) => (needsUtf8Flag(name) ? FLAG_UTF8_NAMES : 0));

  const localSize = entries.reduce(
    (total, entry, i) => total + LOCAL_HEADER_SIZE + (names[i]?.length ?? 0) + entry.data.length,
    0
  );
  const centralSize = entries.reduce(
    (total, _entry, i) => total + CENTRAL_HEADER_SIZE + (names[i]?.length ?? 0),
    0
  );

  const out = new Uint8Array(localSize + centralSize + END_OF_CENTRAL_DIRECTORY_SIZE);
  const view = new DataView(out.buffer);
  let offset = 0;

  const u16 = (value: number): void => {
    view.setUint16(offset, value, true);
    offset += 2;
  };
  const u32 = (value: number): void => {
    view.setUint32(offset, value, true);
    offset += 4;
  };
  const raw = (value: Uint8Array): void => {
    out.set(value, offset);
    offset += value.length;
  };

  // Local file headers, each immediately followed by its stored data.
  const localOffsets: number[] = [];
  entries.forEach((entry, i) => {
    const name = names[i] ?? new Uint8Array(0);
    localOffsets.push(offset);
    u32(LOCAL_FILE_HEADER_SIGNATURE);
    u16(VERSION_NEEDED);
    u16(flags[i] ?? 0); // general purpose bit flag
    u16(METHOD_STORE);
    u16(dos.time);
    u16(dos.date);
    u32(crcs[i] ?? 0);
    u32(entry.data.length); // compressed size == uncompressed size when stored
    u32(entry.data.length);
    u16(name.length);
    u16(0); // extra field length
    raw(name);
    raw(entry.data);
  });

  // Central directory — the index readers actually trust; its per-entry
  // relative offset is what points back at each local header.
  const centralDirectoryOffset = offset;
  entries.forEach((entry, i) => {
    const name = names[i] ?? new Uint8Array(0);
    u32(CENTRAL_DIRECTORY_SIGNATURE);
    u16(VERSION_NEEDED); // version made by
    u16(VERSION_NEEDED); // version needed to extract
    u16(flags[i] ?? 0); // general purpose bit flag
    u16(METHOD_STORE);
    u16(dos.time);
    u16(dos.date);
    u32(crcs[i] ?? 0);
    u32(entry.data.length);
    u32(entry.data.length);
    u16(name.length);
    u16(0); // extra field length
    u16(0); // file comment length
    u16(0); // disk number start
    u16(0); // internal file attributes
    u32(0); // external file attributes
    u32(localOffsets[i] ?? 0);
    raw(name);
  });

  u32(END_OF_CENTRAL_DIRECTORY_SIGNATURE);
  u16(0); // number of this disk
  u16(0); // disk on which the central directory starts
  u16(entries.length); // entries on this disk
  u16(entries.length); // entries total
  u32(centralSize);
  u32(centralDirectoryOffset);
  u16(0); // archive comment length

  return new Blob([out], { type: "application/zip" });
}
