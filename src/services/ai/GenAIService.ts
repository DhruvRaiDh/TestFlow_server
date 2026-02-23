import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';
import dotenv from 'dotenv';
import path from 'path';
import * as fs from 'fs';
// import { supabase } from '../lib/supabase';
import OpenAI from 'openai';
import { settingsService } from '../persistence/SettingsService';
import { localProjectService } from '../persistence/LocalProjectService';
import { logger } from '../../lib/logger';

// Load env from backend root
dotenv.config({ path: path.join(__dirname, '../../../.env') });

// Helper to write to log file for debugging
const logErrorToFile = (message: string, error: unknown) => {
    const logPath = path.join(__dirname, '../../../ai_debug.log');
    const timestamp = new Date().toISOString();

    let errorDetails = '';
    if (error instanceof Error) {
        errorDetails = error.stack || error.message;
    } else {
        errorDetails = JSON.stringify(error);
    }

    const logEntry = `\n[${timestamp}] ${message}\nError: ${errorDetails}\n-------------------\n`;

    try {
        fs.appendFileSync(logPath, logEntry);
    } catch (writeError: unknown) {
        if (writeError instanceof Error) {
            logger.error('Failed to write to AI debug log file', writeError);
        }
    }
};

const logResponseToFile = (message: string, content: string) => {
    const logPath = path.join(__dirname, '../../../ai_debug.log');
    const timestamp = new Date().toISOString();
    const logEntry = `\n[${timestamp}] ${message}\nContent Preview: ${content.substring(0, 500)}...\n-------------------\n`;
    try {
        fs.appendFileSync(logPath, logEntry);
    } catch (writeError: unknown) {
        if (writeError instanceof Error) {
            logger.error('Failed to write response to AI debug log file', writeError);
        }
    }
};

interface AIConfig {
    apiKey?: string;
    model?: string;
    provider?: 'google' | 'openai' | 'groq' | 'custom';
    baseUrl?: string;
}

export class GenAIService {
    private defaultGenAI: GoogleGenerativeAI;
    private defaultModel: any;

    constructor() {
        const apiKey = process.env.GEMINI_API_KEY;
        console.log(`[GenAIService] Initializing default with API Key present: ${!!apiKey}`);

        if (!apiKey) {
            console.error('[GenAIService] FATAL: GEMINI_API_KEY is missing in environment variables!');
            this.defaultGenAI = new GoogleGenerativeAI('dummy_key');
        } else {
            this.defaultGenAI = new GoogleGenerativeAI(apiKey);
        }

        // Default Model
        this.defaultModel = this.defaultGenAI.getGenerativeModel({
            model: "gemini-1.5-flash",
            safetySettings: this.getSafetySettings()
        });
        console.log(`[GenAIService] Default Active Model: gemini-1.5-flash`);
    }

    private getSafetySettings() {
        return [
            { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
        ];
    }

    // Helper to write to log file for debugging
    private logDebug(message: string) {
        const logPath = path.join(__dirname, '../../../ai_debug.log');
        const timestamp = new Date().toISOString();
        const logEntry = `\n[${timestamp}] [DEBUG] ${message}\n`;
        try {
            fs.appendFileSync(logPath, logEntry);
        } catch (e) {
            console.error("Failed to write to log file:", e);
        }
    }

    // Helper to get active configuration (Default or Custom from DB)
    private async getActiveConfig(userId?: string): Promise<AIConfig> {
        this.logDebug(`getActiveConfig called for userId: '${userId}'`);

        if (!userId) {
            this.logDebug(`No UserID provided, using system default (Google).`);
            return { provider: 'google' };
        }

        try {
            // Fetch active key for user via Settings Service (Local)
            // Fetch active key for user via Settings Service (Local)
            // PASS TRUE to get raw key for execution!
            const keys = await settingsService.getAIKeys(userId, true);
            const keyData = keys.find(k => k.is_active);

            if (keyData && keyData.api_key) {
                this.logDebug(`⚡ Using CUSTOM API KEY for user ${userId} (${keyData.name}) - Provider: ${keyData.provider || 'google'}`);
                return {
                    apiKey: keyData.api_key,
                    model: keyData.model || this.getDefaultModelForProvider(keyData.provider),
                    provider: (keyData.provider as any) || 'google',
                    // baseUrl: keyData.base_url // interface missing base_url, assuming default for now
                };
            } else {
                this.logDebug(`No active key found for user ${userId}.`);
            }
        } catch (e) {
            this.logDebug(`Exception in getActiveConfig: ${JSON.stringify(e)}`);
        }

        this.logDebug(`Using System Default for user ${userId} (Fallback)`);
        return { provider: 'google' };
    }

    private getDefaultModelForProvider(provider?: string): string {
        switch (provider) {
            case 'openai': return 'gpt-4o';
            case 'groq': return 'llama-3.3-70b-versatile';
            default: return 'gemini-1.5-flash';
        }
    }

    // Unified Generation Method (Strategy Pattern)
    private async generateContentUnified(prompt: string, userId?: string): Promise<string> {
        console.log(`[AI-LOG] 🚀 Unified Generation Started. User: ${userId || 'system'}`);
        const config = await this.getActiveConfig(userId);

        if (config.provider === 'openai' || config.provider === 'groq' || config.provider === 'custom') {
            console.log(`[AI-LOG] 📡 Using OpenAI-compatible provider: ${config.provider}`);
            return this.generateOpenAI(config, prompt);
        } else {
            console.log(`[AI-LOG] 📡 Using Google Gemini provider`);
            return this.generateGoogle(config, prompt);
        }
    }

    // Google Implementation
    private async generateGoogle(config: AIConfig, prompt: string): Promise<string> {
        try {
            let model;
            if (config.apiKey) {
                const genAI = new GoogleGenerativeAI(config.apiKey);
                model = genAI.getGenerativeModel({
                    model: config.model || "gemini-1.5-flash",
                    safetySettings: this.getSafetySettings()
                });
            } else {
                model = this.defaultModel;
            }

            const result = await model.generateContent(prompt);
            const response = await result.response;
            return response.text();
        } catch (error) {
            logErrorToFile("Google Generation Failed", error);
            throw error;
        }
    }

    // OpenAI/Groq Implementation
    private async generateOpenAI(config: AIConfig, prompt: string): Promise<string> {
        try {
            let baseURL = config.baseUrl;

            // Auto-configure Groq URL if not set
            if (!baseURL && config.provider === 'groq') {
                baseURL = 'https://api.groq.com/openai/v1';
            }

            this.logDebug(`[GenAIService] FINAL CONFIG -> Provider: '${config.provider}', BaseURL: '${baseURL}', KeyLength: ${config.apiKey?.length}`);

            const openai = new OpenAI({
                apiKey: config.apiKey,
                baseURL: baseURL || undefined
            });

            console.log(`[GenAIService] Calling OpenAI Compatible API. Provider: ${config.provider}, Model: ${config.model}, URL: ${baseURL || 'default'}`);

            // SECURITY DEBUG: Log masked key to verify it is being read correctly
            const maskedKey = config.apiKey ? `${config.apiKey.substring(0, 4)}...${config.apiKey.substring(config.apiKey.length - 4)}` : 'undefined';
            this.logDebug(`Attempting generation with Key: ${maskedKey}, Provider: ${config.provider}, BaseURL: ${baseURL}`);

            const completion = await openai.chat.completions.create({
                messages: [{ role: "user", content: prompt }],
                model: config.model || (config.provider === 'groq' ? 'llama3-70b-8192' : "gpt-4o"),
                max_tokens: 16000,
            });

            return completion.choices[0].message.content || "";
        } catch (error) {
            logErrorToFile(`${config.provider} Generation Failed`, error);
            console.error("OpenAI/Groq Error:", error);
            throw error;
        }
    }

    async generateFlow(userPrompt: string, userId?: string): Promise<{ nodes: any[], edges: any[] }> {
        const prompt = `
        Act as a Test Automation Architect.
        Convert the following User Scenario into a JSON structure for a Node-Based Flow Editor.
        
        User Scenario: "${userPrompt}"

        The output must be a single JSON object containing "nodes" and "edges".
        
        Node Types Available:
        - "navigate": params: { url: string } (Label: "Navigate")
        - "click": params: { selector: string } (Label: "Click")
        - "type": params: { selector: string, value: string } (Label: "Type")
        - "wait": params: { value: string (ms) } (Label: "Wait")
        - "screenshot": params: {} (Label: "Screenshot")
        - "condition": params: {} (Label: "If/Else") (Output ports: "true", "false")
        - "loop": params: { count: string } (Label: "Loop")
        - "assert_visible": params: { selector: string } (Label: "Assert Visible")
        - "assert_visible": params: { selector: string } (Label: "Assert Visible")
        - "assert_text": params: { selector: string, value: string } (Label: "Check Text")
        - "use_data": params: { datasetId: string } (Label: "Use Data") (Use this for CSV/Data iteration)
        
        Layout Rules:
        - Start at x: 100, y: 100
        - Space nodes vertically by 100px (e.g. y: 100, y: 200, y: 300)
        - Generate simple sequential IDs (1, 2, 3...)
        - Connect them sequentially with edges (source: "1", target: "2").
        - If "dataset", "csv", or "data" is mentioned, START with a "use_data" node (Node 1) before the Loop or Navigation.

        JSON Structure Example:
        {
          "nodes": [
            { "id": "1", "position": { "x": 100, "y": 100 }, "data": { "action": "navigate", "params": { "url": "..." }, "label": "Nav to Google" }, "type": "default" },
            { "id": "2", "position": { "x": 100, "y": 200 }, "data": { "action": "type", "params": { "selector": "...", "value": "" }, "label": "Type Search" }, "type": "default" }
          ],
          "edges": [
            { "id": "e1-2", "source": "1", "target": "2" }
          ]
        }
        
        Output ONLY valid JSON. No markdown.
        `;

        const text = await this.generateContentUnified(prompt, userId);
        try {
            // Heuristic to extract JSON
            const jsonStart = text.indexOf('{');
            const jsonEnd = text.lastIndexOf('}');
            if (jsonStart !== -1 && jsonEnd !== -1) {
                return JSON.parse(text.substring(jsonStart, jsonEnd + 1));
            }
            return JSON.parse(text);
        } catch (e) {
            console.error("Failed to parse Flow Generation JSON", text);
            throw new Error("AI returned invalid JSON for flow.");
        }
    }


    async generateTestCases(requirements: string, userId?: string): Promise<string> {
        return this.generateContentUnified(`
        Act as a QA Engineer. Based on the following requirements, generate a list of structured test cases.
        For each test case, provide:
        - Test Scenario
        - Pre-conditions
        - Test Steps
        - Expected Result

        Requirements:
        "${requirements}"

        Format the output as a Markdown list.
        `, userId);
    }

    async summarizeBug(description: string, userId?: string): Promise<any> {
        const prompt = `
        Act as a QA Lead. Analyze the following verbose bug description/logs and generate a structured Bug Report.
        
        Bug Input:
        "${description}"

        Output format (JSON only):
        {
            "title": "Concise and Descriptive Bug Title",
            "description": "Professional summary of the issue",
            "stepsToReproduce": "Numbered list of reproduction steps inferred from input (e.g. 1. Step one 2. Step two)",
            "expectedResult": "What should happen",
            "actualResult": "What is actually happening",
            "severity": "Critical | High | Medium | Low",
            "priority": "P1 | P2 | P3 | P4"
        }
        `;

        const text = await this.generateContentUnified(prompt, userId);
        try {
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (jsonMatch) return JSON.parse(jsonMatch[0]);
            return JSON.parse(text);
        } catch (e) {
            console.error("Failed to parse JSON from AI response", text);
            throw new Error("Invalid JSON response from AI");
        }
    }

    async generateStructuredTestCase(prompt: string, userId?: string): Promise<any> {
        const systemPrompt = `
        Act as a Senior QA Automation Engineer.
        Your task is to generate a comprehensive SINGLE Test Case based on the user's description.
        You must strictly output VALID JSON that matches the following structure. Do not include markdown formatting or backticks.

        JSON Structure:
        {
            "module": "Suggest a module name based on context (e.g., Login, Checkout)",
            "testCaseId": "TC_AI_001", 
            "testScenario": "Brief one-line summary of the test",
            "testCaseDescription": "Detailed purpose of the test",
            "preConditions": "Numbered list of prerequisites (e.g., 1. User exists)",
            "testSteps": "Numbered list of steps (e.g., 1. Go to login page 2. Enter creds)",
            "testData": "Any user/input data needed (e.g. valid credentials)",
            "expectedResult": "Final success state description",
            "actualResult": "",
            "status": "Not Executed",
            "comments": "Generated by AI"
        }

        Rules:
        1. 'preConditions' and 'testSteps' MUST be plain text numbered lists. DO NOT use HTML tags like <ul> or <ol>.
        2. 'testCaseId' should be a placeholder like TC_GEN_01.
        
        User Prompt: "${prompt}"
        `;

        const text = await this.generateContentUnified(systemPrompt, userId);
        try {
            const jsonStart = text.indexOf('{');
            const jsonEnd = text.lastIndexOf('}');
            if (jsonStart !== -1 && jsonEnd !== -1) {
                return JSON.parse(text.substring(jsonStart, jsonEnd + 1));
            }
            return JSON.parse(text);
        } catch (e) {
            console.error("Failed to parse JSON from AI response", text);
            throw new Error("Invalid JSON response from AI");
        }
    }

    async generateBulkTestCases(prompt: string, userId?: string): Promise<any[]> {
        console.log("--> BACKEND: GenAIService generating BULK test cases, prompt len:", prompt.length);

        const systemPrompt = `
        CRITICAL REQUIREMENT: Generate EXACTLY 50 test cases. No more, no less.
        
        GOAL: Create comprehensive test coverage for the described module/feature.
        
        COVERAGE REQUIREMENTS (must total exactly 50):
        1. Happy Path Scenarios (20 test cases)
        2. Edge Cases (10 test cases)
        3. Negative Scenarios (10 test cases)
        4. Error Handling (7 test cases)
        5. Additional Scenarios (3 test cases)
        
        ID GENERATION RULES:
        1. Analyze the user's input to determine the Module Name.
           - Use a short 3-4 letter uppercase prefix (e.g., "Login" -> "LOG", "Payments" -> "PAY").
        2. Generate SEQUENTIAL IDs from 001 to 050 (e.g., LOG-001 ... LOG-050).
           - Do NOT repeat IDs.

        OUTPUT FORMAT:
        Output a VALID JSON ARRAY of exactly 50 objects. No markdown, no backticks, no text outside JSON.
        
        Each object must match:
        {
            "module": "Inferred Module Name",
            "testCaseId": "Dynamic ID (e.g. LOG-001)",
            "testScenario": "Clear one-line summary",
            "testCaseDescription": "Detailed purpose of the test",
            "preConditions": "Numbered list (e.g. 1. User is logged in\\n2. Database is accessible)",
            "testSteps": "Numbered list (e.g. 1. Navigate to page\\n2. Enter data\\n3. Click submit)",
            "testData": "Required input data",
            "expectedResult": "Expected outcome",
            "actualResult": "",
            "status": "Pending",
            "comments": "Auto-generated - Type: [Happy Path/Edge Case/Negative/Error Handling]"
        }

        User Flow Description: "${prompt}"
        `;

        const text = await this.generateContentUnified(systemPrompt, userId);
        console.log("--> BACKEND: AI Response Length:", text.length);
        logResponseToFile("generateBulkTestCases Response", text);

        try {
            // Heuristic: OpenAI sometimes returns simple content, sometimes markdown. 
            // We need to find the array brackets.
            const jsonStart = text.indexOf('[');
            const jsonEnd = text.lastIndexOf(']');
            if (jsonStart !== -1 && jsonEnd !== -1) {
                return JSON.parse(text.substring(jsonStart, jsonEnd + 1));
            }
            return JSON.parse(text);
        } catch (error) {
            logErrorToFile("generateBulkTestCases Failed", error);
            console.error("Error generating bulk test cases:", error);
            throw new Error(`Failed to generate bulk test cases: ${(error as Error).message}`);
        }
    }

    async healSelector(htmlSnippet: string, oldSelector: string, errorMsg: string, userId?: string): Promise<string | null> {
        const prompt = `
        Act as a Test Automation Expert (Playwright).
        A test failed because the element with selector "${oldSelector}" was not found.
        
        Error Message: "${errorMsg}"
        
        Using the provided HTML Snippet of the current page state, identify the NEW selector for the element that most likely corresponds to the old one.
        Analyze attributes like id, class, name, text content, and structure.
        
        HTML Snippet:
        \`\`\`html
        ${htmlSnippet.substring(0, 15000)} 
        \`\`\`
        
        (Note: HTML is truncated to 15k chars to fit context window if large).

        OUTPUT FORMAT:
        Return ONLY the new selector string. Do not return JSON. Do not return Markdown. 
        If you cannot confidently find the element, return "null" (string).
        `;

        try {
            const text = (await this.generateContentUnified(prompt, userId)).trim();
            if (text.toLowerCase() === 'null') return null;
            return text.replace(/`/g, '').replace(/"/g, '').replace(/'/g, '');
        } catch (error) {
            logErrorToFile("healSelector Failed", error);
            console.error("Error healing selector:", error);
            return null;
        }
    }

    async analyzeRunFailure(runId: string, userId?: string, projectId?: string): Promise<any> {
        console.log(`[AI-LOG] 🔍 Analyzing failure for Run ID: ${runId}`);

        try {
            let runData = null;
            let logs = [];

            if (projectId) {
                console.log(`[AI-LOG] 📂 Fetching data for Project: ${projectId}`);
                const runInfo = await localProjectService.findTestRunById(runId);
                if (runInfo) {
                    runData = runInfo.run;
                    logs = runInfo.logs;
                    console.log(`[AI-LOG] ✅ Found run in project ${runInfo.projectId}`);
                }
            } else {
                console.log(`[AI-LOG] 🕵️ No ProjectID provided. Scanning all projects for Run ID: ${runId}`);
                const runInfo = await localProjectService.findTestRunById(runId);
                if (runInfo) {
                    runData = runInfo.run;
                    logs = runInfo.logs;
                    console.log(`[AI-LOG] ✅ Found run in project ${runInfo.projectId}`);
                }
            }

            if (!runData) {
                console.warn(`[AI-LOG] ⚠️ Could not find run data for ID: ${runId}`);
                return {
                    failureReason: "Run data not found",
                    technicalRootCause: "The requested run ID does not exist in local storage.",
                    suggestedFix: "Check if the run was deleted or if the ID is correct.",
                    confidenceScore: 0.0
                };
            }

            const errorMsg = runData.error_message || "Unknown error";
            const lastLogs = logs.slice(-10).map((l: any) => `[${l.status}] ${l.message}`).join('\n');

            console.log(`[AI-LOG] 🧠 Sending logs to AI for analysis. Error: ${errorMsg}`);

            const prompt = `
            Act as a Senior Test Automation Engineer. Analyze the following failed test execution.
            
            Run ID: ${runId}
            Error Message: "${errorMsg}"
            
            Last 10 Log Entries:
            ${lastLogs}
            
            Output format (JSON only):
            {
                "failureReason": "Concise summary of why the test failed (Human readable)",
                "technicalRootCause": "Brief technical explanation (e.g., Timeout while waiting for selector #login-btn)",
                "suggestedFix": "Concrete steps to fix this (e.g., Update selector to .btn-primary or increase timeout)",
                "confidenceScore": 0.0-1.0
            }
            `;

            const text = await this.generateContentUnified(prompt, userId);
            console.log(`[AI-LOG] ✨ AI Analysis complete for ${runId}`);

            try {
                const jsonMatch = text.match(/\{[\s\S]*\}/);
                if (jsonMatch) return JSON.parse(jsonMatch[0]);
                return JSON.parse(text);
            } catch (e) {
                console.error("[AI-LOG] ❌ Failed to parse AI JSON response", text);
                return {
                    failureReason: "Analysis parsing failed",
                    technicalRootCause: text.substring(0, 100),
                    suggestedFix: "Consult direct logs.",
                    confidenceScore: 0.1
                };
            }

        } catch (error: any) {
            console.error("[AI-LOG] ❌ analyzeRunFailure Error:", error);
            throw new Error(`Analysis failed: ${error.message}`);
        }
    }
}

export const genAIService = new GenAIService();
