// Starting points with known coordinates, so auto-planning works without a geocoding API.
// Replace with a places/geocoding search (Mapbox, Google Places, Nominatim) later.
export type City = { name: string; lat: number; lng: number };

export const START_CITIES: City[] = [
  { name: "Hyderabad", lat: 17.385, lng: 78.4867 },
  { name: "Vijayawada", lat: 16.5062, lng: 80.648 },
  { name: "Visakhapatnam", lat: 17.6868, lng: 83.2185 },
  { name: "Bengaluru", lat: 12.9716, lng: 77.5946 },
  { name: "Chennai", lat: 13.0827, lng: 80.2707 },
  { name: "Mumbai", lat: 19.076, lng: 72.8777 },
  { name: "Pune", lat: 18.5204, lng: 73.8567 },
  { name: "Delhi", lat: 28.6139, lng: 77.209 },
  { name: "Kolkata", lat: 22.5726, lng: 88.3639 },
  { name: "Ahmedabad", lat: 23.0225, lng: 72.5714 },
  { name: "Jaipur", lat: 26.9124, lng: 75.7873 },
  { name: "Kochi", lat: 9.9312, lng: 76.2673 },
];
