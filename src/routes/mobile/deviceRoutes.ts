import { Router } from 'express';
import { listDevices, listAvds, launchAvd, installApk, isAppInstalled } from '../../services/mobile/AdbDirectService';
import { startAppium, stopAppium, getAppiumStatus } from '../../services/mobile/DeviceService';

export const deviceRoutes = Router();

// ── Physical Devices ───────────────────────────────────────────────────────

deviceRoutes.get('/devices', async (req, res) => {
    try {
        const devices = await listDevices();
        res.json({ devices });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// ── Appium ─────────────────────────────────────────────────────────────────

deviceRoutes.get('/appium/status', async (req, res) => {
    try {
        const status = await getAppiumStatus();
        res.json(status);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

deviceRoutes.post('/appium/start', async (req, res) => {
    try {
        const result = await startAppium();
        res.json(result);
    } catch (err: any) {
        res.status(500).json({ success: false, message: err.message });
    }
});

deviceRoutes.post('/appium/stop', async (req, res) => {
    try {
        const result = await stopAppium();
        res.json(result);
    } catch (err: any) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ── AVDs (Emulators) ───────────────────────────────────────────────────────

deviceRoutes.get('/avds', async (req, res) => {
    try {
        const avds = await listAvds();
        res.json({ avds });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

deviceRoutes.post('/avds/launch', async (req, res) => {
    try {
        const { avdName } = req.body;
        if (!avdName) return res.status(400).json({ success: false, message: 'avdName is required' });
        const result = await launchAvd(avdName);
        res.json(result);
    } catch (err: any) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ── App management ─────────────────────────────────────────────────────────

deviceRoutes.post('/install', async (req, res) => {
    try {
        const { deviceId, apkPath } = req.body;
        if (!deviceId || !apkPath) return res.status(400).json({ success: false, message: 'deviceId and apkPath required' });
        const result = await installApk(deviceId, apkPath);
        res.json(result);
    } catch (err: any) {
        res.status(500).json({ success: false, message: err.message });
    }
});

deviceRoutes.get('/check-app', async (req, res) => {
    try {
        const { deviceId, packageName } = req.query as { deviceId: string; packageName: string };
        if (!deviceId || !packageName) return res.status(400).json({ error: 'deviceId and packageName required' });
        const installed = await isAppInstalled(deviceId, packageName);
        res.json({ installed, packageName });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});
