export function nowIso() {
  return new Date().toISOString();
}

export function dateId(date = new Date()) {
  return date.toISOString().slice(0, 10);
}
