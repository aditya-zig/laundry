import L from "leaflet";
import "leaflet/dist/leaflet.css";

export type MarkerKind = "facility" | "customer" | "rider" | "stop";

export interface MarkerSpec {
  lat: number;
  lng: number;
  label: string;
  kind: MarkerKind;
  /** The order this marker stands for. Only one pin per kind is on screen at
   * a time, but tests and screen readers target one marker exactly instead
   * of guessing which pin belongs to which order. */
  orderId?: string;
  /** A stale report is drawn hollow so nobody reads it as live tracking. */
  stale?: boolean;
}

const COLORS: Record<MarkerKind, string> = {
  facility: "#141414",
  customer: "#1D5FBF",
  rider: "#C4242A",
  stop: "#5F6368",
};

/** Leaflet map for the pilot console. Circle markers keep the bundle free of
 * icon image assets, and every marker carries the label it stands for. */
export class PilotMap {
  private readonly map: L.Map;
  private readonly layer = L.layerGroup();
  private tileFailed = false;

  constructor(container: HTMLElement, center: [number, number]) {
    this.map = L.map(container, { zoomControl: true }).setView(center, 14);
    const tiles = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors",
    });
    tiles.on("tileerror", () => {
      if (this.tileFailed) return;
      this.tileFailed = true;
      this.onTileFailure?.();
    });
    tiles.addTo(this.map);
    this.layer.addTo(this.map);
    // The console renders inside a panel that appears after the map is built.
    setTimeout(() => this.map.invalidateSize(), 50);
  }

  onTileFailure: (() => void) | undefined;

  setMarkers(markers: MarkerSpec[]): void {
    this.layer.clearLayers();
    for (const marker of markers) {
      const color = COLORS[marker.kind];
      const circle = L.circleMarker([marker.lat, marker.lng], {
        radius: 9,
        color,
        weight: marker.stale ? 2 : 3,
        opacity: 1,
        fillColor: color,
        fillOpacity: marker.stale ? 0.05 : 0.85,
        dashArray: marker.stale ? "3 3" : undefined,
      });
      // The label carries customer-supplied text (an address line), so it is
      // built as a text node. An HTML string here would run it as markup.
      const label = document.createElement("strong");
      label.textContent = marker.label;
      circle.bindPopup(label);
      circle.addTo(this.layer);
      const element = circle.getElement();
      if (element) {
        element.setAttribute("data-marker", marker.kind);
        if (marker.orderId) element.setAttribute("data-order-id", marker.orderId);
        element.setAttribute("aria-label", marker.label);
      }
    }
    const rider = markers.find((m) => m.kind === "rider");
    const customer = markers.find((m) => m.kind === "customer");
    if (rider && customer) {
      L.polyline(
        [
          [rider.lat, rider.lng],
          [customer.lat, customer.lng],
        ],
        { color: "#5F6368", weight: 2, dashArray: "6 6", opacity: 0.8 },
      ).addTo(this.layer);
    }
  }

  focus(markers: MarkerSpec[]): void {
    if (markers.length === 0) return;
    const bounds = L.latLngBounds(markers.map((m) => [m.lat, m.lng] as [number, number]));
    this.map.fitBounds(bounds.pad(0.25), { maxZoom: 16 });
  }

  invalidate(): void {
    this.map.invalidateSize();
  }
}
