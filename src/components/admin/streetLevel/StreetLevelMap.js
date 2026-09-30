import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const OSM_TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors';

const POINT_STYLE = { radius: 5, color: '#1565c0', weight: 1.5, fillColor: '#42a5f5', fillOpacity: 0.85 };
const SELECTED_STYLE = { radius: 7, color: '#e65100', weight: 2, fillColor: '#ff9800', fillOpacity: 0.95 };
const DRAFT_STYLE = { color: '#d81b60', weight: 3, dashArray: '6 4' };

function headingTip(p) {
  if (p.heading == null) return null;
  const len = 0.00018;
  const rad = (p.heading * Math.PI) / 180;
  return [p.lat + len * Math.cos(rad), p.lng + (len * Math.sin(rad)) / Math.max(0.2, Math.cos((p.lat * Math.PI) / 180))];
}

/**
 * Platform-owned OpenStreetMap (Leaflet). No Google content is displayed here.
 * Stateless about drawing: the parent owns `draft` vertices and reacts to clicks.
 */
export default function StreetLevelMap({
  points = [],
  selectedIds = [],
  draft = null,
  initialView,
  onMapClick,
  onPointClick,
  onViewChange,
  fitKey,
  height = '100%',
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const pointLayerRef = useRef(null);
  const draftLayerRef = useRef(null);
  const handlersRef = useRef({});
  handlersRef.current = { onMapClick, onPointClick, onViewChange };

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return undefined;
    const map = L.map(containerRef.current, {
      center: [initialView?.lat ?? 1.2966, initialView?.lng ?? 103.7764],
      zoom: initialView?.zoom ?? 15,
      zoomControl: true,
    });
    L.tileLayer(OSM_TILES, { maxZoom: 19, attribution: OSM_ATTRIBUTION }).addTo(map);
    pointLayerRef.current = L.layerGroup().addTo(map);
    draftLayerRef.current = L.layerGroup().addTo(map);
    const emitView = () => {
      const c = map.getCenter();
      handlersRef.current.onViewChange?.({ lat: c.lat, lng: c.lng, zoom: map.getZoom() });
    };
    map.on('click', (e) => handlersRef.current.onMapClick?.({ lat: e.latlng.lat, lng: e.latlng.lng }));
    map.on('moveend', emitView);
    emitView();
    mapRef.current = map;
    const resize = new ResizeObserver(() => map.invalidateSize());
    resize.observe(containerRef.current);
    return () => {
      resize.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const layer = pointLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    const selected = new Set(selectedIds);
    points.forEach((p) => {
      const isSel = selected.has(p.id);
      const tip = headingTip(p);
      if (tip) L.polyline([[p.lat, p.lng], tip], { color: isSel ? '#e65100' : '#1565c0', weight: 2 }).addTo(layer);
      const marker = L.circleMarker([p.lat, p.lng], isSel ? SELECTED_STYLE : POINT_STYLE).addTo(layer);
      marker.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        handlersRef.current.onPointClick?.(p.id, e.originalEvent);
      });
      if (p.label) marker.bindTooltip(p.label);
    });
  }, [points, selectedIds]);

  useEffect(() => {
    const layer = draftLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    if (!draft?.vertices?.length) return;
    const latlngs = draft.vertices.map((v) => [v.lat, v.lng]);
    if (draft.kind === 'grid' && latlngs.length === 2) {
      L.rectangle(latlngs, { ...DRAFT_STYLE, fillOpacity: 0.08 }).addTo(layer);
    } else if (draft.kind === 'area' && latlngs.length >= 3) {
      L.polygon(latlngs, { ...DRAFT_STYLE, fillOpacity: 0.08 }).addTo(layer);
    } else if (latlngs.length >= 2) {
      L.polyline(latlngs, DRAFT_STYLE).addTo(layer);
    }
    latlngs.forEach((ll) => L.circleMarker(ll, { radius: 4, color: '#d81b60', fillOpacity: 1 }).addTo(layer));
    (draft.preview || []).forEach((p) => L.circleMarker([p.lat, p.lng], { radius: 3, color: '#8e24aa', weight: 1, fillOpacity: 0.6 }).addTo(layer));
  }, [draft]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !fitKey || !points.length) return;
    const bounds = L.latLngBounds(points.map((p) => [p.lat, p.lng]));
    map.fitBounds(bounds.pad(0.2), { maxZoom: 18 });
  }, [fitKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={containerRef} data-testid="street-level-map" style={{ width: '100%', height, minHeight: 320 }} />;
}
