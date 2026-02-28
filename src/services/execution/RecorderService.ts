/// <reference lib="dom" />
import { chromium, firefox, Browser, BrowserContext, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { Server } from 'socket.io';
import { ReportService } from '../analysis/ReportService';
// import { supabase } from '../lib/supabase';
import { localProjectService } from '../persistence/LocalProjectService';
import { genAIService } from '../ai/GenAIService';
import { visualTestService } from '../analysis/VisualTestService';
import { logger } from '../../lib/logger';
import { testDataService } from '../persistence/TestDataService';
import { testRunService } from '../persistence/TestRunService';
import { v4 as uuidv4 } from 'uuid';

interface RecordedStep {
    command: string;
    target: string;
    targets: string[][]; // Array of [selector, type] tuples
    value: string;
}

interface RecordedScript {
    id: string;
    projectId: string;
    name: string;
    module: string;
    steps: RecordedStep[];
    createdAt: string;
}

export class RecorderService {
    private browser: Browser | null = null;
    private context: BrowserContext | null = null;
    private page: Page | null = null;
    private isRecording = false;
    private recordedSteps: RecordedStep[] = [];
    private io: Server | null = null;
    private reportService: ReportService;

    constructor() {
        this.reportService = new ReportService();
    }

    setSocket(io: Server) {
        this.io = io;
    }

    async startRecording(url: string) {
        try {
            logger.info('Starting recording', { url });
            const headlessParam = process.env.HEADLESS !== 'false';

            // Only close previous if recording
            if (this.isRecording) {
                await this.stopRecording();
            }

            logger.debug('Launching browser', { headless: headlessParam });

            // Use persistent profile - SYNCED WITH ENGINE SERVICE
            const userDataDir = path.join(process.cwd(), 'data', 'browser_profile');
            // Check if directory exists, if not create it
            if (!fs.existsSync(userDataDir)) fs.mkdirSync(userDataDir, { recursive: true });

            logger.debug('Launching stealth profile', { userDataDir });

            this.context = await chromium.launchPersistentContext(userDataDir, {
                channel: 'chrome',
                headless: headlessParam,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-blink-features=AutomationControlled' // Stealth Key 
                ],
                ignoreDefaultArgs: ['--enable-automation', '--use-mock-keychain'],
                viewport: null
            });
            // this.browser is not used with persistent context in the same way, 
            // but we keep the property for compatibility if needed, or ignore it.

            // Handle new pages (popups, new tabs)
            this.context.on('page', async (newPage) => {
                logger.debug('New page detected');
                this.page = newPage;
                await this.injectRecorder(newPage);
            });

            this.page = this.context.pages().length > 0 ? this.context.pages()[0] : await this.context.newPage();
            this.isRecording = true;
            this.recordedSteps = [];

            // Helper to ensure injection happens on the first page too if strict timing requires it
            await this.injectRecorder(this.page);

            // ... (Rest of startRecording matches original flow) ...


            // Add initial open command
            const initialStep: RecordedStep = {
                command: 'open',
                target: url,
                targets: [],
                value: ''
            };
            this.recordedSteps.push(initialStep);

            // Emit 'record:step' to match frontend listener
            logger.debug('Emitting initial step', { step: initialStep });
            this.io?.emit('record:step', {
                action: 'navigate',
                url: url,
                timestamp: Date.now()
            });





            await this.page.goto(url);
            logger.info('Recording started successfully');
        } catch (error: unknown) {
            if (error instanceof Error) {
                logger.error('Error starting recording', error);
            }
            throw error;
        }
    }

    private async injectRecorder(page: Page) {
        // 1. Enable Browser Logging to Backend Terminal
        page.on('console', msg => {
            const text = msg.text();
            if (text.includes('[Recorder]')) {
                logger.debug('Browser console', { message: text });
            }
        });

        page.on('pageerror', err => {
            if (err instanceof Error) {
                logger.error('Page error', err);
            }
        });

        // 2. Expose function to browser (Handle idempotent injection)
        try {
            await page.exposeFunction('recordEvent', (event: any) => {
                // ... (Keeping exact same handler logic) ...
                logger.debug('Received event from browser', { event });
                if (this.isRecording) {
                    this.recordedSteps.push({
                        command: event.command,
                        target: event.target,
                        targets: event.targets || [],
                        value: event.value
                    });

                    this.context?.pages().forEach(p => {
                        p.evaluate((step) => {
                            window.dispatchEvent(new CustomEvent('recorder:update', { detail: step }));
                        }, { command: event.command, target: event.target, value: event.value }).catch(() => { });
                    });

                    this.io?.emit('record:step', {
                        action: event.command === 'type' ? 'type' : 'click',
                        selector: event.target,
                        value: event.value,
                        timestamp: Date.now()
                    });
                }
            });
        } catch (e: unknown) {
            if (e instanceof Error && !e.message.includes('already been registered')) {
                logger.error('Failed to expose function', e);
            }
        }

        // 3. Define the Injection Logic as a String/Function
        const injectionLogic = () => {
            try {
                if (document.getElementById('tf-recorder-host')) {
                    logger.debug('UI already injected');
                    return;
                }
                logger.debug('Injecting UI');

                // Check for draft recovery
                const checkDraftRecovery = () => {
                    try {
                        const draft = localStorage.getItem('recorder_draft');
                        const timestamp = localStorage.getItem('recorder_draft_timestamp');
                        if (draft && timestamp) {
                            const steps = JSON.parse(draft);
                            if (steps.length > 0) {
                                const timeAgo = new Date(timestamp).toLocaleString();
                                const recover = confirm(
                                    `Found a saved draft with ${steps.length} step(s) from ${timeAgo}.\n\nWould you like to recover it?`
                                );
                                if (recover) {
                                    // Restore steps by dispatching events
                                    steps.forEach((step: any) => {
                                        window.dispatchEvent(new CustomEvent('recorder:update', { detail: step }));
                                    });
                                    logger.info('Recovered steps from draft', { stepCount: steps.length });
                                } else {
                                    localStorage.removeItem('recorder_draft');
                                    localStorage.removeItem('recorder_draft_timestamp');
                                }
                            }
                        }
                    } catch (error: unknown) {
                        if (error instanceof Error) {
                            logger.error('Draft recovery failed', error);
                        }
                    }
                };

                // --- 1. Host & Shadow ---
                // --- 1. Host & Shadow ---
                const host = document.createElement('div');
                host.id = 'tf-recorder-host';
                host.style.position = 'fixed';
                host.style.top = '0';
                host.style.right = '0';
                host.style.zIndex = '2147483647';

                const inject = () => {
                    if (document.getElementById('tf-recorder-host')) return;
                    if (document.documentElement) {
                        document.documentElement.appendChild(host);
                        // Check for draft after UI is ready
                        setTimeout(checkDraftRecovery, 500);
                    } else if (document.body) {
                        document.body.appendChild(host);
                        setTimeout(checkDraftRecovery, 500);
                    } else {
                        // Retry on load
                        window.addEventListener('DOMContentLoaded', () => inject());
                    }
                };
                inject();

                const shadow = host.attachShadow({ mode: 'open' });

                // --- 2. Styles (Studio Panel) ---
                const style = document.createElement('style');
                style.textContent = `
                    :host { font-family: 'Inter', system-ui, sans-serif; }
                    .studio-panel {
                        width: 300px;
                        height: 500px;
                        background: rgba(15, 23, 42, 0.98);
                        border: 1px solid rgba(255,255,255,0.1);
                        border-radius: 12px;
                        box-shadow: -10px 0 30px rgba(0,0,0,0.5);
                        display: flex;
                        flex-direction: column;
                        color: white;
                        font-size: 13px;
                        transition: height 0.3s ease, width 0.3s ease;
                        overflow: hidden;
                    }
                    .studio-panel.minimized {
                        height: 48px;
                        width: 200px;
                    }
                    .header {
                        padding: 12px 16px;
                        border-bottom: 1px solid rgba(255,255,255,0.1);
                        background: rgba(255,255,255,0.03);
                        font-weight: 600;
                        display: flex;
                        align-items: center;
                        gap: 8px;
                        cursor: grab;
                        user-select: none;
                    }
                    .header:active { cursor: grabbing; }
                    .rec-dot { width: 8px; height: 8px; background: #ef4444; border-radius: 50%; animation: pulse 1.5s infinite; }
                    
                    .actions { margin-left: auto; display: flex; gap: 8px; }
                    .icon-btn { cursor: pointer; opacity: 0.7; font-size: 14px; padding: 2px 6px; border-radius: 4px; }
                    .icon-btn:hover { opacity: 1; background: rgba(255,255,255,0.1); }

                    .script-view {
                        flex: 1;
                        overflow-y: auto;
                        padding: 12px;
                        display: flex;
                        flex-direction: column;
                        gap: 8px;
                    }
                    .step-item {
                        background: rgba(255,255,255,0.03);
                        padding: 8px 12px;
                        border-radius: 6px;
                        border-left: 2px solid #3b82f6;
                    }
                    .step-cmd { font-weight: 600; color: #93c5fd; margin-bottom: 2px; }
                    .step-val { color: #cbd5e1; font-family: monospace; font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
                    .context-bar {
                        padding: 16px;
                        border-top: 1px solid rgba(255,255,255,0.1);
                        background: rgba(0,0,0,0.2);
                    }
                    .context-title { font-size: 11px; text-transform: uppercase; color: #64748b; margin-bottom: 8px; letter-spacing: 0.5px; }
                    .suggestion-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
                    .suggestion-btn {
                        background: #334155;
                        border: 1px solid rgba(255,255,255,0.1);
                        color: #e2e8f0;
                        padding: 8px;
                        border-radius: 6px;
                        cursor: pointer;
                        text-align: center;
                        transition: all 0.2s;
                        font-size: 11px;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        gap: 6px;
                    }
                    .suggestion-btn:hover { background: #475569; border-color: #64748b; }
                    .suggestion-btn.primary { background: #2563eb; border-color: #3b82f6; }
                    .suggestion-btn.primary:hover { background: #1d4ed8; }
                    @keyframes pulse { 0% { opacity: 1; } 50% { opacity: 0.5; } 100% { opacity: 1; } }
                `;
                shadow.appendChild(style);

                // --- 3. DOM ---
                const panel = document.createElement('div');
                panel.className = 'studio-panel';
                panel.innerHTML = `
                    <div class="header">
                        <div class="rec-dot"></div> 
                        <span>RECORDER</span>
                        <div class="actions">
                             <div class="icon-btn" id="min-btn">_</div>
                        </div>
                    </div>
                    <div class="script-view" id="script-list">
                        <div style="text-align:center; color:#64748b; margin-top:20px;">Recording...</div>
                    </div>
                    <div class="context-bar">
                        <div class="context-title">Smart Actions</div>
                        <div class="suggestion-grid" id="actions-grid">
                            <div class="suggestion-btn" style="grid-column: span 2; opacity: 0.5; cursor: default;">Select an input field...</div>
                        </div>
                    </div>
                `;
                shadow.appendChild(panel);

                // --- 4. Logic (Drag & Minimize) ---
                const header = panel.querySelector('.header') as HTMLElement;
                const minBtn = panel.querySelector('#min-btn') as HTMLElement;

                // Toggle Minimize
                minBtn.onclick = (e) => {
                    e.stopPropagation();
                    panel.classList.toggle('minimized');
                };

                // Drag Logic
                let isDragging = false;
                let startX = 0, startY = 0;
                let initialLeft = 0, initialTop = 0;

                header.addEventListener('mousedown', (e) => {
                    isDragging = true;
                    startX = e.clientX;
                    startY = e.clientY;
                    const rect = host.getBoundingClientRect();
                    initialLeft = rect.left;
                    initialTop = rect.top;
                    host.style.cursor = 'grabbing';
                });

                window.addEventListener('mousemove', (e) => {
                    if (!isDragging) return;
                    e.preventDefault();
                    const dx = e.clientX - startX;
                    const dy = e.clientY - startY;
                    host.style.top = `${initialTop + dy}px`;
                    host.style.left = `${initialLeft + dx}px`;
                    host.style.right = 'auto'; // Disable right anchor
                });

                window.addEventListener('mouseup', () => {
                    isDragging = false;
                    host.style.cursor = 'auto';
                });

                // --- 4. Logic ---
                // A. Live Script Update + Auto-Save + Step Editing
                const recordedSteps: any[] = [];

                window.addEventListener('recorder:update', (e: any) => {
                    const step = e.detail;
                    recordedSteps.push(step);
                    const list = shadow.getElementById('script-list');
                    if (list) {
                        const item = document.createElement('div');
                        item.className = 'step-item';
                        item.style.cssText = 'display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-bottom: 1px solid rgba(255,255,255,0.1);';

                        const stepIndex = recordedSteps.length - 1;

                        // Step content
                        const content = document.createElement('div');
                        content.style.cssText = 'flex: 1; display: flex; gap: 8px; cursor: pointer;';
                        content.innerHTML = `<div class="step-cmd">${step.command.toUpperCase()}</div><div class="step-val">${step.target}</div>`;

                        // Edit button
                        const editBtn = document.createElement('button');
                        editBtn.textContent = '✏️';
                        editBtn.style.cssText = 'background: rgba(59, 130, 246, 0.2); border: 1px solid #3b82f6; color: #3b82f6; padding: 2px 6px; border-radius: 4px; cursor: pointer; font-size: 10px;';
                        editBtn.onclick = () => {
                            const newTarget = prompt('Edit selector:', step.target);
                            const newValue = step.value ? prompt('Edit value:', step.value) : null;
                            if (newTarget) {
                                recordedSteps[stepIndex].target = newTarget;
                                if (newValue !== null) recordedSteps[stepIndex].value = newValue;
                                content.innerHTML = `<div class="step-cmd">${step.command.toUpperCase()}</div><div class="step-val">${newTarget}</div>`;
                                localStorage.setItem('recorder_draft', JSON.stringify(recordedSteps));
                            }
                        };

                        // Delete button
                        const deleteBtn = document.createElement('button');
                        deleteBtn.textContent = '🗑️';
                        deleteBtn.style.cssText = 'background: rgba(239, 68, 68, 0.2); border: 1px solid #ef4444; color: #ef4444; padding: 2px 6px; border-radius: 4px; cursor: pointer; font-size: 10px;';
                        deleteBtn.onclick = () => {
                            if (confirm('Delete this step?')) {
                                recordedSteps.splice(stepIndex, 1);
                                item.remove();
                                localStorage.setItem('recorder_draft', JSON.stringify(recordedSteps));
                            }
                        };

                        item.appendChild(content);
                        item.appendChild(editBtn);
                        item.appendChild(deleteBtn);
                        list.appendChild(item);
                        list.scrollTop = list.scrollHeight;

                        // Auto-Save Draft to localStorage
                        try {
                            localStorage.setItem('recorder_draft', JSON.stringify(recordedSteps));
                            localStorage.setItem('recorder_draft_timestamp', new Date().toISOString());

                            // Visual feedback
                            const header = shadow.querySelector('.header span') as HTMLElement;
                            if (header) {
                                const originalText = header.textContent;
                                header.textContent = 'RECORDER (Draft Saved)';
                                header.style.color = '#10b981';
                                setTimeout(() => {
                                    header.textContent = originalText;
                                    header.style.color = '';
                                }, 1000);
                            }
                        } catch (error: unknown) {
                            if (error instanceof Error) {
                                logger.error('Auto-save failed', error);
                            }
                        }
                    }
                });

                // B. Context Detection
                const updateContext = (target: HTMLInputElement) => {
                    const grid = shadow.getElementById('actions-grid');
                    if (!grid) return;
                    grid.innerHTML = ''; // clear

                    const type = target.type;
                    const name = target.name?.toLowerCase() || '';
                    const placeholder = target.placeholder?.toLowerCase() || '';

                    const addBtn = (label: string, value: string, mock: string, primary = false) => {
                        const btn = document.createElement('div');
                        btn.className = `suggestion-btn ${primary ? 'primary' : ''}`;

                        // Enhanced: Show both label and mock preview
                        btn.innerHTML = `
                            <div style="display: flex; flex-direction: column; align-items: flex-start; gap: 2px; width: 100%;">
                                <div style="font-weight: 600; font-size: 11px;">${label}</div>
                                <div style="font-size: 9px; opacity: 0.7; font-family: monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; width: 100%;">${mock}</div>
                            </div>
                        `;

                        btn.onclick = (e) => {
                            e.preventDefault();
                            e.stopPropagation();

                            // Fill Visual
                            target.value = mock;
                            target.dispatchEvent(new Event('input', { bubbles: true }));
                            target.dispatchEvent(new Event('change', { bubbles: true }));

                            // Record Variable
                            const targets = getSelectors(target);
                            (window as any).recordEvent({
                                command: 'type',
                                target: targets.length > 0 ? targets[0][0] : target.tagName.toLowerCase(),
                                targets: targets,
                                value: value
                            });

                            // Visual feedback
                            btn.style.background = '#10b981';
                            btn.style.borderColor = '#10b981';
                            setTimeout(() => {
                                btn.style.background = '';
                                btn.style.borderColor = '';
                            }, 500);
                        };
                        grid.appendChild(btn);
                    };

                    if (type === 'email' || name.includes('email')) {
                        addBtn('📧 Insert Email', '{{email}}', 'test_user@example.com', true);
                        addBtn('Generate Unique', '{{email_unique}}', `user_${Date.now()}@test.com`);
                    } else if (type === 'password') {
                        addBtn('🔒 Insert Pass', '{{password}}', 'SecretPass123!', true);
                    } else if (name.includes('name')) {
                        addBtn('👤 Insert Name', '{{name}}', 'John Doe', true);
                    } else {
                        addBtn('text', '{{random_text}}', 'Sample Text');
                        addBtn('number', '{{random_number}}', '12345');
                    }
                };

                // Listeners
                document.addEventListener('focus', (e) => {
                    const target = e.target as HTMLElement;
                    if (['INPUT', 'TEXTAREA'].includes(target.tagName)) {
                        updateContext(target as HTMLInputElement);
                    }
                }, true);

                // Helper to get selectors (Robust)
                const getSelectors = (el: HTMLElement): string[][] => {
                    const targets: string[][] = [];

                    // 1. ID (Best)
                    if (el.id) {
                        targets.push([`id=${el.id}`, 'id']);
                        targets.push([`css=#${el.id}`, 'css:id']);
                        targets.push([`//*[@id='${el.id}']`, 'xpath:id']);
                    }

                    // 2. Name
                    const name = el.getAttribute('name');
                    if (name) {
                        targets.push([`name=${name}`, 'name']);
                        targets.push([`css=[name='${name}']`, 'css:name']);
                        targets.push([`//*[@name='${name}']`, 'xpath:attributes']);
                    }

                    // 3. Link Text (Anchors)
                    if (el.tagName === 'A' && el.textContent?.trim()) {
                        targets.push([`linkText=${el.textContent.trim()}`, 'linkText']);
                    }

                    // 4. CSS (Classes)
                    if (el.className && typeof el.className === 'string') {
                        const classes = el.className.split(/\s+/).filter(c => c && !c.includes(':'));
                        if (classes.length) {
                            targets.push([`css=.${classes.join('.')}`, 'css:class']);
                        }
                    }

                    // 5. XPath (Relative/Hierarchy)
                    try {
                        const getPath = (element: HTMLElement, relative = false): string => {
                            if (relative && element.id) return `//*[@id='${element.id}']`;
                            if (element === document.body) return '/html/body';

                            let ix = 0; const siblings = element.parentNode?.childNodes;
                            if (siblings) {
                                for (let i = 0; i < siblings.length; i++) {
                                    const sibling = siblings[i] as HTMLElement;
                                    if (sibling === element) return getPath(element.parentNode as HTMLElement, relative) + '/' + element.tagName.toLowerCase() + (ix + 1 > 1 ? '[' + (ix + 1) + ']' : '');
                                    if (sibling.nodeType === 1 && sibling.tagName === element.tagName) ix++;
                                }
                            }
                            return '';
                        };

                        // Relative (starts from nearest ID)
                        const relativeXpath = getPath(el, true);
                        if (relativeXpath && !relativeXpath.startsWith('/html')) targets.push([`xpath=${relativeXpath}`, 'xpath:relative']);

                        // Absolute
                        const absXpath = getPath(el, false);
                        if (absXpath) targets.push([`xpath=${absXpath}`, 'xpath:position']);

                    } catch (error: unknown) {
                        if (error instanceof Error) {
                            logger.error('XPath error', error);
                        }
                    }

                    // 6. CSS (Hierarchy - Simple)
                    // (Optional: add more complex CSS generators if needed)

                    return targets;
                };

                document.addEventListener('click', (e) => {
                    const target = e.target as HTMLElement;
                    if (['INPUT', 'TEXTAREA'].includes(target.tagName) || target.closest('#tf-recorder-host')) return;

                    console.log('[Recorder:Browser] Click detected on:', target.tagName, target);

                    try {
                        const targets = getSelectors(target);
                        if ((window as any).recordEvent) {
                            console.log('[Recorder:Browser] Sending click event...');
                            (window as any).recordEvent({
                                command: 'click',
                                target: targets.length > 0 ? targets[0][0] : target.tagName.toLowerCase(),
                                targets: targets,
                                value: ''
                            });
                        } else {
                            console.error('[Recorder:Browser] ❌ recordEvent function is missing on window!');
                        }
                    } catch (err) {
                        console.error('[Recorder:Browser] Click Handler Error:', err);
                    }
                }, true);

                document.addEventListener('change', (e) => {
                    const target = e.target as HTMLInputElement;
                    if (['INPUT', 'TEXTAREA'].includes(target.tagName) && !target.dataset.ignoreRecord) {
                        if (target.value.startsWith('{{')) return;

                        console.log('[Recorder:Browser] Change detected on:', target.tagName);

                        if ((window as any).recordEvent) {
                            (window as any).recordEvent({
                                command: 'type',
                                target: target.tagName.toLowerCase(), // Simplified for brevity in log
                                value: target.value
                            });
                        }
                    }
                }, true);

            } catch (err: any) {
                console.error('[Recorder] Injection Error:', err);
            }
        };

        // 4. Inject
        await page.addInitScript(injectionLogic);
        await page.evaluate(injectionLogic);
    }
    async stopRecording() {
        if (this.context) {
            await this.context.close();
        }
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
        }
        this.context = null;
        this.page = null;
        this.isRecording = false;
        return this.recordedSteps;
    }

    async saveScript(script: Omit<RecordedScript, 'id' | 'createdAt'> & { userId: string }) {
        // Map frontend step format (action/selector) to backend format (command/target)
        const mappedSteps = script.steps.map((step: any) => {
            let command = step.command;
            let target = step.target;
            let targets = step.targets || [];
            let value = step.value || '';

            // Handle frontend format
            if (step.action) {
                if (step.action === 'navigate') {
                    command = 'open';
                    target = step.url;
                } else {
                    command = step.action; // click, type
                    target = step.selector;
                }
            }

            return {
                command: command || 'unknown',
                target: target || '',
                targets: targets,
                value: value
            };
        });

        // Use LocalProjectService
        // Note: We need projectId. If script doesn't have it, we might have an issue.
        // Assuming script.projectId is present.

        return await localProjectService.createScript(script.projectId, {
            name: script.name,
            module: script.module,
            steps: mappedSteps,
            project_id: script.projectId, // Persistence
            user_id: script.userId
        }, script.userId);
    }

    async updateScriptSteps(scriptId: string, steps: RecordedStep[]) {
        // Need ProjectID to update. 
        // This method signature is missing projectID which is required for Local Service (file path).
        // WE need to find the project ID first? Or change signature.
        // For now, let's look up the project by scanning? No, too slow.
        // We will assume we can't update without ProjectID easily unless we scan.
        // Let's modify the signature to accept projectId or find it.
        // Quick fix: Scan all projects (we only have a few JSON files).

        // Actually, let's try to pass projectId if possible. If not, we scan.
        // For now, I'll implement a scan helper in LocalProjectService? 
        // Or just let it fail/warn for now. 
        // Wait, playScript calls this. playScript has script data.

        logger.warn('updateScriptSteps requires Project ID for local storage, skipping persistence');
    }

    async deleteScript(scriptId: string, projectId: string) {
        if (!projectId) throw new Error('Project ID required for deletion');

        // Delete from Local Project Service
        // We use a dummy userId for now as local service trusts projectId access in this mode
        await localProjectService.deleteScript(projectId, scriptId, 'user-id');
        logger.info('Deleted script', { scriptId, projectId });
        return { status: 'deleted' };
    }

    async getScripts(projectId?: string, userId?: string) {
        if (!projectId) return [];
        // userId is optional for now as we trust the projectId access in local mode
        return await localProjectService.getScripts(projectId, userId || '');
    }

    async playScript(scriptId: string, userId?: string, options?: { browser?: 'chromium' | 'firefox' | 'webkit' }): Promise<{ status: 'pass' | 'fail', logs: string }> {
        // --- 1. Find Script ---
        const allProjects = await localProjectService.getAllProjects(userId || '');
        let foundScript: any = null;
        let foundProjectId = '';

        for (const p of allProjects) {
            const scripts = await localProjectService.getScripts(p.id, userId || '');
            const match = scripts.find((s: any) => s.id === scriptId);
            if (match) {
                foundScript = match;
                foundProjectId = p.id;
                break;
            }
        }

        if (!foundScript) throw new Error('Script not found or access denied');

        // --- 2. Create Unified Run (Source: Recorder) ---
        // We use 'recorder' source so HistoryView can filter it out by default
        const runId = await testRunService.createRun(foundProjectId, [scriptId], 'recorder', 'manual');
        logger.info('Created unified run', { runId });

        const script = {
            id: foundScript.id,
            projectId: foundScript.project_id || foundProjectId,
            name: foundScript.name,
            module: foundScript.module,
            steps: foundScript.steps,
            createdAt: foundScript.createdAt,
            userId: foundScript.user_id
        };

        const headlessParam = process.env.HEADLESS === 'true';

        // Browser Selection Logic
        const browserType = options?.browser || 'chromium';
        let context: BrowserContext;

        logger.debug('Launching browser persistent context', { browserType });

        if (browserType === 'firefox') {
            // Ephemeral Firefox (No Profile) as requested
            logger.debug('Launching Firefox (ephemeral)');
            this.browser = await firefox.launch({
                headless: headlessParam,
            });
            context = await this.browser.newContext({ viewport: null });
        } else {
            // Default Chromium
            const userDataDir = path.join(process.cwd(), 'data', 'browser_profile');
            if (!fs.existsSync(userDataDir)) fs.mkdirSync(userDataDir, { recursive: true });

            context = await chromium.launchPersistentContext(userDataDir, {
                channel: 'chrome',
                headless: headlessParam,
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
                ignoreDefaultArgs: ['--enable-automation', '--use-mock-keychain'],
                viewport: null
            });
        }

        // 🚨 Safety: Detect if user closes the window manually
        context.on('close', () => {
            logger.warn('Browser window closed manually by user');
            // We can't easily "cancel" the running loop below unless we check a flag or use an AbortController.
            // But we can ensure we don't try to use it.
            // Actually, we'll rely on the loop checking context.pages() or similar, or catching the specific error.
        });

        // this.browser is not used with persistent context in the same way, 
        // but we keep the property for compatibility if needed, or ignore it.
        const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();

        const logs: string[] = [];
        // Unified Logger
        const log = (msg: string, level: 'info' | 'warn' | 'error' = 'info') => {
            logger.debug('Browser message', { message: msg });
            logs.push(msg); // Keep for return value
            testRunService.appendLog(runId, foundProjectId, msg, level);
        };
        let stepsCompleted = 0;
        let scriptWasHealed = false;

        try {
            await testRunService.updateRun(runId, foundProjectId, { status: 'running' });
            for (let i = 0; i < script.steps.length; i++) {
                const step = script.steps[i];
                let target = step.target;
                if (target.startsWith('css=')) target = target.replace('css=', '');
                if (target.startsWith('id=')) target = `#${target.replace('id=', '')}`;
                if (target.startsWith('xpath=')) target = target.replace('xpath=', '');

                if (step.target.includes('=')) {
                    target = step.target;
                } else if (step.target.startsWith('/') || step.target.startsWith('(')) {
                    target = `xpath=${step.target}`;
                }

                log(`[Recorder] Executing: ${step.command} on ${target}`);

                if (this.io) {
                    this.io.emit('recorder:step:start', { index: i, step });
                }

                try {
                    if (step.command === 'open') {
                        if (!context.pages().length) throw new Error('Browser closed');
                        await page.goto(step.target);
                    } else if (step.command === 'click') {
                        if (!context.pages().length) throw new Error('Browser closed');
                        await page.click(target, { timeout: 5000 });
                    } else if (step.command === 'type') {
                        if (!context.pages().length) throw new Error('Browser closed');
                        await page.fill(target, step.value, { timeout: 5000 });
                    }

                    if (this.io) {
                        this.io.emit('recorder:step:success', { index: i });
                    }
                    stepsCompleted++;
                } catch (stepError: any) {
                    // --- SELF HEALING LOGIC START ---
                    const errorMessage = stepError.message || '';
                    if ((errorMessage.includes('Timeout') || errorMessage.includes('waiting for selector')) && step.command !== 'open') {
                        log(`[Healer] 🩹 Step failed with timeout. Attempting Self-Healing for element: ${target} ...`);

                        try {
                            const htmlSnapshot = await page.content();
                            const healedSelector = await genAIService.healSelector(htmlSnapshot, target, errorMessage);

                            if (healedSelector) {
                                log(`[Healer] ✨ AI found a potential new selector: ${healedSelector}`);

                                // Retry with new selector
                                if (step.command === 'click') {
                                    await page.click(healedSelector);
                                } else if (step.command === 'type') {
                                    await page.fill(healedSelector, step.value);
                                }

                                log(`[Healer] ✅ Retry successful! Updating script...`);

                                // Update the script object in memory
                                script.steps[i].target = healedSelector;
                                script.steps[i].targets = [[healedSelector, 'css:finder'], ...(script.steps[i].targets || [])];
                                scriptWasHealed = true;

                                if (this.io) {
                                    this.io.emit('recorder:step:success', { index: i, healed: true, newSelector: healedSelector });
                                }
                                stepsCompleted++;
                                continue; // Continue to next loop
                            } else {
                                log(`[Healer] ❌ AI could not find a fix.`);
                            }
                        } catch (healError) {
                            log(`[Healer] Failed to heal: ${healError}`);
                        }
                    }
                    // --- SELF HEALING LOGIC END ---

                    if (this.io) {
                        this.io.emit('recorder:step:error', { index: i, error: stepError.message });
                    }
                    throw stepError;
                }
            }

            log('[Recorder] Script finished successfully');

            // --- VISUAL REGRESSION CHECK ---
            log('[Visual] 📸 Capturing screenshot for Visual Check...');
            const screenshotBuffer = await page.screenshot({ fullPage: true });
            const visualResult = await visualTestService.compare(script.id, screenshotBuffer, script.projectId);

            let finalStatus: 'pass' | 'fail' = 'pass';
            if (visualResult.hasBaseline && visualResult.diffPercentage > 0) {
                log(`[Visual] ⚠️ Mismatch detected: ${visualResult.diffPercentage.toFixed(2)}% difference.`);
                logs.push(`[Visual] ⚠️ Mismatch detected: ${visualResult.diffPercentage.toFixed(2)}%`);
                // Optionally mark as fail, or just 'visual_mismatch' if status supported
                // For now, keeping as PASS but logging warning. 
                // User can reject in UI.
            } else if (!visualResult.hasBaseline) {
                log(`[Visual] 🆕 First run. Saved as new Baseline.`);
            } else {
                log(`[Visual] ✅ Pixel Match! No changes.`);
            }
            // -------------------------------

            await context.close();

            if (scriptWasHealed && foundProjectId) {
                await localProjectService.updateScript(foundProjectId, script.id, { steps: script.steps }, userId || '');
                log('[Recorder] 💾 Script updated with healed selectors.');
            }

            // Finish Unified Run
            await testRunService.updateRun(runId, foundProjectId, { status: 'completed' });

            return { status: 'pass', logs: logs.join('\n') };

        } catch (error: any) {
            log(`[Recorder] Script failed: ${error.message}`, 'error');
            if (context) await context.close();

            // Fail Unified Run
            await testRunService.updateRun(runId, foundProjectId, { status: 'failed' });

            return { status: 'fail', logs: logs.join('\n') };


        }
    }

    /** Generate a Playwright TypeScript test file from a recorded script's steps */
    generatePlaywrightTs(script: { name: string; steps: any[] }): string {
        const fnName = (script.name || 'test').replace(/[^a-zA-Z0-9_]/g, '_').replace(/^\d/, '_$&');
        const baseUrl = script.steps.find((s: any) => s.command === 'open' || s.action === 'navigate')?.target ||
            script.steps.find((s: any) => s.command === 'open' || s.action === 'navigate')?.url || '';

        let lines: string[] = [
            `import { test, expect } from '@playwright/test';`,
            ``,
            `test('${script.name || 'Recorded Test'}', async ({ page }) => {`,
        ];

        for (const step of script.steps) {
            const cmd = step.command || step.action || '';
            const target = step.target || step.selector || '';
            const url = step.url || step.target || '';
            const value = step.value || '';

            // Normalise selector
            let selector = target;
            if (selector.startsWith('css=')) selector = selector.slice(4);
            if (selector.startsWith('id=')) selector = `#${selector.slice(3)}`;
            if (selector.startsWith('name=')) selector = `[name="${selector.slice(5)}"]`;
            // xpath stays as-is, Playwright handles 'xpath=...'

            if (cmd === 'open' || cmd === 'navigate') {
                lines.push(`  await page.goto('${url}');`);
            } else if (cmd === 'click') {
                lines.push(`  await page.locator('${selector}').click();`);
            } else if (cmd === 'type') {
                lines.push(`  await page.locator('${selector}').fill('${value}');`);
            } else if (cmd === 'scroll') {
                lines.push(`  await page.mouse.wheel(0, 500);`);
            } else if (cmd === 'assertText') {
                lines.push(`  await expect(page.locator('${selector}')).toHaveText('${value}');`);
            } else if (cmd === 'assertVisible') {
                lines.push(`  await expect(page.locator('${selector}')).toBeVisible();`);
            }
        }

        lines.push(`});`);
        return lines.join('\n');
    }

    async exportScript(scriptId: string, format: 'side' | 'java' | 'python' | 'playwright-ts', userId?: string) {
        // Find script first (same inefficient scan)
        const allProjects = userId
            ? await localProjectService.getAllProjects(userId)
            : await localProjectService.getAllProjectsSystem();
        let script: any = null;
        for (const p of allProjects) {
            const scripts = await localProjectService.getScripts(p.id, userId || '');
            const match = scripts.find((s: any) => s.id === scriptId);
            if (match) {
                script = match;
                break;
            }
        }

        if (!script) throw new Error('Script not found');

        // Helper to get best selector
        const getBestSelector = (step: any) => {
            if (!step.targets || step.targets.length === 0) return { type: 'css', value: step.target.replace('css=', '') };

            // Priority: id > name > css > xpath
            const id = step.targets.find((t: any[]) => t[1] === 'id');
            if (id) return { type: 'id', value: id[0].replace('id=', '') };

            const name = step.targets.find((t: any[]) => t[1] === 'name');
            if (name) return { type: 'name', value: name[0].replace('name=', '') };

            // Default to target but clean it
            let target = step.target;
            if (target.startsWith('id=')) return { type: 'id', value: target.replace('id=', '') };
            if (target.startsWith('name=')) return { type: 'name', value: target.replace('name=', '') };
            if (target.startsWith('xpath=')) return { type: 'xpath', value: target.replace('xpath=', '') };
            if (target.startsWith('css=')) return { type: 'css', value: target.replace('css=', '') };

            return { type: 'css', value: target };
        };

        if (format === 'side') {
            return {
                id: script.id,
                version: "2.0",
                name: script.name,
                url: script.steps.find((s: any) => s.command === 'open')?.target || "",
                tests: [{
                    id: script.id,
                    name: script.name,
                    commands: script.steps.map((s: any) => {
                        // Ensure targets are in Selenium IDE format: [[value, type], [value, type]]
                        const targets = s.targets && s.targets.length > 0
                            ? s.targets
                            : [[s.target, s.target.startsWith('xpath') ? 'xpath:position' : 'css:finder']];

                        return {
                            id: uuidv4(),
                            comment: "",
                            command: s.command,
                            target: s.target,
                            targets: targets,
                            value: s.value || ""
                        };
                    })
                }],
                suites: [{
                    id: uuidv4(),
                    name: "Default Suite",
                    persistSession: false,
                    parallel: false,
                    timeout: 300,
                    tests: [script.id]
                }],
                urls: [script.steps.find((s: any) => s.command === 'open')?.target || ""],
                plugins: []
            };
        } else if (format === 'playwright-ts') {
            return this.generatePlaywrightTs(script);
        } else if (format === 'java') {
            // Java Playwright (not legacy Selenium)
            const className = (script.name || 'Untitled').replace(/[^a-zA-Z0-9]/g, '');
            const baseUrl = script.steps.find((s: any) => s.command === 'open')?.target || '';
            let code = `import com.microsoft.playwright.*;
import com.microsoft.playwright.options.*;
import org.junit.jupiter.api.*;
import static org.junit.jupiter.api.Assertions.*;

public class ${className}Test {
    static Playwright playwright;
    static Browser browser;
    BrowserContext context;
    Page page;

    @BeforeAll
    static void launchBrowser() {
        playwright = Playwright.create();
        browser = playwright.chromium().launch();
    }

    @AfterAll
    static void closeBrowser() {
        playwright.close();
    }

    @BeforeEach
    void createContextAndPage() {
        context = browser.newContext();
        page = context.newPage();
    }

    @AfterEach
    void closeContext() {
        context.close();
    }

    @Test
    void ${className.charAt(0).toLowerCase() + className.slice(1)}() {
`;
            for (const step of script.steps) {
                const cmd = step.command || step.action || '';
                let sel = (step.target || step.selector || '').replace(/css=/, '').replace(/id=/, '#').replace(/"/g, '\\"');
                if (sel.startsWith('name=')) sel = `[name="${sel.slice(5)}"]`;

                if (cmd === 'open' || cmd === 'navigate') {
                    code += `        page.navigate("${step.target || step.url || ''}");\n`;
                } else if (cmd === 'click') {
                    code += `        page.locator("${sel}").click();\n`;
                } else if (cmd === 'type') {
                    code += `        page.locator("${sel}").fill("${(step.value || '').replace(/"/g, '\\"')}");\n`;
                } else if (cmd === 'scroll') {
                    code += `        page.mouse().wheel(0, 500);\n`;
                }
            }
            code += `    }\n}\n`;
            return code;
        } else if (format === 'python') {
            // Python Playwright (not legacy Selenium)
            const fnName = (script.name || 'untitled').toLowerCase().replace(/[^a-z0-9]/g, '_');
            let code = `import pytest
from playwright.sync_api import Page, expect

def test_${fnName}(page: Page):
`;
            for (const step of script.steps) {
                const cmd = step.command || step.action || '';
                let sel = (step.target || step.selector || '').replace(/css=/, '').replace(/id=/, '#');
                if (sel.startsWith('name=')) sel = `[name="${sel.slice(5)}"]`;

                if (cmd === 'open' || cmd === 'navigate') {
                    code += `    page.goto("${step.target || step.url || ''}")\n`;
                } else if (cmd === 'click') {
                    code += `    page.locator("${sel}").click()\n`;
                } else if (cmd === 'type') {
                    code += `    page.locator("${sel}").fill("${(step.value || '')}")\n`;
                } else if (cmd === 'scroll') {
                    code += `    page.mouse.wheel(0, 500)\n`;
                }
            }
            return code;
        }
    }

    // Deprecated: Reports are now TestRuns.
    // We redirect to ReportService just for compatibility if anyone calls it, 
    // but ideally the frontend should now check 'TestRuns' for everything.
    async getReports(projectId?: string, userId?: string) {
        return this.reportService.getReports(projectId, userId);
    }

    async deleteReport(id: string, userId?: string) {
        return this.reportService.deleteReport(id, userId);
    }
}

export const recorderService = new RecorderService();
