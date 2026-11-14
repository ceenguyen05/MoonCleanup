// Pinned LOLA GDR sources (world-and-dust-simulation 3.1). LOLA-only products; no SLDEM2015 (JAXA terms unresolved).
// The bake refuses to run when the downloaded bytes differ from these checksums.

export const PDS_LDEM_BASE =
  "https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/cylindrical/img";

export const LOLA_CREDIT =
  "Elevation: NASA LRO Lunar Orbiter Laser Altimeter (LOLA) Science Team, NASA/GSFC; data via NASA Planetary Data System.";

export interface PinnedSource {
  readonly id: string;
  readonly product: "LDEM_16";
  readonly imgUrl: string;
  readonly lblUrl: string;
  readonly imgFile: string;
  readonly lblFile: string;
  readonly imgBytes: number;
  readonly imgSha256: string;
  readonly lblSha256: string;
}

export const LDEM_16: PinnedSource = {
  id: "ldem_16",
  product: "LDEM_16",
  imgUrl: `${PDS_LDEM_BASE}/ldem_16.img`,
  lblUrl: `${PDS_LDEM_BASE}/ldem_16.lbl`,
  imgFile: "ldem_16.img",
  lblFile: "ldem_16.lbl",
  imgBytes: 33_177_600,
  imgSha256: "a511e40d7a3ea3275945b4da2a1df377133264fab0be94b7434b1cf8907254cb",
  lblSha256: "9aef29463ccc6ed3a3fbe0df3ecd830a99c69e16b564f455507dee2697096579",
};

/** Not downloaded in M0-W2-T05 (531 MB, over the 500 MB stop line): report-only extrapolation and go/no-go. */
export const LDEM_64_URL = `${PDS_LDEM_BASE}/ldem_64.img`;
export const LDEM_64_BYTES = 530_841_600;
