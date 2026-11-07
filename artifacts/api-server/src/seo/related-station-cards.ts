import { pgSeoCatalog } from '../data/postgres-seo-read-store';

export async function relatedStationCards(kind: 'country' | 'state' | 'publisher', value: string, selfId: unknown, limit: number) {
  if (!value) return [];
  const scope = kind === 'publisher'
    ? { name: { $regex: `^${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}` } }
    : { [kind]: value };
  // Exclude the current station after the shared read so different station
  // pages and languages can reuse the same bounded, health-aware producer.
  const cards = await pgSeoCatalog().find({
    noIndex: { $ne: true }, isListVisible: true,
    $and: [{ $or: [{ isJunk: { $exists: false } }, { isJunk: { $ne: true } }] }],
    ...scope,
  }, {
    fields: ['name', 'slug', 'favicon', 'logoAssets', 'country', 'countryCode', 'tags', 'votes'],
    sort: { votes: -1 }, limit: limit + 1,
    sharedCardsKey: JSON.stringify(['related-v1', kind, value, limit]),
  });
  return cards.filter(card => card._id !== selfId).slice(0, limit);
}
