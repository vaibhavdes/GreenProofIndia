import L from "leaflet";
import { useEffect } from "react";
import { CircleMarker, LayersControl, MapContainer, Polygon, Polyline, TileLayer, Tooltip, useMap, useMapEvents } from "react-leaflet";
import { gradeStyle } from "../lib/format";
import type { Evidence, LatLng, Measurement, Site } from "../lib/types";

const INDIA: LatLng = [20.59, 78.96];

function FitTo({ points }: { points: LatLng[] }) {
  const map = useMap();
  const key = points.map((p) => p.join(",")).join(";");
  useEffect(() => {
    if (points.length === 1) map.setView(points[0], 16);
    else if (points.length > 1) map.fitBounds(L.latLngBounds(points), { padding: [30, 30], maxZoom: 17 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return null;
}

function FlyTo({ target }: { target?: LatLng | null }) {
  const map = useMap();
  useEffect(() => {
    if (target) map.flyTo(target, 16);
  }, [map, target]);
  return null;
}

function DrawClicks({ onAdd }: { onAdd: (p: LatLng) => void }) {
  useMapEvents({ click: (e) => onAdd([+e.latlng.lat.toFixed(6), +e.latlng.lng.toFixed(6)]) });
  return null;
}

export default function SiteMap({
  sites,
  evidence = [],
  measurements = [],
  drawing,
  onDrawAdd,
  onEvidenceClick,
  focusSiteId,
  flyTo,
  height = 420,
}: {
  sites: Site[];
  evidence?: Evidence[];
  measurements?: Measurement[];
  drawing?: LatLng[] | null;
  onDrawAdd?: (p: LatLng) => void;
  onEvidenceClick?: (ev: Evidence) => void;
  focusSiteId?: string | null;
  flyTo?: LatLng | null;
  height?: number;
}) {
  const located = evidence.filter((e) => e.status === "ready" && e.exif?.lat != null);
  const focus = sites.find((s) => s.id === focusSiteId);
  const fitPoints: LatLng[] = drawing?.length
    ? drawing
    : focus?.boundary.length
      ? focus.boundary
      : [...sites.flatMap((s) => s.boundary), ...located.map((e) => [e.exif!.lat!, e.exif!.lng!] as LatLng)];

  return (
    <div className="overflow-hidden rounded-xl ring-1 ring-stone-200" style={{ height }}>
      <MapContainer center={INDIA} zoom={5} style={{ height: "100%", width: "100%" }} scrollWheelZoom>
        <LayersControl position="topright">
          <LayersControl.BaseLayer checked name="Satellite">
            <TileLayer
              url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
              attribution="Imagery © Esri, Maxar, Earthstar Geographics"
              maxZoom={19}
            />
          </LayersControl.BaseLayer>
          <LayersControl.BaseLayer name="Map">
            <TileLayer url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="© OpenStreetMap contributors" maxZoom={19} />
          </LayersControl.BaseLayer>
        </LayersControl>
        <FitTo points={fitPoints} />
        <FlyTo target={flyTo} />
        {sites.map((s) =>
          s.boundary.length >= 3 ? (
            <Polygon
              key={s.id}
              positions={s.boundary}
              pathOptions={{ color: s.kind === "lake" ? "#38bdf8" : "#4ade80", weight: s.id === focusSiteId ? 4 : 2, fillOpacity: 0.12 }}
            >
              <Tooltip sticky>
                {s.name} · {s.metrics.boundary_ha} ha
              </Tooltip>
            </Polygon>
          ) : null,
        )}
        {measurements
          .filter((m) => m.water_polygon && m.water_polygon.length >= 3)
          .map((m) => (
            <Polygon key={m.id} positions={m.water_polygon!} pathOptions={{ color: "#0369a1", weight: 1, dashArray: "4 4", fillOpacity: 0.25 }}>
              <Tooltip sticky>
                Water spread {m.date}: {m.water_area_ha} ha
              </Tooltip>
            </Polygon>
          ))}
        {located.map((e) => (
          <CircleMarker
            key={e.id}
            center={[e.exif!.lat!, e.exif!.lng!]}
            radius={6}
            pathOptions={{ color: "#fff", weight: 2, fillColor: e.proof ? gradeStyle[e.proof.grade].ring : "#78716c", fillOpacity: 1 }}
            eventHandlers={{ click: () => onEvidenceClick?.(e) }}
          >
            <Tooltip>
              {e.caption ?? e.public_id} {e.proof ? `· ${e.proof.score}/100` : ""}
            </Tooltip>
          </CircleMarker>
        ))}
        {drawing && onDrawAdd && <DrawClicks onAdd={onDrawAdd} />}
        {drawing && drawing.length > 0 && (
          <>
            <Polyline positions={drawing.length >= 3 ? [...drawing, drawing[0]] : drawing} pathOptions={{ color: "#facc15", weight: 3 }} />
            {drawing.map((p, i) => (
              <CircleMarker key={i} center={p} radius={4} pathOptions={{ color: "#facc15", fillOpacity: 1 }} />
            ))}
          </>
        )}
      </MapContainer>
    </div>
  );
}
