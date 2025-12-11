import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { DXFFile } from '../types';
import { ChevronRight, ChevronDown, Eye, EyeOff, Box, Layers, RotateCcw, Maximize, Monitor, Palette, Move3d, BoxSelect, RotateCw, ZoomIn, ZoomOut, Home, Grid3X3, Sun, MousePointer2, Menu, X, Settings } from 'lucide-react';

interface MultiDXFViewerProps {
  files: DXFFile[];
}

interface DXFEntity {
  type: string;
  layer?: string;
  x?: number; y?: number; z?: number;
  x1?: number; y1?: number; z1?: number;
  x2?: number; y2?: number; z2?: number;
  x3?: number; y3?: number; z3?: number;
  vertices?: { x: number, y: number, z: number }[];
  controlPoints?: { x: number, y: number, z: number }[];
  knots?: number[];
  closed?: boolean;
  blockName?: string;
  radius?: number;
  startAngle?: number;
  endAngle?: number;
  rotation?: number;
  scale?: { x: number, y: number, z: number };
  [key: string]: any;
}

interface TreeNode {
  id: string;
  name: string;
  type: 'file' | 'layer';
  visible: boolean;
  expanded: boolean;
  children: TreeNode[];
  object?: THREE.Object3D;
  color?: string;
  entityCount?: number;
  opacity: number;
  renderMode: RenderMode;
}

type ViewType = 'front' | 'back' | 'left' | 'right' | 'top' | 'iso';
type RenderMode = 'shaded' | 'wireframe' | 'xray';

const FILE_COLORS = [
  '#FF5252', '#FF4081', '#E040FB', '#7C4DFF', '#536DFE',
  '#40C4FF', '#18FFFF', '#64FFDA', '#69F0AE', '#B2FF59',
  '#EEFF41', '#FFD740', '#FFAB40', '#FF6E40', '#8D6E63'
];

const MultiDXFViewer: React.FC<MultiDXFViewerProps> = ({ files }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const subViewRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [status, setStatus] = useState<string>('');
  const [loadedFiles, setLoadedFiles] = useState<DXFFile[]>([]);
  const [treeData, setTreeData] = useState<TreeNode[]>([]);
  const [selectedNode, setSelectedNode] = useState<TreeNode | null>(null);
  const [globalRenderMode, setGlobalRenderMode] = useState<RenderMode>('shaded');
  const [showSubView, setShowSubView] = useState(false);
  const [sectionBoxEnabled, setSectionBoxEnabled] = useState(false);
  const [history, setHistory] = useState<{ obj: THREE.Object3D, position: THREE.Vector3, rotation: THREE.Euler }[][]>([]);

  // Mobile UI States
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isPropertiesOpen, setIsPropertiesOpen] = useState(true);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const subRendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const subCameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const outlineRef = useRef<THREE.BoxHelper | null>(null);
  const sectionBoxRef = useRef<THREE.Mesh | null>(null);
  const edgeGroupRef = useRef<THREE.Group | null>(null);

  // Responsive Check
  useEffect(() => {
    const checkMobile = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      if (mobile) {
        setIsSidebarOpen(false);
        setIsPropertiesOpen(false);
      } else {
        setIsSidebarOpen(true);
        setIsPropertiesOpen(true);
      }
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Initialize Three.js
  useEffect(() => {
    if (!containerRef.current) return;

    if (rendererRef.current) {
      rendererRef.current.dispose();
      containerRef.current.innerHTML = '';
    }

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x111111);
    sceneRef.current = scene;

    const edgeGroup = new THREE.Group();
    edgeGroup.name = 'edgeGroup';
    scene.add(edgeGroup);
    edgeGroupRef.current = edgeGroup;

    const width = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;

    const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 500000);
    camera.position.set(1000, 1000, 1000);
    camera.up.set(0, 0, 1);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, logarithmicDepthBuffer: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.localClippingEnabled = true;
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controls.screenSpacePanning = true;
    controls.minDistance = 1;
    controls.maxDistance = 500000;
    controlsRef.current = controls;

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(100, 100, 200);
    scene.add(dirLight);

    const gridHelper = new THREE.GridHelper(5000, 50, 0x444444, 0x222222);
    gridHelper.rotation.x = Math.PI / 2;
    scene.add(gridHelper);

    const axesHelper = new THREE.AxesHelper(500);
    scene.add(axesHelper);

    let animationId: number;
    const animate = () => {
      animationId = requestAnimationFrame(animate);
      if (controlsRef.current) controlsRef.current.update();
      if (rendererRef.current && sceneRef.current && cameraRef.current) {
        rendererRef.current.render(sceneRef.current, cameraRef.current);
      }
      if (subRendererRef.current && sceneRef.current && subCameraRef.current) {
        subRendererRef.current.render(sceneRef.current, subCameraRef.current);
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
      cancelAnimationFrame(animationId);
      renderer.dispose();
      if (containerRef.current) containerRef.current.innerHTML = '';
    };
  }, []);

  // Sub View initialization
  useEffect(() => {
    if (showSubView && subViewRef.current && sceneRef.current && !subRendererRef.current) {
      const subRenderer = new THREE.WebGLRenderer({ antialias: true });
      subRenderer.setSize(180, 180);
      subViewRef.current.appendChild(subRenderer.domElement);
      subRendererRef.current = subRenderer;

      const subCamera = new THREE.PerspectiveCamera(60, 1, 0.1, 500000);
      subCamera.position.set(2000, 2000, 2000);
      subCamera.up.set(0, 0, 1);
      subCameraRef.current = subCamera;
    }
  }, [showSubView]);

  // Handle File Loading
  useEffect(() => {
    if (files.length > 0 && sceneRef.current) {
      loadAllDXFFiles(files);
    } else if (files.length === 0 && sceneRef.current) {
      const toRemove: THREE.Object3D[] = [];
      sceneRef.current.traverse((child) => {
        if (child.name && (child.name.startsWith('auto-') || child.name.startsWith('manual-'))) toRemove.push(child);
      });
      toRemove.forEach(child => sceneRef.current?.remove(child));
      setLoadedFiles([]);
      setTreeData([]);
    }
  }, [files]);

  // View functions
  const setView = (view: ViewType) => {
    if (!cameraRef.current || !controlsRef.current) return;
    const distance = 2000;
    const target = controlsRef.current.target.clone();

    switch (view) {
      case 'front': cameraRef.current.position.set(target.x, target.y - distance, target.z); break;
      case 'back': cameraRef.current.position.set(target.x, target.y + distance, target.z); break;
      case 'left': cameraRef.current.position.set(target.x - distance, target.y, target.z); break;
      case 'right': cameraRef.current.position.set(target.x + distance, target.y, target.z); break;
      case 'top': cameraRef.current.position.set(target.x, target.y, target.z + distance); break;
      case 'iso': cameraRef.current.position.set(target.x + distance * 0.7, target.y - distance * 0.7, target.z + distance * 0.7); break;
    }
    cameraRef.current.lookAt(target);
    controlsRef.current.update();
  };

  const applyRenderModeToObject = (object: THREE.Object3D, mode: RenderMode) => {
    object.traverse((child) => {
      if ((child as THREE.Mesh).isMesh && (child as THREE.Mesh).material) {
        const mesh = child as THREE.Mesh;
        if (mode === 'wireframe') {
          (mesh.material as any).wireframe = true;
          mesh.material.transparent = false;
          mesh.material.opacity = 1;
        } else if (mode === 'xray') {
          (mesh.material as any).wireframe = false;
          mesh.material.transparent = true;
          mesh.material.opacity = 0.3;
        } else {
          (mesh.material as any).wireframe = false;
          mesh.material.transparent = true;
          mesh.material.opacity = 1;
        }
        mesh.material.needsUpdate = true;
      }
    });
  };

  const updateGlobalRenderMode = (mode: RenderMode) => {
    setGlobalRenderMode(mode);
    if (!sceneRef.current) return;

    if (edgeGroupRef.current) edgeGroupRef.current.clear(); // Clear global edges if any

    const updateTreeNodes = (nodes: TreeNode[]): TreeNode[] => {
      return nodes.map(node => {
        if (node.object) applyRenderModeToObject(node.object, mode);
        return {
          ...node,
          renderMode: mode,
          children: updateTreeNodes(node.children)
        };
      });
    };

    setTreeData(prev => updateTreeNodes(prev));
    if (selectedNode) setSelectedNode(prev => prev ? { ...prev, renderMode: mode } : null);
  };


  const toggleSectionBox = useCallback(() => {
    if (!sceneRef.current) return;

    if (sectionBoxEnabled) {
      if (sectionBoxRef.current) {
        sceneRef.current.remove(sectionBoxRef.current);
        sectionBoxRef.current = null;
      }
      sceneRef.current.traverse((child) => {
        if ((child as THREE.Mesh).isMesh && (child as THREE.Mesh).material) {
          (child as THREE.Mesh).material.clippingPlanes = [];
        }
      });
      setSectionBoxEnabled(false);
    } else {
      const box = new THREE.Box3();
      loadedFiles.forEach(dxf => { if (dxf.group) box.expandByObject(dxf.group); });
      if (box.isEmpty()) return;

      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());

      const boxGeo = new THREE.BoxGeometry(size.x * 1.2, size.y * 1.2, size.z * 1.2);
      const boxMat = new THREE.MeshBasicMaterial({ color: 0x00aaff, transparent: true, opacity: 0.1, side: THREE.BackSide });
      const boxMesh = new THREE.Mesh(boxGeo, boxMat);
      boxMesh.position.copy(center);
      boxMesh.name = 'sectionBox';

      sceneRef.current.add(boxMesh);
      sectionBoxRef.current = boxMesh;
      setSectionBoxEnabled(true);
    }
  }, [sectionBoxEnabled, loadedFiles]);

  // Camera controls
  const zoomIn = () => {
    if (cameraRef.current && controlsRef.current) {
      const dist = cameraRef.current.position.distanceTo(controlsRef.current.target);
      const direction = new THREE.Vector3().subVectors(controlsRef.current.target, cameraRef.current.position).normalize();
      if (dist > 50) cameraRef.current.position.addScaledVector(direction, dist * 0.2); // Proportional zoom
      controlsRef.current.update();
    }
  };

  const zoomOut = () => {
    if (cameraRef.current && controlsRef.current) {
      const dist = cameraRef.current.position.distanceTo(controlsRef.current.target);
      const direction = new THREE.Vector3().subVectors(controlsRef.current.target, cameraRef.current.position).normalize();
      cameraRef.current.position.addScaledVector(direction, -dist * 0.2); // Proportional zoom
      controlsRef.current.update();
    }
  };

  const resetCamera = () => {
    if (cameraRef.current && controlsRef.current) {
      cameraRef.current.position.set(1000, 1000, 1000);
      controlsRef.current.target.set(0, 0, 0);
      controlsRef.current.update();
    }
  };

  // Tree functions
  const toggleNode = useCallback((nodeId: string) => {
    const toggle = (nodes: TreeNode[]): TreeNode[] => nodes.map(n =>
      n.id === nodeId ? { ...n, expanded: !n.expanded } :
        n.children.length > 0 ? { ...n, children: toggle(n.children) } : n
    );
    setTreeData(prev => toggle(prev));
  }, []);

  const selectNode = useCallback((node: TreeNode) => {
    setSelectedNode(node);
    if (isMobile) setIsPropertiesOpen(true); // Open properties on selection in mobile
    if (!sceneRef.current) return;
    if (outlineRef.current) { sceneRef.current.remove(outlineRef.current); outlineRef.current = null; }
    if (node.object) {
      const outline = new THREE.BoxHelper(node.object, 0xffff00);
      sceneRef.current.add(outline);
      outlineRef.current = outline;
    }
  }, [isMobile]);

  const toggleNodeVisibility = useCallback((nodeId: string) => {
    const toggle = (nodes: TreeNode[]): TreeNode[] => nodes.map(n => {
      if (n.id === nodeId) {
        const newVis = !n.visible;
        if (n.object) n.object.visible = newVis;
        const setChildVis = (node: TreeNode, vis: boolean): TreeNode => {
          if (node.object) node.object.visible = vis;
          return { ...node, visible: vis, children: node.children.map(c => setChildVis(c, vis)) };
        };
        return setChildVis({ ...n, visible: newVis }, newVis);
      }
      return n.children.length > 0 ? { ...n, children: toggle(n.children) } : n;
    });
    setTreeData(prev => toggle(prev));
  }, []);

  // Update color for selected node
  const updateNodeColor = useCallback((nodeId: string, color: string) => {
    const updateTree = (nodes: TreeNode[]): TreeNode[] => nodes.map(n => {
      if (n.id === nodeId) {
        if (n.object) {
          n.object.traverse((child) => {
            if ((child as THREE.Mesh).isMesh || (child as THREE.Line).isLine) {
              const obj = child as THREE.Mesh | THREE.Line;
              if (obj.material instanceof THREE.Material) {
                (obj.material as any).color.setStyle(color);
              }
            }
          });
        }
        return { ...n, color };
      }
      return n.children.length > 0 ? { ...n, children: updateTree(n.children) } : n;
    });
    setTreeData(prev => updateTree(prev));
    if (selectedNode?.id === nodeId) setSelectedNode(prev => prev ? { ...prev, color } : null);
  }, [selectedNode]);

  // Update opacity for node
  const updateNodeOpacity = useCallback((nodeId: string, opacity: number) => {
    const updateTree = (nodes: TreeNode[]): TreeNode[] => nodes.map(n => {
      if (n.id === nodeId) {
        if (n.object) {
          n.object.traverse((child) => {
            if ((child as THREE.Mesh).isMesh || (child as THREE.Line).isLine) {
              const obj = child as THREE.Mesh | THREE.Line;
              if (obj.material instanceof THREE.Material) {
                obj.material.transparent = opacity < 1;
                obj.material.opacity = opacity;
                obj.material.needsUpdate = true;
              }
            }
          });
        }
        return { ...n, opacity };
      }
      return n.children.length > 0 ? { ...n, children: updateTree(n.children) } : n;
    });
    setTreeData(prev => updateTree(prev));
    if (selectedNode?.id === nodeId) setSelectedNode(prev => prev ? { ...prev, opacity } : null);
  }, [selectedNode]);

  // Update render mode for node
  const updateNodeRenderMode = useCallback((nodeId: string, mode: RenderMode) => {
    const updateTree = (nodes: TreeNode[]): TreeNode[] => nodes.map(n => {
      if (n.id === nodeId) {
        if (n.object) applyRenderModeToObject(n.object, mode);
        return { ...n, renderMode: mode };
      }
      return n.children.length > 0 ? { ...n, children: updateTree(n.children) } : n;
    });
    setTreeData(prev => updateTree(prev));
    if (selectedNode?.id === nodeId) setSelectedNode(prev => prev ? { ...prev, renderMode: mode } : null);
  }, [selectedNode]);

  const moveObject = (axis: 'x' | 'y' | 'z', delta: number) => {
    if (!selectedNode?.object) return;
    setHistory(prev => [...prev, [{
      obj: selectedNode.object!,
      position: selectedNode.object!.position.clone(),
      rotation: selectedNode.object!.rotation.clone()
    }]]);
    selectedNode.object.position[axis] += delta;
    if (outlineRef.current && sceneRef.current) {
      outlineRef.current.update();
    }
  };

  const rotateObject = (axis: 'x' | 'y' | 'z', deltaDeg: number) => {
    if (!selectedNode?.object) return;
    setHistory(prev => [...prev, [{
      obj: selectedNode.object!,
      position: selectedNode.object!.position.clone(),
      rotation: selectedNode.object!.rotation.clone()
    }]]);
    selectedNode.object.rotation[axis] += (deltaDeg * Math.PI) / 180;
    if (outlineRef.current) outlineRef.current.update();
  };

  const undo = () => {
    if (history.length === 0) return;
    history[history.length - 1].forEach(({ obj, position, rotation }) => {
      obj.position.copy(position);
      obj.rotation.copy(rotation);
    });
    setHistory(prev => prev.slice(0, -1));
    if (outlineRef.current) outlineRef.current.update();
  };

  // DXF Parser
  const parseDXF = (content: string, fileColor: string, fileName: string): { group: THREE.Group, tree: TreeNode } => {
    const group = new THREE.Group();
    const lines = content.split(/\r?\n/);
    const blocks: Record<string, DXFEntity[]> = {};
    const entities: DXFEntity[] = [];
    const layerGroups: Record<string, THREE.Group> = {};
    const layerColors: Record<string, string> = {};

    let section: string | null = null;
    let currentBlockName: string | null = null;
    let currentBlockEntities: DXFEntity[] = [];
    let currentEntity: DXFEntity | null = null;

    const commitEntity = () => {
      if (!currentEntity) return;
      if (section === 'BLOCKS' && currentBlockName) {
        currentBlockEntities.push(currentEntity);
      } else if (section === 'ENTITIES') {
        entities.push(currentEntity);
      }
      currentEntity = null;
    };

    for (let i = 0; i < lines.length - 1; i += 2) {
      const codeStr = lines[i].trim();
      const value = lines[i + 1]?.trim() || '';
      if (codeStr === '') continue;

      const code = parseInt(codeStr, 10);
      if (isNaN(code)) continue;

      if (code === 0) {
        commitEntity();
        if (value === 'SECTION') section = null;
        else if (value === 'ENDSEC') section = null;
        else if (value === 'BLOCK') { currentBlockName = ''; currentBlockEntities = []; }
        else if (value === 'ENDBLK') {
          if (currentBlockName) blocks[currentBlockName] = currentBlockEntities;
          currentBlockName = null;
          currentBlockEntities = [];
        } else if ((section === 'ENTITIES') || (section === 'BLOCKS' && currentBlockName !== null)) {
          currentEntity = { type: value };
        }
      }
      else if (code === 2) {
        if (section === null && (value === 'ENTITIES' || value === 'BLOCKS')) section = value;
        else if (section === 'BLOCKS' && currentBlockName === '') currentBlockName = value;
        else if (currentEntity && currentEntity.type === 'INSERT') currentEntity.blockName = value;
      }
      else if (code === 8 && currentEntity) currentEntity.layer = value;
      else if (currentEntity) {
        const valNum = parseFloat(value);
        switch (code) {
          case 10: currentEntity.x = valNum; break;
          case 20: currentEntity.y = valNum; break;
          case 30: currentEntity.z = valNum; break;
          case 11: currentEntity.x1 = valNum; break;
          case 21: currentEntity.y1 = valNum; break;
          case 31: currentEntity.z1 = valNum; break;
          case 12: currentEntity.x2 = valNum; break;
          case 22: currentEntity.y2 = valNum; break;
          case 32: currentEntity.z2 = valNum; break;
          case 13: currentEntity.x3 = valNum; break;
          case 23: currentEntity.y3 = valNum; break;
          case 33: currentEntity.z3 = valNum; break;
          case 40:
            if (currentEntity.knots) currentEntity.knots.push(valNum);
            else currentEntity.radius = valNum;
            break;
          case 50: currentEntity.startAngle = valNum; break;
          case 51: currentEntity.endAngle = valNum; break;
          case 41: if (!currentEntity.scale) currentEntity.scale = { x: 1, y: 1, z: 1 }; currentEntity.scale.x = valNum; break;
          case 42: if (!currentEntity.scale) currentEntity.scale = { x: 1, y: 1, z: 1 }; currentEntity.scale.y = valNum; break;
          case 43: if (!currentEntity.scale) currentEntity.scale = { x: 1, y: 1, z: 1 }; currentEntity.scale.z = valNum; break;
        }

        if (currentEntity.type === 'LWPOLYLINE') {
          if (code === 10) {
            if (!currentEntity.vertices) currentEntity.vertices = [];
            currentEntity.vertices.push({ x: valNum, y: 0, z: 0 });
          }
          if (code === 20 && currentEntity.vertices) {
            const v = currentEntity.vertices[currentEntity.vertices.length - 1];
            if (v) v.y = valNum;
          }
          if (code === 70) currentEntity.closed = (valNum & 1) === 1;
        }

        if (currentEntity.type === 'SPLINE') {
          if (code === 10) {
            if (!currentEntity.controlPoints) currentEntity.controlPoints = [];
            currentEntity.controlPoints.push({ x: valNum, y: 0, z: 0 });
          }
          if (code === 20 && currentEntity.controlPoints) {
            const v = currentEntity.controlPoints[currentEntity.controlPoints.length - 1];
            if (v) v.y = valNum;
          }
          if (code === 30 && currentEntity.controlPoints) {
            const v = currentEntity.controlPoints[currentEntity.controlPoints.length - 1];
            if (v) v.z = valNum;
          }
        }
      }
    }
    commitEntity();

    const createObject = (e: DXFEntity, layerColor: string): THREE.Object3D | null => {
      const matLine = new THREE.LineBasicMaterial({ color: new THREE.Color(layerColor) });
      const matMesh = new THREE.MeshBasicMaterial({ color: new THREE.Color(layerColor), side: THREE.DoubleSide, transparent: true, opacity: 1 });

      try {
        if (e.type === 'LINE') {
          return new THREE.Line(new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(e.x || 0, e.y || 0, e.z || 0),
            new THREE.Vector3(e.x1 || 0, e.y1 || 0, e.z1 || 0)
          ]), matLine);
        }
        if (e.type === 'LWPOLYLINE' && e.vertices && e.vertices.length > 1) {
          const points = e.vertices.map(v => new THREE.Vector3(v.x, v.y, e.z || 0));
          if (e.closed) points.push(points[0]);
          return new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), matLine);
        }
        if (e.type === 'CIRCLE') {
          const curve = new THREE.EllipseCurve(0, 0, e.radius || 1, e.radius || 1, 0, 2 * Math.PI, false, 0);
          const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(32).map(p => new THREE.Vector3(p.x, p.y, 0))), matLine);
          line.position.set(e.x || 0, e.y || 0, e.z || 0);
          return line;
        }
        if (e.type === 'ARC') {
          const s = (e.startAngle || 0) * Math.PI / 180, en = (e.endAngle || 0) * Math.PI / 180;
          const curve = new THREE.EllipseCurve(0, 0, e.radius || 1, e.radius || 1, s, en, false, 0);
          const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(32).map(p => new THREE.Vector3(p.x, p.y, 0))), matLine);
          line.position.set(e.x || 0, e.y || 0, e.z || 0);
          return line;
        }
        if (e.type === 'SPLINE' && e.controlPoints && e.controlPoints.length > 1) {
          const vecPoints = e.controlPoints.map(p => new THREE.Vector3(p.x, p.y, p.z || 0));
          const curve = new THREE.CatmullRomCurve3(vecPoints);
          return new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(50)), matLine);
        }
        if (e.type === '3DFACE') {
          const pts = [
            new THREE.Vector3(e.x || 0, e.y || 0, e.z || 0),
            new THREE.Vector3(e.x1 || 0, e.y1 || 0, e.z1 || 0),
            new THREE.Vector3(e.x2 || 0, e.y2 || 0, e.z2 || 0),
            new THREE.Vector3(e.x3 || 0, e.y3 || 0, e.z3 || 0)
          ];
          if (!pts[3].equals(pts[2])) pts.push(pts[0], pts[2]);
          const geo = new THREE.BufferGeometry().setFromPoints(pts);
          geo.computeVertexNormals();
          return new THREE.Mesh(geo, matMesh);
        }
        if (e.type === 'INSERT' && e.blockName && blocks[e.blockName]) {
          const blockGroup = new THREE.Group();
          blocks[e.blockName].forEach(childE => {
            const childObj = createObject(childE, layerColor);
            if (childObj) blockGroup.add(childObj);
          });
          blockGroup.position.set(e.x || 0, e.y || 0, e.z || 0);
          blockGroup.scale.set(e.scale?.x ?? 1, e.scale?.y ?? 1, e.scale?.z ?? 1);
          if (e.rotation) blockGroup.rotation.z = (e.rotation * Math.PI) / 180;
          return blockGroup;
        }
      } catch { /* ignore */ }
      return null;
    };

    entities.forEach(e => {
      const layerName = e.layer || '0';
      if (!layerGroups[layerName]) {
        layerGroups[layerName] = new THREE.Group();
        layerGroups[layerName].name = `layer_${layerName}`;
        layerColors[layerName] = fileColor;
      }
      const obj = createObject(e, layerColors[layerName]);
      if (obj) layerGroups[layerName].add(obj);
    });

    Object.values(layerGroups).forEach(g => group.add(g));

    const fileNode: TreeNode = {
      id: `file_${fileName}`, name: fileName, type: 'file', visible: true, expanded: true,
      children: [], object: group, color: fileColor, entityCount: entities.length, opacity: 1, renderMode: 'shaded'
    };

    Object.entries(layerGroups).forEach(([layerName, layerGroup]) => {
      fileNode.children.push({
        id: `layer_${fileName}_${layerName}`, name: layerName, type: 'layer', visible: true, expanded: false,
        children: [], object: layerGroup, color: fileColor, entityCount: layerGroup.children.length, opacity: 1, renderMode: 'shaded'
      });
    });

    return { group, tree: fileNode };
  };

  const loadAllDXFFiles = async (dxfFiles: DXFFile[]) => {
    setLoading(true);
    setError('');
    setStatus('Parsing files...');

    try {
      if (sceneRef.current) {
        const toRemove: THREE.Object3D[] = [];
        sceneRef.current.traverse((child) => {
          if (child.name && (child.name.startsWith('auto-') || child.name.startsWith('manual-') || child.name.startsWith('layer_'))) toRemove.push(child);
        });
        toRemove.forEach(child => sceneRef.current?.remove(child));
      }

      const loadedDXFs: DXFFile[] = [];
      const newTreeData: TreeNode[] = [];

      for (let i = 0; i < dxfFiles.length; i++) {
        const dxfFile = dxfFiles[i];
        if (!dxfFile.content || dxfFile.content.length < 10) continue;
        if (dxfFile.content.startsWith('AutoCAD Binary DXF')) continue;

        const distinctColor = FILE_COLORS[i % FILE_COLORS.length];
        const { group, tree } = parseDXF(dxfFile.content, distinctColor, dxfFile.name);
        group.name = dxfFile.id;
        group.visible = dxfFile.visible;

        if (sceneRef.current) sceneRef.current.add(group);
        loadedDXFs.push({ ...dxfFile, group, color: distinctColor });
        newTreeData.push(tree);
      }

      setLoadedFiles(loadedDXFs);
      setTreeData(newTreeData);

      if (loadedDXFs.length > 0) fitCamera(loadedDXFs);
      else setError('No viewable objects found in DXF files.');
    } catch { setError('Error processing files.'); }
    finally { setLoading(false); setStatus(''); }
  };

  const fitCamera = (files: DXFFile[]) => {
    if (!sceneRef.current || !cameraRef.current || !controlsRef.current) return;
    const box = new THREE.Box3();
    files.forEach(dxf => { if (dxf.group?.visible) box.expandByObject(dxf.group); });
    if (!box.isEmpty()) {
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      if (maxDim > 0 && maxDim < Infinity) {
        const fov = cameraRef.current.fov * (Math.PI / 180);
        const cameraZ = Math.max(Math.abs(maxDim / 2 / Math.tan(fov / 2)) * 1.5, maxDim);
        cameraRef.current.position.set(center.x + cameraZ * 0.5, center.y - cameraZ * 0.5, center.z + cameraZ * 0.5);
        controlsRef.current.target.copy(center);
        controlsRef.current.update();
        if (subCameraRef.current) {
          subCameraRef.current.position.set(center.x + cameraZ, center.y - cameraZ, center.z + cameraZ);
          subCameraRef.current.lookAt(center);
        }
      }
    }
  };

  const renderTreeNode = (node: TreeNode, depth: number = 0): React.ReactNode => {
    const hasChildren = node.children.length > 0;
    const isSelected = selectedNode?.id === node.id;

    return (
      <div key={node.id}>
        <div className={`flex items-center gap-1 py-1.5 px-1 rounded cursor-pointer transition-colors ${isSelected ? 'bg-blue-600/80' : 'hover:bg-white/10'}`} style={{ paddingLeft: `${depth * 12 + 4}px` }} onClick={() => selectNode(node)}>
          {hasChildren ? (
            <button onClick={(e) => { e.stopPropagation(); toggleNode(node.id); }} className="w-4 h-4 flex items-center justify-center text-gray-400 hover:text-white">
              {node.expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            </button>
          ) : <span className="w-4" />}

          {node.type === 'file' && <Box size={14} className="text-blue-400 flex-shrink-0" />}
          {node.type === 'layer' && <Layers size={14} className="text-purple-400 flex-shrink-0" />}

          {node.color && <div className="w-3 h-3 rounded-full flex-shrink-0 shadow-sm" style={{ backgroundColor: node.color, boxShadow: `0 0 6px ${node.color}` }} />}

          <span className="flex-1 text-xs truncate font-medium">{node.name}</span>
          {node.entityCount !== undefined && <span className="text-[10px] text-gray-500">({node.entityCount})</span>}

          <button onClick={(e) => { e.stopPropagation(); toggleNodeVisibility(node.id); }} className="w-5 h-5 flex items-center justify-center text-gray-400 hover:text-white">
            {node.visible ? <Eye size={12} /> : <EyeOff size={12} className="text-red-400" />}
          </button>
        </div>
        {node.expanded && hasChildren && <div>{node.children.map(child => renderTreeNode(child, depth + 1))}</div>}
      </div>
    );
  };

  return (
    <div className="flex h-full bg-gray-900 text-white overflow-hidden relative">
      {/* Mobile Header / Menus */}
      {isMobile && (
        <div className="absolute top-0 left-0 right-0 z-20 flex justify-between p-2 bg-gray-900/80 backdrop-blur-sm pointer-events-none">
          <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="p-2 bg-gray-800 rounded shadow pointer-events-auto text-white">
            {isSidebarOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
          {selectedNode && (
            <button onClick={() => setIsPropertiesOpen(!isPropertiesOpen)} className="p-2 bg-gray-800 rounded shadow pointer-events-auto text-white">
              {isPropertiesOpen ? <X size={20} /> : <Settings size={20} />}
            </button>
          )}
        </div>
      )}

      {/* Left Tree - Responsive: Collapsible sidebar for mobile */}
      <div className={`${isMobile ? 'absolute top-0 bottom-0 z-30 shadow-2xl transition-transform duration-300' : 'relative w-72'} ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'} bg-[#1a1a20] border-r border-gray-700 flex flex-col flex-shrink-0 ${isMobile ? 'w-3/4 max-w-xs' : ''}`}>
        <div className="p-3 border-b border-gray-700 flex items-center gap-2 bg-gradient-to-r from-blue-900/30 to-transparent">
          <Layers size={18} className="text-blue-400" />
          <span className="font-bold text-sm">Project Tree</span>
          <span className="ml-auto text-[10px] text-gray-400 bg-gray-800 px-2 py-0.5 rounded">{loadedFiles.length} files</span>
          {isMobile && <button onClick={() => setIsSidebarOpen(false)} className="ml-2 text-gray-400"><X size={16} /></button>}
        </div>
        <div className="flex-1 overflow-y-auto p-2">{treeData.map(node => renderTreeNode(node))}</div>
      </div>

      {/* Center Main Area */}
      <div className="flex-1 flex flex-col min-w-0 h-full relative">
        {/* Toolbar - Responsive: Scrollable horizontal on mobile */}
        <div className={`bg-gray-800 border-b border-gray-700 p-2 flex gap-2 items-center overflow-x-auto whitespace-nowrap hide-scrollbar ${isMobile ? 'pt-14' : ''}`}>
          {/* View buttons */}
          <div className="flex gap-1 border-r border-gray-600 pr-2">
            {(['front', 'back', 'left', 'right', 'top', 'iso'] as ViewType[]).map(v => (
              <button key={v} onClick={() => setView(v)} className="px-2 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-xs capitalize font-medium flex-shrink-0">
                {v}
              </button>
            ))}
          </div>

          {/* Render Mode */}
          <div className="flex gap-1 border-r border-gray-600 pr-2">
            <button onClick={() => updateGlobalRenderMode('shaded')} className={`px-2 py-1.5 rounded text-xs font-medium flex-shrink-0 ${globalRenderMode === 'shaded' ? 'bg-blue-600' : 'bg-gray-700 hover:bg-gray-600'}`}>
              <Grid3X3 size={14} className="inline mr-1" />Shaded
            </button>
            <button onClick={() => updateGlobalRenderMode('wireframe')} className={`px-2 py-1.5 rounded text-xs font-medium flex-shrink-0 ${globalRenderMode === 'wireframe' ? 'bg-blue-600' : 'bg-gray-700 hover:bg-gray-600'}`}>Wireframe</button>
            <button onClick={() => updateGlobalRenderMode('xray')} className={`px-2 py-1.5 rounded text-xs font-medium flex-shrink-0 ${globalRenderMode === 'xray' ? 'bg-blue-600' : 'bg-gray-700 hover:bg-gray-600'}`}>X-Ray</button>
          </div>

          {/* Tools */}
          <div className="flex gap-1">
            <button onClick={toggleSectionBox} className={`flex items-center gap-1 px-2 py-1.5 rounded text-xs font-medium flex-shrink-0 ${sectionBoxEnabled ? 'bg-cyan-600' : 'bg-gray-700 hover:bg-gray-600'}`}>
              <BoxSelect size={14} /> Section
            </button>
            <button onClick={() => setShowSubView(!showSubView)} className={`flex items-center gap-1 px-2 py-1.5 rounded text-xs font-medium flex-shrink-0 ${showSubView ? 'bg-purple-600' : 'bg-gray-700 hover:bg-gray-600'}`}>
              <Monitor size={14} /> SubView
            </button>
            <button onClick={() => fitCamera(loadedFiles)} className="flex items-center gap-1 px-2 py-1.5 bg-blue-600 hover:bg-blue-500 rounded text-xs font-medium flex-shrink-0" title="Zoom All">
              <Maximize size={14} /> Zoom All
            </button>
          </div>
        </div>

        {/* 3D View */}
        <div className="flex-1 relative w-full h-full overflow-hidden">
          <div ref={containerRef} className="w-full h-full" />

          {/* Floating Camera Controls (Right Side) */}
          <div className="absolute top-20 right-3 flex flex-col gap-1 bg-gray-800/90 p-1.5 rounded-lg shadow-xl border border-gray-700 backdrop-blur-sm z-10">
            <button onClick={zoomIn} className="p-2 hover:bg-gray-700 rounded text-white" title="Zoom In"><ZoomIn size={isMobile ? 18 : 20} /></button>
            <button onClick={zoomOut} className="p-2 hover:bg-gray-700 rounded text-white" title="Zoom Out"><ZoomOut size={isMobile ? 18 : 20} /></button>
            <button onClick={resetCamera} className="p-2 hover:bg-gray-700 rounded text-white" title="Reset Camera"><Home size={isMobile ? 18 : 20} /></button>
            <button onClick={() => fitCamera(loadedFiles)} className="p-2 hover:bg-gray-700 rounded text-blue-400" title="Zoom All"><Maximize size={isMobile ? 18 : 20} /></button>
          </div>

          {showSubView && (
            <div className="absolute bottom-12 right-3 border-2 border-purple-500 rounded overflow-hidden shadow-xl bg-gray-900 z-10">
              <div className="bg-purple-600 px-2 py-0.5 text-[10px] font-medium">Overview</div>
              <div ref={subViewRef} style={{ width: isMobile ? 120 : 180, height: isMobile ? 120 : 180 }} />
            </div>
          )}

          {sectionBoxEnabled && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-cyan-600 px-3 py-1.5 rounded shadow text-xs flex items-center gap-2 font-medium z-10 pointer-events-none">
              <BoxSelect size={14} /> Section Box Active
            </div>
          )}
        </div>

        {/* Status Bar / Footer */}
        <div className="bg-gray-800 border-t border-gray-700 px-3 py-1.5 text-[10px] sm:text-[11px] text-gray-400 flex justify-between items-center whitespace-nowrap overflow-x-auto">
          <div className="flex gap-3 sm:gap-4">
            <span>📁 {loadedFiles.length} files</span>
            {!isMobile && <span>🎨 {globalRenderMode}</span>}
            {sectionBoxEnabled && <span className="text-cyan-400">📦 Section</span>}
            {selectedNode && <span className="text-yellow-400 truncate max-w-[100px]">✓ {selectedNode.name}</span>}
          </div>
          <div className="flex items-center gap-3">
            <span>© 2025 SeaStar</span>
            <a href="mailto:designsir@seastargo.com" className="hover:text-blue-400 transition-colors">designsir@seastargo.com</a>
          </div>
        </div>
      </div>

      {/* Right Properties Panel - Responsive: Overlay sidebar for mobile */}
      {selectedNode && (
        <div className={`${isMobile ? 'absolute top-0 right-0 bottom-0 z-30 shadow-2xl w-3/4 max-w-xs transition-transform duration-300' : 'relative w-80'} ${isPropertiesOpen ? 'translate-x-0' : 'translate-x-full'} bg-[#1a1a20] border-l border-gray-700 flex flex-col flex-shrink-0 ${!isMobile ? 'shadow-xl z-10' : ''}`}>
          <div className="p-4 border-b border-gray-700 flex items-center gap-2 bg-gradient-to-r from-gray-800 to-transparent">
            <MousePointer2 size={18} className="text-green-400" />
            <span className="font-bold text-sm text-white">Selected Object Properties</span>
            <button onClick={() => { setSelectedNode(null); if (isMobile) setIsPropertiesOpen(false); }} className="ml-auto text-gray-400 hover:text-white">✕</button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-6">
            {/* Info */}
            <div className="bg-gray-800/50 rounded-lg p-3 space-y-2 border border-gray-700">
              <div className="flex items-center gap-2">
                {selectedNode.type === 'file' ? <Box size={16} className="text-blue-400" /> : <Layers size={16} className="text-purple-400" />}
                <span className="font-semibold text-sm text-white">{selectedNode.name}</span>
              </div>
              <div className="text-xs text-gray-400">
                Type: {selectedNode.type === 'file' ? 'File' : 'Layer'} • {selectedNode.entityCount} entities
              </div>
            </div>

            {/* Individual Render Mode */}
            <div className="space-y-2">
              <div className="text-xs font-semibold text-gray-300 flex items-center gap-1"><Sun size={14} /> Display Mode</div>
              <div className="flex gap-2 p-1 bg-gray-800 rounded-lg">
                <button onClick={() => updateNodeRenderMode(selectedNode.id, 'shaded')} className={`flex-1 py-1.5 rounded text-xs transition-colors ${selectedNode.renderMode === 'shaded' ? 'bg-blue-600 text-white' : 'hover:bg-gray-700 text-gray-400'}`}>Shaded</button>
                <button onClick={() => updateNodeRenderMode(selectedNode.id, 'wireframe')} className={`flex-1 py-1.5 rounded text-xs transition-colors ${selectedNode.renderMode === 'wireframe' ? 'bg-blue-600 text-white' : 'hover:bg-gray-700 text-gray-400'}`}>Wire</button>
                <button onClick={() => updateNodeRenderMode(selectedNode.id, 'xray')} className={`flex-1 py-1.5 rounded text-xs transition-colors ${selectedNode.renderMode === 'xray' ? 'bg-blue-600 text-white' : 'hover:bg-gray-700 text-gray-400'}`}>X-Ray</button>
              </div>
            </div>

            {/* Color */}
            <div className="space-y-2">
              <div className="text-xs font-semibold text-gray-300 flex items-center gap-1"><Palette size={14} /> Material Color</div>
              <div className="flex gap-2">
                <input
                  type="color"
                  value={selectedNode.color || '#ffffff'}
                  onChange={(e) => updateNodeColor(selectedNode.id, e.target.value)}
                  className="w-10 h-10 bg-transparent rounded cursor-pointer border-0 p-0"
                  title="Select color"
                />
                <div className="flex-1 flex flex-col justify-center">
                  <div className="text-[10px] text-gray-500 uppercase">{selectedNode.color}</div>
                  <div className="text-xs text-gray-400">Click circle to change</div>
                </div>
              </div>
            </div>

            {/* Opacity */}
            <div className="space-y-2">
              <div className="text-xs font-semibold text-gray-300 flex justify-between">
                <span>Opacity</span>
                <span className="font-mono text-blue-400">{Math.round((selectedNode.opacity || 1) * 100)}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                value={(selectedNode.opacity || 1) * 100}
                onChange={(e) => updateNodeOpacity(selectedNode.id, Number(e.target.value) / 100)}
                className="w-full accent-blue-500 h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer"
                title="Adjust opacity"
              />
            </div>

            {/* Rotation */}
            {selectedNode.object && (
              <div className="space-y-2">
                <div className="text-xs font-semibold text-gray-300 flex items-center gap-1"><RotateCw size={14} /> Rotation Control</div>
                <div className="grid grid-cols-3 gap-2">
                  <button onClick={() => rotateObject('x', 90)} className="py-2 bg-gray-800 hover:bg-gray-700 rounded text-xs font-mono border border-gray-700">X +90°</button>
                  <button onClick={() => rotateObject('y', 90)} className="py-2 bg-gray-800 hover:bg-gray-700 rounded text-xs font-mono border border-gray-700">Y +90°</button>
                  <button onClick={() => rotateObject('z', 90)} className="py-2 bg-gray-800 hover:bg-gray-700 rounded text-xs font-mono border border-gray-700">Z +90°</button>
                  <button onClick={() => rotateObject('x', -90)} className="py-2 bg-gray-800 hover:bg-gray-700 rounded text-xs font-mono border border-gray-700">X -90°</button>
                  <button onClick={() => rotateObject('y', -90)} className="py-2 bg-gray-800 hover:bg-gray-700 rounded text-xs font-mono border border-gray-700">Y -90°</button>
                  <button onClick={() => rotateObject('z', -90)} className="py-2 bg-gray-800 hover:bg-gray-700 rounded text-xs font-mono border border-gray-700">Z -90°</button>
                </div>
              </div>
            )}

            {/* Move Object */}
            {selectedNode.object && (
              <div className="space-y-2">
                <div className="text-xs font-semibold text-gray-300 flex items-center gap-1"><Move3d size={14} /> Position Control</div>
                <div className="grid grid-cols-3 gap-2">
                  {[['x', -50, 'X-'], ['x', 50, 'X+'], ['y', 50, 'Y+'], ['z', -50, 'Z-'], ['y', -50, 'Y-'], ['z', 50, 'Z+']].map(([axis, delta, label]) => (
                    <button
                      key={label as string}
                      onClick={() => moveObject(axis as 'x' | 'y' | 'z', delta as number)}
                      className="py-2 bg-gray-800 hover:bg-gray-700 rounded text-xs font-mono font-bold border border-gray-700"
                    >
                      {label as string}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Position Info */}
            {selectedNode.object && (
              <div className="bg-gray-800/30 rounded-lg p-3 border border-gray-700/50">
                <div className="text-xs text-gray-500 mb-2 uppercase tracking-wider">Transform Data</div>
                <div className="font-mono text-xs space-y-1">
                  <div className="flex justify-between border-b border-gray-700/50 pb-1"><span className="text-gray-400">Position</span></div>
                  <div className="flex justify-between pl-2"><span className="text-red-400">X</span> <span>{selectedNode.object.position.x.toFixed(1)}</span></div>
                  <div className="flex justify-between pl-2"><span className="text-green-400">Y</span> <span>{selectedNode.object.position.y.toFixed(1)}</span></div>
                  <div className="flex justify-between pl-2"><span className="text-blue-400">Z</span> <span>{selectedNode.object.position.z.toFixed(1)}</span></div>

                  <div className="flex justify-between border-b border-gray-700/50 pb-1 mt-2"><span className="text-gray-400">Rotation</span></div>
                  <div className="flex justify-between pl-2"><span className="text-red-400">X</span> <span>{(selectedNode.object.rotation.x * 180 / Math.PI).toFixed(0)}°</span></div>
                  <div className="flex justify-between pl-2"><span className="text-green-400">Y</span> <span>{(selectedNode.object.rotation.y * 180 / Math.PI).toFixed(0)}°</span></div>
                  <div className="flex justify-between pl-2"><span className="text-blue-400">Z</span> <span>{(selectedNode.object.rotation.z * 180 / Math.PI).toFixed(0)}°</span></div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Loading Overlay */}
      {loading && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black/90">
          <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4"></div>
          <span className="text-blue-400 text-sm font-medium tracking-wider">{status || 'PROCESSING...'}</span>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-red-950/95 p-6 rounded-xl border border-red-500/50 text-center max-w-sm z-50 shadow-2xl backdrop-blur-sm">
          <div className="text-4xl mb-3">⚠️</div>
          <p className="text-red-200 text-sm mb-4 font-medium">{error}</p>
          <button onClick={() => setError('')} className="px-6 py-2 bg-red-800 hover:bg-red-700 rounded-lg text-sm font-bold transition-colors shadow-lg">DISMISS</button>
        </div>
      )}
    </div>
  );
};

export default MultiDXFViewer;