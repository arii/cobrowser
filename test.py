import json
import time
import threading
from selenium import webdriver
from selenium.webdriver.common.by import By

# --- CONFIGURATION ---
SESSION_FILE = "linux_interactions_session.json"
TARGET_URL = "https://wikipedia.org"

# Shared flag to safely control background execution
recording_active = True
captured_actions = []

def monitor_terminal():
    """Listens for the stop command on a separate background thread."""
    global recording_active
    while recording_active:
        user_input = input().strip().lower()
        if user_input == 'stop':
            recording_active = False
            break

def record_session():
    """Polls the focused elements inside the browser using standard WebDriver tools."""
    global recording_active
    recording_active = True
    
    print("Launching Linux-compatible browser tracker...")
    options = webdriver.ChromeOptions()
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-web-security")
    
    driver = webdriver.Chrome(options=options)
    driver.get(TARGET_URL)
    driver.maximize_window()

    print("\n>>> RECORDING STARTED! Click and type inside the browser window.")
    print(">>> When finished, type 'stop' in this terminal and press Enter.")
    print("Type 'stop' to finish recording: ")

    # Kick off the terminal monitoring thread
    threading.Thread(target=monitor_terminal, daemon=True).start()

    last_active_element = None
    last_text_value = ""

    # High frequency polling loop (runs completely inside Python, bypassing CSP headers)
    while recording_active:
        try:
            # Query Chrome natively for whatever element currently has focus
            active_element = driver.switch_to.active_element
            element_tag = active_element.tag_name.lower()
            
            # --- CRITERIA 1: CAPTURE MOUSE CLICKS ---
            if active_element != last_active_element:
                # Build a CSS locator path for the newly clicked element
                element_id = active_element.get_attribute("id")
                element_class = active_element.get_attribute("class")
                
                if element_id:
                    selector = f"{element_tag}#{element_id}"
                elif element_class:
                    first_class = element_class.split()[0]
                    selector = f"{element_tag}.{first_class}"
                else:
                    selector = element_tag

                # If the user clicked a non-input element (like a button or link)
                if element_tag not in ["input", "textarea"]:
                    action_item = {"action": "click", "selector": selector}
                    if not captured_actions or captured_actions[-1] != action_item:
                        captured_actions.append(action_item)
                        print(f"   [Logged Click] -> {selector}")
                
                # Reset keystroke states for the new element focus window
                last_active_element = active_element
                last_text_value = ""

            # --- CRITERIA 2: CAPTURE TYPED TEXT INPUT ---
            if element_tag in ["input", "textarea"]:
                current_text = active_element.get_attribute("value") or ""
                if current_text != last_text_value:
                    # Update or append the typed keys string seamlessly
                    element_id = active_element.get_attribute("id")
                    selector = f"{element_tag}#{element_id}" if element_id else element_tag
                    
                    action_item = {"action": "type", "selector": selector, "value": current_text}
                    
                    # Overwrite the trailing record if it's the same field to avoid single character spam
                    if captured_actions and captured_actions[-1]["selector"] == selector and captured_actions[-1]["action"] == "type":
                        captured_actions[-1]["value"] = current_text
                    else:
                        captured_actions.append(action_item)
                    
                    print(f"   [Logged Typing] -> In {selector}: \"{current_text}\"")
                    last_text_value = current_text

        except Exception:
            pass  # Safely handle transient layout frames during page reloads
        
        time.sleep(0.15)  # 150ms check cycle balance

    driver.quit()
    
    # Save the actions schema mapping configuration
    with open(SESSION_FILE, "w") as f:
        json.dump(captured_actions, f, indent=4)
    print(f"\nSuccessfully saved {len(captured_actions)} interactions to {SESSION_FILE}!")


def playback_session():
    """Reads the JSON sequence log map and recreates the events via pure WebDriver calls."""
    try:
        with open(SESSION_FILE, "r") as f:
            actions = json.load(f)
    except FileNotFoundError:
        print(f"Error: {SESSION_FILE} not found!")
        return

    if not actions:
        print("No actions found to play back.")
        return

    print(f"\nInitializing playback engine for {len(actions)} steps...")
    driver = webdriver.Chrome()
    driver.get(TARGET_URL)
    driver.maximize_window()
    time.sleep(2)

    for index, event in enumerate(actions):
        selector = event["selector"]
        try:
            element = driver.find_element(By.CSS_SELECTOR, selector)
            
            if event["action"] == "click":
                print(f"[{index + 1}/{len(actions)}] Clicking element: {selector}")
                element.click()
                time.sleep(2.0)
                
            elif event["action"] == "type":
                print(f"[{index + 1}/{len(actions)}] Typing \"{event['value']}\" into: {selector}")
                element.clear()
                element.send_keys(event["value"])
                time.sleep(1.0)
                
        except Exception as e:
            print(f"    Skipped step {index + 1} for selector: {selector}. (Not visible or page updated)")

    print("\nPlayback complete! Closing browser.")
    time.sleep(2)
    driver.quit()

if __name__ == "__main__":
    record_session()
    playback_session()

