import { logger } from '../utils/logger';
import { pgLocalization } from '../data/postgres-localization-store';

export class TranslationVersionService {
  private static SCOPE = 'global';

  static async bumpVersion(notes?: string): Promise<{ version: number; success: boolean }> {
    return pgLocalization().bumpVersion(notes, this.SCOPE);

  }

  static async getCurrentVersion(): Promise<number> {
    return (await pgLocalization().getMetadata(this.SCOPE)).languagesVersion;

  }

  static async getMetadata() {
    return pgLocalization().getMetadata(this.SCOPE);

  }

  static async bumpVersionViaApi(adminToken?: string): Promise<{ success: boolean; version: number }> {
    try {
      const port = process.env.PORT || '5000';
      const baseUrl = process.env.RAILWAY_PUBLIC_DOMAIN
        ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
        : `http://localhost:${port}`;

      const response = await fetch(`${baseUrl}/api/admin/translation-metadata/bump`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(adminToken && { 'Authorization': `Bearer ${adminToken}` })
        },
        credentials: 'include'
      });

      if (!response.ok) {
        logger.log('❌ Failed to bump version via API:', response.status);
        return { success: false, version: 0 };
      }

      const data: any = await response.json();
      logger.log(`✅ Version bumped via API to ${data.version}`);
      return { success: true, version: data.version };
    } catch (error) {
      logger.log('❌ Error calling bump API:', error);
      return { success: false, version: 0 };
    }
  }
}

export async function bumpTranslationVersion(notes?: string) {
  return TranslationVersionService.bumpVersion(notes);
}

export async function getCurrentTranslationVersion() {
  return TranslationVersionService.getCurrentVersion();
}

export async function getTranslationMetadata() {
  return TranslationVersionService.getMetadata();
}
