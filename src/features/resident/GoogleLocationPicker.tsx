import { useEffect, useRef, useState } from "react"
import { Icon } from "@/components/common/Icon"
import { Button } from "@/components/common/ui"
import { Notice } from "@/components/common/States"

export interface RequestLocation { address: string; latitude: number | null; longitude: number | null; barangay: string; city: string; province: string; map_url: string }

function parts(row: any) { const a = row.address ?? {}; return { barangay: a.suburb ?? a.village ?? a.neighbourhood ?? "", city: a.city ?? a.town ?? a.municipality ?? "", province: a.state ?? a.province ?? "" } }

export function GoogleLocationPicker({ value, onChange }: { value: RequestLocation | null; onChange: (value: RequestLocation | null) => void }) {
  const watchRef = useRef<number | null>(null), lastReverseRef = useRef(0)
  const [address, setAddress] = useState(value?.address ?? ""), [mapUrl, setMapUrl] = useState(value?.map_url ?? ""), [searching, setSearching] = useState(false), [following, setFollowing] = useState(false), [error, setError] = useState<string | null>(null)
  const setPoint = (latitude: number, longitude: number, nextAddress = address, locationParts = { barangay: "", city: "", province: "" }) => {
    onChange({ address: nextAddress.trim() || "Selected map location", latitude, longitude, ...locationParts, map_url: mapUrl.trim() || `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}` })
  }
  const reverseLookup = async (latitude: number, longitude: number) => {
    // Public Nominatim must not be queried for every GPS tick. Keep at least
    // four seconds between address lookups while coordinates still update live.
    const now = Date.now()
    if (now - lastReverseRef.current < 4000) { setPoint(latitude, longitude); return }
    lastReverseRef.current = now
    try {
      const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&lat=${latitude}&lon=${longitude}`)
      if (!response.ok) throw new Error("Location details are temporarily unavailable.")
      const row = await response.json()
      const nextAddress = row.display_name ?? `Pinned location (${latitude.toFixed(6)}, ${longitude.toFixed(6)})`
      setAddress(nextAddress)
      setPoint(latitude, longitude, nextAddress, parts(row))
    } catch (reason) {
      setPoint(latitude, longitude)
      setError((reason as Error).message)
    }
  }
  useEffect(() => () => { if (watchRef.current != null) navigator.geolocation?.clearWatch(watchRef.current) }, [])
  const searchAddress = async () => {
    if (!address.trim()) { setError("Enter a complete address before searching."); return }
    setSearching(true); setError(null)
    try { const response = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=1&countrycodes=ph&q=${encodeURIComponent(address.trim())}`); if (!response.ok) throw new Error("Address search is temporarily unavailable."); const result = await response.json(); if (!result[0]) throw new Error("No matching address found. Try a more complete address or place the pin manually."); const row = result[0]; setAddress(row.display_name); setPoint(Number(row.lat), Number(row.lon), row.display_name, parts(row)) } catch (reason) { setError((reason as Error).message) } finally { setSearching(false) }
  }
  const useCurrentLocation = () => navigator.geolocation ? navigator.geolocation.getCurrentPosition((position) => { void reverseLookup(position.coords.latitude, position.coords.longitude) }, () => setError("We could not access your location. Allow location permission or place the pin manually."), { enableHighAccuracy: true, timeout: 12000, maximumAge: 5000 }) : setError("This browser does not support location access.")
  const toggleLiveLocation = () => {
    if (!navigator.geolocation) { setError("This browser does not support location access."); return }
    if (watchRef.current != null) { navigator.geolocation.clearWatch(watchRef.current); watchRef.current = null; setFollowing(false); return }
    setError(null)
    watchRef.current = navigator.geolocation.watchPosition(
      (position) => { void reverseLookup(position.coords.latitude, position.coords.longitude) },
      () => { setFollowing(false); watchRef.current = null; setError("Live location could not be started. Allow location permission or place the pin manually.") },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 3000 },
    )
    setFollowing(true)
  }
  const mapQuery = value?.latitude != null && value?.longitude != null ? `${value.latitude},${value.longitude}` : address.trim() || "Philippines"
  const googleMapEmbedUrl = `https://www.google.com/maps?q=${encodeURIComponent(mapQuery)}&z=${value?.latitude != null ? 17 : 6}&output=embed`
  return <div className="map-picker">
    <Notice tone="info">Search an address or use your current location to save exact coordinates. The Google Maps preview below lets you inspect the selected area without an API key.</Notice>
    <div className="map-search-row"><label className="map-search-input"><Icon name="search" size={16} /><input value={address} onChange={(event) => setAddress(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void searchAddress() } }} placeholder="Complete address of the concern" aria-label="Complete address" /></label><Button variant="secondary" disabled={searching} onClick={() => void searchAddress()}>{searching ? "Searching…" : "Find address"}</Button></div>
    <div className="map-actions"><Button variant="secondary" icon="pin" onClick={useCurrentLocation}>Use my current location</Button><Button variant={following ? "primary" : "secondary"} icon="route" onClick={toggleLiveLocation}>{following ? "Stop live location" : "Follow my live location"}</Button></div>
    <div className="google-map"><iframe title="Google Maps location preview" src={googleMapEmbedUrl} loading="lazy" referrerPolicy="no-referrer-when-downgrade" allowFullScreen /></div>
    <label className="map-search-input"><Icon name="route" size={16} /><input value={mapUrl} onChange={(event) => { setMapUrl(event.target.value); if (value) onChange({ ...value, map_url: event.target.value.trim() || `https://www.google.com/maps/search/?api=1&query=${value.latitude},${value.longitude}` }) }} placeholder="Optional: paste a Google Maps share link for directions" aria-label="Google Maps share link" /></label>
    {error && <Notice tone="warning">{error}</Notice>}
    {value && <div className="location-summary"><strong>Selected location</strong><span>{value.address}</span><small>Latitude: {value.latitude?.toFixed(6)} · Longitude: {value.longitude?.toFixed(6)}</small>{value.map_url && <a href={value.map_url} target="_blank" rel="noreferrer">Open in Google Maps <Icon name="arrow" size={13} /></a>}</div>}
  </div>
}
