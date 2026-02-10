from selenium import webdriver
from selenium.webdriver.chrome.service import Service
import time

# 1. Initialize the Chrome Driver
driver = webdriver.Chrome()

try:
    # 2. Open Google
    driver.get("https://www.google.com")
    print("Browser opened to Google.")

    # 3. Wait for 5 seconds
    time.sleep(5)

finally:
    # 4. Exit/Close the browser
    driver.quit()
    print("Browser closed successfully.")