export function normalizeText(value) {
  return (value || "").toLowerCase().trim();
}

export function tokenize(value) {
  return normalizeText(value).split(/[\s._-]+/).filter(Boolean);
}
