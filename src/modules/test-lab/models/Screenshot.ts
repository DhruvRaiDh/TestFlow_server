// Model: Screenshot
// Represents a screenshot captured during a recording session or test run

export type ScreenshotTrigger = 'step' | 'stop' | 'failure' | 'manual';

export interface Screenshot {
    id: string;
    projectId: string;
    sessionId: string;     // Recording session ID or run ID
    sessionName: string;   // Script name or run label
    stepIndex: number;     // Step number in the recording (0-based)
    stepAction?: string;   // e.g. 'click', 'navigate'
    stepTarget?: string;   // e.g. selector or URL
    trigger: ScreenshotTrigger;
    filename: string;      // e.g. step-001.png
    filepath: string;      // Absolute path on disk
    url?: string;          // Page URL when screenshot was taken
    timestamp: string;
}

export type CreateScreenshotDto = Omit<Screenshot, 'id' | 'timestamp'>;
