import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls';
import { DXFFile } from '../types';
import {
  ChevronRight, ChevronDown, Eye, EyeOff, Box, Layers,
  RotateCcw, Scissors, Monitor, Palette, Move3d,
  Maximize, BoxSelect, Square, Grid3x3
} from 'lucide-react';

interface MultiDXFViewerProps {
  files: DXFFile[];
}

interface DXFEntity {
  type: string;
  layer?: string;
  x?: number; y?: number; z?: number;
  x1?: number; y1?: number; z1?: number;
  x2?: number; y2?: number; z2?: number;
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
  type: 'file' | 'layer' | 'entity';
  visible: boolean;
  expanded: boolean;
  children: TreeNode[];
  object?: THREE.Object3D;
  color?: string;
  entityCount?: number;
  opacity?: number;
}

type ViewType = 'front' | 'back' | 'left' | 'right' | 'top' | 'iso';
type RenderMode = 'shaded' | 'wireframe' | 'xray';

const MultiDXFViewer: React.FC<MultiDXFViewerProps> = ({ files }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const subViewRef = useRef<HTMLDivElement>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [status, setStatus] = useState<string>('');
  const [loadedFiles, setLoadedFiles] = useState<DXFFile[]>([]);

  const [treeData, setTreeData] = useState<TreeNode[]>([]);
  const [selectedNode, setSelectedNode] = useState<TreeNode | null>(null);

  const [renderMode, setRenderMode] = useState<RenderMode>('shaded');
  const [showSubView, setShowSubView] = useState(false);
  const [history, setHistory] = useState<{ obj: THREE.Object3D, position: THREE.Vector3 }[][]>([]);

  // Section Box 상태
  const [sectionBoxEnabled, setSectionBoxEnabled] = useState(false);
  const [sectionBox, setSectionBox] = useState<THREE.Mesh | null>(null);
  const sectionBoxRef = useRef<THREE.Mesh | null>(null);
  const sectionPlanesRef = useRef<THREE.Plane[]>([]);

  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const transformControlsRef = useRef<TransformControls | null>(null);
  const subRendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const subCameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const outlineRef = useRef<THREE.BoxHelper | null>(null);
  const edgeGroupRef = useRef<THREE.Group | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    if (rendererRef.current) {
      rendererRef.current.dispose();
      containerRef.current.innerHTML = '';
    }

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a20);
    sceneRef.current = scene;

    const width = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;

    const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 500000);
    camera.position.set(1000, 1000, 1000);
    camera.up.set(0, 0, 1);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, logarithmicDepthBuffer: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    renderer.localClippingEnabled = true;
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controls.screenSpacePanning = true;
    controlsRef.current = controls;

    // Transform Controls for Section Box
    const transformControls = new TransformControls(camera, renderer.domElement);
    transformControls.setMode('scale');
    transformControls.addEventListener('dragging-changed', (e) => {
      controls.enabled = !e.value;
    });
    transformControls.addEventListener('objectChange', () => {
      updateSectionPlanes();
    });
    scene.add(transformControls);
    transformControlsRef.current = transformControls;

    // Lighting
    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(100, 100, 200);
    scene.add(dirLight);
    scene.add(new THREE.DirectionalLight(0xffffff, 0.4).translateX(-100).translateY(100).translateZ(-200));

    // Grid
    const gridHelper = new THREE.GridHelper(5000, 50, 0x3a3a4a, 0x2a2a3a);
    gridHelper.rotation.x = Math.PI / 2;
    scene.add(gridHelper);
    scene.add(new THREE.AxesHelper(500));

    // Edge group for X-Ray mode
    edgeGroupRef.current = new THREE.Group();
    edgeGroupRef.current.name = 'edgeGroup';
    scene.add(edgeGroupRef.current);

    // 서브뷰 카메라
    const subCamera = new THREE.PerspectiveCamera(60, 1, 0.1, 500000);
    subCamera.position.set(2000, 2000, 2000);
    subCamera.up.set(0, 0, 1);
    subCamera.lookAt(0, 0, 0);
    subCameraRef.current = subCamera;

    let animationId: number;
    const animate = () => {
      animationId = requestAnimationFrame(animate);
      if (controlsRef.current) controlsRef.current.update();
      if (rendererRef.current && sceneRef.current && cameraRef.current) {
        rendererRef.current.render(sceneRef.current, cameraRef.current);
      }
      if (showSubView && subRendererRef.current && sceneRef.current && subCameraRef.current) {
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
      transformControls.dispose();
      renderer.dispose();
      if (containerRef.current) containerRef.current.innerHTML = '';
    };
  }, [showSubView]);

  // 서브뷰 초기화
  useEffect(() => {
    if (!subViewRef.current || !showSubView) return;
    const subRenderer = new THREE.WebGLRenderer({ antialias: true });
    subRenderer.setSize(180, 180);
    subViewRef.current.appendChild(subRenderer.domElement);
    subRendererRef.current = subRenderer;
    return () => {
      if (subViewRef.current && subRenderer.domElement.parentNode === subViewRef.current) {
        subViewRef.current.removeChild(subRenderer.domElement);
      }
      subRenderer.dispose();
    };
  }, [showSubView]);

  useEffect(() => {
    if (files.length > 0 && sceneRef.current) loadAllDXFFiles(files);
  }, [files]);

  // Section Box 생성/제거
  const toggleSectionBox = useCallback(() => {
    if (!sceneRef.current) return;

    if (sectionBoxEnabled) {
      // 제거
      if (sectionBoxRef.current) {
        if (transformControlsRef.current) transformControlsRef.current.detach();
        sceneRef.current.remove(sectionBoxRef.current);
        sectionBoxRef.current = null;
        setSectionBox(null);
      }
      // Clipping 해제
      sceneRef.current.traverse((child) => {
        if ((child as THREE.Mesh).isMesh && (child as THREE.Mesh).material) {
          const mesh = child as THREE.Mesh;
          if (mesh.material instanceof THREE.Material) {
            mesh.material.clippingPlanes = null;
            mesh.material.needsUpdate = true;
          }
        }
      });
      sectionPlanesRef.current = [];
      setSectionBoxEnabled(false);
    } else {
      // 생성 - 모델 바운딩 박스 기준
      const box = new THREE.Box3();
      loadedFiles.forEach(f => { if (f.group) box.expandByObject(f.group); });

      if (box.isEmpty()) return;

      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());

      // Section Box Mesh (반투명 + 와이어프레임)
      const boxGeo = new THREE.BoxGeometry(size.x * 1.2, size.y * 1.2, size.z * 1.2);
      const boxMat = new THREE.MeshBasicMaterial({
        color: 0x00aaff,
        transparent: true,
        opacity: 0.1,
        side: THREE.BackSide,
        depthWrite: false
      });
      const boxMesh = new THREE.Mesh(boxGeo, boxMat);
      boxMesh.position.copy(center);
      boxMesh.name = 'sectionBox';

      // 와이어프레임 추가
      const edges = new THREE.EdgesGeometry(boxGeo);
      const lineMat = new THREE.LineBasicMaterial({ color: 0x00aaff, linewidth: 2 });
      const wireframe = new THREE.LineSegments(edges, lineMat);
      boxMesh.add(wireframe);

      sceneRef.current.add(boxMesh);
      sectionBoxRef.current = boxMesh;
      setSectionBox(boxMesh);

      // Transform Controls 연결
      if (transformControlsRef.current) {
        transformControlsRef.current.attach(boxMesh);
      }

      // Clipping Planes 생성
      updateSectionPlanes();
      setSectionBoxEnabled(true);
    }
  }, [sectionBoxEnabled, loadedFiles]);

  // Section Planes 업데이트
  const updateSectionPlanes = useCallback(() => {
    if (!sceneRef.current || !sectionBoxRef.current) return;

    const box = sectionBoxRef.current;
    const pos = box.position;
    const scale = box.scale;
    const geo = box.geometry as THREE.BoxGeometry;
    const params = geo.parameters;
    const halfX = (params.width * scale.x) / 2;
    const halfY = (params.height * scale.y) / 2;
    const halfZ = (params.depth * scale.z) / 2;

    const planes = [
      new THREE.Plane(new THREE.Vector3(1, 0, 0), -(pos.x - halfX)),  // Left
      new THREE.Plane(new THREE.Vector3(-1, 0, 0), (pos.x + halfX)),  // Right
      new THREE.Plane(new THREE.Vector3(0, 1, 0), -(pos.y - halfY)),  // Front
      new THREE.Plane(new THREE.Vector3(0, -1, 0), (pos.y + halfY)),  // Back
      new THREE.Plane(new THREE.Vector3(0, 0, 1), -(pos.z - halfZ)),  // Bottom
      new THREE.Plane(new THREE.Vector3(0, 0, -1), (pos.z + halfZ)),  // Top
    ];

    sectionPlanesRef.current = planes;

    // 모든 객체에 적용
    sceneRef.current.traverse((child) => {
      if (child.name === 'sectionBox' || child.name === 'edgeGroup') return;
      if ((child as THREE.Mesh).isMesh && (child as THREE.Mesh).material) {
        const mesh = child as THREE.Mesh;
        if (mesh.material instanceof THREE.Material) {
          mesh.material.clippingPlanes = planes;
          mesh.material.clipIntersection = false;
          mesh.material.needsUpdate = true;
        }
      }
      if ((child as THREE.Line).isLine && (child as THREE.Line).material) {
        const line = child as THREE.Line;
        if (line.material instanceof THREE.Material) {
          line.material.clippingPlanes = planes;
          line.material.needsUpdate = true;
        }
      }
    });
  }, []);

  const setView = (view: ViewType) => {
    if (!cameraRef.current || !controlsRef.current) return;
    const distance = 2000;
    const positions: Record<ViewType, [number, number, number]> = {
      front: [0, -distance, 0], back: [0, distance, 0],
      left: [-distance, 0, 0], right: [distance, 0, 0],
      top: [0, 0, distance], iso: [distance, -distance, distance]
    };
    cameraRef.current.position.set(...positions[view]);
    cameraRef.current.lookAt(controlsRef.current.target);
    controlsRef.current.update();
  };

  const changeRenderMode = (mode: RenderMode) => {
    setRenderMode(mode);
    if (!sceneRef.current || !edgeGroupRef.current) return;

    // 기존 edge 제거
    while (edgeGroupRef.current.children.length > 0) {
      edgeGroupRef.current.remove(edgeGroupRef.current.children[0]);
    }

    sceneRef.current.traverse((child) => {
      if (child.name === 'sectionBox' || child.name === 'edgeGroup') return;

      if ((child as THREE.Mesh).isMesh && (child as THREE.Mesh).material) {
        const mesh = child as THREE.Mesh;
        if (mesh.material instanceof THREE.Material) {
          if (mode === 'wireframe') {
            (mesh.material as any).wireframe = true;
            mesh.material.opacity = 1;
          } else if (mode === 'xray') {
            // X-Ray: 반투명 + Edge 표시
            (mesh.material as any).wireframe = false;
            mesh.material.transparent = true;
            mesh.material.opacity = 0.3;
            mesh.material.needsUpdate = true;

            // Edge 추가
            const edges = new THREE.EdgesGeometry(mesh.geometry);
            const edgeMat = new THREE.LineBasicMaterial({ color: 0x000000 });
            const edgeLines = new THREE.LineSegments(edges, edgeMat);
            edgeLines.position.copy(mesh.position);
            edgeLines.rotation.copy(mesh.rotation);
            edgeLines.scale.copy(mesh.scale);
            edgeGroupRef.current?.add(edgeLines);
          } else {
            // Shaded
            (mesh.material as any).wireframe = false;
            mesh.material.transparent = true;
            mesh.material.opacity = 1;
            mesh.material.needsUpdate = true;
          }
        }
      }
    });
  };

  // 트리 관련 함수들
  const toggleNode = useCallback((nodeId: string) => {
    const toggle = (nodes: TreeNode[]): TreeNode[] => nodes.map(n =>
      n.id === nodeId ? { ...n, expanded: !n.expanded } :
        n.children.length > 0 ? { ...n, children: toggle(n.children) } : n
    );
    setTreeData(prev => toggle(prev));
  }, []);

  const selectNode = useCallback((node: TreeNode) => {
    setSelectedNode(node);
    if (!sceneRef.current) return;
    if (outlineRef.current) { sceneRef.current.remove(outlineRef.current); outlineRef.current = null; }
    if (node.object) {
      const outline = new THREE.BoxHelper(node.object, 0xffff00);
      sceneRef.current.add(outline);
      outlineRef.current = outline;
    }
  }, []);

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

  // 속성 변경
  const updateColor = (color: string) => {
    if (!selectedNode?.object) return;
    selectedNode.object.traverse((child) => {
      if ((child as THREE.Mesh).isMesh || (child as THREE.Line).isLine) {
        const obj = child as THREE.Mesh | THREE.Line;
        if (obj.material instanceof THREE.Material) {
          (obj.material as THREE.MeshBasicMaterial).color.setStyle(color);
        }
      }
    });
  };

  const updateOpacity = (nodeId: string, opacity: number) => {
    const updateInTree = (nodes: TreeNode[]): TreeNode[] => nodes.map(n => {
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
      return n.children.length > 0 ? { ...n, children: updateInTree(n.children) } : n;
    });
    setTreeData(prev => updateInTree(prev));
  };

  const moveObject = (axis: 'x' | 'y' | 'z', delta: number) => {
    if (!selectedNode?.object) return;
    setHistory(prev => [...prev, [{ obj: selectedNode.object!, position: selectedNode.object!.position.clone() }]]);
    selectedNode.object.position[axis] += delta;
    if (outlineRef.current && sceneRef.current) {
      sceneRef.current.remove(outlineRef.current);
      outlineRef.current = new THREE.BoxHelper(selectedNode.object, 0xffff00);
      sceneRef.current.add(outlineRef.current);
    }
  };

  const undo = () => {
    if (history.length === 0) return;
    history[history.length - 1].forEach(({ obj, position }) => obj.position.copy(position));
    setHistory(prev => prev.slice(0, -1));
  };

  // DXF 파서
  const parseDXF = (content: string, color: string, fileName: string): { group: THREE.Group, tree: TreeNode } => {
    const group = new THREE.Group();
    const lines = content.split(/\r?\n/);
    const entities: DXFEntity[] = [];
    const layerGroups: Record<string, THREE.Group> = {};
    const layerColors: Record<string, string> = {};

    let section: string | null = null;
    let currentEntity: DXFEntity | null = null;

    const commitEntity = () => {
      if (!currentEntity) return;
      if (section === 'ENTITIES') entities.push(currentEntity);
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
        else if (section === 'ENTITIES') currentEntity = { type: value };
      }
      else if (code === 2 && section === null && value === 'ENTITIES') section = value;
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
          case 40: currentEntity.radius = valNum; break;
          case 50: currentEntity.startAngle = valNum; break;
          case 51: currentEntity.endAngle = valNum; break;
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
      }
    }
    commitEntity();

    const createObject = (e: DXFEntity, layerColor: string): THREE.Object3D | null => {
      const matLine = new THREE.LineBasicMaterial({ color: new THREE.Color(layerColor) });
      const matMesh = new THREE.MeshPhongMaterial({ color: new THREE.Color(layerColor), side: THREE.DoubleSide, transparent: true, opacity: 1 });

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
        if (e.type === '3DFACE') {
          const pts = [new THREE.Vector3(e.x || 0, e.y || 0, e.z || 0), new THREE.Vector3(e.x1 || 0, e.y1 || 0, e.z1 || 0), new THREE.Vector3(e.x2 || 0, e.y2 || 0, e.z2 || 0), new THREE.Vector3(e.x3 || 0, e.y3 || 0, e.z3 || 0)];
          const geo = new THREE.BufferGeometry().setFromPoints(pts);
          geo.computeVertexNormals();
          return new THREE.Mesh(geo, matMesh);
        }
      } catch { /* ignore */ }
      return null;
    };

    const palette = ['#FF5252', '#FF4081', '#7C4DFF', '#536DFE', '#40C4FF', '#64FFDA', '#B2FF59', '#FFD740', '#FF6E40', '#8D6E63'];
    let colorIdx = 0;

    entities.forEach(e => {
      const layerName = e.layer || '0';
      if (!layerGroups[layerName]) {
        layerGroups[layerName] = new THREE.Group();
        layerGroups[layerName].name = `layer_${layerName}`;
        layerColors[layerName] = palette[colorIdx++ % palette.length];
      }
      const obj = createObject(e, layerColors[layerName]);
      if (obj) {
        obj.userData.entityType = e.type;
        obj.userData.layer = layerName;
        layerGroups[layerName].add(obj);
      }
    });

    Object.values(layerGroups).forEach(g => group.add(g));

    const fileNode: TreeNode = {
      id: `file_${fileName}`, name: fileName, type: 'file', visible: true, expanded: true,
      children: [], object: group, color, entityCount: entities.length, opacity: 1
    };

    Object.entries(layerGroups).forEach(([layerName, layerGroup]) => {
      const layerNode: TreeNode = {
        id: `layer_${fileName}_${layerName}`, name: layerName, type: 'layer', visible: true, expanded: false,
        children: [], object: layerGroup, color: layerColors[layerName], entityCount: layerGroup.children.length, opacity: 1
      };
      fileNode.children.push(layerNode);
    });

    return { group, tree: fileNode };
  };

  const loadAllDXFFiles = async (dxfFiles: DXFFile[]) => {
    setLoading(true);
    setError('');
    setStatus('파일 파싱 중...');

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

      for (const dxfFile of dxfFiles) {
        if (!dxfFile.content || dxfFile.content.length < 10) continue;
        if (dxfFile.content.startsWith('AutoCAD Binary DXF')) continue;

        const { group, tree } = parseDXF(dxfFile.content, dxfFile.color, dxfFile.name);
        group.name = dxfFile.id;
        group.visible = dxfFile.visible;

        if (sceneRef.current) sceneRef.current.add(group);
        loadedDXFs.push({ ...dxfFile, group });
        newTreeData.push(tree);
      }

      setLoadedFiles(loadedDXFs);
      setTreeData(newTreeData);

      if (loadedDXFs.length > 0) fitCamera(loadedDXFs);
      else setError('DXF 파일에서 객체를 찾을 수 없습니다.');
    } catch { setError('파일 처리 중 오류'); }
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
        <div className={`flex items-center gap-1 py-1 px-1 rounded cursor-pointer transition-colors ${isSelected ? 'bg-blue-600/80' : 'hover:bg-white/5'}`} style={{ paddingLeft: `${depth * 12 + 4}px` }} onClick={() => selectNode(node)}>
          {hasChildren ? (
            <button onClick={(e) => { e.stopPropagation(); toggleNode(node.id); }} className="w-4 h-4 flex items-center justify-center text-gray-400 hover:text-white">
              {node.expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            </button>
          ) : <span className="w-4" />}

          {node.type === 'file' && <Box size={12} className="text-blue-400 flex-shrink-0" />}
          {node.type === 'layer' && <Layers size={12} className="text-purple-400 flex-shrink-0" />}

          {node.color && <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: node.color }} />}

          <span className="flex-1 text-xs truncate">{node.name}</span>
          {node.entityCount && <span className="text-[10px] text-gray-500">({node.entityCount})</span>}

          <button onClick={(e) => { e.stopPropagation(); toggleNodeVisibility(node.id); }} className="w-4 h-4 flex items-center justify-center text-gray-400 hover:text-white opacity-70">
            {node.visible ? <Eye size={10} /> : <EyeOff size={10} className="text-red-400" />}
          </button>
        </div>
        {node.expanded && hasChildren && <div>{node.children.map(child => renderTreeNode(child, depth + 1))}</div>}
      </div>
    );
  };

  return (
    <div className="flex h-full bg-gray-900 text-white overflow-hidden">
      {/* 좌측 트리 */}
      <div className="w-72 bg-[#1e1e24] border-r border-gray-700 flex flex-col flex-shrink-0">
        <div className="p-2 border-b border-gray-700 flex items-center gap-2">
          <Layers size={16} className="text-blue-400" />
          <span className="font-semibold text-sm">프로젝트</span>
          <span className="ml-auto text-[10px] text-gray-500">{loadedFiles.length}개</span>
        </div>
        <div className="flex-1 overflow-y-auto p-1">{treeData.map(node => renderTreeNode(node))}</div>
      </div>

      {/* 중앙 */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* 툴바 */}
        <div className="bg-gray-800 border-b border-gray-700 p-1.5 flex gap-1 flex-wrap items-center">
          <div className="flex gap-0.5 bg-gray-700/50 rounded p-0.5">
            {(['front', 'back', 'left', 'right', 'top', 'iso'] as ViewType[]).map(v => (
              <button key={v} onClick={() => setView(v)} className="px-2 py-1 hover:bg-gray-600 rounded text-[11px]">
                {v === 'front' ? '정면' : v === 'back' ? '후면' : v === 'left' ? '좌' : v === 'right' ? '우' : v === 'top' ? '평면' : 'ISO'}
              </button>
            ))}
          </div>

          <div className="w-px h-5 bg-gray-600" />

          <div className="flex gap-0.5 bg-gray-700/50 rounded p-0.5">
            <button onClick={() => changeRenderMode('shaded')} className={`px-2 py-1 rounded text-[11px] ${renderMode === 'shaded' ? 'bg-blue-600' : 'hover:bg-gray-600'}`}>음영</button>
            <button onClick={() => changeRenderMode('wireframe')} className={`px-2 py-1 rounded text-[11px] ${renderMode === 'wireframe' ? 'bg-blue-600' : 'hover:bg-gray-600'}`}>와이어</button>
            <button onClick={() => changeRenderMode('xray')} className={`px-2 py-1 rounded text-[11px] ${renderMode === 'xray' ? 'bg-blue-600' : 'hover:bg-gray-600'}`}>X-Ray</button>
          </div>

          <div className="w-px h-5 bg-gray-600" />

          <button onClick={toggleSectionBox} className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] ${sectionBoxEnabled ? 'bg-cyan-600' : 'bg-gray-700 hover:bg-gray-600'}`}>
            <BoxSelect size={12} /> Section Box
          </button>

          <button onClick={() => setShowSubView(!showSubView)} className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] ${showSubView ? 'bg-purple-600' : 'bg-gray-700 hover:bg-gray-600'}`}>
            <Monitor size={12} /> 서브뷰
          </button>

          <div className="w-px h-5 bg-gray-600" />

          <button onClick={undo} disabled={history.length === 0} className="flex items-center gap-1 px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-[11px] disabled:opacity-40">
            <RotateCcw size={12} /> 되돌리기
          </button>
          <button onClick={() => fitCamera(loadedFiles)} className="flex items-center gap-1 px-2 py-1 bg-blue-600 hover:bg-blue-500 rounded text-[11px]">
            <Maximize size={12} /> 맞춤
          </button>
        </div>

        {/* 3D 뷰 */}
        <div className="flex-1 relative">
          <div ref={containerRef} className="w-full h-full" />

          {showSubView && (
            <div className="absolute bottom-3 right-3 border-2 border-purple-500 rounded overflow-hidden shadow-xl bg-gray-900">
              <div className="bg-purple-600 px-2 py-0.5 text-[10px]">전체 뷰</div>
              <div ref={subViewRef} style={{ width: 180, height: 180 }} />
            </div>
          )}

          {sectionBoxEnabled && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-cyan-600 px-3 py-1.5 rounded shadow text-xs flex items-center gap-2">
              <BoxSelect size={14} /> Section Box 활성 (드래그로 크기 조절)
            </div>
          )}
        </div>

        {/* 상태바 */}
        <div className="bg-gray-800 border-t border-gray-700 px-2 py-1 text-[10px] text-gray-400 flex gap-3">
          <span>📁 {loadedFiles.length}개</span>
          <span>🎨 {renderMode === 'shaded' ? '음영' : renderMode === 'wireframe' ? '와이어' : 'X-Ray'}</span>
          {sectionBoxEnabled && <span className="text-cyan-400">📦 Section Box</span>}
          {showSubView && <span className="text-purple-400">📺 서브뷰</span>}
          {selectedNode && <span className="text-yellow-400">✓ {selectedNode.name}</span>}
        </div>
      </div>

      {/* 우측 속성 */}
      {selectedNode && (
        <div className="w-64 bg-[#1e1e24] border-l border-gray-700 flex flex-col flex-shrink-0">
          <div className="p-2 border-b border-gray-700 flex items-center gap-2">
            <Palette size={14} className="text-orange-400" />
            <span className="font-semibold text-sm">속성</span>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-3">
            <div className="bg-gray-800/50 rounded p-2 space-y-1">
              <div className="text-[10px] text-gray-400">이름</div>
              <div className="text-xs">{selectedNode.name}</div>
              <div className="text-[10px] text-gray-400 mt-1">타입</div>
              <div className="text-xs">{selectedNode.type === 'file' ? '파일' : '레이어'}</div>
            </div>

            <div>
              <div className="text-[10px] text-gray-400 mb-1 flex items-center gap-1"><Palette size={10} /> 색상</div>
              <input type="color" defaultValue={selectedNode.color || '#ffffff'} onChange={(e) => updateColor(e.target.value)} className="w-full h-7 bg-gray-700 rounded cursor-pointer border border-gray-600" />
            </div>

            <div>
              <div className="text-[10px] text-gray-400 mb-1 flex justify-between">
                <span>투명도</span>
                <span>{Math.round((selectedNode.opacity || 1) * 100)}%</span>
              </div>
              <input type="range" min="0" max="100" value={(selectedNode.opacity || 1) * 100} onChange={(e) => updateOpacity(selectedNode.id, Number(e.target.value) / 100)} className="w-full accent-blue-500" />
            </div>

            {selectedNode.object && (
              <div>
                <div className="text-[10px] text-gray-400 mb-1 flex items-center gap-1"><Move3d size={10} /> 이동</div>
                <div className="grid grid-cols-3 gap-1">
                  {[['x', -50, 'X-'], ['x', 50, 'X+'], ['y', 50, 'Y+'], ['z', -50, 'Z-'], ['y', -50, 'Y-'], ['z', 50, 'Z+']].map(([axis, delta, label]) => (
                    <button key={label as string} onClick={() => moveObject(axis as 'x' | 'y' | 'z', delta as number)} className="py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-[10px] font-mono">{label as string}</button>
                  ))}
                </div>
              </div>
            )}

            {selectedNode.object && (
              <div className="bg-gray-800/50 rounded p-2">
                <div className="text-[10px] text-gray-400 mb-1">위치</div>
                <div className="font-mono text-[10px] space-y-0.5">
                  <div>X: {selectedNode.object.position.x.toFixed(1)}</div>
                  <div>Y: {selectedNode.object.position.y.toFixed(1)}</div>
                  <div>Z: {selectedNode.object.position.z.toFixed(1)}</div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {loading && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black/90">
          <div className="w-10 h-10 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mb-2"></div>
          <span className="text-blue-400 text-sm">{status || '처리 중...'}</span>
        </div>
      )}

      {error && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-red-950/95 p-5 rounded-lg border border-red-500/50 text-center max-w-sm z-50">
          <div className="text-3xl mb-2">⚠️</div>
          <p className="text-red-200 text-sm mb-3">{error}</p>
          <button onClick={() => setError('')} className="px-3 py-1.5 bg-red-800 hover:bg-red-700 rounded text-xs">확인</button>
        </div>
      )}
    </div>
  );
};

export default MultiDXFViewer;