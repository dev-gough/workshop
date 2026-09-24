'use client';

import { useRef, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { FurnitureItem, RoomSpec, DoorItem } from './model';
import { effectiveDims, cutoutRect, wallPolygon, doorGeom, doorOnFloor } from './model';

// Default heights for 3D extrusion (in inches)
const WALL_HEIGHT = 96; // 8 feet
const FURNITURE_HEIGHT = 30; // 2.5 feet typical
const WALL_THICKNESS = 6; // 6 inches
const DOOR_THICKNESS = 1.75; // standard door leaf

interface RoomViewer3DProps {
  room: RoomSpec;
  items: FurnitureItem[];
  doors: DoorItem[];
  selectedId: number | null;
  selectedDoorId: number | null;
}

function WallsGeometry({ room }: { room: RoomSpec }) {
  const geometry = useMemo(() => {
    const shape = new THREE.Shape();
    const poly = wallPolygon(room);
    
    // Outer boundary
    poly.forEach(([x, y], i) => {
      if (i === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    });
    shape.closePath();
    
    // Inner boundary (offset by wall thickness)
    const innerPoly = wallPolygon(room).map(([x, y]): [number, number] => {
      // Simple inward offset - for complex shapes we'd need a proper offset algorithm
      const cx = room.w / 2;
      const cy = room.h / 2;
      const dx = x - cx;
      const dy = y - cy;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len < 0.001) return [x, y];
      const scale = Math.max(0, len - WALL_THICKNESS) / len;
      return [cx + dx * scale, cy + dy * scale];
    });
    
    const hole = new THREE.Path();
    innerPoly.forEach(([x, y], i) => {
      if (i === 0) hole.moveTo(x, y);
      else hole.lineTo(x, y);
    });
    hole.closePath();
    shape.holes.push(hole);
    
    const extrudeSettings = {
      depth: WALL_HEIGHT,
      bevelEnabled: false,
    };
    
    return new THREE.ExtrudeGeometry(shape, extrudeSettings);
  }, [room]);

  return (
    <mesh geometry={geometry} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
      <meshStandardMaterial color="#888888" roughness={0.8} metalness={0.1} />
    </mesh>
  );
}

function Floor({ room }: { room: RoomSpec }) {
  const geometry = useMemo(() => {
    const shape = new THREE.Shape();
    const poly = wallPolygon(room);
    
    poly.forEach(([x, y], i) => {
      if (i === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    });
    shape.closePath();
    
    return new THREE.ShapeGeometry(shape);
  }, [room]);

  return (
    <mesh geometry={geometry} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
      <meshStandardMaterial color="#d4d4d8" roughness={0.9} metalness={0.0} />
    </mesh>
  );
}

function FurnitureBox({ 
  item, 
  isSelected 
}: { 
  item: FurnitureItem; 
  isSelected: boolean;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const { w, h } = effectiveDims(item);
  
  // Pulse selected items gently
  useFrame((state) => {
    if (meshRef.current && isSelected) {
      const scale = 1 + Math.sin(state.clock.elapsedTime * 2) * 0.02;
      meshRef.current.scale.set(1, scale, 1);
    }
  });

  return (
    <mesh
      ref={meshRef}
      position={[
        item.x + w / 2,
        FURNITURE_HEIGHT / 2,
        item.y + h / 2,
      ]}
    >
      <boxGeometry args={[w, FURNITURE_HEIGHT, h]} />
      <meshStandardMaterial
        color={item.color}
        roughness={0.7}
        metalness={0.2}
        emissive={isSelected ? item.color : '#000000'}
        emissiveIntensity={isSelected ? 0.3 : 0}
      />
    </mesh>
  );
}

function DoorMesh({ door, room }: { door: DoorItem; room: RoomSpec }) {
  if (!doorOnFloor(door, room)) return null;
  
  const geom = doorGeom(door, room);
  const horizontal = door.wall === 'n' || door.wall === 's';
  
  // Position the door leaf standing open at 90°
  const leafWidth = door.width;
  const leafHeight = WALL_HEIGHT - 2; // slightly shorter than wall
  
  return (
    <mesh
      position={[
        geom.lx - (geom.lx - geom.hx) / 2,
        leafHeight / 2 + 1,
        geom.ly - (geom.ly - geom.hy) / 2,
      ]}
      rotation={[0, horizontal ? Math.PI / 2 : 0, 0]}
    >
      <boxGeometry args={[leafWidth, leafHeight, DOOR_THICKNESS]} />
      <meshStandardMaterial color="#6B4423" roughness={0.6} metalness={0.1} />
    </mesh>
  );
}

function Scene({ room, items, doors, selectedId, selectedDoorId }: RoomViewer3DProps) {
  return (
    <>
      {/* Lighting */}
      <ambientLight intensity={0.6} />
      <directionalLight position={[10, 20, 10]} intensity={0.8} castShadow />
      <directionalLight position={[-10, 20, -10]} intensity={0.4} />
      
      {/* Room */}
      <Floor room={room} />
      <WallsGeometry room={room} />
      
      {/* Furniture */}
      {items.map(item => (
        <FurnitureBox 
          key={item.id} 
          item={item} 
          isSelected={item.id === selectedId} 
        />
      ))}
      
      {/* Doors */}
      {doors.map(door => (
        <DoorMesh key={door.id} door={door} room={room} />
      ))}
      
      {/* Camera controls */}
      <OrbitControls
        enableDamping
        dampingFactor={0.05}
        minDistance={50}
        maxDistance={500}
        maxPolarAngle={Math.PI / 2.1}
      />
    </>
  );
}

export default function RoomViewer3D(props: RoomViewer3DProps) {
  const { room } = props;
  
  // Center the camera on the room
  const cameraPosition: [number, number, number] = useMemo(() => {
    const cx = room.w / 2;
    const cy = room.h / 2;
    const maxDim = Math.max(room.w, room.h);
    const distance = maxDim * 1.2;
    return [cx + distance * 0.7, distance * 0.8, cy + distance * 0.7];
  }, [room.w, room.h]);

  return (
    <div className="bp-paper h-full w-full" style={{ minHeight: 420 }}>
      <Canvas
        camera={{
          position: cameraPosition,
          fov: 50,
          near: 1,
          far: 2000,
        }}
        style={{ background: 'transparent' }}
      >
        <Scene {...props} />
      </Canvas>
    </div>
  );
}
