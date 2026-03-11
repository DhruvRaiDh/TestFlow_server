import { remote } from 'webdriverio';

export interface AppiumSession {
    sessionId: string;
    driver: any;
    deviceId: string;
    appPackage?: string;
}

const activeSessions = new Map<string, AppiumSession>();

export async function createSession(opts: {
    deviceId: string;
    appPackage?: string;
    appActivity?: string;
    apkPath?: string;
    noReset?: boolean;
}): Promise<AppiumSession> {
    const caps: Record<string, any> = {
        platformName: 'Android',
        'appium:automationName': 'UiAutomator2',
        'appium:deviceName': opts.deviceId,
        'appium:udid': opts.deviceId,
        'appium:noReset': opts.noReset ?? true,
        'appium:newCommandTimeout': 300,
        'appium:autoGrantPermissions': true,
        'appium:skipDeviceInitialization': false,
    };

    if (opts.apkPath) {
        caps['appium:app'] = opts.apkPath;
    } else if (opts.appPackage) {
        caps['appium:appPackage'] = opts.appPackage;
        caps['appium:appActivity'] = opts.appActivity || '.MainActivity';
    }

    const driver = await remote({
        hostname: 'localhost',
        port: 4723,
        path: '/',
        capabilities: caps,
        logLevel: 'error',
        connectionRetryTimeout: 60000,
        connectionRetryCount: 3,
    });

    const sessionId = (driver as any).sessionId || crypto.randomUUID();
    const session: AppiumSession = { sessionId, driver, deviceId: opts.deviceId, appPackage: opts.appPackage };
    activeSessions.set(sessionId, session);
    return session;
}

export async function getSession(sessionId: string): Promise<AppiumSession | undefined> {
    return activeSessions.get(sessionId);
}

export async function closeSession(sessionId: string): Promise<void> {
    const session = activeSessions.get(sessionId);
    if (session) {
        try { await session.driver.deleteSession(); } catch { }
        activeSessions.delete(sessionId);
    }
}

export async function closeAllSessions(): Promise<void> {
    for (const [id] of activeSessions) {
        await closeSession(id).catch(() => { });
    }
}

export function getActiveSessions(): string[] {
    return [...activeSessions.keys()];
}
