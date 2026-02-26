/** Remap MongoDB _id to id for API responses (frontend expects `id`). */
export function toApiDoc<T extends { _id: string }>(doc: T): Omit<T, '_id'> & { id: string } {
  const { _id, ...rest } = doc;
  return { id: _id, ...rest } as Omit<T, '_id'> & { id: string };
}

/** Array version of toApiDoc. */
export function toApiDocs<T extends { _id: string }>(docs: T[]): (Omit<T, '_id'> & { id: string })[] {
  return docs.map(toApiDoc);
}
