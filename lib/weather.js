// Nashville weather from Open-Meteo (free, no key).
import { env } from './core.js';

const CODES = { 0: 'Clear', 1: 'Mostly sunny', 2: 'Partly cloudy', 3: 'Cloudy', 45: 'Foggy', 48: 'Foggy', 51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle', 61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 66: 'Freezing rain', 67: 'Freezing rain', 71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains', 80: 'Showers', 81: 'Showers', 82: 'Heavy showers', 85: 'Snow showers', 86: 'Snow showers', 95: 'Thunderstorms', 96: 'Thunderstorms', 99: 'Thunderstorms' };
const wet = c => c >= 51;

export async function weather() {
  const lat = env('ETHER_LAT', '36.1627'), lon = env('ETHER_LON', '-86.7816');
  const q = new URLSearchParams({ latitude: lat, longitude: lon, current: 'temperature_2m,weather_code', daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max', temperature_unit: 'fahrenheit', timezone: env('ETHER_TZ', 'America/Chicago'), forecast_days: '3' });
  const r = await fetch('https://api.open-meteo.com/v1/forecast?' + q);
  if (!r.ok) throw new Error('weather ' + r.status);
  const j = await r.json();
  const d = j.daily, c = j.current;
  const todayCode = d.weather_code[0], rainPct = d.precipitation_probability_max[0];
  let summary = CODES[todayCode] || '';
  if (rainPct >= 50 && !wet(todayCode)) summary += ` · ${rainPct}% chance of rain`;
  else if (!wet(todayCode) && wet(d.weather_code[1]) && d.precipitation_probability_max[1] >= 50) summary += ' · rain tomorrow';
  return { now: Math.round(c.temperature_2m) + '°', summary, high: Math.round(d.temperature_2m_max[0]) + '°', low: Math.round(d.temperature_2m_min[0]) + '°', rainPct };
}
