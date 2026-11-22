import { z } from 'zod';

// Shared schemas compile without browser or Node globals. Count UTF-8 bytes,
// including four-byte astral characters, to respect bcrypt's 72-byte limit.
const utf8Bytes = (value: string) => Array.from(value).reduce((bytes, character) => {
  const point = character.codePointAt(0)!;
  return bytes + (point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4);
}, 0);

const profilePreferencesSchema = z.object({
  profileGender: z.enum(['female', 'male', 'other', 'undisclosed']).optional(),
  profileCountryCode: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/).nullable().optional(),
  language: z.string().max(35).optional(), autoplay: z.boolean().optional(),
  playAtLogin: z.enum(['LAST_PLAYED', 'RANDOM', 'FAVORITE']).optional(),
}).passthrough().refine(value => JSON.stringify(value).length <= 4096, 'Preferences are too large');

export const profileFieldsSchema = z.object({
  fullName: z.string().trim().min(1).max(200).optional(),
  username: z.string().trim().toLowerCase().min(3).max(30).regex(/^[a-z0-9][a-z0-9_.-]*$/).optional(),
  email: z.string().trim().email().max(254).transform(value => value.toLowerCase()).optional(),
  avatar: z.string().max(2048).refine(value => !value || /^https?:\/\//i.test(value) || /^\/(?!\/)/.test(value), 'Invalid avatar URL').nullable().optional(),
  location: z.string().max(200).optional(), bio: z.string().max(2000).optional(),
  isPublicProfile: z.boolean().optional(), preferences: profilePreferencesSchema.optional(),
});

export const authProfileSchema = profileFieldsSchema.omit({ avatar: true, bio: true }).extend({
  password: z.string().refine(value => !value.trim() || (value.length >= 8 && utf8Bytes(value) <= 72), 'Password must be at least 8 characters and at most 72 bytes').optional(),
});

export const notificationSettingsSchema = z.object({
  pushEnabled: z.boolean().optional(), messages: z.boolean().optional(), followers: z.boolean().optional(),
  favorites: z.boolean().optional(), nowPlaying: z.boolean().optional(),
  newStations: z.boolean().optional(), recommendations: z.boolean().optional(),
}).strict();
