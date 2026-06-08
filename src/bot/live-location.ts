/**
 * Live location state manager with motion tracking.
 * Tracks active live location sharing per Telegram user.
 * Calculates speed, dwell time, and direction of movement.
 */

export interface GeoPoint {
  latitude: number;
  longitude: number;
  timestamp: number;
}

export interface LiveLocationState {
  latitude: number;
  longitude: number;
  livePeriod: number;
  updatedAt: number;
  timezone?: string;
  utcOffset?: number;
  history: GeoPoint[];
  prevPoint?: GeoPoint;
  speedKmh?: number;
  bearing?: number;
  dwellStartedAt?: number;
}

const liveLocations = new Map<number, LiveLocationState>();

const DWELL_RADIUS_M = 50;
const HISTORY_MAX = 20;
const MIN_MOVEMENT_M = 3; // minimum distance to count as "moving"

function haversineDistance(
  lat1: number, lon1: number,
  lat2: number, lon2: number,
): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function calculateBearing(
  lat1: number, lon1: number,
  lat2: number, lon2: number,
): number {
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const y = Math.sin(dLon) * Math.cos((lat2 * Math.PI) / 180);
  const x =
    Math.cos((lat1 * Math.PI) / 180) * Math.sin((lat2 * Math.PI) / 180) -
    Math.sin((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.cos(dLon);
  const brng = (Math.atan2(y, x) * 180) / Math.PI;
  return (brng + 360) % 360;
}

function bearingToCardinal(degrees: number): string {
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const idx = Math.round(degrees / 45) % 8;
  return dirs[idx];
}

export function bearingToDirection(degrees: number | undefined): string | undefined {
  if (degrees === undefined) return undefined;
  const card = bearingToCardinal(degrees);
  return `${degrees.toFixed(1)}° (${card})`;
}

export function updateLiveLocation(
  userId: number,
  latitude: number,
  longitude: number,
  livePeriod: number,
  timezone?: string,
  utcOffset?: number,
): void {
  const now = Date.now();
  const existing = liveLocations.get(userId);
  const point: GeoPoint = { latitude, longitude, timestamp: now };

  const history = existing?.history ?? [];
  history.push(point);
  if (history.length > HISTORY_MAX) history.shift();

  const prevPoint = existing
    ? { latitude: existing.latitude, longitude: existing.longitude, timestamp: existing.updatedAt }
    : undefined;

  // Calculate speed
  let speedKmh: number | undefined;
  if (prevPoint) {
    const dist = haversineDistance(prevPoint.latitude, prevPoint.longitude, latitude, longitude);
    const dtSec = (now - prevPoint.timestamp) / 1000;
    if (dtSec > 0) {
      speedKmh = (dist / dtSec) * 3.6;
    }
  }

  // Calculate bearing
  let bearing: number | undefined;
  if (prevPoint) {
    const dist = haversineDistance(prevPoint.latitude, prevPoint.longitude, latitude, longitude);
    if (dist >= MIN_MOVEMENT_M) {
      bearing = calculateBearing(prevPoint.latitude, prevPoint.longitude, latitude, longitude);
    } else if (existing?.bearing !== undefined) {
      bearing = existing.bearing;
    }
  } else {
    bearing = existing?.bearing;
  }

  // Calculate dwell time
  let dwellStartedAt = existing?.dwellStartedAt;
  if (prevPoint) {
    const dist = haversineDistance(prevPoint.latitude, prevPoint.longitude, latitude, longitude);
    if (dist < DWELL_RADIUS_M) {
      if (!dwellStartedAt) {
        dwellStartedAt = prevPoint.timestamp;
      }
    } else {
      dwellStartedAt = undefined;
    }
  }

  // Average speed over recent history (for smoother readings)
  const avgSpeed = calcAverageSpeed(history);

  liveLocations.set(userId, {
    latitude,
    longitude,
    livePeriod,
    updatedAt: now,
    timezone: timezone ?? existing?.timezone,
    utcOffset: utcOffset ?? existing?.utcOffset,
    history,
    prevPoint,
    speedKmh: avgSpeed ?? speedKmh,
    bearing,
    dwellStartedAt,
  });
}

function calcAverageSpeed(history: GeoPoint[]): number | undefined {
  if (history.length < 2) return undefined;
  let totalDist = 0;
  let totalTime = 0;
  for (let i = 1; i < history.length; i++) {
    const a = history[i - 1];
    const b = history[i];
    totalDist += haversineDistance(a.latitude, a.longitude, b.latitude, b.longitude);
    totalTime += (b.timestamp - a.timestamp) / 1000;
  }
  if (totalTime <= 0) return undefined;
  return (totalDist / totalTime) * 3.6;
}

export function getLiveLocation(userId: number): LiveLocationState | undefined {
  const state = liveLocations.get(userId);
  if (!state) return undefined;

  const elapsed = (Date.now() - state.updatedAt) / 1000;
  if (elapsed > state.livePeriod * 2) {
    liveLocations.delete(userId);
    return undefined;
  }

  return state;
}

export function deleteLiveLocation(userId: number): void {
  liveLocations.delete(userId);
}

export function isLiveLocationActive(userId: number): boolean {
  return getLiveLocation(userId) !== undefined;
}

export function formatLiveLocationTag(userId: number): string | undefined {
  const state = getLiveLocation(userId);
  if (!state) return undefined;

  const lat = state.latitude.toFixed(6);
  const lon = state.longitude.toFixed(6);
  return `[location=${lat},${lon}]`;
}

export function formatMovementTag(userId: number): string | undefined {
  const state = getLiveLocation(userId);
  if (!state) return undefined;

  const parts: string[] = [];

  if (state.speedKmh !== undefined) {
    parts.push(`speed=${state.speedKmh.toFixed(1)}km/h`);
  }

  if (state.bearing !== undefined) {
    parts.push(`heading=${bearingToDirection(state.bearing)}`);
  }

  if (state.dwellStartedAt !== undefined) {
    const dwellSec = Math.round((Date.now() - state.dwellStartedAt) / 1000);
    const mins = Math.floor(dwellSec / 60);
    const secs = dwellSec % 60;
    parts.push(`dwell=${mins}m${secs}s`);
  }

  return parts.length > 0 ? `[movement: ${parts.join(", ")}]` : undefined;
}

export function getLiveLocationTimezone(userId: number): { timezone?: string; utcOffset?: number } {
  const state = getLiveLocation(userId);
  return {
    timezone: state?.timezone,
    utcOffset: state?.utcOffset,
  };
}

export function clearAllLiveLocations(): void {
  liveLocations.clear();
}
