'use client';
import { useRef, useEffect } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { FurnitureItem, RoomSpec, DoorItem } from './model';
import { effectiveDims, cutoutRect, wallPolygon, doorGeom, doorOnFloor } from './model';

const WALL_HEIGHT = 96;
const FURNITURE_HEIGHT = 30;
const WALL_THICKNESS = 4;
const DOOR_THICKNESS = 1.5;

interface RoomViewer3DProps {
  room: RoomSpec;
  items: FurnitureItem[];
  doors: DoorItem[];
  selectedId: number | null;
  selectedDoorId: number | null;
}

export default function RoomViewer3D({ room, items, doors, selectedId, selectedDoorId }: RoomViewer3DProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  // Initialize Three.js scene
  useEffect(() => {
    if (!containerRef.current) return;

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(getComputedStyle(document.documentElement).getPropertyValue('--bp-void').trim() || '#0a0a0a');
    sceneRef.current = scene;

    // Camera
    const camera = new THREE.PerspectiveCamera(50, containerRef.current.clientWidth / containerRef.current.clientHeight, 1, 2000);
    camera.position.set(200, 180, 200);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.minDistance = 50;
    controls.maxDistance = 500;
    controls.maxPolarAngle = Math.PI / 2.1;
    controlsRef.current = controls;

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const directionalLight1 = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight1.position.set(10, 20, 10);
    directionalLight1.castShadow = true;
    directionalLight1.shadow.mapSize.width = 1024;
    directionalLight1.shadow.mapSize.height = 1024;
    directionalLight1.shadow.camera.left = -200;
    directionalLight1.shadow.camera.right = 200;
    directionalLight1.shadow.camera.top = 200;
    directionalLight1.shadow.camera.bottom = -200;
    scene.add(directionalLight1);

    const directionalLight2 = new THREE.DirectionalLight(0xffffff, 0.4);
    directionalLight2.position.set(-10, 20, -10);
    scene.add(directionalLight2);

    // Animation loop
    const animate = () => {
      animationFrameRef.current = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    // Handle resize
    const handleResize = () => {
      if (!containerRef.current || !camera || !renderer) return;
      const width = containerRef.current.clientWidth;
      const height = containerRef.current.clientHeight;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(containerRef.current);

    // Cleanup
    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      resizeObserver.disconnect();
      controls.dispose();
      renderer.dispose();
      containerRef.current?.removeChild(renderer.domElement);
    };
  }, []);

  // Update scene content when props change
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    // Clear previous meshes (keep lights)
    const objectsToRemove = scene.children.filter(obj => obj instanceof THREE.Mesh || obj instanceof THREE.Group);
    objectsToRemove.forEach(obj => scene.remove(obj));

    // Build room geometry
    const wallColor = getComputedStyle(document.documentElement).getPropertyValue('--bp-wall').trim() || '#888';
    const floorColor = getComputedStyle(document.documentElement).getPropertyValue('--bp-floor').trim() || '#1a1a1a';

    // Floor
    const w = room.w;
    const h = room.h;
    const floorGeometry = new THREE.PlaneGeometry(w, h);
    const floorMaterial = new THREE.MeshStandardMaterial({ color: floorColor, side: THREE.DoubleSide });
    const floorMesh = new THREE.Mesh(floorGeometry, floorMaterial);
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.position.y = 0;
    floorMesh.receiveShadow = true;
    scene.add(floorMesh);

    // Walls with cutouts
    const poly = wallPolygon(room);
    const wallShape = new THREE.Shape();
    wallShape.moveTo(poly[0][0] - w/2, poly[0][1] - h/2);
    for (let i = 1; i < poly.length; i++) {
      wallShape.lineTo(poly[i][0] - w/2, poly[i][1] - h/2);
    }
    wallShape.closePath();

    // Add cutouts as holes
    if (room.cutouts) {
      room.cutouts.forEach(cutout => {
        const r = cutoutRect(cutout, room);
        const hole = new THREE.Path();
        hole.moveTo(r.x - w/2, r.y - h/2);
        hole.lineTo(r.x + r.w - w/2, r.y - h/2);
        hole.lineTo(r.x + r.w - w/2, r.y + r.h - h/2);
        hole.lineTo(r.x - w/2, r.y + r.h - h/2);
        hole.closePath();
        wallShape.holes.push(hole);
      });
    }

    const extrudeSettings = {
      steps: 1,
      depth: WALL_HEIGHT,
      bevelEnabled: false,
    };

    const wallGeometry = new THREE.ExtrudeGeometry(wallShape, extrudeSettings);
    wallGeometry.rotateX(Math.PI / 2);
    const wallMaterial = new THREE.MeshStandardMaterial({ 
      color: wallColor,
      side: THREE.DoubleSide,
    });
    const wallMesh = new THREE.Mesh(wallGeometry, wallMaterial);
    wallMesh.castShadow = true;
    wallMesh.receiveShadow = true;
    scene.add(wallMesh);

    // Furniture
    items.forEach(item => {
      const isSelected = item.id === selectedId;
      const { w, h } = effectiveDims(item);
      const boxGeometry = new THREE.BoxGeometry(w, FURNITURE_HEIGHT, h);
      const boxMaterial = new THREE.MeshStandardMaterial({
        color: isSelected ? 0x6366f1 : 0x404040,
        transparent: true,
        opacity: isSelected ? 0.8 : 0.6,
      });
      const box = new THREE.Mesh(boxGeometry, boxMaterial);
      
      box.position.x = item.x - w/2;
      box.position.y = FURNITURE_HEIGHT / 2;
      box.position.z = item.y - h/2;
      box.rotation.y = (item.rotation * Math.PI) / 180;
      box.castShadow = true;
      box.receiveShadow = true;

      // Subtle float animation for selected item
      if (isSelected) {
        const time = Date.now() * 0.001;
        box.position.y += Math.sin(time * 2) * 2;
      }

      scene.add(box);
    });

    // Doors
    const doorColor = 0x8b4513;
    doors.forEach(door => {
      const g = doorGeom(door, room);
      const doorWidth = Math.sqrt((g.sx - g.hx) ** 2 + (g.sy - g.hy) ** 2);
      const doorHeight = WALL_HEIGHT * 0.85;
      const doorGeometry = new THREE.BoxGeometry(doorWidth, doorHeight, DOOR_THICKNESS);
      const doorMaterial = new THREE.MeshStandardMaterial({
        color: doorColor,
        transparent: true,
        opacity: 0.7,
      });
      const doorMesh = new THREE.Mesh(doorGeometry, doorMaterial);

      // Position door at hinge point
      const centerX = (g.hx + g.sx) / 2;
      const centerY = (g.hy + g.sy) / 2;
      const doorAngle = Math.atan2(g.sy - g.hy, g.sx - g.hx);
      
      doorMesh.position.x = centerX - w/2;
      doorMesh.position.y = doorHeight / 2;
      doorMesh.position.z = centerY - h/2;
      doorMesh.rotation.y = doorAngle;
      doorMesh.castShadow = true;

      scene.add(doorMesh);
    });

  }, [room, items, doors, selectedId, selectedDoorId]);

  return (
    <div 
      ref={containerRef} 
      className="h-full w-full" 
      style={{ minHeight: 420 }}
    />
  );
}
