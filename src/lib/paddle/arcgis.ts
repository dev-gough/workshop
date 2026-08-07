/**
 * Minimal client for Ontario's LIO ArcGIS REST services (the open-data
 * MapServers behind GeoHub). Hard-won specifics from the Phase-0 spike:
 *   * deep `resultOffset` paging starts 500ing around 50k records, so
 *     pagination is keyset (`OBJECTID > last` + orderBy) instead;
 *   * the server freely returns short pages below resultRecordCount, so a
 *     short page never means "done" — only an empty one does;
 *   * `UPPER()` in where clauses 500s on these layers.
 */

const LIO = 'https://ws.lioservices.lrc.gov.on.ca/arcgis1071a/rest/services/LIO_OPEN_DATA';

export const LAYERS = {
  otnSegment: `${LIO}/LIO_Open04/MapServer/19`,
  otnAccessPoint: `${LIO}/LIO_Open04/MapServer/20`,
  ohnWaterbody: `${LIO}/LIO_Open01/MapServer/25`,
  ohnWatercourse: `${LIO}/LIO_Open01/MapServer/26`,
};

export interface EsriFeature {
  attributes: Record<string, unknown>;
  geometry?: { paths?: number[][][]; rings?: number[][][]; x?: number; y?: number };
}

export interface FetchLayerOptions {
  layerUrl: string;
  where?: string;
  /** [w, s, e, n] lon/lat envelope filter. */
  bbox?: [number, number, number, number];
  outFields: string;
  /** Degrees of allowed generalization (~0.00005 ≈ 5 m). Omit for full res. */
  maxAllowableOffset?: number;
  pageSize?: number;
  log?: (msg: string) => void;
}

async function queryPage(url: string, retries = 5): Promise<{ features: EsriFeature[] }> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(300_000) });
      const data = await res.json();
      if (data.error) throw new Error(`arcgis: ${JSON.stringify(data.error)}`);
      return data;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 5_000 * (attempt + 1)));
    }
  }
  throw lastErr;
}

/** Fetch every feature matching the query, keyset-paged on OBJECTID. */
export async function fetchLayer(opts: FetchLayerOptions): Promise<EsriFeature[]> {
  const features: EsriFeature[] = [];
  let lastOid = 0;
  let page = opts.pageSize ?? 1000;
  for (;;) {
    const params = new URLSearchParams({
      where: opts.where ? `(${opts.where}) AND OBJECTID > ${lastOid}` : `OBJECTID > ${lastOid}`,
      outFields: `OBJECTID,${opts.outFields}`,
      returnGeometry: 'true',
      outSR: '4326',
      geometryPrecision: '6',
      resultRecordCount: String(page),
      orderByFields: 'OBJECTID',
      f: 'json',
    });
    if (opts.bbox) {
      params.set('geometry', opts.bbox.join(','));
      params.set('geometryType', 'esriGeometryEnvelope');
      params.set('inSR', '4326');
      params.set('spatialRel', 'esriSpatialRelIntersects');
    }
    if (opts.maxAllowableOffset) params.set('maxAllowableOffset', String(opts.maxAllowableOffset));

    let data: { features: EsriFeature[] };
    try {
      data = await queryPage(`${opts.layerUrl}/query?${params}`);
    } catch (err) {
      if (page > 125) {
        page = Math.floor(page / 2); // some offsets 500 on big pages; shrink and retry
        continue;
      }
      throw err;
    }
    const got = data.features ?? [];
    if (got.length === 0) break;
    features.push(...got);
    lastOid = got[got.length - 1].attributes.OBJECTID as number;
    opts.log?.(`  ${opts.layerUrl.split('/').slice(-2).join('/')}: ${features.length} features`);
  }
  return features;
}
