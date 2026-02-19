export interface MobileDevice {
    id: string;
    platform: 'android' | 'ios';
    version: string;
    name: string;
    udid?: string; // For real devices
    isEmulator: boolean;
    status: 'online' | 'offline' | 'busy';
}

export interface MobileTestConfig {
    appPath: string;
    deviceId: string;
    platform: 'android' | 'ios';
    bundleId?: string; // iOS
    packageName?: string; // Android
    activityName?: string; // Android
    automationName: 'UiAutomator2' | 'XCUITest';
    noReset?: boolean;
    fullReset?: boolean;
}

export interface MobileTestResult {
    id: string;
    testName: string;
    deviceId: string;
    status: 'pass' | 'fail' | 'running';
    duration: number;
    logs: string[];
    screenshots: string[];
    error?: string;
    createdAt: string;
}
