# MobiDesk for Windows

Electron desktop app for Android phones and tablets. It discovers devices with ADB, mirrors screens in scrcpy, shows live internal/SD card storage capacity and free space, shows internal and mounted SD storage as root locations, browses folders in list or grid view, filters Documents, Audio, Pictures, and Videos, and previews common media formats, lists and uninstalls user apps, installs APKs, and can display contacts and SMS messages where the device permits ADB shell access.

## Run from source

Install Node.js, then open PowerShell in this folder and run:

```powershell
npm install
npm start
```

## Build a Windows installer

```powershell
npm run dist
```

The installer is written to `release/`.

## Android tools

The Windows installer bundles ADB, scrcpy, and the supporting Windows libraries from the official scrcpy release, so no separate Android utilities are required. The bundled third-party notices are in `tools/ANDROID-TOOLS-NOTICE.txt` and `tools/LICENSE.txt`.

For USB, enable Developer options and USB debugging, connect the device, unlock it, and accept the USB debugging prompt. For Wi-Fi, put the phone and PC on the same network, enable Wireless debugging on Android, and use **Connect a device → Wi-Fi** in MobiDesk. Tap **Find nearby devices**; MobiDesk lists pairing and already-paired devices, so you don't need to type an IP address. First-time pairing still needs the six-digit code shown on the phone. The mirror and its controls open together in one MobiDesk window, with icon-only controls and hover tooltips along the right side.

MobiDesk only operates on devices ADB reports as authorized. The Files page browses shared storage and transfers files; Android restricts protected system and app-private folders. Photos can appear as thumbnails in grid view; common image, video, and audio files can be opened in the preview window. Media preview is limited to 25 MB per file; larger files can be downloaded to the PC. The Apps page installs a selected APK and uninstalls third-party apps after confirmation. Contacts and Messages load only when opened and requested; data is displayed in MobiDesk and is not uploaded by the app. Some Android builds restrict shell access to contacts or SMS. scrcpy is distributed from its [official Windows release](https://github.com/Genymobile/scrcpy/releases) and includes its own ADB executable in that package.


In Files, import files or folders from Windows, select Android items to export or delete them, and filter the list by Pictures, Audio, Documents, and Videos. The navigation sidebar stays visible while scrolling.


On the Files page, storage opens to live capacity cards. Long-press a file or folder to enter selection mode, then export or delete selected items. Use Import files / folders to copy content from Windows into the current Android folder.


The Contacts page shows phone numbers beside contact names. Export a loaded contact list as CSV, or import a vCard (.vcf) and complete the save step on the Android device.


Open any text message in the slide-out details panel to read its full text, sender number, direction, and date.


The navigation sidebar stays fixed beside the app content while you scroll. The Windows app icon uses the MobiDesk phone logo.


The Mirror workspace opens a single mirror window with the scrcpy screen embedded beside the phone controls. Use Back, Recent apps, Vibrate, screenshot, video capture, minimize, or close from the icon rail on the right. Hover over an icon to see its tooltip.
