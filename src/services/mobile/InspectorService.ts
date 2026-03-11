import { parseStringPromise } from 'xml2js';
import { getPageSource, takeScreenshot } from './AdbDirectService';

// ── XML Element Tree ──────────────────────────────────────────────────────

export interface UIElement {
    index: string;
    text: string;
    resourceId: string;
    className: string;
    contentDesc: string;
    checkable: string;
    checked: string;
    clickable: string;
    enabled: string;
    focusable: string;
    focused: string;
    scrollable: string;
    longClickable: string;
    password: string;
    selected: string;
    bounds: string;
    // parsed bounds
    x1?: number;
    y1?: number;
    x2?: number;
    y2?: number;
    width?: number;
    height?: number;
    // selectors
    bestLocator?: string;
    locatorStrategy?: 'id' | 'xpath' | 'accessibility id' | 'class name';
    children?: UIElement[];
}

function parseBounds(bounds: string): { x1: number; y1: number; x2: number; y2: number; width: number; height: number } | null {
    const m = bounds?.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
    if (!m) return null;
    const [, x1, y1, x2, y2] = m.map(Number);
    return { x1, y1, x2, y2, width: x2 - x1, height: y2 - y1 };
}

function getBestLocator(el: UIElement): { strategy: UIElement['locatorStrategy']; value: string } {
    if (el.resourceId) return { strategy: 'id', value: el.resourceId };
    if (el.contentDesc) return { strategy: 'accessibility id', value: el.contentDesc };
    if (el.text) return { strategy: 'xpath', value: `//*[@text='${el.text}']` };
    return { strategy: 'class name', value: el.className };
}

function xmlNodeToElement(node: any): UIElement {
    const attrs = node.$ || {};
    const el: UIElement = {
        index: attrs.index || '',
        text: attrs.text || '',
        resourceId: attrs['resource-id'] || '',
        className: attrs['class'] || '',
        contentDesc: attrs['content-desc'] || '',
        checkable: attrs.checkable || 'false',
        checked: attrs.checked || 'false',
        clickable: attrs.clickable || 'false',
        enabled: attrs.enabled || 'true',
        focusable: attrs.focusable || 'false',
        focused: attrs.focused || 'false',
        scrollable: attrs.scrollable || 'false',
        longClickable: attrs['long-clickable'] || 'false',
        password: attrs.password || 'false',
        selected: attrs.selected || 'false',
        bounds: attrs.bounds || '',
    };

    const b = parseBounds(el.bounds);
    if (b) Object.assign(el, b);

    const loc = getBestLocator(el);
    el.bestLocator = loc.value;
    el.locatorStrategy = loc.strategy;

    // Recursively parse children
    if (node.node) {
        el.children = node.node.map(xmlNodeToElement);
    }

    return el;
}

export async function getElementTree(deviceId: string): Promise<{ tree: UIElement; screenshotBase64: string }> {
    const [pageSourceRaw, screenshotBuf] = await Promise.all([
        getPageSource(deviceId),
        takeScreenshot(deviceId),
    ]);

    // xml2js parse
    const parsed = await parseStringPromise(pageSourceRaw, { explicitArray: true });
    const root = parsed?.hierarchy?.node?.[0];
    if (!root) throw new Error('Could not parse UI hierarchy');

    const tree = xmlNodeToElement(root);
    const screenshotBase64 = screenshotBuf.toString('base64');

    return { tree, screenshotBase64 };
}

export async function findElementByCoords(deviceId: string, x: number, y: number): Promise<UIElement | null> {
    const { tree } = await getElementTree(deviceId);

    function findAt(el: UIElement): UIElement | null {
        if (el.x1 !== undefined && el.x2 !== undefined && el.y1 !== undefined && el.y2 !== undefined) {
            if (x >= el.x1 && x <= el.x2 && y >= el.y1 && y <= el.y2) {
                // Check children first (more specific)
                if (el.children) {
                    for (const child of el.children) {
                        const found = findAt(child);
                        if (found) return found;
                    }
                }
                return el;
            }
        }
        if (el.children) {
            for (const child of el.children) {
                const found = findAt(child);
                if (found) return found;
            }
        }
        return null;
    }

    return findAt(tree);
}
