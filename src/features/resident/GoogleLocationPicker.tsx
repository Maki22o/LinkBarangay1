import { useEffect, useRef, useState } from "react"
import { Icon } from "@/components/common/Icon"
import { Notice } from "@/components/common/States"

declare global { interface Window { google?: any } }

export interface RequestLocation {
  address: string
  latitude: number
  longitude: number
  barangay: string
  city: string
  province: string
}

let mapsLoader: Promise<void> | null = null

function loadMaps(key: string) {
  if (window.google?.maps?.places) return Promise.resolve()
  if (mapsLoader) return mapsLoader
  mapsLoader = new Promise((resolve, reject) => {
    const script = document.createElement("script")
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&libraries=places`
    script.async = true
    script.onload = () => window.google?.maps?.places ? resolve() : reject(new Error("Google Maps did not load correctly."))
    script.onerror = () => reject(new Error("Google Maps could not be loaded. Check your connection and API key restrictions."))
    document.head.appendChild(script)
  })
  return mapsLoader
}

function component(components: any[], type: string) {
  return components.find((item) => item.types?.includes(type))?.long_name ?? ""
}

export function GoogleLocationPicker({ value, onChange }: { value: RequestLocation | null; onChange: (value: RequestLocation | null) => void }) {
  const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined
  const mapNode = useRef<HTMLDivElement>(null)
  const searchNode = useRef<HTMLInputElement>(null)
  const mapRef = useRef<any>(null)
  const markerRef = useRef<any>(null)
  const geocoderRef = useRef<any>(null)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!key || !mapNode.current || !searchNode.current) return
    let cancelled = false
    void loadMaps(key).then(() => {
      if (cancelled || !window.google) return
      const google = window.google
      const initial = value ? { lat: value.latitude, lng: value.longitude } : { lat: 14.5995, lng: 120.9842 }
      const map = new google.maps.Map(mapNode.current, { center: initial, zoom: value ? 17 : 12, mapTypeControl: false, streetViewControl: false })
      const marker = new google.maps.Marker({ map, position: value ? initial : null, draggable: true })
      mapRef.current = map; markerRef.current = marker; geocoderRef.current = new google.maps.Geocoder()
      const applyPlace = (place: any, fallbackPosition?: any) => {
        const location = place?.geometry?.location ?? fallbackPosition
        if (!location) return
        const latitude = typeof location.lat === "function" ? location.lat() : location.lat
        const longitude = typeof location.lng === "function" ? location.lng() : location.lng
        const address = place?.formatted_address ?? searchNode.current?.value ?? "Selected map location"
        const parts = place?.address_components ?? []
        marker.setPosition({ lat: latitude, lng: longitude }); map.panTo({ lat: latitude, lng: longitude }); map.setZoom(17)
        onChange({ address, latitude, longitude, barangay: component(parts, "sublocality_level_1") || component(parts, "sublocality"), city: component(parts, "locality") || component(parts, "administrative_area_level_2"), province: component(parts, "administrative_area_level_1") })
      }
      const reverse = (position: any) => geocoderRef.current.geocode({ location: position }).then((result: any) => {
        const found = result.results?.[0]
        if (found) { searchNode.current!.value = found.formatted_address; applyPlace(found, position) }
        else setError("We could not determine an address for that pin. Search for a complete address instead.")
      }).catch(() => setError("Address lookup failed. Search for the complete address and try again."))
      const autocomplete = new google.maps.places.Autocomplete(searchNode.current, { fields: ["geometry", "formatted_address", "address_components"], componentRestrictions: { country: "ph" } })
      autocomplete.addListener("place_changed", () => { const place = autocomplete.getPlace(); if (!place.geometry) { setError("Select an address from the suggestions."); return }; setError(null); applyPlace(place) })
      map.addListener("click", (event: any) => { setError(null); void reverse(event.latLng) })
      marker.addListener("dragend", (event: any) => { setError(null); void reverse(event.latLng) })
      setReady(true)
    }).catch((reason: Error) => { if (!cancelled) setError(reason.message) })
    return () => { cancelled = true }
  }, [key])

  if (!key) return <Notice tone="warning">Google Maps is not configured. Add a browser-restricted <code>VITE_GOOGLE_MAPS_API_KEY</code> to <code>.env.local</code>, then restart the app. The API key must enable Maps JavaScript, Places, and Geocoding APIs.</Notice>

  return <div className="map-picker">
    <label className="map-search-input"><Icon name="search" size={16} /><input ref={searchNode} placeholder="Search for a complete address or location..." aria-label="Search location" /></label>
    <div ref={mapNode} className="google-map" aria-label="Interactive Google map" />
    {!ready && !error && <p className="muted-note">Loading interactive map…</p>}
    {error && <Notice tone="warning">{error}</Notice>}
    {value && <div className="location-summary">
      <strong>Selected location</strong><span>{value.address}</span>
      <small>Barangay: {value.barangay || "—"} · City/Municipality: {value.city || "—"} · Province: {value.province || "—"}</small>
      <small>Latitude: {value.latitude.toFixed(6)} · Longitude: {value.longitude.toFixed(6)}</small>
    </div>}
  </div>
}
