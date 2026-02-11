export async function createDeterministicIdentityId(personName: string, fileDataUrl: string): Promise<string> {
  const normalized = `${personName.trim().toLowerCase()}|${fileDataUrl.slice(0, 2048)}`;
  const encoded = new TextEncoder().encode(normalized);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  const hashArray = Array.from(new Uint8Array(digest));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 20);
}
