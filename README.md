# 🏗️ 3DVIEW - Auto DXF Viewer

A React application that automatically visualizes 3D DXF files from a local directory using Three.js and Vite.

## ✨ Features

- **Auto-Loading**: Automatically reads all `.dxf` files from the `/DXF` root directory.
- **3D Visualization**: Renders LINE, 3DFACE, and POLYLINE entities.
- **Auto-Coloring**: Assigns distinct colors to different files/blocks.
- **Interactive**: Orbit controls (Rotate, Pan, Zoom).
- **Wireframe Mode**: Toggle between solid and wireframe rendering.
- **Responsive**: Automatically adjusts to window resizing.

## 🚀 Getting Started

### 1. Installation

```bash
npm install
# or
yarn install
```

### 2. Prepare DXF Files

Create a folder named `DXF` in the project root directory (alongside `src` and `package.json`). Place your `.dxf` files there.

**Recommended Export Settings (AutoCAD):**
- Export as **DXF**
- Version: **AutoCAD 2000** or newer
- Format: **ASCII** (Text)

### 3. Run Development Server

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

## 🎮 Controls

- **Left Click + Drag**: Rotate View
- **Right Click + Drag**: Pan View
- **Scroll Wheel**: Zoom In/Out
- **Sidebar**: Toggle visibility of individual files or switch render modes.

## 🛠️ Tech Stack

- **React 18**: UI Framework
- **Three.js**: 3D Rendering Engine
- **Vite**: Build Tool & Asset Handling
- **Tailwind CSS**: Styling
