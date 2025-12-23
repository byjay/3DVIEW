import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { DXFFile } from '../types';
import {
  ChevronRight, ChevronDown, Layers, Box, Maximize, Palette, CheckSquare, Square,
  MousePointer, Scissors, Eye, EyeOff, Home
} from 'lucide-react';

interface MultiDXFViewerProps {
  files: DXFFile[];
}

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------
interface DXFEntity {
  type: string;
  layer?: string;
  x?: number; y?: number; z?: number;
  x1?: number; y1?: number; z1?: number;
  x2?: number; y2?: number; z2?: number;
  x3?: number; y3?: number; z3?: number; // 3DFACE
  vertices?: { x: number, y: number, z: number }[];
  blockName?: string;
  radius?: number; // Circle/Arc
  startAngle?: number; // Arc
  endAngle?: number; // Arc
  rotation?: number;
  scale?: { x: number, y: number, z: number };
  closed?: boolean;
  [key: string]: any;
}

interface LayerInfo {
  name: string;
  visible: boolean;
  color?: string;
  count: number;
}

interface LoadedFileState extends DXFFile {
  loaded: boolean; // Is it in the scene?
  visible: boolean; // Is the whole file visible?
  layers: LayerInfo[];
}

// ----------------------------------------------------------------------------
// Component
// ----------------------------------------------------------------------------

const MultiDXFViewer: React.FC<MultiDXFViewerProps> = ({ files }) => {
  // Anti-translate attribute
  const containerRef = useRef<HTMLDivElement>(null);

  // App State
  const [parsing, setParsing] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [previewFiles, setPreviewFiles] = useState<DXFFile[]>([]); // For Modal

  // Scene State
  const [fileStates, setFileStates] = useState<LoadedFileState[]>([]);
  const [renderMode, setRenderMode] = useState<'shaded' | 'wireframe' | 'xray' | 'sizeMap'>('shaded');

  // Slice / Section Box State
  interface SliceSettings {
    enabled: boolean;
    bounds: {
      xMin: number; xMax: number;
      yMin: number; yMax: number;
      zMin: number; zMax: number;
    }
  }
  const [sliceSettings, setSliceSettings] = useState<SliceSettings>({
    enabled: false,
    bounds: { xMin: -1000, xMax: 1000, yMin: -1000, yMax: 1000, zMin: -1000, zMax: 1000 }
  });
  const [sceneBounds, setSceneBounds] = useState<{ min: THREE.Vector3, max: THREE.Vector3 }>({
    min: new THREE.Vector3(-1000, -1000, -1000),
    max: new THREE.Vector3(1000, 1000, 1000)
  });

  const [gizmoMode, setGizmoMode] = useState<'translate' | 'scale' | 'none'>('scale');

  // Refs for permanent objects to avoid re-creation loops
  const visualBoxRef = useRef<THREE.LineSegments | null>(null);
  const transformControlRef = useRef<TransformControls | null>(null);
  const isDraggingRef = useRef(false);

  // Three.js Refs
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const objectsMapRef = useRef<Map<string, THREE.Group>>(new Map()); // "fileId" -> Group
  // UI State
  const [expandedNodes, setExpandedNodes] = useState<Record<string, boolean>>({}); // "fileId", "fileId-layerName"
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);

  // ... (Three init...)

  // Fit to Selection Logic
  const handleFitToSelection = () => {
    if (!selectedObjectId || !sceneRef.current) return;

    const fileId = selectedObjectId; // Assuming simple file selection for now
    const group = objectsMapRef.current.get(fileId);

    if (group) {
      const box = new THREE.Box3().setFromObject(group);
      if (!box.isEmpty()) {
        const size = box.getSize(new THREE.Vector3());
        const min = box.min;
        const max = box.max;
        // Add slight padding 1%
        const pad = size.multiplyScalar(0.01);

        setSliceSettings(prev => ({
          ...prev,
          enabled: true,
          bounds: {
            xMin: min.x - pad.x, xMax: max.x + pad.x,
            yMin: min.y - pad.y, yMax: max.y + pad.y,
            zMin: min.z - pad.z, zMax: max.z + pad.z,
          }
        }));
      }
    }
  };

  // Update Clipping Planes & Visual Box & Gizmo
  useEffect(() => {
    if (!rendererRef.current || !sceneRef.current || !cameraRef.current || !controlsRef.current) return;

    // 1. Clipping Planes (Always update based on state)
    if (sliceSettings.enabled) {
      const planes = [
        new THREE.Plane(new THREE.Vector3(1, 0, 0), -sliceSettings.bounds.xMin),
        new THREE.Plane(new THREE.Vector3(-1, 0, 0), sliceSettings.bounds.xMax),
        new THREE.Plane(new THREE.Vector3(0, 1, 0), -sliceSettings.bounds.yMin),
        new THREE.Plane(new THREE.Vector3(0, -1, 0), sliceSettings.bounds.yMax),
        new THREE.Plane(new THREE.Vector3(0, 0, 1), -sliceSettings.bounds.zMin),
        new THREE.Plane(new THREE.Vector3(0, 0, -1), sliceSettings.bounds.zMax)
      ];
      rendererRef.current.clippingPlanes = planes;
    } else {
      rendererRef.current.clippingPlanes = [];
    }

    // 2. Visual Box & Gizmo Management
    const boxName = 'slice-visual-box';

    // Create Gizmo if not exists
    if (!transformControlRef.current) {
      const tControls = new TransformControls(cameraRef.current, rendererRef.current.domElement);
      tControls.addEventListener('dragging-changed', (event) => {
        if (controlsRef.current) controlsRef.current.enabled = !event.value;
        isDraggingRef.current = event.value;

        // On Drag End: Sync back to React State to update sliders
        if (!event.value) {
          syncBoxToState();
        }
      });
      tControls.addEventListener('change', () => {
        if (isDraggingRef.current) {
          // Real-time update of planes while dragging
          syncPlanesFromBox();
        }
      });
      sceneRef.current.add(tControls);
      transformControlRef.current = tControls;
    }

    // Helper to sync Box Transform -> Clipping Planes (Real-time)
    const syncPlanesFromBox = () => {
      if (!visualBoxRef.current || !rendererRef.current) return;
      const box = new THREE.Box3().setFromObject(visualBoxRef.current);

      const planes = [
        new THREE.Plane(new THREE.Vector3(1, 0, 0), -box.min.x),
        new THREE.Plane(new THREE.Vector3(-1, 0, 0), box.max.x),
        new THREE.Plane(new THREE.Vector3(0, 1, 0), -box.min.y),
        new THREE.Plane(new THREE.Vector3(0, -1, 0), box.max.y),
        new THREE.Plane(new THREE.Vector3(0, 0, 1), -box.min.z),
        new THREE.Plane(new THREE.Vector3(0, 0, -1), box.max.z)
      ];
      rendererRef.current.clippingPlanes = planes;
    };

    // Helper to sync Box Transform -> React State (Finalize)
    const syncBoxToState = () => {
      if (!visualBoxRef.current) return;
      const box = new THREE.Box3().setFromObject(visualBoxRef.current);
      setSliceSettings(prev => ({
        ...prev,
        bounds: {
          xMin: box.min.x, xMax: box.max.x,
          yMin: box.min.y, yMax: box.max.y,
          zMin: box.min.z, zMax: box.max.z
        }
      }));
    };


    if (sliceSettings.enabled) {
      // Calculate dimensions from State
      const width = sliceSettings.bounds.xMax - sliceSettings.bounds.xMin;
      const height = sliceSettings.bounds.yMax - sliceSettings.bounds.yMin;
      const depth = sliceSettings.bounds.zMax - sliceSettings.bounds.zMin;

      const centerX = sliceSettings.bounds.xMin + width / 2;
      const centerY = sliceSettings.bounds.yMin + height / 2;
      const centerZ = sliceSettings.bounds.zMin + depth / 2;

      if (width > 0 && height > 0 && depth > 0) {
        // Create or Update Box
        if (!visualBoxRef.current) {
          // Initialize
          // Note: We use a Unit Box and Scale it, so transform controls work better for scaling?
          // Actually, resizing a BoxGeometry via TransformControls 'scale' works fine.
          const geometry = new THREE.BoxGeometry(1, 1, 1);
          const edges = new THREE.EdgesGeometry(geometry);
          const material = new THREE.LineBasicMaterial({ color: 0x00ffff, opacity: 0.5, transparent: true });
          const boxLines = new THREE.LineSegments(edges, material);
          boxLines.name = boxName;
          sceneRef.current.add(boxLines);
          visualBoxRef.current = boxLines;
        }

        // If NOT dragging, we force the box to match the State
        // (If dragging, the gizmo controls the box, so we don't overwrite it)
        if (!isDraggingRef.current && visualBoxRef.current) {
          visualBoxRef.current.position.set(centerX, centerY, centerZ);
          visualBoxRef.current.scale.set(width, height, depth);
        }

        // Attach Gizmo
        if (transformControlRef.current) {
          if (transformControlRef.current.object !== visualBoxRef.current) {
            transformControlRef.current.attach(visualBoxRef.current);
          }
          transformControlRef.current.setMode(gizmoMode === 'none' ? 'translate' : gizmoMode); // default fallback
          transformControlRef.current.visible = gizmoMode !== 'none';
          transformControlRef.current.enabled = gizmoMode !== 'none';
        }
      }
    } else {
      // Cleanup
      if (visualBoxRef.current) {
        sceneRef.current.remove(visualBoxRef.current);
        visualBoxRef.current = null;
      }
      if (transformControlRef.current) {
        transformControlRef.current.detach();
      }
    }

  }, [sliceSettings, rendererRef.current, sceneRef.current, gizmoMode]); // Re-run if mode changes



  // Three.js Refs


  // 1. Initialize Three.js
  useEffect(() => {
    if (!containerRef.current) return;
    if (rendererRef.current) { rendererRef.current.dispose(); containerRef.current.innerHTML = ''; }

    const width = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x111111); // Dark Gray/Black
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1000000); // Huge far clip for large DXFs
    camera.position.set(1000, 1000, 1000);
    camera.up.set(0, 0, 1); // Z-up for CAD
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, logarithmicDepthBuffer: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.localClippingEnabled = true; // Enable clipping for Section Box
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.2;
    controls.screenSpacePanning = true;
    controlsRef.current = controls;

    // Lighting
    scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.5);
    dirLight.position.set(100, 200, 300);
    scene.add(dirLight);

    // Grid (Navisworks style: subtle)
    const gridHelper = new THREE.GridHelper(5000, 50, 0x333333, 0x222222);
    gridHelper.rotation.x = Math.PI / 2;
    scene.add(gridHelper);
    scene.add(new THREE.AxesHelper(500));

    // Animation Loop
    const animate = () => {
      requestAnimationFrame(animate);
      if (controlsRef.current) controlsRef.current.update();
      if (rendererRef.current && sceneRef.current && cameraRef.current) {
        rendererRef.current.render(sceneRef.current, cameraRef.current);
      }
    };
    animate();

    const handleResize = () => {
      if (!containerRef.current || !cameraRef.current || !rendererRef.current) return;
      const w = containerRef.current.clientWidth;
      const h = containerRef.current.clientHeight;
      cameraRef.current.aspect = w / h;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      renderer.dispose();
      if (containerRef.current) containerRef.current.innerHTML = '';
    };
  }, []);

  // 2. Handle File Changes -> Open Modal
  useEffect(() => {
    if (files.length > 0) {
      // Just show modal with list of files. No parsing yet (optimization).
      setPreviewFiles(files.map(f => ({ ...f }))); // Clone
      setShowModal(true);
    } else {
      setShowModal(false);
      clearScene();
    }
  }, [files]);

  const clearScene = () => {
    if (!sceneRef.current) return;
    objectsMapRef.current.forEach(g => sceneRef.current?.remove(g));
    objectsMapRef.current.clear();
    setFileStates([]);
  };

  // 3. Import Selected Files
  const handleImport = async (selectedFiles: DXFFile[]) => {
    setShowModal(false);
    setParsing(true);

    // Clear existing
    clearScene();

    const newFileStates: LoadedFileState[] = [];

    // Process each file
    // We do ONE robust parse per file.
    for (const file of selectedFiles) {
      // Init State
      const fState: LoadedFileState = { ...file, loaded: true, visible: true, layers: [] };

      if (file.content) {
        // Parse & Build
        try {
          const { group, layers } = await parseAndBuildDXF(file.content, file.color);
          group.name = file.id;

          if (sceneRef.current) sceneRef.current.add(group);
          objectsMapRef.current.set(file.id, group);

          fState.layers = layers;
          setExpandedNodes(prev => ({ ...prev, [file.id]: true })); // Auto Expand
        } catch (e) {
          console.error("Parse Fail", e);
        }
      }
      newFileStates.push(fState);
    }

    setFileStates(newFileStates);
    setParsing(false);

    // Defer bounds calc & fit view
    setTimeout(() => {
      calculateSceneBounds();
      handleFitView();
    }, 100);
  };

  const calculateSceneBounds = () => {
    if (!sceneRef.current) return;
    const box = new THREE.Box3();
    let hasObj = false;
    sceneRef.current.traverse(o => {
      if ((o.type === 'Line' || o.type === 'Mesh') && o.visible) {
        box.expandByObject(o);
        hasObj = true;
      }
    });

    if (hasObj && !box.isEmpty()) {
      const size = box.getSize(new THREE.Vector3());
      const min = box.min;
      const max = box.max;

      // Pad slightly
      const pad = size.multiplyScalar(0.1);
      const exactMin = min.clone().sub(pad);
      const exactMax = max.clone().add(pad);

      setSceneBounds({ min: exactMin, max: exactMax });

      // Initialize slice bounds if they look "default"
      setSliceSettings(prev => {
        // Only reset if we are freshly loading or it's way off? 
        // Let's just reset to full bounds on new load for convenience
        return {
          enabled: prev.enabled,
          bounds: {
            xMin: exactMin.x, xMax: exactMax.x,
            yMin: exactMin.y, yMax: exactMax.y,
            zMin: exactMin.z, zMax: exactMax.z
          }
        };
      });
    }
  };

  // --------------------------------------------------------------------------
  // Core Business Logic: Robust Parsing
  // --------------------------------------------------------------------------
  const parseAndBuildDXF = async (data: string, colorHex: string): Promise<{ group: THREE.Group, layers: LayerInfo[] }> => {
    return new Promise((resolve) => {
      // Basic Parser
      const lines = data.split(/\r?\n/);
      const entities: DXFEntity[] = [];
      const blocks: Record<string, DXFEntity[]> = {};
      let currentBlockName: string | null = null;
      let currentBlockEnts: DXFEntity[] = [];
      let currentEntity: DXFEntity | null = null;
      let section: string | null = null;

      const commit = () => {
        if (currentEntity) {
          if (section === 'BLOCKS' && currentBlockName) currentBlockEnts.push(currentEntity);
          else if (section === 'ENTITIES') entities.push(currentEntity);
          currentEntity = null;
        }
      };

      for (let i = 0; i < lines.length - 1; i += 2) {
        const code = parseInt(lines[i].trim());
        const val = lines[i + 1].trim();
        if (code === 0) {
          commit();
          if (val === 'SECTION') section = null;
          else if (val === 'ENDSEC') section = null;
          else if (val === 'BLOCK') { currentBlockName = ''; currentBlockEnts = []; }
          else if (val === 'ENDBLK') { if (currentBlockName) blocks[currentBlockName] = currentBlockEnts; currentBlockName = null; }
          else if (val === 'LINE' || val === 'LWPOLYLINE' || val === 'CIRCLE' || val === 'ARC' || val === '3DFACE' || val === 'INSERT') {
            if (section === 'ENTITIES' || (section === 'BLOCKS' && currentBlockName !== null)) currentEntity = { type: val };
          }
        } else if (code === 2 && (val === 'ENTITIES' || val === 'BLOCKS')) section = val;
        else if (code === 2 && section === 'BLOCKS' && currentBlockName === '') currentBlockName = val;
        else if (currentEntity) {
          const num = parseFloat(val);
          if (code === 8) currentEntity.layer = val; // Layer
          else if (code === 2 && currentEntity.type === 'INSERT') currentEntity.blockName = val;
          // Coords
          else if (code === 10) currentEntity.x = num; else if (code === 20) currentEntity.y = num; else if (code === 30) currentEntity.z = num;
          else if (code === 11) currentEntity.x1 = num; else if (code === 21) currentEntity.y1 = num; else if (code === 31) currentEntity.z1 = num;
          else if (code === 12) currentEntity.x2 = num; else if (code === 22) currentEntity.y2 = num; else if (code === 32) currentEntity.z2 = num;
          else if (code === 13) currentEntity.x3 = num; else if (code === 23) currentEntity.y3 = num; else if (code === 33) currentEntity.z3 = num;
          // Props
          else if (code === 40) currentEntity.radius = num;
          else if (code === 50) { currentEntity.startAngle = num; currentEntity.rotation = num; }
          else if (code === 51) currentEntity.endAngle = num;
          else if (code === 41) { if (!currentEntity.scale) currentEntity.scale = { x: 1, y: 1, z: 1 }; currentEntity.scale.x = num; }
          else if (code === 42) { if (!currentEntity.scale) currentEntity.scale = { x: 1, y: 1, z: 1 }; currentEntity.scale.y = num; }
          else if (code === 43) { if (!currentEntity.scale) currentEntity.scale = { x: 1, y: 1, z: 1 }; currentEntity.scale.z = num; }
          // Polyline
          else if (code === 70 && currentEntity.type === 'LWPOLYLINE') currentEntity.closed = (num & 1) === 1;
          else if ((code === 10 || code === 20) && currentEntity.type === 'LWPOLYLINE') {
            if (code === 10) { if (!currentEntity.vertices) currentEntity.vertices = []; currentEntity.vertices.push({ x: num, y: 0, z: 0 }); }
            if (code === 20 && currentEntity.vertices) currentEntity.vertices[currentEntity.vertices.length - 1].y = num;
          }
        }
      }
      commit();

      // Build Group
      const rootGroup = new THREE.Group();
      const layersSet = new Set<string>();
      const layerCounts: Record<string, number> = {};

      const matLine = new THREE.LineBasicMaterial({ color: new THREE.Color(colorHex) });
      const matMesh = new THREE.MeshBasicMaterial({ color: new THREE.Color(colorHex), side: THREE.DoubleSide });

      const createObj = (e: DXFEntity, level = 0): THREE.Object3D | null => {
        if (level > 8) return null;
        let obj: THREE.Object3D | null = null;

        if (e.type === 'LINE') {
          const pts = [new THREE.Vector3(e.x || 0, e.y || 0, e.z || 0), new THREE.Vector3(e.x1 || 0, e.y1 || 0, e.z1 || 0)];
          obj = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), matLine);
        } else if (e.type === 'LWPOLYLINE' && e.vertices) {
          const pts = e.vertices.map(v => new THREE.Vector3(v.x, v.y, e.z || 0));
          if (e.closed && pts.length > 0) pts.push(pts[0]);
          obj = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), matLine);
        } else if (e.type === 'CIRCLE' || e.type === 'ARC') {
          const start = e.type === 'ARC' ? (e.startAngle || 0) * Math.PI / 180 : 0;
          const end = e.type === 'ARC' ? (e.endAngle || 0) * Math.PI / 180 : 2 * Math.PI;
          const curve = new THREE.EllipseCurve(0, 0, e.radius || 1, e.radius || 1, start, end, false, 0);
          const pts = curve.getPoints(32).map(p => new THREE.Vector3(p.x, p.y, 0));
          obj = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), matLine);
          obj.position.set(e.x || 0, e.y || 0, e.z || 0); // Arc center
        } else if (e.type === '3DFACE') {
          const pts = [new THREE.Vector3(e.x, e.y, e.z), new THREE.Vector3(e.x1, e.y1, e.z1), new THREE.Vector3(e.x2, e.y2, e.z2), new THREE.Vector3(e.x3, e.y3, e.z3)];
          if (!pts[3].equals(pts[2])) pts.push(pts[0], pts[2]);
          const geo = new THREE.BufferGeometry().setFromPoints(pts);
          geo.computeVertexNormals();
          obj = new THREE.Mesh(geo, matMesh);
        } else if (e.type === 'INSERT' && e.blockName && blocks[e.blockName]) {
          const grp = new THREE.Group();
          // Inherit layer if undefined in block ent? No, block ent has own layer usually.
          blocks[e.blockName].forEach(child => {
            const cObj = createObj(child, level + 1);
            if (cObj) grp.add(cObj);
          });
          grp.position.set(e.x || 0, e.y || 0, e.z || 0);
          grp.scale.set(e.scale?.x || 1, e.scale?.y || 1, e.scale?.z || 1);
          if (e.rotation) grp.rotation.z = e.rotation * Math.PI / 180;
          obj = grp;
        }

        if (obj && e.layer) {
          obj.userData = { layer: e.layer }; // Tag for Layer Filtering
          layersSet.add(e.layer);
          layerCounts[e.layer] = (layerCounts[e.layer] || 0) + 1;
        }
        return obj;
      };

      entities.forEach(e => {
        const o = createObj(e);
        if (o) rootGroup.add(o);
      });

      // Build Layer List for UI
      const layers = Array.from(layersSet).map(name => ({ name, visible: true, count: layerCounts[name] })).sort((a, b) => a.name.localeCompare(b.name));

      resolve({ group: rootGroup, layers });
    });
  };

  // --------------------------------------------------------------------------
  // UI & View Logic
  // --------------------------------------------------------------------------

  const handleFitView = () => {
    if (!sceneRef.current || !cameraRef.current || !controlsRef.current) return;
    const box = new THREE.Box3();
    let hasObj = false;
    sceneRef.current.traverse(o => {
      if ((o.type === 'Line' || o.type === 'Mesh') && o.visible) {
        // Basic Check
        box.expandByObject(o);
        hasObj = true;
      }
    });
    if (hasObj && !box.isEmpty()) {
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const max = Math.max(size.x, size.y, size.z);
      const fov = cameraRef.current.fov * (Math.PI / 180);
      let camZ = Math.abs(max / 2 / Math.tan(fov / 2)) * 1.5;
      cameraRef.current.position.set(center.x + camZ, center.y - camZ, center.z + camZ * 0.5);
      cameraRef.current.lookAt(center);
      controlsRef.current.target.copy(center);
      controlsRef.current.update();
    }
  };



  const changeRenderMode = (mode: 'shaded' | 'wireframe' | 'xray' | 'sizeMap') => {
    setRenderMode(mode);

    if (mode === 'sizeMap') {
      applySizeBasedColoring();
      return;
    }

    // Reset to standard coloring for other modes
    sceneRef.current?.traverse(child => {
      if (child instanceof THREE.Mesh) {
        const m = child.material as THREE.MeshBasicMaterial;
        m.wireframe = mode === 'wireframe';
        m.transparent = mode === 'xray';
        m.opacity = mode === 'xray' ? 0.4 : 1;
        m.needsUpdate = true;
      }
      if (child instanceof THREE.Line) {
        const m = child.material as THREE.LineBasicMaterial;
        m.transparent = mode === 'xray';
        m.opacity = mode === 'xray' ? 0.4 : 1;
        m.needsUpdate = true;
      }
    });
  };

  // Size-based Coloring Function
  const applySizeBasedColoring = () => {
    if (!sceneRef.current) return;

    // 1. Collect all objects and their sizes
    const objectSizes: { obj: THREE.Object3D, size: number }[] = [];

    sceneRef.current.traverse(child => {
      if (child instanceof THREE.Line || child instanceof THREE.Mesh) {
        const box = new THREE.Box3().setFromObject(child);
        if (!box.isEmpty()) {
          const size = box.getSize(new THREE.Vector3());
          const volume = size.x * size.y * size.z;
          const diagonal = Math.sqrt(size.x ** 2 + size.y ** 2 + size.z ** 2);
          objectSizes.push({ obj: child, size: diagonal });
        }
      }
    });

    if (objectSizes.length === 0) return;

    // 2. Find min/max sizes
    const sizes = objectSizes.map(o => o.size);
    const minSize = Math.min(...sizes);
    const maxSize = Math.max(...sizes);
    const range = maxSize - minSize || 1;

    // 3. Apply color gradient (Blue=Small → Cyan → Green → Yellow → Red=Large)
    objectSizes.forEach(({ obj, size }) => {
      const t = (size - minSize) / range; // 0 to 1

      // HSL: Blue(240) → Red(0)
      const hue = (1 - t) * 240; // 240 (blue) to 0 (red)
      const saturation = 0.8;
      const lightness = 0.5;
      const color = new THREE.Color().setHSL(hue / 360, saturation, lightness);

      // Opacity: Small objects more transparent
      const opacity = 0.3 + t * 0.7; // 0.3 (small) to 1.0 (large)

      if (obj instanceof THREE.Line) {
        const mat = obj.material as THREE.LineBasicMaterial;
        mat.color.copy(color);
        mat.transparent = true;
        mat.opacity = opacity;
        mat.needsUpdate = true;
      }
      if (obj instanceof THREE.Mesh) {
        const mat = obj.material as THREE.MeshBasicMaterial;
        mat.color.copy(color);
        mat.transparent = true;
        mat.opacity = opacity;
        mat.needsUpdate = true;
      }

      // Store original size in userData for potential tooltip
      obj.userData.calculatedSize = size;
    });
  };

  const toggleLayer = (fileId: string, layerName: string, visible: boolean) => {
    setFileStates(prev => prev.map(f => {
      if (f.id !== fileId) return f;
      return { ...f, layers: f.layers.map(l => l.name === layerName ? { ...l, visible } : l) };
    }));
    // Update Scene (Traversal for filtered visibility)
    // This is expensive for huge files, but works for viewing.
    const group = objectsMapRef.current.get(fileId);
    if (group) {
      group.traverse(o => {
        if (o.userData.layer === layerName) o.visible = visible;
      });
    }
  };

  const toggleFile = (fileId: string, visible: boolean) => {
    setFileStates(prev => prev.map(f => f.id === fileId ? { ...f, visible } : f));
    const group = objectsMapRef.current.get(fileId);
    if (group) group.visible = visible;
  };

  // --------------------------------------------------------------------------
  // Render JSX
  // --------------------------------------------------------------------------

  // Selection Modal
  const [modalSelection, setModalSelection] = useState<Record<string, boolean>>({});

  const handleModalCheck = (id: string, checked: boolean) => {
    setModalSelection(p => ({ ...p, [id]: checked }));
  };

  const handleModalSubmit = () => {
    const selected = previewFiles.filter(f => modalSelection[f.id] !== false); // Default True if not in map?
    // Actually let's default to unchecked? User said "check to insert".
    // Let's rely on explicit check.
    // But verify user intent. "Default nothing loading".
    // So default everything UNCHECKED in state.
    // Wait, `modalSelection` starts empty.
    // If I want default empty, I treat undefined as false.
    const explicitSelected = previewFiles.filter(f => modalSelection[f.id] === true);
    handleImport(explicitSelected);
  };

  return (
    <div className="flex h-full bg-[#111] text-gray-200 font-sans overflow-hidden relative" translate="no">

      {/* INITIAL POPUP */}
      {showModal && (
        <div className="absolute inset-0 z-[100] bg-black/80 flex items-center justify-center p-8 backdrop-blur-sm">
          <div className="bg-[#1e1e24] w-full max-w-lg rounded-xl border border-gray-600 shadow-2xl flex flex-col max-h-[80vh]">
            <div className="p-4 border-b border-gray-700 font-bold text-lg text-white flex items-center gap-2">
              <CheckSquare className="text-blue-500" /> Select Files to Load
            </div>
            <div className="p-4 overflow-y-auto flex-1 custom-scrollbar space-y-2">
              {previewFiles.map(f => (
                <label key={f.id} className={`flex items-center gap-3 p-3 rounded border cursor-pointer hover:bg-gray-700 transition-colors ${modalSelection[f.id] ? 'bg-blue-900/20 border-blue-500' : 'bg-gray-800 border-gray-700'}`}>
                  <input type="checkbox" className="w-5 h-5 accent-blue-500" checked={!!modalSelection[f.id]} onChange={e => handleModalCheck(f.id, e.target.checked)} />
                  <span className="font-medium text-gray-200">{f.name}</span>
                </label>
              ))}
              {previewFiles.length === 0 && <div className="text-gray-500 text-center py-4">No files detected.</div>}
            </div>
            <div className="p-4 border-t border-gray-700 bg-gray-800 flex justify-end">
              <button onClick={handleModalSubmit} className="px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded font-bold shadow-lg disabled:opacity-50 disabled:cursor-not-allowed" disabled={!Object.values(modalSelection).some(Boolean)}>
                Load Selected
              </button>
            </div>
          </div>
        </div>
      )}

      {/* LEFT: Selection Tree */}
      <div className="w-80 bg-[#1e1e24] border-r border-gray-700 flex flex-col flex-shrink-0">
        <div className="h-10 border-b border-gray-700 bg-gray-800 flex items-center px-3 font-semibold text-xs uppercase tracking-wider text-gray-400">
          Selection Tree
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-2 px-1">
            <Box size={12} /> <span>Standard</span>
          </div>
          {fileStates.map(file => (
            <div key={file.id} className="mb-1">
              <div className="flex items-center gap-1 group hover:bg-white/5 rounded px-1 py-1 cursor-pointer select-none">
                <div onClick={() => setExpandedNodes(p => ({ ...p, [file.id]: !p[file.id] }))} className="p-0.5 hover:bg-white/10 rounded">
                  {expandedNodes[file.id] ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </div>
                <div className={`flex-1 flex items-center gap-2 cursor-pointer ${selectedObjectId === file.id ? 'text-blue-400 font-bold' : 'text-gray-200'}`} onClick={() => { setExpandedNodes(p => ({ ...p, [file.id]: !p[file.id] })); setSelectedObjectId(file.id); }}>
                  <Box size={14} className={selectedObjectId === file.id ? "text-blue-400" : "text-gray-400"} />
                  <span className="text-sm">{file.name}</span>
                  <span className="text-[10px] text-gray-500 bg-gray-800 p-0.5 rounded px-1">{file.layers.length} Layers</span>
                </div>
                <button onClick={() => toggleFile(file.id, !file.visible)} className="p-1 opacity-50 hover:opacity-100">
                  {file.visible ? <Eye size={14} className="text-gray-300" /> : <EyeOff size={14} className="text-gray-600" />}
                </button>
              </div>

              {/* Layers */}
              {expandedNodes[file.id] && (
                <div className="pl-6 border-l border-gray-700 ml-2.5 mt-1 space-y-0.5">
                  {file.layers.map(layer => (
                    <div key={layer.name} className="flex items-center gap-2 py-0.5 px-1 hover:bg-white/5 rounded text-xs group">
                      <button onClick={() => toggleLayer(file.id, layer.name, !layer.visible)} className="hover:text-white">
                        {layer.visible ? <CheckSquare size={12} className="text-blue-500" /> : <Square size={12} className="text-gray-600" />}
                      </button>
                      <Layers size={12} className="text-gray-500" />
                      <span className="text-gray-400 flex-1 truncate" title={layer.name}>{layer.name}</span>
                      <span className="text-[10px] text-gray-600">({layer.count})</span>
                    </div>
                  ))}
                  {file.layers.length === 0 && <div className="text-[10px] text-gray-600 italic pl-1">No visible layers</div>}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* CENTER: 3D View */}
      <div className="flex-1 flex flex-col relative min-w-0">
        {/* Top Toolbar */}
        <div className="h-12 bg-gray-800 border-b border-gray-700 flex items-center px-4 gap-4 shadow-sm z-10">
          {/* Navisworks-like tabs/buttons */}
          <div className="flex items-center gap-1 bg-gray-700/50 p-1 rounded">
            <button onClick={handleFitView} className="p-1.5 hover:bg-gray-600 rounded text-gray-300" title="Home / Fit"><Home size={18} /></button>
            <button onClick={() => controlsRef.current?.reset()} className="p-1.5 hover:bg-gray-600 rounded text-gray-300" title="Reset"><MousePointer size={18} /></button>
          </div>

          <div className="w-px h-6 bg-gray-600 mx-2" />

          <div className="flex items-center gap-2">
            <button onClick={() => setSliceSettings(p => ({ ...p, enabled: !p.enabled }))} className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${sliceSettings.enabled ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}>
              <Scissors size={14} /> Section Box
            </button>
          </div>

          <div className="ml-auto flex bg-gray-700/50 rounded p-1 gap-1">
            <button onClick={() => changeRenderMode('shaded')} className={`px-2 py-1 text-xs rounded ${renderMode === 'shaded' ? 'bg-blue-600 text-white' : 'hover:bg-gray-600 text-gray-400'}`}>Shaded</button>
            <button onClick={() => changeRenderMode('wireframe')} className={`px-2 py-1 text-xs rounded ${renderMode === 'wireframe' ? 'bg-blue-600 text-white' : 'hover:bg-gray-600 text-gray-400'}`}>Wireframe</button>
            <button onClick={() => changeRenderMode('xray')} className={`px-2 py-1 text-xs rounded ${renderMode === 'xray' ? 'bg-blue-600 text-white' : 'hover:bg-gray-600 text-gray-400'}`}>X-Ray</button>
            <button onClick={() => changeRenderMode('sizeMap')} className={`px-2 py-1 text-xs rounded ${renderMode === 'sizeMap' ? 'bg-green-600 text-white' : 'hover:bg-gray-600 text-gray-400'}`} title="Color by Size">Size Map</button>
          </div>
        </div>

        {/* Viewport */}
        <div className="flex-1 relative bg-gradient-to-br from-[#111] to-[#222]">
          <div ref={containerRef} className="w-full h-full" />

          {/* Overlay Status */}
          <div className="absolute bottom-2 right-2 flex flex-col items-end pointer-events-none select-none">
            <div className="text-[10px] text-gray-500">
              {parsing ? 'Parsing Geometry...' : `Ready | ${fileStates.filter(f => f.visible).length} Files Visible`}
            </div>
          </div>

          {parsing && (
            <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center z-50">
              <div className="text-blue-400 font-bold animate-pulse text-lg mb-2">Processing DXF...</div>
              <div className="w-48 h-1 bg-gray-800 rounded overflow-hidden">
                <div className="h-full bg-blue-500 animate-loading-bar" style={{ width: '50%' }}></div>
              </div>
            </div>
          )}
        </div>
      </div>



      {/* RIGHT: Properties & Tools */}
      <div className="w-80 bg-[#1e1e24] border-l border-gray-700 flex flex-col overflow-y-auto custom-scrollbar">
        <div className="h-10 border-b border-gray-700 bg-gray-800 flex items-center px-3 font-semibold text-xs uppercase tracking-wider text-gray-400">
          Tools & Properties
        </div>

        <div className="p-4 space-y-6">
          {/* Slice Control Panel */}
          <div className="bg-gray-800/50 rounded-lg p-3 border border-gray-700">
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-bold text-gray-200 flex items-center gap-2">
                <Scissors size={14} className="text-blue-400" /> Slice Control
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" className="sr-only peer" checked={sliceSettings.enabled} onChange={e => setSliceSettings(p => ({ ...p, enabled: e.target.checked }))} />
                <div className="w-9 h-5 bg-gray-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
              </label>
            </div>

            {sliceSettings.enabled && (
              <div className="space-y-4">
                {/* Gizmo Tools */}
                <div className="flex gap-2">
                  <button
                    onClick={() => setGizmoMode(m => m === 'translate' ? 'none' : 'translate')}
                    className={`flex-1 py-1.5 rounded text-xs flex items-center justify-center gap-1 transition-colors ${gizmoMode === 'translate' ? 'bg-blue-600 text-white' : 'bg-gray-700 hover:bg-gray-600 text-gray-300'}`}
                    title="Move Section Box"
                  >
                    <MousePointer size={12} /> Move
                  </button>
                  <button
                    onClick={() => setGizmoMode(m => m === 'scale' ? 'none' : 'scale')}
                    className={`flex-1 py-1.5 rounded text-xs flex items-center justify-center gap-1 transition-colors ${gizmoMode === 'scale' ? 'bg-blue-600 text-white' : 'bg-gray-700 hover:bg-gray-600 text-gray-300'}`}
                    title="Resize Section Box"
                  >
                    <Maximize size={12} /> Resize
                  </button>
                  <button
                    onClick={handleFitToSelection}
                    disabled={!selectedObjectId}
                    className="flex-1 py-1.5 bg-gray-700 hover:bg-gray-600 text-xs text-white rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1"
                    title="Fit to Selected File"
                  >
                    <Box size={12} /> Fit Sel.
                  </button>
                </div>
                {/* X Axis */}
                <div className="space-y-1">
                  <div className="flex justify-between text-xs text-gray-400"><span>X Axis</span><span>{sliceSettings.bounds.xMin.toFixed(0)} ~ {sliceSettings.bounds.xMax.toFixed(0)}</span></div>
                  <div className="flex gap-2 items-center">
                    <span className="text-[10px] w-6">Min</span>
                    <input
                      type="range" min={sceneBounds.min.x} max={sceneBounds.max.x} step={(sceneBounds.max.x - sceneBounds.min.x) / 100}
                      value={sliceSettings.bounds.xMin}
                      onChange={e => setSliceSettings(p => ({ ...p, bounds: { ...p.bounds, xMin: parseFloat(e.target.value) } }))}
                      className="flex-1 h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>
                  <div className="flex gap-2 items-center">
                    <span className="text-[10px] w-6">Max</span>
                    <input
                      type="range" min={sceneBounds.min.x} max={sceneBounds.max.x} step={(sceneBounds.max.x - sceneBounds.min.x) / 100}
                      value={sliceSettings.bounds.xMax}
                      onChange={e => setSliceSettings(p => ({ ...p, bounds: { ...p.bounds, xMax: parseFloat(e.target.value) } }))}
                      className="flex-1 h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>
                </div>

                {/* Y Axis */}
                <div className="space-y-1">
                  <div className="flex justify-between text-xs text-gray-400"><span>Y Axis</span><span>{sliceSettings.bounds.yMin.toFixed(0)} ~ {sliceSettings.bounds.yMax.toFixed(0)}</span></div>
                  <div className="flex gap-2 items-center">
                    <span className="text-[10px] w-6">Min</span>
                    <input
                      type="range" min={sceneBounds.min.y} max={sceneBounds.max.y} step={(sceneBounds.max.y - sceneBounds.min.y) / 100}
                      value={sliceSettings.bounds.yMin}
                      onChange={e => setSliceSettings(p => ({ ...p, bounds: { ...p.bounds, yMin: parseFloat(e.target.value) } }))}
                      className="flex-1 h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>
                  <div className="flex gap-2 items-center">
                    <span className="text-[10px] w-6">Max</span>
                    <input
                      type="range" min={sceneBounds.min.y} max={sceneBounds.max.y} step={(sceneBounds.max.y - sceneBounds.min.y) / 100}
                      value={sliceSettings.bounds.yMax}
                      onChange={e => setSliceSettings(p => ({ ...p, bounds: { ...p.bounds, yMax: parseFloat(e.target.value) } }))}
                      className="flex-1 h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>
                </div>

                {/* Z Axis */}
                <div className="space-y-1">
                  <div className="flex justify-between text-xs text-gray-400"><span>Z Axis</span><span>{sliceSettings.bounds.zMin.toFixed(0)} ~ {sliceSettings.bounds.zMax.toFixed(0)}</span></div>
                  <div className="flex gap-2 items-center">
                    <span className="text-[10px] w-6">Min</span>
                    <input
                      type="range" min={sceneBounds.min.z} max={sceneBounds.max.z} step={(sceneBounds.max.z - sceneBounds.min.z) / 100}
                      value={sliceSettings.bounds.zMin}
                      onChange={e => setSliceSettings(p => ({ ...p, bounds: { ...p.bounds, zMin: parseFloat(e.target.value) } }))}
                      className="flex-1 h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>
                  <div className="flex gap-2 items-center">
                    <span className="text-[10px] w-6">Max</span>
                    <input
                      type="range" min={sceneBounds.min.z} max={sceneBounds.max.z} step={(sceneBounds.max.z - sceneBounds.min.z) / 100}
                      value={sliceSettings.bounds.zMax}
                      onChange={e => setSliceSettings(p => ({ ...p, bounds: { ...p.bounds, zMax: parseFloat(e.target.value) } }))}
                      className="flex-1 h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>
                </div>

                <button
                  onClick={() => {
                    setSliceSettings(p => ({ ...p, bounds: { xMin: sceneBounds.min.x, xMax: sceneBounds.max.x, yMin: sceneBounds.min.y, yMax: sceneBounds.max.y, zMin: sceneBounds.min.z, zMax: sceneBounds.max.z } }));
                  }}
                  className="w-full py-1.5 bg-gray-700 hover:bg-gray-600 text-xs text-white rounded transition-colors"
                >
                  Reset Planes
                </button>
              </div>
            )}
          </div>

          {!sliceSettings.enabled && (
            <div className="text-xs text-gray-500 italic">Select an object or enable tools...</div>
          )}

          {/* Debug Info */}
          {/* <div className="text-[10px] text-gray-600 font-mono mt-10">
              Debug: {sceneBounds.min.x.toFixed(1)} ~ {sceneBounds.max.x.toFixed(1)}
           </div> */}
        </div>
      </div>
    </div >
  );
};

export default MultiDXFViewer;