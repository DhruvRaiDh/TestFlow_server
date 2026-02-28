// Service: RecorderService (Test Lab)
// Playwright-based browser recorder with per-step screenshot capture.
// Self-contained — does NOT modify the existing RecorderService.

import { chromium, Browser, BrowserContext, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { Server } from 'socket.io';
import { RecordedStep } from '../models/Script';
import { scriptService } from './ScriptService';
import { screenshotService } from './ScreenshotService';
import { testLabStorage } from '../storage/TestLabStorage';

export interface RecordingSession {
    sessionId: string;
    projectId: string;
    scriptName: string;
    startedAt: string;
    steps: RecordedStep[];
    screenshotCount: number;
}

export class TestLabRecorderService {
    private browser: Browser | null = null;
    private context: BrowserContext | null = null;
    private page: Page | null = null;
    private isRecording = false;
    private currentSession: RecordingSession | null = null;
    private io: Server | null = null;

    setSocket(io: Server) {
        this.io = io;
    }

    get activeSession(): RecordingSession | null {
        return this.currentSession;
    }

    async startRecording(projectId: string, url: string, sessionId: string): Promise<RecordingSession> {
        if (this.isRecording) await this.stopRecording();

        const headless = process.env.HEADLESS === 'true';
        const userDataDir = path.join(process.cwd(), 'data', 'test-lab-browser-profile');
        if (!fs.existsSync(userDataDir)) fs.mkdirSync(userDataDir, { recursive: true });

        this.context = await chromium.launchPersistentContext(userDataDir, {
            channel: 'chrome',
            headless,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
            ignoreDefaultArgs: ['--enable-automation'],
            viewport: null,
        });

        this.context.on('page', async (newPage) => {
            this.page = newPage;
            await this.injectRecorder(newPage, projectId, sessionId);
        });

        this.page = this.context.pages().length > 0
            ? this.context.pages()[0]
            : await this.context.newPage();

        this.isRecording = true;
        this.currentSession = {
            sessionId,
            projectId,
            scriptName: 'New Recording',
            startedAt: new Date().toISOString(),
            steps: [],
            screenshotCount: 0,
        };

        await this.injectRecorder(this.page, projectId, sessionId);

        // First step: navigate
        const navStep: RecordedStep = { action: 'navigate', url, timestamp: Date.now() };
        this.currentSession.steps.push(navStep);
        this.emitStep(navStep, sessionId);

        // Screenshot of initial page
        await this.captureScreenshot(projectId, sessionId, 0, { stepAction: 'navigate', url });

        await this.page.goto(url);

        return this.currentSession;
    }

    private async captureScreenshot(projectId: string, sessionId: string, stepIndex: number, meta: {
        stepAction?: string; stepTarget?: string; url?: string;
    }): Promise<void> {
        if (!this.page) return;
        try {
            const dir = await testLabStorage.ensureScreenshotDir(projectId, sessionId);
            const paddedIndex = String(stepIndex + 1).padStart(3, '0');
            const filename = `step-${paddedIndex}.png`;
            const filepath = path.join(dir, filename);

            const buffer = await this.page.screenshot({ path: filepath, type: 'png' });

            // Register in storage
            await testLabStorage.createScreenshot(projectId, {
                projectId,
                sessionId,
                sessionName: this.currentSession?.scriptName || 'Recording',
                stepIndex,
                stepAction: meta.stepAction,
                stepTarget: meta.stepTarget,
                trigger: 'step',
                filename,
                filepath,
                url: meta.url || this.page.url(),
            });

            // Emit thumbnail event to frontend
            this.io?.emit('test-lab:screenshot', {
                sessionId,
                stepIndex,
                filename,
                url: this.page.url(),
            });

            if (this.currentSession) this.currentSession.screenshotCount++;
        } catch (e) {
            console.warn('[TestLabRecorder] Screenshot failed:', e);
        }
    }

    private async injectRecorder(page: Page, projectId: string, sessionId: string): Promise<void> {
        page.on('console', msg => {
            if (msg.text().includes('[TL-Recorder]')) {
                console.log('[Browser]', msg.text());
            }
        });

        try {
            await page.exposeFunction('tlRecordEvent', async (event: any) => {
                if (!this.isRecording || !this.currentSession) return;

                const step: RecordedStep = {
                    action: event.command === 'type' ? 'type' : 'click',
                    selector: event.target,
                    value: event.value,
                    timestamp: Date.now(),
                };
                this.currentSession.steps.push(step);
                this.emitStep(step, sessionId);

                // Capture screenshot after each interaction
                const stepIndex = this.currentSession.steps.length - 1;
                await this.captureScreenshot(projectId, sessionId, stepIndex, {
                    stepAction: step.action,
                    stepTarget: step.selector,
                });
            });
        } catch (e: any) {
            if (!e.message?.includes('already been registered')) {
                console.warn('[TestLabRecorder] exposeFunction error:', e.message);
            }
        }

        // Inject event listeners into browser page
        await page.addInitScript(() => {
            const getSelector = (el: HTMLElement): string => {
                if (el.id) return `#${el.id}`;
                const name = el.getAttribute('name');
                if (name) return `[name="${name}"]`;
                if (el.className && typeof el.className === 'string') {
                    const cls = el.className.split(/\s+/).filter(c => c && !c.includes(':'))[0];
                    if (cls) return `.${cls}`;
                }
                return el.tagName.toLowerCase();
            };

            document.addEventListener('click', (e) => {
                const target = e.target as HTMLElement;
                if (target.closest('#tl-recorder-host')) return;
                if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
                if ((window as any).tlRecordEvent) {
                    (window as any).tlRecordEvent({ command: 'click', target: getSelector(target), value: '' });
                }
            }, true);

            document.addEventListener('change', (e) => {
                const target = e.target as HTMLInputElement;
                if (!['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
                if (target.value.startsWith('{{')) return;
                if ((window as any).tlRecordEvent) {
                    (window as any).tlRecordEvent({ command: 'type', target: getSelector(target), value: target.value });
                }
            }, true);
        });

        await page.evaluate(() => {
            // Same listeners for already-loaded pages
            const getSelector = (el: HTMLElement): string => {
                if (el.id) return `#${el.id}`;
                const name = el.getAttribute('name');
                if (name) return `[name="${name}"]`;
                return el.tagName.toLowerCase();
            };
            document.addEventListener('click', (e) => {
                const target = e.target as HTMLElement;
                if (target.closest('#tl-recorder-host')) return;
                if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
                if ((window as any).tlRecordEvent) {
                    (window as any).tlRecordEvent({ command: 'click', target: getSelector(target), value: '' });
                }
            }, true);

            document.addEventListener('change', (e) => {
                const target = e.target as HTMLInputElement;
                if (!['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
                if (target.value.startsWith('{{')) return;
                if ((window as any).tlRecordEvent) {
                    (window as any).tlRecordEvent({ command: 'type', target: getSelector(target), value: target.value });
                }
            }, true);
        }).catch(() => { /* page may not be ready */ });
    }

    private emitStep(step: RecordedStep, sessionId: string) {
        this.io?.emit('test-lab:record:step', { ...step, sessionId });
    }

    async stopRecording(): Promise<RecordedStep[]> {
        if (this.page && this.currentSession) {
            // Final screenshot on stop
            const stopIdx = this.currentSession.steps.length;
            await this.captureScreenshot(
                this.currentSession.projectId,
                this.currentSession.sessionId,
                stopIdx,
                { stepAction: 'stop', url: this.page.url() }
            );
        }

        const steps = this.currentSession?.steps || [];
        if (this.context) { await this.context.close().catch(() => { }); }
        this.context = null;
        this.page = null;
        this.isRecording = false;
        this.currentSession = null;
        return steps;
    }

    async saveRecording(projectId: string, sessionId: string, scriptName: string, steps: RecordedStep[]): Promise<any> {
        const tsContent = scriptService.generatePlaywrightTs(scriptName, steps);

        const script = await testLabStorage.createScript(projectId, {
            name: scriptName,
            language: 'typescript',
            source: 'recorder',
            content: tsContent,
            steps,
            projectId,
            tags: ['recorded'],
        });

        // Update session names in screenshots
        const store = await testLabStorage.listScreenshots(projectId, sessionId);
        for (const shot of store) {
            await testLabStorage.createScreenshot(projectId, {
                ...shot,
                sessionName: scriptName,
            });
        }

        return script;
    }

    getStatus(): { isRecording: boolean; session: RecordingSession | null } {
        return { isRecording: this.isRecording, session: this.currentSession };
    }
}

export const testLabRecorderService = new TestLabRecorderService();
