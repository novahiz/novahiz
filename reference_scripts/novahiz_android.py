#!/usr/bin/env python3
"""
⚡ Novahiz Android Autonomous Launcher (Headed Mode)
Automatically detects AVDs, boots the visual Android emulator window, waits for boot,
and launches the Expo/React Native project without any manual intervention.
"""

import os
import sys
import time
import shutil
import argparse
import subprocess
import json

def find_android_tools():
    sdk_root = os.environ.get("ANDROID_HOME") or os.environ.get("ANDROID_SDK_ROOT")
    user_home = os.path.expanduser("~")
    
    potential_emulator_paths = [
        shutil.which("emulator"),
        os.path.join(user_home, "AppData", "Local", "Android", "Sdk", "emulator", "emulator.exe"),
        "/Applications/Android Studio.app/Contents/jre/jdk/Contents/Home/bin/emulator",
        os.path.join(user_home, "Android", "Sdk", "emulator", "emulator"),
    ]
    
    potential_adb_paths = [
        shutil.which("adb"),
        os.path.join(user_home, "AppData", "Local", "Android", "Sdk", "platform-tools", "adb.exe"),
        os.path.join(user_home, "Android", "Sdk", "platform-tools", "adb"),
    ]
    
    emulator_cmd = next((p for p in potential_emulator_paths if p and os.path.isfile(p)), "emulator")
    adb_cmd = next((p for p in potential_adb_paths if p and os.path.isfile(p)), "adb")
    
    return emulator_cmd, adb_cmd

def get_running_devices(adb_cmd):
    try:
        res = subprocess.run([adb_cmd, "devices"], capture_output=True, text=True, timeout=5)
        lines = res.stdout.strip().split("\n")[1:]
        devices = []
        for l in lines:
            parts = l.strip().split()
            if len(parts) >= 2 and parts[1] == "device":
                devices.append(parts[0])
        return devices
    except Exception:
        return []

def list_avds(emulator_cmd):
    try:
        res = subprocess.run([emulator_cmd, "-list-avds"], capture_output=True, text=True, timeout=5)
        avds = [line.strip() for line in res.stdout.strip().split("\n") if line.strip()]
        return avds
    except Exception:
        return []

def launch_headed_emulator(emulator_cmd, avd_name):
    # Headed mode = standard GUI window enabled (no -no-window)
    cmd = [emulator_cmd, "-avd", avd_name]
    
    if sys.platform == "win32":
        DETACHED_PROCESS = 0x00000008
        CREATE_NEW_PROCESS_GROUP = 0x00000200
        process = subprocess.Popen(
            cmd,
            creationflags=DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            close_fds=True
        )
    else:
        process = subprocess.Popen(
            cmd,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True
        )
    return process.pid

def wait_for_boot(adb_cmd, max_seconds=45):
    start = time.time()
    while time.time() - start < max_seconds:
        try:
            res = subprocess.run(
                [adb_cmd, "shell", "getprop", "sys.boot_completed"],
                capture_output=True,
                text=True,
                timeout=4
            )
            if res.stdout.strip() == "1":
                return True
        except Exception:
            pass
        time.sleep(2)
    return False

def launch_expo_app(project_dir):
    if not os.path.isdir(project_dir):
        return None
    
    cmd = ["npx", "expo", "start", "--android"]
    if sys.platform == "win32":
        DETACHED_PROCESS = 0x00000008
        proc = subprocess.Popen(
            cmd,
            cwd=project_dir,
            shell=True,
            creationflags=DETACHED_PROCESS,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL
        )
    else:
        proc = subprocess.Popen(
            cmd,
            cwd=project_dir,
            shell=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True
        )
    return proc.pid

def main():
    parser = argparse.ArgumentParser(description="Novahiz Autonomous Android Headed Launcher")
    parser.add_argument("--project-dir", type=str, default="", help="Path to Expo / React Native project")
    parser.add_argument("--avd", type=str, default="", help="Specific AVD name to launch")
    args = parser.parse_args()

    emulator_cmd, adb_cmd = find_android_tools()
    
    # 1. Check if an emulator is already running
    running_devs = get_running_devices(adb_cmd)
    avd_used = args.avd
    
    if not running_devs:
        available_avds = list_avds(emulator_cmd)
        if not available_avds:
            print(json.dumps({
                "success": False,
                "error": "NO_AVD_FOUND",
                "message": "Aucun émulateur Android (AVD) n'est installé. Créez-en un dans Android Studio."
            }))
            sys.exit(1)
        
        avd_used = args.avd if (args.avd and args.avd in available_avds) else available_avds[0]
        pid = launch_headed_emulator(emulator_cmd, avd_used)
        booted = wait_for_boot(adb_cmd, max_seconds=40)
        running_devs = get_running_devices(adb_cmd)
    else:
        booted = True
        avd_used = "running-device"
    
    # 2. Launch Expo project if requested
    metro_pid = None
    if args.project_dir and os.path.isdir(args.project_dir):
        metro_pid = launch_expo_app(args.project_dir)

    result = {
        "success": True,
        "avd": avd_used,
        "mode": "HEADED_VISUAL",
        "devices": running_devs,
        "booted": booted,
        "metro_pid": metro_pid,
        "project_dir": args.project_dir or "none",
        "message": f"Émulateur Android '{avd_used}' lancé avec succès en mode fenêtré (Headed) sur votre écran !"
    }
    
    print(json.dumps(result, indent=2))

if __name__ == "__main__":
    main()
