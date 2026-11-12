# Asset and Data Licensing Research: Browser Co-op Moon-Cleaning Game

**Date:** 2026-11-11 · **Author:** research subagent P1f · **Scope:** Licensing, credit, format and hosting facts for (1) NASA/USGS lunar elevation and imagery data, (2) sky assets (Earth textures, star catalogs, star maps), (3) CC0/permissive materials, models, animations, audio, fonts and icons, and (4) Git LFS on GitHub plus Vercel build support. The game is free, non-monetized and has a possibly **public** GitHub repo, so redistribution terms for raw files matter. We assume licenses must be safe for commercial use. **This is research, not legal advice.** Items needing a human decision are listed at the end.

**Method and caveats.** All facts were gathered on 2026-11-11 with an automated web fetcher and search tool. Some official pages would not load in that tool:

- USGS Astrogeology product pages and the Adobe Mixamo FAQ returned HTTP 403.
- The Freesound FAQ and the CMU mocap site failed with TLS certificate errors.
- The JAXA SELENE terms page could not be retrieved.

Facts for those sources come from search-engine snippets or mirror copies. They are marked **(via search)** and carry lower confidence. Quotes are short excerpts as the fetcher returned them. Re-check any quote on the live page before using it in a legal or credits document. `[S#]` refers to the numbered **Sources** list at the end. Confidence tags: **High** means read directly on an official page. **Medium** means read from a secondary source or search snippet, or partly inferred. **Low** means not verified.

---

## Executive summary

1. **NASA lunar data and visualizations are low-risk for our use.** NASA media "generally are not subject to copyright in the United States", and "NASA should be acknowledged as the source of the material". The NASA insignia, logotype and seal are protected and must not be used. No use may imply NASA endorsement. **High** [S10]
2. **Best starting asset: the NASA SVS *CGI Moon Kit*.** It contains:
   - color maps: a 2025 16-bit sRGB set from 4k up to full size, and a 2019 8-bit set from 1k up to 27360×13680;
   - LOLA displacement maps: ldem_4/16/64 as float km, plus uint16 variants.

   Credit: "NASA's Scientific Visualization Studio." The page states no license of its own, so NASA's general guidelines apply. **High** [S9][S10]
3. **LOLA LDEMs on the PDS Geosciences Node.**
   - 4, 16, 64 and 128 px/deg are single files of 2.07 MB, 33 MB, 531 MB and 2.12 GB.
   - 256 px/deg is 4 tiles, about 8.5 GB in total.
   - 512 px/deg is 16 tiles, about 34 GB in total.
   - 1024 px/deg is described as "sparse" and "preliminary".

   A small game moon needs only LDEM_16 to LDEM_64-class data. **High** [S2][S3]
4. **SLDEM2015 (LOLA plus JAXA Kaguya TC, ±60°, 512 px/deg ≈ 59 m)** is marked "Public Domain" on the USGS record [S6]. However, it contains JAXA data. JAXA's archive asks for a "©JAXA/SELENE" credit, and we could not retrieve its full terms [S32]. → **Use LOLA-only LDEMs** unless a human clears the JAXA terms. **Medium**
5. **LROC terms depend on where the file comes from.**
   - PDS products are public domain.
   - Images from the LROC *website* "are copyrighted". Commercial use of LROC images not downloaded from the PDS archive needs prior permission.
   - Credit: "NASA/GSFC/Arizona State University".
   - NASA moved LROC management to Intuitive Machines in May 2026, so re-check the terms before launch.

   **High** [S11][S13]
6. **USGS-produced data are "U.S. Public Domain".** USGS asks for the credit "U.S. Geological Survey". The USGS identifier is trademarked. **High** [S18]
7. **Contradiction with the brief: Gaia data are not CC BY-SA 3.0 IGO.** ESA's Gaia license page says: "Gaia data are distributed under the CC BY-NC 3.0 IGO license." That is a non-commercial license, and commercial use is handled through separate ESA terms. NASA's *Deep Star Maps* include Gaia DR2 stars. → Do not use Gaia-derived content until a human reviews it. **Medium-High** [S23][S22]
8. **Clearest documented-license star source for a naked-eye sky: HYG v4.x** (Hipparcos + Yale Bright Star + Gliese), licensed **CC BY-SA 4.0**. Any star texture or star file derived from it must stay CC BY-SA 4.0 and carry attribution. **Medium-High** [S27][S30]
9. **CC0 sources that are safe to commit:**
   - Poly Haven;
   - ambientCG, which says you may "include the raw files in your project";
   - Kenney.

   **High** [S34][S35][S36]
10. **Quaternius is no longer plain CC0 on its own site.** The *Quaternius Asset License v1.0* forbids redistributing the assets "as a standalone asset, asset pack, stock file, template, or similar product". → Do not commit raw Quaternius files to the public repo without a human decision. **Medium-High** [S37]
11. **Mixamo:** free to use in games, royalty-free. Raw character and animation files must not be distributed to non-team members. → **Never commit Mixamo files to the public repo.** **Medium** (official FAQ blocked; read via search) [S39][S40]
12. **Audio policy:**
    - Freesound licenses each sound separately. Accept **CC0 and CC BY** only. Reject **CC BY-NC** and legacy Sampling+.
    - Sonniss GDC bundles and Pixabay can be used inside the shipped game. Their raw files must stay out of the public repo, because both licenses forbid standalone redistribution.

    **Medium-High** [S43][S45][S46]
13. **Fonts and icons:**
    - Google Fonts are mostly OFL, and commercial use is OK. The six candidate families are expected to be OFL 1.1 but were not each verified.
    - Icons: Lucide is ISC, Phosphor MIT, Tabler MIT, Material Symbols Apache-2.0.

    **Medium** [S47][S48]
14. **GitHub LFS uses metered billing.**
    - Free and Pro accounts get 10 GiB of storage and 10 GiB of bandwidth per month. Team and Enterprise Cloud get 250 GiB of each.
    - Without a payment method, usage over the quota is blocked.
    - Downloads by CI count toward the repo owner's bandwidth.

    Vercel pulls LFS objects if you switch the feature on in the project's Git settings, and you must redeploy after changing it. Each build probably uses LFS bandwidth (an inference). **High** [S49][S51]
15. **Recommendation:**
    - Keep raw scientific datasets and any asset whose license forbids redistribution out of git.
    - Commit the pipeline scripts and a source manifest listing each file's URL, license, credit and checksum.
    - Commit only small, game-ready derived files from CC0, public-domain or our own work.
    - Generate heavy derivatives offline once, not on every Vercel build.

---

## 1. Lunar elevation data: LRO LOLA DEMs, polar products, SLDEM2015

### 1.1 Hosting

- **PDS Geosciences Node (Washington University).** Hosts the LOLA EDR, RDR, RADR, **GDR (gridded DEMs)** and SHADR data, plus SLDEM in PDS4 bundles. The data directories are under `https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/` [S1].
  - The same page links to the MIT "LOLA Data Node" at `http://imbrium.mit.edu/`, which is updated more often than PDS.
  - It also links to the Lunar Orbital Data Explorer at `https://ode.rsl.wustl.edu/moon/`. **High** [S1]
- **NASA GSFC Planetary Geodesy Data Archive (PGDA).** Hosts the SLDEM2015 product page, with downloads served from `http://imbrium.mit.edu/DATA/SLDEM2015/`. **High** [S5]
- **USGS Astrogeology.** Hosts GeoTIFF conversions, for example "Moon LRO LOLA - SELENE Kaguya TC DEM Merge 60N60S 59m" and "Moon LRO LOLA DEM 118m".
  - These pages returned HTTP 403 to our fetcher.
  - A search-engine summary says the SLDEM merge is offered as a **22 GB GeoTIFF**, with credit to NASA's LOLA Team and JAXA's SELENE/Kaguya Team, and is marked Public Domain. **Medium** (via search) [S7][S8]

### 1.2 LOLA GDR global equirectangular DEMs (LDEM)

File sizes come from the live PDS directory listing [S2]. Product descriptions come from the GDR data set catalog [S3].

| Product | Grid (computed) | Files on PDS | Size per file (bytes) | Total |
|---|---|---|---|---|
| LDEM_4 | 1440 × 720 | 1 | 2,073,600 | ≈2.1 MB |
| LDEM_16 | 5760 × 2880 | 1 | 33,177,600 | ≈33 MB |
| LDEM_64 | 23040 × 11520 | 1 | 530,841,600 | ≈531 MB |
| LDEM_128 | 46080 × 23040 | 1 | 2,123,366,400 | ≈2.1 GB |
| LDEM_256 | 92160 × 46080 | 4 tiles (90° lat × 180° lon) | 2,123,366,400 | ≈8.5 GB |
| LDEM_512 | 184320 × 92160 | 16 tiles (45° × 90°) | 2,123,366,400 | ≈34.0 GB |
| LDEM_1024 | 15° × 30° tiles | up to 144 tiles (12 lat bands × 12 lon sectors seen) | 943,718,400 | ≈136 GB if complete |

- **Grid and data type.** We computed the grid sizes from px/deg × 360 × 180. The byte counts match exactly at 2 bytes per pixel, so the samples are probably 16-bit integers. That is an **inference**. The scaling factor and offset are in each product's `.LBL` label, which we did not read.
- **Products described in the catalog [S3]:**
  - Global maps at "4, 16, 64, 128, 256, and 512 pixels per degree".
  - A 1024 px/deg set, described as "a sparse preliminary effort".
  - Kaguya TC co-registered DEMs at 128, 256 and 512 px/deg.
  - **Polar stereographic** maps for both poles at "resolutions from 240 down to 5 meters per pixel".
  - Ancillary grids: sample density, albedo, slope, roughness and geoid. Some products use JPEG2000.
- **Formats:** "raster Digital Elevation Models formatted as binary images with detached labels" (PDS3 `.IMG` plus `.LBL`, and PDS4 `.xml` labels). **High** [S2][S3]
- Other file prefixes in the same directory: `ldec_` (sample counts), `ldam_`/`ldac_` (albedo), `ldsm_` (slope) and `ldrm_` (radius). **Medium**: we inferred the meaning of the `ldec_` prefix. [S2]

### 1.3 SLDEM2015 (LOLA + SELENE/Kaguya Terrain Camera)

- **Coverage and accuracy.** It covers latitudes within ±60° "at a horizontal resolution of 512 pixels per degree (∼59 m at the equator) and a typical vertical accuracy ∼3 to 4 m". "Map values are referred to a radius of 1737400 m." **High** [S6]
- **Formats on PGDA/MIT [S5]:**
  - global FLOAT_IMG at 256 and 128 px/deg;
  - global JPEG2000 at 512, 256 and 128 px/deg;
  - tiles at 512 and 256 px/deg.

  The PDS mirror has `sldem2015/global/{float_img, jp2}` and `sldem2015/tiles/` [S4]. **High**
- **Size estimate.** The full 512 px/deg, ±60° grid is 184,320 × 61,440 px. That is about 45 GB as float32 or about 22.6 GB as 16-bit. These figures are our arithmetic, and they are consistent with the "22 GB GeoTIFF" from USGS [S7].
- **Citation required by PGDA:** "If using this dataset, please cite the following paper:" Barker, M. K., Mazarico, E., Neumann, G. A., Zuber, M. T., Haruyama, J., Smith, D. E., "A new lunar digital elevation model from the Lunar Orbiter Laser Altimeter and SELENE Terrain Camera", *Icarus* 273, 346–355, doi:10.1016/j.icarus.2015.07.039. **High** [S5]
- **USGS record:** Sources/Usage reads "Public Domain"; Credit reads "Astrogeology Science Center". **High** [S6]
- **JAXA component.**
  - The SELENE Data Archive terms reportedly ask users to indicate "©JAXA/SELENE" on products. These terms changed on 2018-07-30 (via search) [S32].
  - We could not retrieve the full current terms, including any commercial-use clause.
  - The live DARTS page shows an October 2026 notice that lists the Kaguya (SELENE) PDAP search as **suspended** [S32].
  - ISAS/JAXA's website content policy requires credits such as "(c) ISAS/JAXA" and reserves "Other use deemed inappropriate by ISAS/JAXA" (via search) [S33].

  **Low-Medium**. → Human decision (see the end of this report).

### 1.4 Usage terms and credit for LOLA products

- The PDS LOLA page has **no** license, citation or credit text. It only links to a "Cite PDS On Your Poster" page. **High** [S1]
- NASA-wide guidelines apply: "generally are not subject to copyright in the United States", and NASA should be acknowledged. **High** [S10]
- **Suggested credit** (our wording; no official LOLA wording was found): "Elevation: NASA LRO Lunar Orbiter Laser Altimeter (LOLA) Science Team, NASA/GSFC; data via NASA Planetary Data System."

**Practical recommendation.** For a scaled-down game moon:

- Use LDEM_16 (33 MB) or the CGI Moon Kit `ldem_16_uint.tif` (31.7 MB) as the master height source.
- Use LDEM_64 only if close-up terrain detail is needed.
- Generate game LOD tiles and normal maps offline.

---

## 2. Lunar imagery: LROC WAC mosaics, Hapke color, Clementine and others

### 2.1 LROC WAC Global Morphologic Mosaic (643 nm)

- **What it is.**
  - "This mosaic uses only the 643 nm band of the WAC."
  - It is built from more than 15,000 images taken from December 2009 to January 2011.
  - "all images were corrected to a common photometric geometry using a Hapke model".
  - The images are map-projected onto the GLD100 DTM. The polar images also use the LOLA shape model.

  **High** [S14]
- **Resolutions and tiling.**
  - Full resolution is "archived in ten regional tiles at three different resolutions": 100 m/px, 256 px/deg and 128 px/deg.
  - Eight of those tiles are equirectangular, each 60° of latitude × 90° of longitude.
  - Two are polar stereographic tiles, running from 60° to the pole.
  - 64, 32, 16, 8 and 4 px/deg come as single global tiles.
  - Orthographic hemisphere views are also provided. **High** [S14]
  - 100 m/px ≈ 303.23 px/deg, and 256 px/deg ≈ 118.45 m/px. **Medium** (via search) [S15]
- **Formats:** `.IMG`, "full-resolution 8-bit GeoTIFFs", and "low-resolution 8-bit browse products in PNG format". **High** [S14]
- **Sizes:**
  - One 100 m equatorial tile (E300N1350) is 1.85 GB as IMG. **Medium** (via search) [S15]
  - USGS lists its global 100 m GeoTIFF at about 5.5 GB. **Medium** (via search) [S57]
- **Hosting:**
  - PDS: the LROC PDS URLs now redirect to NASA's PDS store at `pds.mcp.nasa.gov` [S14].
  - The LROC RDR browser at `data.lroc.im-ldi.com` [S15].
  - USGS Astrogeology [S57].

### 2.2 WAC Hapke-normalized color mosaic

- It is a 7-band mosaic covering 70°N–70°S, normalized to 60° phase and 0° emission. **Medium** (via search) [S16]
- The CGI Moon Kit color maps "were adapted from the Hapke Normalized WAC Mosaic". **High** [S9]

### 2.3 LROC terms and credit

From the LROC "Terms & Citation" page [S11]. **High** for all points in this subsection.

- "Data products available through the LROC Data Node of the PDS or through NASA PDS interfaces are in the public domain"
- "Images available on the LROC website ... are copyrighted." This covers Featured Images, curated products and similar material.
- "All commercial use of LROC images not downloaded from the LROC PDS archive require prior permission."
- "For news media or educational purposes, credit LROC images with the text tag NASA/GSFC/Arizona State University. If space is limited, the shorter credit NASA/GSFC/ASU is also acceptable."
- Lunaserv gives this credit for the WAC Global Mosaic: "Credit: NASA/GSFC/Arizona State University" [S12].
- The USGS-hosted LROC mosaic record says "Public Domain" and "Image Credit: NASA/Goddard Space Flight Center/Arizona State University" [S17].
- **Operator change.**
  - "NASA has transferred management of two lunar science instruments to Intuitive Machines". The reason given is "the instruments' principal investigators and science team members joining the company".
  - The data are "now being managed by Texas A&M University" and are "part of NASA's Planetary Data System" (NASA Science, 2026-05-18) [S13].
  - The LROC and Lunaserv URLs now redirect from `lroc.asu.edu` to `lroc.im-ldi.com` and `lunaserv.im-ldi.com`. The terms page still names the ASU-era LROC SOC [S11][S12].

  → Re-verify the terms before launch.

### 2.4 Clementine and other color data

- **Not verified in this pass.** The USGS Astrogeology Clementine product pages are blocked for our fetcher, and Lunaserv's copyright page has no Clementine entry [S12]. Check the "Sources/Usage" field on each USGS record before use. **Low**
- Kaguya (SELENE) TC and MI imagery: JAXA terms apply and are unverified (§1.3). → Avoid for now.
- **Recommendation:** use the CGI Moon Kit color maps (LROC WAC Hapke-derived). No other color source is needed.

---

## 3. NASA SVS "CGI Moon Kit" (svs.gsfc.nasa.gov/4720)

- The kit was originally published on 2019-09-06 and last updated on 2026-01-09. It now includes a "2025 version" of the color map. The visualizer is Ernie Wright and the scientist is Noah Petro (NASA/GSFC). **High** [S9]
- **Color maps, 2025 version** (16-bit sRGB TIFFs plus one linear EXR):

  | File | Dimensions | Size |
  |---|---|---|
  | `lroc_color_2k.jpg` | 2048×1024 | 447 KB |
  | `lroc_color_16bit_srgb_4k.tif` | 4096×2048 | 59 MB |
  | `lroc_color_16bit_srgb_8k.tif` | 8192×4096 | 232 MB |
  | `lroc_color_16bit_srgb_16k.tif` | 16384×8192 | 909 MB |
  | `lroc_color_16bit_srgb.tif` | full size | 2.4 GB |
  | `lroc_color.exr` | half-float, linear | 943 MB |

- **Color maps, 2019 version** (24-bit RGB):

  | File | Dimensions | Size |
  |---|---|---|
  | `lroc_color_poles_1k.jpg` | 1024×512 | 136 KB |
  | `lroc_color_poles_2k.tif` | 2048×1024 | 3.2 MB |
  | `lroc_color_poles_4k.tif` | 4096×2048 | 12.5 MB |
  | `lroc_color_poles_8k.tif` | 8192×4096 | 48.3 MB |
  | `lroc_color_poles_16k.tif` | 16384×8192 | 178 MB |
  | `lroc_color_poles.tif` | 27360×13680 | 494 MB |

- **Displacement maps:**

  | File | Dimensions | Size |
  |---|---|---|
  | `ldem_3_8bit.jpg` | 1024×512 | 109 KB |
  | `ldem_4.tif` (float) | 1440×720 | 4.0 MB |
  | `ldem_4_uint.tif` (uint16) | 1440×720 | 2.0 MB |
  | `ldem_16.tif` (float) | 5760×2880 | 63 MB |
  | `ldem_16_uint.tif` (uint16) | 5760×2880 | 31.7 MB |
  | `ldem_64.tif` (float) | 23040×11520 | 1.01 GB |
  | `ldem_64_uint.tif` (uint16) | 23040×11520 | 506 MB |

  Hyperwall variants also exist. **High** [S9]
- **Units:**
  - Float files store height in km relative to a 1737.4 km radius.
  - Unsigned 16-bit files store height in half-meters relative to 1,727,400 m, "offset by +20,000". This is equivalent to (height above 1737.4 km in half-meters) + 20,000; that equivalence is our arithmetic.

  **High** [S9]
- **Source statements:**
  - Color: "adapted from the Hapke Normalized WAC Mosaic, a composite built by the camera team from over 100,000 WAC (Wide Angle Camera) images."
  - Displacement: "taken directly from the latest (as of spring 2019) gridded data products of the Lunar Orbiter Laser Altimeter instrument team."
  - Caveat: "These image is optimized for aesthetics, not science." (sic). **High** [S9]
- **Credit:** "Please give credit for this item to:" "NASA's Scientific Visualization Studio." The page has **no explicit license or public-domain statement**. It links to NASA's reproduction guidelines (see §4). **High** [S9]
- **Our use:**
  - 4k or 8k color (convert to KTX2 or WebP in the pipeline).
  - `ldem_16_uint.tif` or `ldem_4_uint.tif` for displacement.
  - These are NASA-produced, so committing modest-size copies or derivatives to a public repo is consistent with NASA's guidelines [S10]. Keep the 16k, full-size and EXR files out of git.

---

## 4. NASA and USGS media usage guidelines

### 4.1 NASA ("Guidelines for using images and media", NASA Brand Center) [S10], High

- **Copyright status.**
  - "NASA content – images, audio, video, and media files used in the rendition of 3-dimensional models" "generally are not subject to copyright in the United States".
  - Allowed uses are "for educational or informational purposes, including photo collections, textbooks, … public exhibits, computer graphical simulations and Internet Web pages."
- **Credit:** "NASA should be acknowledged as the source of the material."
- **Marks:**
  - "The NASA Insignia, Logotype, identifiers, and imagery are not in the public domain."
  - "The use of the Insignia, Logotype and NASA identifiers is protected by law."
  - "NASA does not permit our Insignia (i.e., NASA Meatball, Worm logotype, or Seal) to appear with SI generated imagery." This matters if we ever use AI-generated art.
- **Endorsement:**
  - "NASA content used in a factual manner that does not imply endorsement may be used without needing explicit permission."
  - Commercial use "must not explicitly or implicitly convey NASA's endorsement of commercial goods or services."
- **People:**
  - "If a NASA image, audio, video or media includes an identifiable person," commercial use "may infringe that person's right of privacy or publicity".
  - "Astronauts or employees who are currently employed by NASA cannot have their names, likenesses or other personality traits displayed." This sentence appears in the commercial or promotional context.
- **Third-party material:** "Those wishing to use copyright protected material of third parties must contact the copyright holder directly."
- **Nuance.** The statement is scoped "in the United States" and says "generally". Status outside the US is not addressed on the page. Also, some NASA-hosted items are third-party works. **Medium** for the international point.

**Rules this implies for us** (our recommendations):

- No NASA meatball, worm or seal anywhere: game, UI, README, repo social image, store pages.
- No "NASA" in the game title or branding.
- No real astronaut likenesses.
- Add a line such as "Not affiliated with or endorsed by NASA."
- Credit NASA, and the specific team, in a credits screen and in `CREDITS.md`.

### 4.2 USGS ("Copyrights and Credits") [S18], High

- "USGS-authored or produced data and information are considered to be in the U.S. Public Domain."
- "When using information from USGS information products, publications, or websites, we ask that proper credit be given." The example credit is "Credit: U.S. Geological Survey."
- The USGS identifier "is trademarked and must be used in accordance with the rules outlined in the Visual Identity System."
- Third-party items on USGS sites "are generally marked as being copyrighted". "To use these copyrighted materials, you must obtain permission from the copyright holder under copyright law."
- **Note:** USGS Astrogeology hosts conversions of NASA and JAXA data. The mission credit (for example JAXA for SLDEM2015) still applies [S6][S7].

---

## 5. Sky assets: Earth textures, star catalogs, star maps

### 5.1 Earth: Blue Marble and Black Marble

- **Policy (NASA Visible Earth, via search).**
  - "Most images published in Visible Earth are freely available for re-publication or re-use, including commercial purposes, except for where copyright is indicated."
  - "We ask that you use the credit statement attached with each image or else credit Visible Earth; the only mandatory credit is NASA."
  - On 2026-11-11 the Visible Earth policy URL **redirected** to the NASA Science Earth Observatory hub, so the live policy text could not be read. **Medium** [S19]
- Lunaserv gives this credit note for Blue Marble: "NASA requires that they be provided a credit as the owners of the imagery." It also says the Visible Earth team asks that "The Visible Earth be provided a credit as the location that the imagery was found at." **High** [S12]
- **Blue Marble.** The collection now lives at `science.nasa.gov/earth/earth-observatory/collections/blue-marble`. It lists Blue Marble (2002, 1 km) and "Blue Marble: Next Generation" (2005). A thumbnail named `world.topo.bathy.200408.3x5400x2700.jpg` suggests 5400×2700 topo/bathy variants; this is an **inference from the filename**. The new pages show **no credit line or use statement**. **Medium** [S21]
- **Black Marble ("Earth at Night: Flat Maps").** Available for 2016 and 2012 in color and grayscale:
  - 3600×1800 (0.1°);
  - 13500×6750 (3 km);
  - 500 m at 86400×43200, as eight 21600×21600 tiles.

  Formats are JPEG and GeoTIFF. The page shows no credit or use statement and links to "NASA Brand & Usage Guidelines". **High** [S20]
- **Recommendation:** use Blue Marble NG and Black Marble at 4k–8k after downsampling. Credit "NASA Earth Observatory / NASA Visible Earth". NASA is the mandatory credit.

### 5.2 Star catalogs and star maps

| Source | Licence found | Commercial use | Notes / confidence |
|---|---|---|---|
| **Gaia DR2/DR3 (ESA)** | ESA Gaia Users license page: "Gaia data are distributed under the CC BY-NC 3.0 IGO license." "For details and guidelines concerning commercial use of the Gaia data, please see the Terms and Conditions" | **NC.** Commercial use only per separate ESA terms (not reviewed) | Conflicts with older archive text, "The Gaia data are open and free to use, provided credit is given to 'ESA/Gaia/DPAC'" (via search) [S25]. ESA *images* carry "ESA/Gaia/DPAC, CC BY-SA 3.0 IGO" (via search) [S26]. The Credits page says: "When using Gaia data, please acknowledge the people and institutes that were involved in making the data available to you." [S24] **Medium-High** [S23] |
| **Hipparcos / Tycho-2 (ESA) via CDS VizieR** | VizieR gives "free access to the data contained therein, essentially dedicated to a scientific usage"; "the commercial usage of the data is subject to rules depending of the origin" (via search) | **Unclear** | Each catalog's ReadMe or copyright section governs. Not verified for Hipparcos or Tycho-2. **Low-Medium** [S29] |
| **Yale Bright Star Catalogue (BSC5)** | No explicit license found in this pass | **Unclear** | **Low**. Reached most easily through HYG (next row) |
| **HYG Database v4.2 (2025)** (Hipparcos + Yale BSC5 + Gliese) | "The HYG database is licensed with the Creative Commons Attribution-ShareAlike 4.0 license." Pre-v4.0 versions are CC BY-SA 2.5 (via search) | Yes | ShareAlike applies (see §5.3). **Medium-High** [S27][S28] |
| **NASA SVS "Deep Star Maps 2020"** (svs.gsfc.nasa.gov/4851) | No license stated. Credit: "NASA/Goddard Space Flight Center Scientific Visualization Studio." plus "Gaia DR2: ESA/Gaia/DPAC" plus constellation figures "based on those developed for the IAU by Alan MacRobert" (Sky and Telescope) | NASA part: yes. **Gaia part: unclear given NC** | Sources: Hipparcos-2 (<8.0 mag), Tycho-2 (8.0–11.5), Gaia DR2 (fainter), UCAC3 to fill gaps, plus Yale BSC and XHIP. Files are half-float EXR star, Milky Way and bright-star layers from 4k (≈34 MB) to 64k (≈3.8 GB), in celestial or galactic coordinates. TIF overlays for grid, constellation bounds and figures. Published 2020-09-09, updated 2022-08-12. **High** for the facts, **human decision** for the license [S22] |

**Practical takeaway.** A realistic naked-eye starfield needs only stars of about magnitude ≤ 6.5–8, so Gaia is unnecessary. The option with the clearest documented license is to **render our own starfield offline from HYG v4.x (CC BY-SA 4.0)** and release that texture or star file under CC BY-SA 4.0. Using the SVS Deep Star Maps is the convenient option, but it needs a human decision because of the Gaia DR2 content.

### 5.3 What share-alike means for derived textures (CC BY-SA 4.0, legal code [S30]), High for the quotes

- **"Adapted Material"** is "material subject to Copyright and Similar Rights that is derived from or based upon the Licensed Material and in which the Licensed Material is translated, altered, arranged, transformed, or otherwise modified in a manner requiring permission".
- **ShareAlike, §3(b).** "The Adapter's License You apply must be a Creative Commons license with the same License Elements, this version or later, or a BY-SA Compatible License."
- **Databases, §4.** "if You include all or a substantial portion of the database contents in a database in which You have Sui Generis Database Rights, then the database in which You have Sui Generis Database Rights (but not its individual contents) is Adapted Material".
- **Attribution, §3(a)(1).** You must retain the creator identification, copyright notice, license notice and disclaimer notice, plus a URI to the material. You must also "indicate if You modified the Licensed Material" and indicate the CC license with its text or URI.

**Our reading** (not legal advice; human or legal confirmation recommended):

- A star texture or a filtered star JSON generated from HYG should be treated as Adapted Material. Ship it as a **separate file** licensed CC BY-SA 4.0, with attribution to HYG/astronexus and a note on what we changed.
- Shipping that file alongside our code and CC0 assets does not, on its own, turn those other works into BY-SA. Do not merge BY-SA data into a file or pack we label CC0.
- Bare facts like star positions may not be copyrightable in some places, but database rights can exist in others, which is why we follow the license anyway.
- **CC BY-SA 3.0 IGO** (used for ESA images) has an equivalent share-alike mechanism. We could not fetch its legal code this pass because of a tool limit [S31]. **Low**
- **CC BY-NC (Gaia data):** anything derived from it would inherit the **NonCommercial** restriction, which conflicts with our requirement that assets be safe for commercial use.

---

## 6. CC0 and permissive asset libraries (PBR materials, HDRIs, models)

| Library | License (quote) | Attribution | Redistribution / raw files in public repo | Confidence |
|---|---|---|---|---|
| **Poly Haven** (HDRIs, PBR textures, models) | CC0: "effectively Public Domain"; "You can use our assets for any purpose" | "You do not need to give credit or attribution when using them (although it is appreciated)." | "You can redistribute them, share them around, include them when sharing your own work, or even in a product you sell." **OK** | High [S34] |
| **ambientCG** (PBR materials, HDRIs) | "All ambientCG assets are provided under the Creative Commons CC0 1.0 Universal License." | Optional. Suggested text: "Created using <asset name> from ambientCG.com, licensed under the Creative Commons CC0 1.0 Universal License." | You may "copy, modify, distribute and perform the assets, even for commercial purposes" and "include the raw files in your project, for example a video game." **OK** | High [S35] |
| **Kenney** (models, UI, audio, characters) | "Yes, all game assets on the asset pages are public domain licensed (CC0)." | "Attribution is not required." | Not addressed directly. CC0 allows it. "For full details, see the included license file". **OK** (keep the license file) | High [S36] |
| **Quaternius** (low-poly models, animation libraries) | Now the **Quaternius Asset License (QAL) v1.0**, not CC0. "You can use these assets, free of charge, in personal, educational, and commercial games"; "worldwide, royalty-free, non-exclusive, perpetual license" | "No attribution is required." | "You just can't resell or redistribute the assets themselves as assets." §3(a) bars redistribution "as a standalone asset, asset pack, stock file, template, or similar product"; "It does not restrict distributing a completed Product that merely incorporates the Assets." **Grey area for a public repo → treat as NO for raw files** | Medium-High [S37] |

- **Poly Haven caveats.**
  - Non-asset site content (logos, renders, text) is "protected by intellectual property laws".
  - The Terms of Service ban "Web scraping or data mining without express permission".
  - So do not bulk-scrape it from a script. Download manually, or use an officially sanctioned method (not verified). **High** [S34]
- **Quaternius caveat.** Older packs downloaded when Quaternius used CC0 may carry CC0 license files. The license applies per copy received, which is our understanding and was not verified. Check the license file inside each pack.
- **Other candidates, not verified this pass:** NASA 3D Resources, per-model CC licenses on Sketchfab, and marketplace assets under standard EULAs. **Do not use until checked.**

---

## 7. Animation sources

| Source | Terms found | Game use | Raw files in public repo | Confidence |
|---|---|---|---|---|
| **Adobe Mixamo** | Adobe Help says characters and animations are royalty free for personal, commercial and non-profit projects, including video games (via search). The pinned Adobe Community FAQ (2022) says there are "no limitations on the types of paid or nonpaid projects you can use as long as it follows the distribution rules"; "you are not required to give credit to Adobe, Mixamo, or Fuse"; you cannot make "asset packages for video game engines which redistribute character or animation raw files"; team members may use downloaded files but "you may not distribute the files to customers or non-team members" (via search). The Adobe Terms of Use govern. | **Yes**, baked into the game | **NO.** A public repo distributes raw files to non-team members | **Medium**: official FAQ returned HTTP 403 [S39][S40] |
| **CMU Graphics Lab Motion Capture Database** | "This data is free for use in research projects. You may include this data in commercially-sold products, but you may not resell this data directly, even in converted form." Suggested acknowledgement: "The data used in this project was obtained from mocap.cs.cmu.edu." An older readme said "free for use in research and commercial projects worldwide" (via mirrors/search) | **Yes** | Probably OK: free redistribution is not resale. **Human confirmation recommended** | **Medium**: site TLS error, wording from mirrors [S41] |
| **CMU FBX conversion at 4TU.ResearchData** | Listed as **CC BY-NC 4.0** | **No** (NC) | No | Medium (via search) [S42] |
| **Quaternius Universal Animation Library 1 & 2** | Listed on quaternius.com and tagged "Retarget" and "Humanoid Rig". Covered by QAL v1.0 (see §6) | Yes | Treat as **NO** for raw files | Medium [S37][S38] |
| **Kenney animated characters** | CC0 (site-wide statement) | Yes | Yes | Medium. Individual packs not checked [S36] |
| **Rokoko free assets / other mocap libraries** | **Not verified this pass** | — | — | Low. Do not assume CC0 |

**Recommendation.**

- In the public repo, rely on CC0 animations (Kenney), our own animations, or CMU-derived clips (after a human confirms).
- If Mixamo is used for prototyping, keep its files in **private** storage outside the repo and plan to replace them.
- A search result also mentions an Adobe-side restriction on using Mixamo content to train machine-learning models. This comes from a community answer. **Low**. [S39]

---

## 8. Audio sources

| Source | License / terms | Commercial | Attribution | Raw files in public repo | Confidence |
|---|---|---|---|---|---|
| **Freesound** | License is **per sound**: CC0, CC BY, or CC BY-NC (4.0 versions; older uploads may be 3.0), plus legacy Sampling+. On Sampling+ the FAQ says: "The sounds on freesound are not our sounds, they are the sounds of our users. So, we can't simply change the licenses for the users, we have to ask them to change the license." (via search) | CC0 and CC BY: yes. **CC BY-NC: no** | CC BY: yes | CC0: yes. CC BY: yes, with attribution | **Medium**: FAQ TLS error, via search [S43] |
| **Sonniss GDC Game Audio Bundle** | "worldwide, non-exclusive, royalty-free license"; "Licensee may use and modify the licensed sound effects for personal and commercial projects"; "unlimited number of projects"; "UNLIMITED USER LICENSE" | Yes | Not required: "without attribution to the original creator" | **NO.** "Licensee may not distribute, publish, sub-license or otherwise supply the sound effects as sound effects", including in an "asset pack, project template, software development kit or anything similar"; "Licensee may not sell any of the sound effects as they come" | High [S45] |
| **Pixabay (audio and images)** | Pixabay Content License: "Use Content for free"; "Modify or adapt Content into new works" | Yes, with limits. Trademark-bearing content cannot be used "for commercial purposes in relation to goods and services" | Not required | **NO.** "You cannot sell or distribute Content (either in digital or physical form) on a Standalone basis." "Standalone means where no creative effort has been applied to the Content" | High [S46] |
| **OpenGameArt** | Mixed licenses, per asset. **Not verified this pass** | Per asset | Per asset | Per asset | Low |

**Recommended audio policy:**

1. Prefer **CC0**: Kenney, Freesound CC0, our own recordings.
2. Allow **CC BY 4.0** only with a per-file credit in `CREDITS.md` and the in-game credits.
3. Reject **CC BY-NC**, **Sampling+**, and anything without a clear license.
4. Use Sonniss or Pixabay only if a human approves keeping the originals **outside** the public repo. Only processed game-ready versions would ship inside the game build. Note that a web game necessarily serves these files to browsers; whether that counts as "incorporated in a project" is a human or legal judgement.
5. Log every file in an asset manifest with: source URL, author, license and version, download date, and modifications.

---

## 9. Fonts and icons

- **Google Fonts (FAQ, via search).**
  - Commercial use is allowed, including in commercially sold products.
  - The most common license is the SIL Open Font License; some fonts use Apache 2.0 or the Ubuntu Font License.
  - OFL fonts may be bundled and redistributed with the license text, but cannot be sold on their own. Modified versions must respect any Reserved Font Names. This last detail comes from secondary sources.

  **Medium** [S47]

| Candidate | Expected license | Status |
|---|---|---|
| Inter | SIL OFL 1.1 | *Expected*. Not individually verified this pass |
| IBM Plex (Sans/Mono) | SIL OFL 1.1 | *Expected*. Not individually verified |
| Space Grotesk | SIL OFL 1.1 | *Expected*. Not individually verified |
| JetBrains Mono | SIL OFL 1.1 | *Expected*. Not individually verified |
| Rajdhani | SIL OFL 1.1 | *Expected*. Not individually verified |
| Orbitron | SIL OFL 1.1 | *Expected*. Not individually verified |

→ Before adding each family, open its license tab on fonts.google.com and commit `OFL.txt` next to the font files.

| Icon set | License | Notes | Confidence |
|---|---|---|---|
| Lucide | ISC | Keep the license notice | Medium (secondary sources) [S48] |
| Phosphor | MIT | Iconify listing shows commercial use OK without attribution | Medium [S48] |
| Tabler Icons | MIT | © Paweł Kuna | Medium [S48] |
| Material Symbols | Apache-2.0 | One secondary site says MIT. Most sources say Apache-2.0 | Medium [S48] |

→ Verify the upstream `LICENSE` files and keep a `THIRD_PARTY_NOTICES` file in the repo.

---

## 10. Git LFS on GitHub (as of 2026-11-11) and Vercel

### 10.1 GitHub Git LFS billing [S49], High

| Plan | Included LFS storage | Included LFS bandwidth (per month) |
|---|---|---|
| GitHub Free / Pro / Free for organizations | 10 GiB | 10 GiB |
| GitHub Team / Enterprise Cloud | 250 GiB | 250 GiB |

- **Billing model.**
  - LFS uses "metered billing", where "you only pay for what you actually use".
  - Bandwidth is "billed for each GiB of data downloaded". Storage is "billed by calculating an hourly usage rate".
  - The old prepaid data packs "have been removed".
  - The page gives no per-GiB prices; it points to GitHub's pricing calculator.
- **Over quota without a payment method:**
  - Storage: you can still clone, but you "will not be able to push new files back up".
  - Bandwidth: LFS support is disabled "until the next month".
  - With a $0 budget, usage is blocked for the rest of the month. With no budget, all overage is billed.
- **CI counts.** When GitHub Actions downloads a 500 MB LFS file, it "will use 500 MB of the repository owner's bandwidth".
- **Repo limits [S50]:**
  - Git warns on files over 50 MiB.
  - GitHub "blocks files larger than 100 MiB".
  - Browser uploads are capped at 25 MiB.
  - Repos should "remain small, ideally less than 1 GB, and less than 5 GB is strongly recommended".
  - Per-plan LFS maximum file sizes were not verified this pass.

### 10.2 Vercel and LFS [S51], High

- "If you have LFS objects in your repository, you can enable or disable support for them from the project settings. When support is enabled, Vercel will pull the LFS objects that are used in your repository."
- "You must redeploy your project after turning Git LFS on." The doc page was last updated 2026-08-25. The changelog entry is titled "Git LFS support" [S52].
- **Community report (via search):** builds failed while cloning when LFS objects had never been pushed to GitHub. Disabling LFS made the build succeed [S53]. **Medium**
- **Inference.** Each Vercel build that pulls LFS objects from GitHub probably counts as a GitHub LFS download. With the 10 GiB/month free bandwidth, 300 MB of LFS content allows only about 30 builds a month, before counting developer clones. That arithmetic is **Medium** confidence. → Keep the LFS payload small, or serve large runtime assets from object storage or a CDN.

### 10.3 Where each file type should live (recommendation)

| Asset class | Examples | Where | Why |
|---|---|---|---|
| Code, configs, small JSON, `CREDITS.md`, asset license manifest, `THIRD_PARTY_NOTICES` | — | **Plain git** | Text files, needed for license compliance |
| Data pipeline scripts plus a **source manifest** (URL, checksum, license, credit, date) | — | **Plain git** | Builds can be reproduced without storing raw data |
| Fonts (woff2 plus `OFL.txt`), SVG icons, small UI PNGs | — | **Plain git** | Small files with permissive licenses |
| Game-ready derived Moon, Earth and star textures from public-domain sources or our own work | 2k–8k KTX2/WebP color, 16-bit height and normal tiles | **Git LFS** (or plain git if each file is a few MB) | Versioned with the code. Keep the total small (see §10.2) |
| CC0 PBR materials, HDRIs, models, CC0/CC BY audio in runtime formats | GLB, KTX2, OGG/Opus | **Git LFS** | The licenses allow redistribution |
| CC BY-SA derived star data or texture | `stars_hyg.json`, starfield KTX2 | **Git or LFS, as a separate file with its own license notice** | Keeps share-alike scoped to that file |
| Raw scientific source data | LDEM_64 and above, SLDEM2015, WAC 100 m, CGI Moon Kit 16k/EXR, Deep Star Maps EXR | **Outside git.** Re-download from the manifest, or keep in private object storage | 0.5–100+ GB. Public-domain status doesn't fix the size problem |
| Originals with redistribution limits | Mixamo FBX, Sonniss WAV, Pixabay originals, Quaternius QAL packs | **Outside the public repo** (private storage), or don't use them | License terms (§6–§8) |
| Heavy intermediates | Mip chains, LOD pyramids, atlases | **Generate offline once.** Commit only final outputs. Avoid regenerating on every Vercel build | Build time, dependence on third-party servers, LFS bandwidth |

- **Note:** in a public repo, LFS files are as public as everything else. LFS does **not** fix license redistribution problems.

---

## 11. Approved sources and "Do not use" list

### 11.1 Approved sources

| Source | License | Commercial use | Attribution required | OK to commit raw files to a public repo | Notes |
|---|---|---|---|---|---|
| NASA SVS CGI Moon Kit [S9][S10] | NASA work. No license stated; NASA guidelines: "generally" not subject to US copyright | Yes (no endorsement, no insignia) | Requested: "NASA's Scientific Visualization Studio" | **Yes** for small sizes (4k/8k color, ldem_4/16). Large files outside git | Primary Moon source |
| NASA PDS LOLA GDR LDEMs [S1][S2][S3][S10] | NASA mission data. No license text | Yes | Requested (acknowledge NASA/LOLA) | **Yes legally**, but only small derivatives in practice | LDEM_4/16 fit easily |
| LROC WAC mosaics, **PDS copies only** [S11][S14] | Public domain (PDS products) | Yes | "NASA/GSFC/Arizona State University" | **Yes** (downsampled/derived) | Website images are excluded. Re-check terms after the 2026 operator change |
| USGS-produced products [S18][S17] | U.S. Public Domain | Yes | Requested: "U.S. Geological Survey" plus mission credit | **Yes** | Check each record. JAXA-derived content is excluded |
| NASA Blue Marble / Black Marble [S19][S20][S12] | NASA. Free reuse including commercial, except where copyright is indicated | Yes | "the only mandatory credit is NASA" | **Yes** (downsampled) | Credit Visible Earth / Earth Observatory as requested |
| Poly Haven [S34] | CC0 | Yes | No | **Yes** | No bulk scraping |
| ambientCG [S35] | CC0 1.0 | Yes | No | **Yes** (explicitly allowed) | — |
| Kenney [S36] | CC0 | Yes | No | **Yes** | Keep the license file |
| HYG Database v4.x [S27][S30] | CC BY-SA 4.0 | Yes | **Yes**, plus ShareAlike on adaptations | **Yes**, with license notice | Derived star files stay BY-SA |
| Freesound, CC0 sounds only [S43] | CC0 | Yes | No | **Yes** | Check each sound's license |
| Freesound, CC BY sounds [S43] | CC BY 4.0 (some 3.0) | Yes | **Yes** | **Yes**, with credits | Log the author, URL and license version |
| CMU mocap (original site data) [S41] | Custom terms: "may include … in commercially-sold products", no resale | Yes, inside the product | Acknowledgement requested | **Probably yes** (Medium) | Human to confirm. Avoid NC conversions |
| Google Fonts, OFL families [S47] | SIL OFL 1.1 (verify each family) | Yes | No credit needed in game. Ship the license with the font files | **Yes**, with `OFL.txt` | Inter, IBM Plex, Space Grotesk, JetBrains Mono, Rajdhani, Orbitron |
| Lucide / Phosphor / Tabler / Material Symbols [S48] | ISC / MIT / MIT / Apache-2.0 | Yes | Keep the license notices | **Yes**, with `LICENSE` | Verify the upstream licenses |

**Conditional: OK inside the shipped game, but NOT as raw files in the public repo. Each needs a human decision.**

| Source | Constraint |
|---|---|
| Adobe Mixamo [S39][S40] | No distribution of raw files to non-team members |
| Sonniss GDC bundles [S45] | No supplying "as sound effects" or in asset packs |
| Pixabay [S46] | No "Standalone" distribution |
| Quaternius under QAL v1.0 [S37] | No redistribution "as a standalone asset, asset pack…" |
| SLDEM2015 and other JAXA SELENE/Kaguya-derived data [S5][S32] | JAXA terms not verified. "©JAXA/SELENE" credit requested |
| NASA SVS Deep Star Maps [S22][S23] | Contains Gaia DR2, whose data license is CC BY-NC 3.0 IGO per ESA |
| Raw Hipparcos / Tycho-2 / Yale BSC via CDS [S29] | Commercial use "subject to rules depending of the origin" |

### 11.2 Do not use

1. **Freesound sounds under CC BY-NC (3.0 or 4.0) or legacy Sampling+** [S43].
2. **Anything licensed NC or ND**:
   - Gaia catalogue data and its derivatives, "CC BY-NC 3.0 IGO", unless ESA's commercial terms are reviewed and cleared [S23];
   - the CMU mocap FBX conversion on 4TU (CC BY-NC 4.0) [S42].
3. **LROC website images not downloaded from PDS** (Featured Images, curated products). They "are copyrighted" and commercial use needs permission [S11].
4. **NASA Insignia (meatball), Worm logotype, Seal or other NASA identifiers, and the USGS identifier.** Also no wording or visuals that imply NASA or USGS endorsement, and no likenesses of identifiable NASA astronauts or employees [S10][S18].
5. **Third-party copyrighted material found on NASA or USGS sites** without the holder's permission [S10][S18].
6. **Assets without an explicit, verifiable license.** This includes "free" wallpapers, Google Images finds, assets ripped from other games, films or videos, YouTube-ripped audio, and packs with no license file. This is a project-policy rule.
7. **Bulk-scraping Poly Haven** without permission [S34].
8. **AI-generated imagery combined with NASA insignia** [S10].
9. **Raw files from Mixamo, Sonniss, Pixabay or Quaternius (QAL) committed to the public repo** (§6–§8).

**Suggested credits block** (our draft, adapt as needed):

- "Moon color and elevation maps: NASA's Scientific Visualization Studio (CGI Moon Kit), using LRO LROC WAC data (NASA/GSFC/Arizona State University) and LRO LOLA data (NASA/GSFC)."
- "Earth imagery: NASA Earth Observatory / NASA Visible Earth."
- If HYG is used: "Star data: HYG Database (astronexus.com), CC BY-SA 4.0; derived starfield © [project], CC BY-SA 4.0."
- "This project is not affiliated with or endorsed by NASA, USGS, ESA, JAXA, or Adobe."

---

## Contradictions and uncertainty

1. **Gaia license.**
   - The brief assumed CC BY-SA 3.0 IGO.
   - ESA's current Gaia Users license page says **CC BY-NC 3.0 IGO** for data [S23].
   - Older archive documentation says the data are "open and free to use, provided credit is given to 'ESA/Gaia/DPAC'" (via search) [S25].
   - ESA *images* carry CC BY-SA 3.0 IGO (via search) [S26].

   All three are reported. The NC statement is the most recent official text we saw.
2. **Quaternius.** It is widely described as CC0, but its site now publishes the **Quaternius Asset License v1.0**, which restricts standalone redistribution [S37].
3. **CMU mocap.** The current wording, seen through mirrors, allows inclusion in commercial products but no resale. An older readme said "free for use in research and commercial projects worldwide". A third-party FBX conversion is CC BY-NC 4.0 [S41][S42].
4. **LROC.**
   - PDS products are public domain, but website images are copyrighted [S11].
   - Management moved to Intuitive Machines on 2026-05-18, and the data are now managed by Texas A&M within PDS [S13].
   - The terms page is still ASU-branded, but on an `im-ldi.com` domain [S11].
5. **NASA SVS pages state no license.** We rely on NASA-wide guidelines, which use the word "generally" and are scoped to the US [S9][S10][S22].
6. **Blocked or failed sources.** Content for these comes from search snippets or mirrors:
   - USGS Astrogeology (HTTP 403) [S7][S8][S57];
   - Adobe Mixamo FAQ (HTTP 403) [S39];
   - Freesound FAQ and CMU site (TLS errors) [S41][S43];
   - JAXA SELENE terms (not retrievable; the archive search is suspended per an October 2026 notice) [S32].
7. **Visible Earth / Earth Observatory moved to science.nasa.gov.** The policy text comes from the search index, and the new pages show no credit lines [S19][S20][S21].
8. **Material Symbols.** Most sources say Apache-2.0; one secondary source says MIT [S48].
9. **Google Font families.** The OFL license for each of the six candidates was *not* individually verified [S47].
10. **LDEM details.** The 16-bit sample type is inferred from file sizes. The LDEM_1024 tile count is inferred from the listing (up to 144), and PDS calls the set "sparse preliminary" [S2][S3].
11. **Clementine imagery, OpenGameArt, Rokoko and other mocap libraries:** not verified this pass.

## Items needing a human decision

1. **Gaia and Deep Star Maps.** Do we accept NASA SVS Deep Star Maps, which contain Gaia DR2 (CC BY-NC 3.0 IGO per ESA)? Or do we render our own starfield from HYG (CC BY-SA 4.0)? Recommendation: HYG, or have someone read ESA's commercial-use Terms and Conditions.
2. **Share-alike.** Do we accept CC BY-SA 4.0 obligations for the star data and texture (separate file, attribution, BY-SA kept)?
3. **SLDEM2015 / JAXA data.** Use it only after someone reads the current JAXA SELENE terms; otherwise use LOLA-only LDEMs. Recommendation: LOLA-only, which is enough for a small game moon.
4. **Mixamo, Sonniss, Pixabay, Quaternius (QAL).** Choose between:
   - (a) not using them;
   - (b) keeping their originals in private storage and shipping only in-game derivatives;
   - (c) asking the licensors.

   Also decide whether serving these files from a public web build is acceptable.
5. **CMU mocap.** Confirm that redistributing converted clips in a public repo, for free, is acceptable under "may not resell".
6. **LROC terms after the operator change.** Re-check `lroc.im-ldi.com/about/terms` before launch.
7. **Storage and billing.**
   - GitHub plan and LFS budget: a $0 budget blocks usage instead of billing.
   - LFS versus object storage or CDN for runtime assets.
   - Whether to turn on Vercel LFS, given the bandwidth used by each build.
8. **Branding.** Confirm there will be no NASA marks or naming, and add a non-endorsement disclaimer.
9. **Monetization.** If the game ever adds monetization, re-review all CC BY and "commercial" assumptions and any Pixabay or Sonniss usage. A legal review is advisable.

---

## Sources

All accessed 2026-11-11. "(via search)" means the content came from search-engine results or snippets, not a direct page read.

1. [S1] PDS Geosciences Node, "LRO LOLA" archive page. https://pds-geosciences.wustl.edu/missions/lro/lola.htm. Official data archive page.
2. [S2] PDS Geosciences Node, LOLA GDR cylindrical IMG directory listing. https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/cylindrical/img/. Official directory listing.
3. [S3] PDS Geosciences Node, LOLA GDR data set description (`gdr_ds.cat`). https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/catalog/gdr_ds.cat. PDS catalog label.
4. [S4] PDS Geosciences Node, SLDEM2015 directories. https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/sldem2015/ and https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/sldem2015/global/. Official directory listings.
5. [S5] NASA GSFC PGDA, "High-resolution Lunar Topography (SLDEM2015)". https://pgda.gsfc.nasa.gov/products/54. Official product page.
6. [S6] USGS, "LRO LOLA and Kaguya Terrain Camera DEM Merge 60N60S 512ppd" (media record). https://www.usgs.gov/media/images/lro-lola-and-kaguya-terrain-camera-dem-merge-60n60s-512ppd. Official record.
7. [S7] USGS Astrogeology, "Moon LRO LOLA - SELENE Kaguya TC DEM Merge 60N60S 59m". https://astrogeology.usgs.gov/search/map/moon_lro_lola_selene_kaguya_tc_dem_merge_60n60s_59m. Official product page; HTTP 403 to fetcher (via search).
8. [S8] USGS Astrogeology, "Moon LRO LOLA DEM 118m". https://astrogeology.usgs.gov/search/map/moon_lro_lola_dem_118m. Official product page; HTTP 403, not verified.
9. [S9] NASA Scientific Visualization Studio, "CGI Moon Kit" (ID 4720). https://svs.gsfc.nasa.gov/4720. Official.
10. [S10] NASA, "Guidelines for using images and media" (NASA Brand Center). https://www.nasa.gov/nasa-brand-center/images-and-media/. Official policy.
11. [S11] LROC Science Operations Center, "Terms & Citation". https://lroc.im-ldi.com/about/terms (301 redirect from https://www.lroc.asu.edu/about/terms). Instrument-team terms.
12. [S12] Lunaserv, "copyright info". https://lunaserv.im-ldi.com/copyright_info.html (301 redirect from https://lunaserv.lroc.asu.edu/copyright_info.html). Instrument-team page.
13. [S13] NASA Science, "NASA Transfers Management of Lunar Science Instruments" (2026-05-18). https://science.nasa.gov/blogs/science-news/2026/05/18/nasa-transfers-management-of-lunar-science-instruments/. Official news.
14. [S14] LROC/PDS, `WAC_GLOBAL_README.TXT`. https://pds.mcp.nasa.gov/data/store/img/lunar_reconnaissance_orbiter/pds4/lroc/lro-l-lroc-5-rdr/LROLRC_2001/DATA/BDR/WAC_GLOBAL/WAC_GLOBAL_README.TXT (302 redirect from pds.lroc.im-ldi.com). PDS documentation.
15. [S15] LROC RDR product pages, "WAC Global Morphologic Map": https://data.lroc.im-ldi.com/lroc/view_rdr_product/WAC_GLOBAL_E300N1350_100M and https://data.lroc.im-ldi.com/lroc/view_rdr_product/WAC_GLOBAL_P900S0000_256P. Instrument-team product pages (via search).
16. [S16] LROC, "WAC HAPKE README" and 643 nm tile page. https://pds.lroc.im-ldi.com/data/LRO-L-LROC-5-RDR-V1.0/LROLRC_2001/DATA/MDR/WAC_HAPKE/WAC_HAPKE_README.TXT and https://data.lroc.im-ldi.com/lroc/view_rdr_product/WAC_HAPKE_643NM_E350N1350. PDS documentation (via search).
17. [S17] USGS, "moon lroc wac nearside mosaic" (media record). https://www.usgs.gov/media/images/moon-lroc-wac-nearside-mosaic. Official record.
18. [S18] USGS, "Copyrights and Credits". https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits. Official policy.
19. [S19] NASA Visible Earth, "Image Use Policy". https://www.visibleearth.nasa.gov/image-use-policy, now 301-redirecting to https://science.nasa.gov/earth/earth-observatory/. Official policy (text via search).
20. [S20] NASA Earth Observatory, "Earth at Night: Flat Maps". https://science.nasa.gov/earth/earth-observatory/earth-at-night/maps. Official.
21. [S21] NASA Earth Observatory, "Blue Marble" collection. https://science.nasa.gov/earth/earth-observatory/collections/blue-marble (301 redirect from https://visibleearth.nasa.gov/collection/1484/blue-marble). Official.
22. [S22] NASA Scientific Visualization Studio, "Deep Star Maps 2020" (ID 4851). https://svs.gsfc.nasa.gov/4851. Official.
23. [S23] ESA Gaia Users, "License". https://www.cosmos.esa.int/web/gaia-users/license. Official.
24. [S24] ESA Gaia Users, "Credits". https://www.cosmos.esa.int/web/gaia-users/credits. Official.
25. [S25] ESA Gaia Archive, "Credit and citation instructions" (GDR2 and EDR3 documentation). https://gaia.esac.esa.int/documentation/GDR2/Miscellaneous/sec_credit_and_citation_instructions/ and https://archives.esac.esa.int/gaia/documentation/GEDR3/Miscellaneous/sec_credit_and_citation_instructions/. Official (via search).
26. [S26] ESA, "Gaia Data Processing and Analysis Consortium". https://sci.esa.int/web/gaia/-/gaia-data-processing-and-analysis-consortium. Official (via search).
27. [S27] astronexus, "HYG Database". https://www.astronexus.com/hyg. Project page.
28. [S28] astronexus HYG repository on Codeberg (license history). https://codeberg.org/astronexus/hyg. Project repo (via search; seen through a proxied copy).
29. [S29] CDS, "Rules of usage of VizieR data". https://vizier.cds.unistra.fr/viz-bin/cite/IX/56. Official service terms (via search).
30. [S30] Creative Commons, "Attribution-ShareAlike 4.0 International, Legal Code". https://creativecommons.org/licenses/by-sa/4.0/legalcode.en. License text.
31. [S31] Creative Commons, "CC BY-SA 3.0 IGO" deed. https://creativecommons.org/licenses/by-sa/3.0/igo/deed.en. License page; appeared in search results, legal code not fetched.
32. [S32] JAXA DARTS, SELENE data archive pages: https://darts.isas.jaxa.jp/planet/pdap/selene (terms, via search) and https://darts.isas.jaxa.jp/app/pdap/selene/ (fetched; October 2026 suspension notice). Official archive.
33. [S33] ISAS/JAXA, "Guidelines for the Use of Contents of this Website". https://www.isas.jaxa.jp/en/imagepolicy/. Official policy (via search).
34. [S34] Poly Haven, "License". https://polyhaven.com/license. Official license page.
35. [S35] ambientCG Docs, "License". https://docs.ambientcg.com/license/. Official license page.
36. [S36] Kenney, "Support" (FAQ). https://kenney.nl/support. Official FAQ.
37. [S37] Quaternius, "License" (Quaternius Asset License v1.0). https://quaternius.com/license.html. Official license page.
38. [S38] Quaternius, home page (lists Universal Animation Library 1 and 2). https://quaternius.com/. Official site.
39. [S39] Adobe Help, "Mixamo | Common questions". https://helpx.adobe.com/creative-cloud/faq/mixamo-faq.html (HTTP 403 to fetcher; regional copy https://helpx.adobe.com/gr_en/creative-cloud/faq/mixamo-faq.html). Official FAQ (via search).
40. [S40] Adobe Community, "Mixamo FAQ: Licensing, Royalties, Ownership, EULA and TOS" (pinned, 2022). https://community.adobe.com/t5/mixamo-discussions/mixamo-faq-licensing-royalties-ownership-eula-and-tos/td-p/13234775. Vendor community FAQ (via search).
41. [S41] CMU Graphics Lab Motion Capture Database. http://mocap.cs.cmu.edu/. Official site; TLS certificate error to fetcher, wording from mirrored copies (via search).
42. [S42] 4TU.ResearchData, "FBX Conversion Of The CMU Graphics Lab Motion Capture Database". https://data.4tu.nl/datasets/0448aab2-3332-449f-a8e2-d208cb58c7df. Dataset record (via search).
43. [S43] Freesound, "Help / FAQ" (and Freesound forum moderator posts). https://freesound.org/help/faq/. Official FAQ; TLS error to fetcher (via search).
44. [S45] Sonniss, "GDC Game Audio Bundle License". https://sonniss.com/gdc-bundle-license/. Official license.
45. [S46] Pixabay, "Content License Summary". https://pixabay.com/service/license-summary/. Official license summary.
46. [S47] Google Fonts, "Frequently Asked Questions". https://developers.google.com/fonts/faq. Official FAQ (via search).
47. [S48] Icon license listings: Iconify icon sets (https://icon-sets.iconify.design/), composables.com Phosphor page (https://composables.com/icons/icon-libraries/phosphor), and a DEV comparison (https://dev.to/svgicons/lucide-vs-tabler-vs-phosphor-which-free-icon-set-fits-your-ui-4ocl). Secondary (via search).
48. [S49] GitHub Docs, "Git Large File Storage" billing. https://docs.github.com/en/billing/concepts/product-billing/git-lfs. Official docs.
49. [S50] GitHub Docs, "About large files on GitHub". https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github. Official docs.
50. [S51] Vercel Docs, "Git settings" (last_updated 2026-08-25). https://vercel.com/docs/project-configuration/git-settings. Official docs.
51. [S52] Vercel Changelog, "Git LFS support". https://vercel.com/changelog/git-lfs-support. Official changelog; linked from S51, not fetched.
52. [S53] Vercel Community, "Build fails with error cloning". https://community.vercel.com/t/build-fails-with-error-cloning/14590. Community forum (via search).
53. [S57] USGS Astrogeology, "Moon LRO LROC WAC Global Morphology Mosaic 100m". https://astrogeology.usgs.gov/search/map/moon_lro_lroc_wac_global_morphology_mosaic_100m. Official product page (via search; 5.5 GB external file size).

*(Source IDs S44, S54–S56 are intentionally unused.)*
