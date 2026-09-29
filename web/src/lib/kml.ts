import type { Site } from "./types";

const esc = (s: string) => s.replace(/[<>&'"]/g, (c) => `&#${c.charCodeAt(0)};`);

/** The site boundary as KML (the format the Green Credit Programme asks for with each land parcel). */
export function downloadSiteKml(site: Site, projectName: string) {
  const ring = [...site.boundary, site.boundary[0]].map(([lat, lng]) => `${lng},${lat},0`).join(" ");
  const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${esc(projectName)}</name>
    <Placemark>
      <name>${esc(site.name)}</name>
      <description>${esc(`${site.kind} site, ${site.metrics.boundary_ha} ha`)}</description>
      <Polygon><outerBoundaryIs><LinearRing><coordinates>${ring}</coordinates></LinearRing></outerBoundaryIs></Polygon>
    </Placemark>
  </Document>
</kml>
`;
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([kml], { type: "application/vnd.google-earth.kml+xml" }));
  link.download = `${site.name.replace(/[^\w-]+/g, "_")}.kml`;
  link.click();
  // Revoking straight away can cancel the download in some browsers.
  window.setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
}
