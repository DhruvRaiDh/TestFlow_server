import fs from 'fs';
import path from 'path';
import { parseString } from 'xml2js';
import { promisify } from 'util';

const parseXML = promisify(parseString);

export interface TestNGResults {
    available: boolean;
    totalTests: number;
    passed: number;
    failed: number;
    skipped: number;
    totalTime: number;
    methods: TestMethod[];
    reportPath: string;
}

export interface TestMethod {
    name: string;
    className: string;
    status: 'passed' | 'failed' | 'skipped';
    duration: number;
    startTime: string;
}

export class TestNGParserService {

    /**
     * Parse TestNG results from XML file
     */
    async parseResults(xmlPath: string): Promise<TestNGResults> {
        if (!fs.existsSync(xmlPath)) {
            return {
                available: false,
                totalTests: 0,
                passed: 0,
                failed: 0,
                skipped: 0,
                totalTime: 0,
                methods: [],
                reportPath: ''
            };
        }

        try {
            const xmlContent = fs.readFileSync(xmlPath, 'utf-8');
            const result = await parseXML(xmlContent) as any;

            // Extract test suite data
            const testngResults = result['testng-results'];
            const suite = testngResults.suite?.[0];

            if (!suite) {
                throw new Error('No test suite found in XML');
            }

            // Parse statistics
            const totalTests = parseInt(testngResults.$?.total || '0');
            const passed = parseInt(testngResults.$?.passed || '0');
            const failed = parseInt(testngResults.$?.failed || '0');
            const skipped = parseInt(testngResults.$?.skipped || '0');

            // Parse test methods
            const methods: TestMethod[] = [];
            const tests = suite.test || [];

            for (const test of tests) {
                const classes = test.class || [];

                for (const cls of classes) {
                    const className = cls.$?.name || 'Unknown';
                    const testMethods = cls['test-method'] || [];

                    for (const method of testMethods) {
                        const attrs = method.$;
                        if (!attrs) continue;

                        // Only include actual test methods (not @BeforeClass, @AfterClass)
                        if (attrs['is-config'] === 'true') continue;

                        methods.push({
                            name: attrs.name || 'Unknown',
                            className: className,
                            status: attrs.status === 'PASS' ? 'passed' :
                                attrs.status === 'FAIL' ? 'failed' : 'skipped',
                            duration: parseFloat(attrs['duration-ms'] || '0') / 1000, // Convert to seconds
                            startTime: attrs['started-at'] || ''
                        });
                    }
                }
            }

            // Calculate total time
            const totalTime = methods.reduce((sum, m) => sum + m.duration, 0);

            // Get report path (index.html in same directory)
            const reportDir = path.dirname(xmlPath);
            const reportPath = path.join(reportDir, 'index.html');

            return {
                available: true,
                totalTests,
                passed,
                failed,
                skipped,
                totalTime: Math.round(totalTime * 100) / 100, // Round to 2 decimals
                methods,
                reportPath: fs.existsSync(reportPath) ? reportPath : ''
            };

        } catch (error) {
            console.error('[TestNGParser] Error parsing XML:', error);
            return {
                available: false,
                totalTests: 0,
                passed: 0,
                failed: 0,
                skipped: 0,
                totalTime: 0,
                methods: [],
                reportPath: ''
            };
        }
    }

    /**
     * Get TestNG results for a specific run
     */
    async getResultsForRun(runId: string): Promise<TestNGResults> {
        // Try run-specific output first
        const runSpecificPath = path.join(process.cwd(), 'test-output', runId, 'testng-results.xml');
        if (fs.existsSync(runSpecificPath)) {
            return this.parseResults(runSpecificPath);
        }

        // Fallback to shared test-output (current behavior)
        const sharedPath = path.join(process.cwd(), 'test-output', 'testng-results.xml');
        return this.parseResults(sharedPath);
    }
}

export const testNGParserService = new TestNGParserService();
