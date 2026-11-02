/** Like `Promise.all(items.map(fn))`, but one item at a time, in order. */
export async function mapSeries<T, R>(items: readonly T[], fn: (item: T, index: number) => Promise<R> | R): Promise<R[]> {
  const out: R[] = [];
  for (const [index, item] of items.entries()) out.push(await fn(item, index));
  return out;
}

/** Like `items.filter(fn)` for an async test, checked one item at a time. */
export async function filterSeries<T>(items: readonly T[], fn: (item: T, index: number) => Promise<boolean> | boolean): Promise<T[]> {
  const out: T[] = [];
  for (const [index, item] of items.entries()) if (await fn(item, index)) out.push(item);
  return out;
}
