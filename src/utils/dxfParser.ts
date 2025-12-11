import * as THREE from 'three';
import { DXFEntity } from '../types';

/**
 * DXF 파일 파싱 및 Three.js 객체 생성
 */
export const parseDXF = (
    content: string,
    color: string,
    wireframeMode: boolean = false
): THREE.Group => {
    const group = new THREE.Group();
    const lines = content.split(/\r?\n/);

    const blocks: Record<string, DXFEntity[]> = {};
    const entities: DXFEntity[] = [];

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

    // Pass 1: Parse Structure
    for (let i = 0; i < lines.length - 1; i += 2) {
        const codeStr = lines[i].trim();
        const value = lines[i + 1].trim();
        if (codeStr === '') continue;

        const code = parseInt(codeStr, 10);
        if (isNaN(code)) continue;

        if (code === 0) {
            commitEntity();

            if (value === 'SECTION') {
                section = null;
            } else if (value === 'ENDSEC') {
                section = null;
            } else if (value === 'BLOCK') {
                currentBlockName = '';
                currentBlockEntities = [];
            } else if (value === 'ENDBLK') {
                if (currentBlockName) {
                    blocks[currentBlockName] = currentBlockEntities;
                }
                currentBlockName = null;
                currentBlockEntities = [];
            } else {
                if ((section === 'ENTITIES') || (section === 'BLOCKS' && currentBlockName !== null)) {
                    currentEntity = { type: value };
                }
            }
        }

        else if (code === 2) {
            if (section === null && (value === 'ENTITIES' || value === 'BLOCKS')) {
                section = value;
            } else if (section === 'BLOCKS' && currentBlockName === '') {
                currentBlockName = value;
            } else if (currentEntity && currentEntity.type === 'INSERT') {
                currentEntity.blockName = value;
            }
        }

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

            // LWPOLYLINE vertices
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

            // SPLINE control points
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

    // Pass 2: Generate Geometry
    const materialLine = new THREE.LineBasicMaterial({ color: new THREE.Color(color) });
    const materialMesh = new THREE.MeshPhongMaterial({
        color: new THREE.Color(color),
        side: THREE.DoubleSide,
        wireframe: wireframeMode,
        transparent: true,
        opacity: 1
    });

    const createObject = (e: DXFEntity): THREE.Object3D | null => {
        try {
            if (e.type === 'LINE') {
                const points = [
                    new THREE.Vector3(e.x || 0, e.y || 0, e.z || 0),
                    new THREE.Vector3(e.x1 || 0, e.y1 || 0, e.z1 || 0)
                ];
                const geometry = new THREE.BufferGeometry().setFromPoints(points);
                return new THREE.Line(geometry, materialLine);
            }

            if (e.type === 'LWPOLYLINE' && e.vertices && e.vertices.length > 1) {
                const points = e.vertices.map(v => new THREE.Vector3(v.x, v.y, e.z || 0));
                if (e.closed) points.push(points[0]);
                const geometry = new THREE.BufferGeometry().setFromPoints(points);
                return new THREE.Line(geometry, materialLine);
            }

            if (e.type === 'CIRCLE') {
                const curve = new THREE.EllipseCurve(
                    0, 0, e.radius || 1, e.radius || 1, 0, 2 * Math.PI, false, 0
                );
                const pts = curve.getPoints(32).map(p => new THREE.Vector3(p.x, p.y, 0));
                const geometry = new THREE.BufferGeometry().setFromPoints(pts);
                const line = new THREE.Line(geometry, materialLine);
                line.position.set(e.x || 0, e.y || 0, e.z || 0);
                return line;
            }

            if (e.type === 'ARC') {
                const start = (e.startAngle || 0) * Math.PI / 180;
                const end = (e.endAngle || 0) * Math.PI / 180;
                const curve = new THREE.EllipseCurve(
                    0, 0, e.radius || 1, e.radius || 1, start, end, false, 0
                );
                const pts = curve.getPoints(32).map(p => new THREE.Vector3(p.x, p.y, 0));
                const geometry = new THREE.BufferGeometry().setFromPoints(pts);
                const line = new THREE.Line(geometry, materialLine);
                line.position.set(e.x || 0, e.y || 0, e.z || 0);
                return line;
            }

            if (e.type === 'SPLINE' && e.controlPoints && e.controlPoints.length > 1) {
                const vecPoints = e.controlPoints.map(p => new THREE.Vector3(p.x, p.y, p.z || 0));
                const curve = new THREE.CatmullRomCurve3(vecPoints);
                const pts = curve.getPoints(50);
                const geometry = new THREE.BufferGeometry().setFromPoints(pts);
                return new THREE.Line(geometry, materialLine);
            }

            if (e.type === '3DFACE') {
                const pts = [
                    new THREE.Vector3(e.x || 0, e.y || 0, e.z || 0),
                    new THREE.Vector3(e.x1 || 0, e.y1 || 0, e.z1 || 0),
                    new THREE.Vector3(e.x2 || 0, e.y2 || 0, e.z2 || 0),
                    new THREE.Vector3(e.x3 || 0, e.y3 || 0, e.z3 || 0)
                ];
                if (!pts[3].equals(pts[2])) {
                    pts.push(pts[0], pts[2]);
                }
                const geometry = new THREE.BufferGeometry().setFromPoints(pts);
                geometry.computeVertexNormals();
                return new THREE.Mesh(geometry, materialMesh);
            }

            // INSERT (Block reference)
            if (e.type === 'INSERT' && e.blockName && blocks[e.blockName]) {
                const blockGroup = new THREE.Group();
                const blockDefs = blocks[e.blockName];

                blockDefs.forEach(childE => {
                    const childObj = createObject(childE);
                    if (childObj) blockGroup.add(childObj);
                });

                blockGroup.position.set(e.x || 0, e.y || 0, e.z || 0);

                const scaleX = e.scale?.x ?? 1;
                const scaleY = e.scale?.y ?? 1;
                const scaleZ = e.scale?.z ?? 1;
                blockGroup.scale.set(scaleX, scaleY, scaleZ);

                if (e.rotation) {
                    blockGroup.rotation.z = (e.rotation * Math.PI) / 180;
                }
                return blockGroup;
            }

        } catch (err) {
            console.warn('Error parsing entity', e.type, err);
        }
        return null;
    };

    // Render all entities
    let count = 0;
    entities.forEach(e => {
        const obj = createObject(e);
        if (obj) {
            group.add(obj);
            count++;
        }
    });

    console.log(`Parsed DXF: ${count} objects created. Blocks found: ${Object.keys(blocks).length}`);
    return group;
};

export default parseDXF;
