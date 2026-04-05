# Polar Clock — Lively Wallpaper Setup Guide

Use the Polar Clock as an animated desktop wallpaper with [Lively Wallpaper](https://www.rocksdanister.com/lively/), a free and open-source animated wallpaper app.

---

## 1. Install Lively Wallpaper

### Windows (Microsoft Store — recommended)

1. Open the **Microsoft Store** (pre-installed on Windows 10/11)
2. Search for **Lively Wallpaper**
3. Click **Get** and wait for it to install
4. Launch Lively from the Start menu

Requires Windows 10 version 1809 or later.

### Windows (GitHub — manual install)

1. Go to [github.com/rocksdanister/lively/releases](https://github.com/rocksdanister/lively/releases)
2. Download the latest `.exe` installer from the **Assets** section
3. Run the installer and follow the prompts
4. Launch Lively from the Start menu

### Linux

Lively does not currently support Linux. The [lively-linux](https://github.com/rocksdanister/lively-linux) project exists but wallpaper functionality is not yet working — only the basic UI loads.

**Linux alternatives for animated wallpapers:**

- **Komorebi** — supports video and web wallpapers, actively maintained
- **Hidamari** — Python-based, supports video backgrounds
- You can also open the exported `index.html` directly in a fullscreen borderless browser window as a lightweight alternative

---

## 2. Export the Polar Clock Wallpaper

1. Open the Polar Clock page in Devy's Workshop
2. Click the **Settings** gear icon (top-right) or press **S**
3. Configure the clock however you like — palette, background animation, rings, position, etc.
4. Scroll to the bottom of the settings panel and expand **Export as Wallpaper**
5. Click **Lively Wallpaper**
6. A file called `polar-clock-lively.zip` will download

---

## 3. Import into Lively

1. **Extract the zip** — right-click `polar-clock-lively.zip` and choose *Extract All*. You should get a folder containing:
   - `index.html` — the wallpaper itself
   - `LivelyProperties.json` — configuration for Lively's property panel
2. Open **Lively Wallpaper**
3. Click the **+** (plus) button in the top-left of the Library
4. Click **Browse**
5. Navigate into the extracted folder and select `index.html`
6. Lively imports the wallpaper and it appears as a tile in your Library
7. **Click the tile** to set it as your wallpaper

---

## 4. Customize After Import

Once the wallpaper is active, you can adjust settings directly from Lively:

- **Right-click the wallpaper tile** in the Library and select **Customize**
- The properties panel lets you change:
  - Color palette
  - Background animation
  - Background opacity
  - Clock position (left, center, right)
  - Which rings to show (seconds, minutes, hours, days, months, etc.)
  - Timezone and city label
  - Smooth vs discrete animation
  - Show/hide city name and date

Changes take effect immediately — no need to re-export.

---

## 5. Performance Notes

- Lively automatically **pauses the wallpaper** when a fullscreen app (like a game) is in focus, dropping to ~0% CPU/GPU usage
- You can adjust the frame rate and resolution scaling in Lively's settings if needed
- The Polar Clock uses lightweight SVG rendering — CPU usage is minimal
- Background animations (especially Julia Set and Mandelbrot) use WebGL and are slightly more GPU-intensive, but still very light

---

## Troubleshooting

**Wallpaper shows a blank screen:**
- Make sure you extracted the zip first — Lively can't read files inside a zip
- Verify the folder contains both `index.html` and `LivelyProperties.json`

**Properties panel is empty:**
- The `LivelyProperties.json` file may be missing from the folder — re-export from the Polar Clock settings

**Clock looks wrong or frozen:**
- Try a different browser engine in Lively's settings (Settings > General > Web Browser)
- Ensure your system clock is set correctly — the wallpaper reads the system time
