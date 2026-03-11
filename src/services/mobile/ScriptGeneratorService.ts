import { ScriptStep } from './ScriptStorageService';

// ── WebdriverIO Script Generator ──────────────────────────────────────────

interface GeneratorConfig {
    deviceId: string;
    appPackage?: string;
    appActivity?: string;
    bundleId?: string;
    platform?: 'android' | 'ios';
}

export function generateWebdriverIOScript(steps: ScriptStep[], config: GeneratorConfig): string {
    const { deviceId, appPackage, appActivity, platform = 'android' } = config;

    const caps = platform === 'android' ? `{
    platformName: 'Android',
    'appium:automationName': 'UiAutomator2',
    'appium:deviceName': '${deviceId}',
    'appium:udid': '${deviceId}',
    ${appPackage ? `'appium:appPackage': '${appPackage}',` : ''}
    ${appActivity ? `'appium:appActivity': '${appActivity}',` : ''}
    'appium:noReset': true,
    'appium:newCommandTimeout': 300,
  }` : `{
    platformName: 'iOS',
    'appium:automationName': 'XCUITest',
    'appium:deviceName': '${deviceId}',
    'appium:udid': '${deviceId}',
    'appium:noReset': true,
  }`;

    const stepLines = steps.map((step, i) => {
        const idx = i + 1;
        switch (step.action) {
            case 'tap':
                if (step.locator && step.locatorStrategy === 'id') {
                    return `  // Step ${idx}: Tap — ${step.elementLabel || step.locator}
  await driver.$('[resource-id="${step.locator}"]').click();`;
                } else if (step.locator && step.locatorStrategy === 'accessibility id') {
                    return `  // Step ${idx}: Tap — ${step.elementLabel || step.locator}
  await driver.$('~${step.locator}').click();`;
                } else if (step.locator) {
                    return `  // Step ${idx}: Tap — ${step.elementLabel || step.locator}
  await driver.$(${JSON.stringify(step.locator)}).click();`;
                }
                return `  // Step ${idx}: Tap at (${step.x}, ${step.y})
  await driver.touchAction({ action: 'tap', x: ${step.x}, y: ${step.y} });`;

            case 'doubleTap':
                return `  // Step ${idx}: Double Tap at (${step.x}, ${step.y})
  const el${idx} = await driver.$('${step.locator || `*`}');
  await driver.touchAction([{ action: 'tap', element: el${idx} }, { action: 'tap', element: el${idx} }]);`;

            case 'longPress':
                return `  // Step ${idx}: Long Press at (${step.x}, ${step.y})
  await driver.touchAction([
    { action: 'longPress', x: ${step.x}, y: ${step.y} },
    { action: 'release' }
  ]);`;

            case 'swipe':
                return `  // Step ${idx}: Swipe (${step.startX},${step.startY}) → (${step.endX},${step.endY})
  await driver.touchAction([
    { action: 'press', x: ${step.startX}, y: ${step.startY} },
    { action: 'wait', ms: 300 },
    { action: 'moveTo', x: ${step.endX}, y: ${step.endY} },
    { action: 'release' }
  ]);`;

            case 'type':
                if (step.locator) {
                    return `  // Step ${idx}: Type "${step.value}"
  await driver.$('[resource-id="${step.locator}"]').setValue(${JSON.stringify(step.value)});`;
                }
                return `  // Step ${idx}: Type "${step.value}" (no specific element)
  await driver.keys(${JSON.stringify(step.value?.split('') || [])});`;

            case 'back':
                return `  // Step ${idx}: Back
  await driver.back();`;

            case 'home':
                return `  // Step ${idx}: Home
  await driver.pressKeyCode(3); // KEYCODE_HOME`;

            case 'wait':
                return `  // Step ${idx}: Wait ${step.value}ms
  await driver.pause(${step.value || 1000});`;

            case 'assertVisible':
                if (step.locator) {
                    return `  // Step ${idx}: Assert visible — ${step.elementLabel || step.locator}
  const isVisible${idx} = await driver.$('[resource-id="${step.locator}"]').isDisplayed();
  console.assert(isVisible${idx}, 'Element should be visible: ${step.locator}');`;
                }
                return `  // Step ${idx}: Assert visible (no locator)`;

            case 'assertText':
                return `  // Step ${idx}: Assert text "${step.assertion?.expected}"
  const text${idx} = await driver.$('[resource-id="${step.locator}"]').getText();
  console.assert(text${idx} === ${JSON.stringify(step.assertion?.expected)}, \`Expected "${step.assertion?.expected}" got \${text${idx}}\`);`;

            case 'scroll':
                return `  // Step ${idx}: Scroll
  await driver.touchAction([
    { action: 'press', x: 540, y: 1400 },
    { action: 'wait', ms: 300 },
    { action: 'moveTo', x: 540, y: 400 },
    { action: 'release' }
  ]);`;

            default:
                return `  // Step ${idx}: ${step.action} (unsupported — manual implementation needed)`;
        }
    }).join('\n\n');

    return `import { remote } from 'webdriverio';

async function runMobileTest() {
  const driver = await remote({
    hostname: 'localhost',
    port: 4723,
    path: '/',
    logLevel: 'error',
    capabilities: ${caps},
  });

  try {
${stepLines}

    console.log('✅ Test passed');
  } catch (err) {
    console.error('❌ Test failed:', err);
    throw err;
  } finally {
    await driver.deleteSession();
  }
}

runMobileTest();
`;
}
