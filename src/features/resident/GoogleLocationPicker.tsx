import { useEffect, useRef, useState } from "react"
import { Icon } from "@/components/common/Icon"
import { Button } from "@/components/common/ui"
import { Notice } from "@/components/common/States"

export interface RequestLocation { address: string; latitude: number | null; longitude: number | null; barangay: string; city: string; province: string; map_url: string }
declare global { interface Window { L?: any } }
let leafletLoader: Promise<any> | null = null

function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L)
  if (leafletLoader) return leafletLoader
  leafletLoader = new Promise((resolve, reject) => {
    const css = document.createElement("link"); css.rel = "stylesheet"; css.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"; css.integrity = "sha256-p4NxAoJBhIINfQWQMyw2s5n8K0V4K0GfMdeF3M4hA+4="; css.crossOrigin = ""; document.head.appendChild(css)
    const script = document.createElement("script"); script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"; script.integrity = "sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo="; script.crossOrigin = ""; script.async = true
    script.onload = () => window.L ? resolve(window.L) : reject(new Error("The map library could not be loaded.")); script.onerror = () => reject(new Error("The map library could not be loaded. Check your internet connection.")); document.head.appendChild(script)
  })
  return leafletLoader
}

function parts(row: any) { const a = row.address ?? {}; return { barangay: a.suburb ?? a.village ?? a.neighbourhood ?? "", city: a.city ?? a.town ?? a.municipality ?? "", province: a.state ?? a.province ?? "" } }

export function GoogleLocationPicker({ value, onChange }: { value: RequestLocation | null; onChange: (value: RequestLocation | null) => void }) {
  const mapNode = useRef<HTMLDivElement>(null), mapRef = useRef<any>(null), markerRef = useRef<any>(null)
  const [address, setAddress] = useState(value?.address ?? ""), [mapUrl, setMapUrl] = useState(value?.map_url ?? ""), [searching, setSearching] = useState(false), [error, setError] = useState<string | null>(null)
  const setPoint = (latitude: number, longitude: number, nextAddress = address, locationParts = { barangay: "", city: "", province: "" }) => {
    const L = window.L; if (!L || !mapRef.current) return
    const point = L.latLng(latitude, longitude)
    if (!markerRef.current) { markerRef.current = L.marker(point, { draggable: true }).addTo(mapRef.current); markerRef.current.on("dragend", () => { const moved = markerRef.current.getLatLng(); setPoint(moved.lat, moved.lng) }) } else markerRef.current.setLatLng(point)
    mapRef.current.setView(point, 17); onChange({ address: nextAddress.trim() || "Pinned map location", latitude, longitude, ...locationParts, map_url: mapUrl.trim() || `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}` })
  }
  useEffect(() => {
    if (!mapNode.current) return
    let cancelled = false
    void loadLeaflet().then((L) => {
      if (cancelled || mapRef.current) return
      const hasPoint = value?.latitude != null && value?.longitude != null, point = hasPoint ? [value!.latitude, value!.longitude] : [14.5995, 120.9842]
      const map = L.map(mapNode.current, { scrollWheelZoom: true }).setView(point, hasPoint ? 17 : 12)
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; <a href=\"https://www.openstreetmap.org/copyright\" target=\"_blank\">OpenStreetMap</a> contributors" }).addTo(map)
      mapRef.current = map
      if (hasPoint) setPoint(value!.latitude!, value!.longitude!, value!.address, { barangay: value!.barangay, city: value!.city, province: value!.province })
      map.on("click", (event: any) => setPoint(event.latlng.lat, event.latlng.lng))
    }).catch((reason: Error) => { if (!cancelled) setError(reason.message) })
    return () => { cancelled = true; if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; markerRef.current = null } }
  }, [])
  const searchAddress = async () => {
    if (!address.trim()) { setError("Enter a complete address before searching."); return }
    setSearching(true); setError(null)
    try { const response = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=1&countrycodes=ph&q=${encodeURIComponent(address.trim())}`); if (!response.ok) throw new Error("Address search is temporarily unavailable."); const result = await response.json(); if (!result[0]) throw new Error("No matching address found. Try a more complete address or place the pin manually."); const row = result[0]; setAddress(row.display_name); setPoint(Number(row.lat), Number(row.lon), row.display_name, parts(row)) } catch (reason) { setError((reason as Error).message) } finally { setSearching(false) }
  }
  const useCurrentLocation = () => navigator.geolocation ? navigator.geolocation.getCurrentPosition((position) => setPoint(position.coords.latitude, position.coords.longitude), () => setError("We could not access your location. Allow location permission or place the pin manually."), { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 }) : setError("This browser does not support location access.")
  return <div className="map-picker">
    <Notice tone="info">Search an address, use your current location, or click and drag the pin. The map saves exact coordinates without a Google Maps API key.</Notice>
    <div className="map-search-row"><label className="map-search-input"><Icon name="search" size={16} /><input value={address} onChange={(event) => setAddress(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void searchAddress() } }} placeholder="Complete address of the concern" aria-label="Complete address" /></label><Button variant="secondary" disabled={searching} onClick={() => void searchAddress()}>{searching ? "Searching…" : "Find address"}</Button></div>
    <div className="map-actions"><Button variant="secondary" icon="pin" onClick={useCurrentLocation}>Use my current location</Button></div>
    <div ref={mapNode} className="openstreet-map" aria-label="Interactive map: click or drag marker to select location" />
    <label className="map-search-input"><Icon name="route" size={16} /><input value={mapUrl} onChange={(event) => { setMapUrl(event.target.value); if (value) onChange({ ...value, map_url: event.target.value.trim() || `https://www.google.com/maps/search/?api=1&query=${value.latitude},${value.longitude}` }) }} placeholder="Optional: paste a Google Maps share link for directions" aria-label="Google Maps share link" /></label>
    {error && <Notice tone="warning">{error}</Notice>}
    {value && <div className="location-summary"><strong>Selected location</strong><span>{value.address}</span><small>Latitude: {value.latitude?.toFixed(6)} · Longitude: {value.longitude?.toFixed(6)}</small>{value.map_url && <a href={value.map_url} target="_blank" rel="noreferrer">Open in Google Maps <Icon name="arrow" size={13} /></a>}</div>}
  </div>
}
