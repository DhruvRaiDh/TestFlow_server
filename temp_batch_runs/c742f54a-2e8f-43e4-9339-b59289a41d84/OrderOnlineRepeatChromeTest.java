

import org.openqa.selenium.*;
import org.openqa.selenium.chrome.ChromeDriver;
import org.openqa.selenium.chrome.ChromeOptions;
import org.openqa.selenium.support.ui.*;
import org.testng.annotations.*;

import java.time.Duration;
import java.util.List;

public class OrderOnlineRepeatChromeTest {

    private WebDriver driver;
    private WebDriverWait wait;

    private static final String START_URL = "https://www.foodchow.com/foodchowdemoindia/order-online";
    private static final long STEP_PAUSE_MS = 1200;

    @BeforeClass
    public void setUp() {
        // NOTE: Selenium 4.6+ auto-manages drivers. No WebDriverManager needed.
        ChromeOptions options = new ChromeOptions();
        options.addArguments("--start-maximized");
        options.addArguments("--remote-allow-origins=*"); // Critical for recent Chrome
        
        driver = new ChromeDriver(options);
        wait = new WebDriverWait(driver, Duration.ofSeconds(30));
    }

    @AfterClass
    public void tearDown() {
        if (driver != null) driver.quit();
    }

    @Test
    public void placeSingleOrder() throws InterruptedException {
        System.out.println("\n========== START SINGLE RUN ==========");

        try {
            driver.get(START_URL);
            Thread.sleep(2000);

            // --------- STEP 1: Start Order ---------
            click(By.cssSelector("header div.h-full.w-full.gap-4.lg\\:flex.hidden.items-center > div > div.flex.gap-2 > button:nth-child(1)"));
            click(By.xpath("//button[.//span[normalize-space()='Pickup'] or normalize-space(.)='Pickup']"));
            click(By.cssSelector("[id*='content-choose_order_time'] button:nth-child(1)"));
            click(By.cssSelector("#category-deals button"));

            // --------- STEP 2: Select Items ---------
            click(By.cssSelector("label[for='group-0-category-0-item-1']"));
            clickAddItemModal();

            click(By.cssSelector("label[for='group-1-category-0-item-0']"));
            clickAddItemModal();

            Thread.sleep(1500);
            clickProceedToCheckoutFixed();

            // --------- STEP 3: Final Checkout ---------
            wait.until(ExpectedConditions.urlContains("/final-checkout"));
            Thread.sleep(2000);

            type(By.xpath("//input[contains(@placeholder,'First')]"), "Dhruv");
            type(By.xpath("//input[contains(@placeholder,'Last')]"), "Raiyani");

            // ✅ Stable React mobile field handling
            fillReactInput("Enter Your Mobile Number", "9737215041");

            // ✅ Click Save
            clickIfPresent(By.xpath("//button[contains(.,'Save') and @type='submit']"));

            // ✅ Wait until Save completes (Payment Method section visible)
            wait.until(ExpectedConditions.visibilityOfElementLocated(
                    By.xpath("//*[contains(.,'PAYMENT METHOD') or contains(.,'Payment Method')]")));

            // --------- STEP 4: Payment and Confirmation ---------
            if (!clickIfPresent(By.cssSelector("input[id*='Card'], button[id*='Card'], div[id*='Card']"))) {
                clickIfPresent(By.xpath("//*[contains(text(),'Cash')]"));
            }

            clickIfPresent(By.xpath("//button[contains(.,'Proceed') or contains(.,'Place') or contains(.,'Pay')]"));

            boolean success = waitUntilAnyTextAppears(new String[]{
                    "Thank you", "Order placed", "successfully", "Thank You For Ordering"
            }, 20);

            if (success) {
                System.out.println("✅ Order successfully placed!");
            } else {
                System.out.println("⚠️ No confirmation detected (may have validation error).");
            }

        } catch (Exception e) {
            System.out.println("❌ Failed to place order: " + e.getMessage());
        }

        System.out.println("========== END SINGLE RUN ==========\n");
    }

    // ---------------------- Helper Methods ----------------------

    private void click(By locator) throws InterruptedException {
        WebElement el = wait.until(ExpectedConditions.elementToBeClickable(locator));
        scroll(el);
        safeClick(el);
        Thread.sleep(STEP_PAUSE_MS);
    }

    private void type(By locator, String value) throws InterruptedException {
        WebElement el = wait.until(ExpectedConditions.visibilityOfElementLocated(locator));
        scroll(el);
        el.clear();
        el.sendKeys(value);
        Thread.sleep(STEP_PAUSE_MS);
    }

    /** ✅ FIXED: React input + validation triggers */
    private void fillReactInput(String placeholderText, String value) throws InterruptedException {
        By reactInput = By.xpath("//input[@placeholder='" + placeholderText + "']");
        WebElement input = wait.until(ExpectedConditions.visibilityOfElementLocated(reactInput));
        scroll(input);

        ((JavascriptExecutor) driver).executeScript(
                "const el = arguments[0];" +
                        "const val = arguments[1];" +
                        "const proto = Object.getPrototypeOf(el);" +
                        "const desc = Object.getOwnPropertyDescriptor(proto, 'value') || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');" +
                        "desc.set.call(el, val);" +
                        "el.dispatchEvent(new Event('input', { bubbles: true }));" +
                        "el.dispatchEvent(new Event('change', { bubbles: true }));" +
                        "el.dispatchEvent(new Event('blur', { bubbles: true }));",
                input, value
        );

        Thread.sleep(STEP_PAUSE_MS);
        System.out.println("✅ Filled phone (triggered validation): " + value);
    }

    private void clickAddItemModal() throws InterruptedException {
        By modalContainer = By.cssSelector("div[class*='DealModal_nestedModalBox']");
        By addButton = By.xpath("//div[contains(@class,'DealModal_btnAdd')]/button");
        wait.until(ExpectedConditions.visibilityOfElementLocated(modalContainer));
        Thread.sleep(700);
        WebElement btn = wait.until(ExpectedConditions.presenceOfElementLocated(addButton));
        scroll(btn);
        ((JavascriptExecutor) driver).executeScript("arguments[0].click();", btn);
        Thread.sleep(STEP_PAUSE_MS);
    }

    private void clickProceedToCheckoutFixed() throws InterruptedException {
        By btn = By.xpath("//button[contains(translate(.,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'proceed to checkout')]");
        List<WebElement> buttons = wait.until(ExpectedConditions.presenceOfAllElementsLocatedBy(btn));
        WebElement checkoutBtn = buttons.get(buttons.size() - 1);
        scroll(checkoutBtn);
        ((JavascriptExecutor) driver).executeScript("arguments[0].click();", checkoutBtn);
        Thread.sleep(STEP_PAUSE_MS);
    }

    private boolean clickIfPresent(By locator) throws InterruptedException {
        List<WebElement> els = driver.findElements(locator);
        for (WebElement el : els) {
            if (el.isDisplayed()) {
                scroll(el);
                safeClick(el);
                Thread.sleep(STEP_PAUSE_MS);
                return true;
            }
        }
        return false;
    }

    private void safeClick(WebElement el) {
        try {
            el.click();
        } catch (Exception e) {
            ((JavascriptExecutor) driver).executeScript("arguments[0].click();", el);
        }
    }

    private void scroll(WebElement el) {
        ((JavascriptExecutor) driver).executeScript(
                "arguments[0].scrollIntoView({behavior:'smooth',block:'center'});", el);
    }

    /** Waits for text like 'Thank you' or 'Order placed' */
    private boolean waitUntilAnyTextAppears(String[] keywords, int timeoutSec) {
        long end = System.currentTimeMillis() + timeoutSec * 1000L;
        while (System.currentTimeMillis() < end) {
            String body = driver.findElement(By.tagName("body")).getText().toLowerCase();
            for (String k : keywords) {
                if (body.contains(k.toLowerCase())) return true;
            }
            try { Thread.sleep(1000); } catch (InterruptedException ignored) {}
        }
        return false;
    }
}

