// import { supabase } from '../lib/supabase';
import * as fs from 'fs/promises';
import * as path from 'path';
import { logger } from '../../lib/logger';

export interface ToolSettings {
    // Mobile Testing
    scrcpyPath?: string;
    adbPath?: string;
    streamFps?: number;
    androidSdkPath?: string;
    appiumPort?: number;
    // Script Runners
    pythonPath?: string;
    javaPath?: string;
    nodePath?: string;
    // Storage
    mediaDir?: string;
    executionTempDir?: string;
}

export interface UserAIKey {
    id: string;
    user_id: string;
    name: string;
    provider: string;
    api_key: string;
    model: string;
    is_active: boolean;
    created_at: string;
}

const DATA_DIR = path.join(__dirname, '../../../data');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

export const settingsService = {

    async ensureDataDir() {
        try { await fs.access(DATA_DIR); } catch { await fs.mkdir(DATA_DIR, { recursive: true }); }
    },

    async readSettings(): Promise<{ aiKeys: UserAIKey[]; toolSettings?: ToolSettings }> {
        await this.ensureDataDir();
        try {
            const data = await fs.readFile(SETTINGS_FILE, 'utf-8');
            return JSON.parse(data);
        } catch (error: unknown) {
            if (error instanceof Error && 'code' in error && (error as any).code === 'ENOENT') {
                return { aiKeys: [] };
            }
            if (error instanceof Error) {
                logger.error('Failed to read settings file', error);
            }
            throw error;
        }
    },

    async getToolSettings(): Promise<ToolSettings> {
        const settings = await this.readSettings();
        return settings.toolSettings ?? {};
    },

    async saveToolSettings(updates: Partial<ToolSettings>): Promise<ToolSettings> {
        const settings = await this.readSettings();
        const merged = { ...(settings.toolSettings ?? {}), ...updates };
        await this.writeSettings({ ...settings, toolSettings: merged });
        return merged;
    },

    async writeSettings(data: { aiKeys: UserAIKey[]; toolSettings?: ToolSettings }) {
        await this.ensureDataDir();
        await fs.writeFile(SETTINGS_FILE, JSON.stringify(data, null, 2));
    },

    async getAIKeys(userId: string, includeSecrets = false): Promise<UserAIKey[]> {
        const { aiKeys } = await this.readSettings();
        const userKeys = aiKeys.filter(k => k.user_id === userId);

        // Sort
        userKeys.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

        if (includeSecrets) {
            return userKeys;
        }

        // Mask keys for security
        return userKeys.map(key => ({
            ...key,
            api_key: `${key.api_key.substring(0, 4)}...${key.api_key.slice(-4)}`
        }));
    },

    async addAIKey(userId: string, keyData: { name: string, apiKey: string, model: string, provider?: string, baseUrl?: string }): Promise<UserAIKey> {
        const { aiKeys } = await this.readSettings();

        // If this is the first key for this user, make it active
        const userKeyCount = aiKeys.filter(k => k.user_id === userId).length;
        const isActive = userKeyCount === 0;

        const newKey: UserAIKey = {
            id: Date.now().toString(), // Simple ID
            user_id: userId,
            name: keyData.name,
            provider: keyData.provider || 'google',
            api_key: keyData.apiKey,
            model: keyData.model,
            is_active: isActive,
            created_at: new Date().toISOString()
        };

        // Note: baseUrl is not in UserAIKey interface currently, but if we need it we update interface.
        // For now ignoring baseUrl or storing it if interface updated.
        // Assuming interface update needed for baseUrl? 
        // Original interface didn't have baseUrl but insert call did?
        // Let's assume we store it but maybe interface needs update.
        // I will stick to interface for now.

        aiKeys.push(newKey);
        await this.writeSettings({ aiKeys });

        return newKey;
    },

    async deleteAIKey(userId: string, keyId: string): Promise<void> {
        const { aiKeys } = await this.readSettings();
        const filtered = aiKeys.filter(k => !(k.id === keyId && k.user_id === userId));
        await this.writeSettings({ aiKeys: filtered });
    },

    async activateAIKey(userId: string, keyId: string): Promise<void> {
        const { aiKeys } = await this.readSettings();

        let changed = false;
        aiKeys.forEach(k => {
            if (k.user_id === userId) {
                if (k.id === keyId) {
                    if (!k.is_active) { k.is_active = true; changed = true; }
                } else {
                    if (k.is_active) { k.is_active = false; changed = true; }
                }
            }
        });

        if (changed) {
            await this.writeSettings({ aiKeys });
        }
    }
};
