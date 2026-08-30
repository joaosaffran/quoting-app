"use client";

import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Box as BoxIcon } from "lucide-react";
import type { ParsedMeshData } from "@/components/stepmesh";

const ACCENT = "#FF5C1A";
const PANEL = "#15181C";
const VIEWPORT = "#1A1D21";
const HAIRLINE_DARK = "#2A2E33";

interface ComponentViewerProps {
  /** One or more already-parsed bodies to show together (usually just the one body for this component). */
  meshes?: ParsedMeshData[];
  label?: string;
}

export default function ComponentViewer({ meshes, label = "Component Preview" }: ComponentViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const modelGroupRef = useRef<THREE.Group | null>(null);
  const frameRef = useRef<number>(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !meshes || meshes.length === 0) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100000);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;

    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(5, 8, 6);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xffe4d1, 0.35);
    fill.position.set(-6, 2, -4);
    scene.add(fill);

    const grid = new THREE.GridHelper(400, 40, 0x2a2e33, 0x1e2126);
    const gridMat = grid.material as THREE.Material;
    gridMat.transparent = true;
    gridMat.opacity = 0.5;
    scene.add(grid);

    const resize = () => {
      const w = container.clientWidth || 1;
      const h = container.clientHeight || 1;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);
    resize();

    const animate = () => {
      frameRef.current = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    // ---------- build the scene straight from already-parsed data (no WASM call here) ----------
    const group = new THREE.Group();
    for (const mesh of meshes) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(mesh.position, 3));
      if (mesh.normal) {
        geometry.setAttribute("normal", new THREE.Float32BufferAttribute(mesh.normal, 3));
      }
      geometry.setIndex(new THREE.BufferAttribute(Uint32Array.from(mesh.index), 1));
      if (!mesh.normal) geometry.computeVertexNormals();

      const material = new THREE.MeshStandardMaterial({
        color: mesh.color ? new THREE.Color(mesh.color[0], mesh.color[1], mesh.color[2]) : 0xb9bdc4,
        metalness: 0.75,
        roughness: 0.35,
      });
      group.add(new THREE.Mesh(geometry, material));
    }

    const box = new THREE.Box3().setFromObject(group);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    group.position.sub(center);

    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const distance = maxDim * 1.9;
    camera.near = maxDim / 100;
    camera.far = maxDim * 100;
    camera.position.set(distance, distance * 0.8, distance);
    camera.updateProjectionMatrix();
    controls.target.set(0, 0, 0);
    controls.update();
    grid.position.y = -size.y / 2;

    scene.add(group);
    modelGroupRef.current = group;

    return () => {
      cancelAnimationFrame(frameRef.current);
      resizeObserver.disconnect();
      controls.dispose();
      group.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          (Array.isArray(obj.material) ? obj.material : [obj.material]).forEach((m) => m.dispose());
        }
      });
      renderer.dispose();
      if (renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement);
      }
      modelGroupRef.current = null;
    };
  }, [meshes]);

  const hasMeshes = !!meshes && meshes.length > 0;

  return (
    <div className="overflow-hidden rounded-xl border" style={{ borderColor: HAIRLINE_DARK }}>
      <div className="flex items-center gap-2 px-3 py-2" style={{ backgroundColor: PANEL }}>
        <BoxIcon className="h-3 w-3" style={{ color: ACCENT }} />
        <span className="font-mono text-[10px] uppercase tracking-widest text-slate-400">{label}</span>
      </div>

      <div className="relative h-56 w-full" style={{ backgroundColor: VIEWPORT }}>
        {hasMeshes ? (
          <>
            <div ref={containerRef} className="absolute inset-0 cursor-grab active:cursor-grabbing" />
            <p className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 font-mono text-[9px] uppercase tracking-widest text-slate-600">
              Drag · Scroll
            </p>
          </>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 px-4 text-center">
            <BoxIcon className="h-4 w-4 text-slate-600" />
            <p className="font-mono text-[10px] uppercase tracking-widest text-slate-600">Preview unavailable</p>
          </div>
        )}
      </div>
    </div>
  );
}