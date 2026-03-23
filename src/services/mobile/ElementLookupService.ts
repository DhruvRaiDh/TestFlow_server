import { getElementTree, findElementByCoords, UIElement } from './InspectorService';

// ── ElementLookupService ──────────────────────────────────────────────────────
//
// Finds elements on screen by locator strategy during replay.
// Used by RunnerService to locate elements by their saved selector
// and return their center coordinates for accurate tapping.
// ─────────────────────────────────────────────────────────────────────────────

interface FoundElement {
    x: number;
    y: number;
    element: UIElement;
}

/**
 * Find an element by its locator strategy and value.
 * Returns the center (x,y) coordinates to tap.
 */
export async function findElementByLocator(
    deviceId: string,
    locatorStrategy: string,
    locatorValue: string,
): Promise<FoundElement | null> {
    const { tree } = await getElementTree(deviceId);

    const match = findInTree(tree, locatorStrategy, locatorValue);
    if (!match) return null;

    // Calculate center coordinates
    if (match.x1 !== undefined && match.x2 !== undefined && match.y1 !== undefined && match.y2 !== undefined) {
        return {
            x: Math.round((match.x1 + match.x2) / 2),
            y: Math.round((match.y1 + match.y2) / 2),
            element: match,
        };
    }
    return null;
}

/**
 * Search the UI tree for an element matching the locator.
 */
function findInTree(el: UIElement, strategy: string, value: string): UIElement | null {
    // Check current element
    if (matches(el, strategy, value)) return el;

    // Recurse children
    if (el.children) {
        for (const child of el.children) {
            const found = findInTree(child, strategy, value);
            if (found) return found;
        }
    }
    return null;
}

/**
 * Check if an element matches the given locator strategy.
 */
function matches(el: UIElement, strategy: string, value: string): boolean {
    switch (strategy) {
        case 'id':
            return el.resourceId === value;

        case 'accessibility id':
            return el.contentDesc === value;

        case 'class name':
            return el.className === value;

        case 'xpath':
            // Simple xpath matching — handles common patterns
            // //*[@text='Login'] or //*[@resource-id='com.app:id/btn']
            const textMatch = value.match(/@text='([^']+)'/);
            if (textMatch && el.text === textMatch[1]) return true;

            const idMatch = value.match(/@resource-id='([^']+)'/);
            if (idMatch && el.resourceId === idMatch[1]) return true;

            const descMatch = value.match(/@content-desc='([^']+)'/);
            if (descMatch && el.contentDesc === descMatch[1]) return true;

            return false;

        case 'text':
            return el.text === value;

        default:
            return false;
    }
}

/**
 * Try multiple strategies to find an element — used during replay.
 * First tries the saved locator, then falls back to finding by text or resource-id.
 */
export async function findElementForReplay(
    deviceId: string,
    step: { locator?: string; locatorStrategy?: string; elementLabel?: string; text?: string; resourceId?: string; x?: number; y?: number },
): Promise<{ x: number; y: number } | null> {
    // Strategy 1: Use saved locator
    if (step.locator && step.locatorStrategy) {
        const found = await findElementByLocator(deviceId, step.locatorStrategy, step.locator);
        if (found) {
            console.log(`[ElementLookup] Found by ${step.locatorStrategy}="${step.locator}" → (${found.x}, ${found.y})`);
            return { x: found.x, y: found.y };
        }
    }

    // Strategy 2: Try to find by text from elementLabel
    if (step.elementLabel && !step.elementLabel.startsWith('(') && !step.elementLabel.startsWith('📱')) {
        const found = await findElementByLocator(deviceId, 'text', step.elementLabel);
        if (found) {
            console.log(`[ElementLookup] Found by text="${step.elementLabel}" → (${found.x}, ${found.y})`);
            return { x: found.x, y: found.y };
        }
    }

    // Strategy 3: Fall back to saved coordinates
    if (step.x !== undefined && step.y !== undefined) {
        console.log(`[ElementLookup] Falling back to saved coords (${step.x}, ${step.y})`);
        return { x: step.x, y: step.y };
    }

    return null;
}
