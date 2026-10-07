// Google Maps links stay first-class: the intelligent map COMPLEMENTS them, it does not replace them.
export const googleMapsPlace = (p: { lat: number; lng: number }) => `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`;
export const googleMapsDirections = (p: { lat: number; lng: number }) => `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}&travelmode=driving`;
