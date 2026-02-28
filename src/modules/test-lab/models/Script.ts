// Model: Script
// Represents an automation script stored in Test Lab

export type ScriptLanguage = 'typescript' | 'python' | 'java' | 'javascript';
export type ScriptSource = 'recorder' | 'manual' | 'ai' | 'devstudio';

export interface RecordedStep {
    action: 'click' | 'type' | 'navigate' | 'scroll' | 'hover' | 'assert';
    selector?: string;
    value?: string;
    url?: string;
    timestamp: number;
}

export interface Script {
    id: string;
    projectId: string;
    name: string;
    description?: string;
    language: ScriptLanguage;
    source: ScriptSource;
    content: string;           // Full source code (TypeScript/Python/Java)
    steps?: RecordedStep[];    // Original recorded steps (if source = recorder)
    tags?: string[];
    createdAt: string;
    updatedAt: string;
}

export type CreateScriptDto = Omit<Script, 'id' | 'createdAt' | 'updatedAt'>;
export type UpdateScriptDto = Partial<Pick<Script, 'name' | 'description' | 'content' | 'tags'>>;
