# ⚙️ Test-flow Backend Server

The powerhouse execution engine for the **Test-flow** automation suite. This backend handles test orchestration, script execution (Python/Playwright), mobile device connections (Appium), and file logging, serving as the core API for the Bug-Binder desktop application.

---

## 🎯 Features

### 🚀 Execution Engine
- **Test Orchestration** - Manages test lifecycles, batch runs, and execution tracking.
- **Python Integration** - Wraps and executes Python-based automation scripts safely within isolated environments.
- **Playwright Support** - Powers deep web-browser automation capabilities.
- **Temporary Workspaces** - Dynamically generates `temp_execution` and `temp_batch_runs` directories for safe execution contexts.

### 📱 Device Management
- **Appium Bridging** - Facilitates connections to mobile devices for recording and automated testing.
- **Device Logs** - Streams real-time device logs back to the frontend IDE.

### 💾 File & Artifact Management
- **Test Outputs** - Automatically structures test results, screenshots, and logs into `test-output` and `test-results` directories.
- **Safe State Tracking** - Uses dynamic JSON validation (`validate_json.js`) to ensure communications remain uncorrupted.

---

## 🛠️ Tech Stack

| Technology | Purpose |
|------------|---------|
| **Node.js & Express** | Runtime environment and core API framework |
| **Playwright** | Next-generation web automation & testing library |
| **Python** | Script execution and legacy test-wrapper support |
| **Powershell / Bash** | Native deployment and dependency scripts |

---

## 📁 Project Structure

While the architecture is continuously evolving and being refactored, here is the current core layout:

```text
TestFlow_server/
├── data/                    # Persistent storage and configuration data
├── scripts/                 # Core execution wrappers and utility functions
├── src/                     # Main Express server and API routes
├── temp_execution/          # (Auto-generated) Ephemeral test run environments
├── test-output/             # (Auto-generated) Final reports and artifacts
├── download_dependencies.ps1# Setup script for rapid environment configuration
├── setup_python.js          # Bootstraps the local Python venv internally
├── validate_json.js         # Core data integrity checker
├── package.json
└── README.md                # This file
```

---

## 🚀 Getting Started

### Prerequisites
- **Node.js** (v18 or higher)
- **Python 3** (Installed and added to System PATH)
- **Git**

### Local Setup

1. **Navigate to the Backend Directory**
   ```bash
   cd backend
   ```

2. **Install Node Dependencies**
   ```bash
   npm install
   ```

3. **Initialize the Python Environment**
   Run the bootstrapping script to dynamically configure the local Python environment required for automation scripts:
   ```bash
   node setup_python.js
   ```

4. **Start the Server**
   ```bash
   npm start
   ```
   *The server will spin up and listen for commands from the Bug-Binder Frontend.*

---

## 📊 Core Responsibilities

1. **Listen:** Waits for execution triggers or device connection requests from the desktop IDE.
2. **Setup:** Builds a temporary workspace in `temp_execution/`.
3. **Execute:** Fires Playwright or Python scripts against the target application.
4. **Report:** Gathers generated screenshots, `.log` files, and JSON boundaries and securely passes them back to the client.

---

## 🤝 Current Architecture Status

> [!NOTE] 
> **Work in Progress:** This backend handles a massive amount of cross-language execution (Node -> Python -> External Devices). The architecture is currently being refactored from a rapid-prototype structure into a more standardized service-repository pattern. 

---

## 👨‍💻 Author

**Dhruv Rai**  
*Part of the complete Test-flow Automation Suite*