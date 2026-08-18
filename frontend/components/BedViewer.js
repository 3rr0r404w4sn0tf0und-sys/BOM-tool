"use client";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

/**
 * Fake 3D print bed: shows the part mesh sitting on a grid sized to the
 * selected printer's bed, lets the user drag directly on the part to
 * rotate it, and reports the rotated bounding box back up (used for
 * bed-fit checking and footprint-dependent settings like brim/raft).
 *
 * Camera orbit (drag on empty space) is handled by OrbitControls.
 * Dragging on the part itself instead rotates the part in place.
 */
export default function BedViewer({ meshUrl, bedDims, onRotatedDimsChange }) {
  const containerRef = useRef(null);
  const stateRef = useRef({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [rotation, setRotation] = useState({ x: 0, y: 0, z: 0 });

  // Set up scene once
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const width = container.clientWidth;
    const height = 360;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x14161c);

    const camera = new THREE.PerspectiveCamera(45, width / height, 1, 5000);
    camera.position.set(220, 220, 220);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0, 0);
    controls.enableDamping = true;

    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(150, 300, 150);
    scene.add(dir);

    const partGroup = new THREE.Group();
    scene.add(partGroup);

    let raf;
    const animate = () => {
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(animate);
    };
    animate();

    // Drag-to-rotate the part: pointerdown on the mesh disables camera
    // orbit for that drag and instead spins the part group.
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let dragging = false;
    let lastX = 0, lastY = 0;

    function onPointerDown(e) {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObject(partGroup, true);
      if (hits.length > 0) {
        dragging = true;
        controls.enabled = false;
        lastX = e.clientX;
        lastY = e.clientY;
      }
    }
    function onPointerMove(e) {
      if (!dragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      partGroup.rotation.y += dx * 0.01;
      partGroup.rotation.x += dy * 0.01;
      reportRotation();
    }
    function onPointerUp() {
      dragging = false;
      controls.enabled = true;
    }

    function reportRotation() {
      const r = partGroup.rotation;
      setRotation({
        x: THREE.MathUtils.radToDeg(r.x) % 360,
        y: THREE.MathUtils.radToDeg(r.y) % 360,
        z: THREE.MathUtils.radToDeg(r.z) % 360,
      });
      const box = new THREE.Box3().setFromObject(partGroup);
      const size = new THREE.Vector3();
      box.getSize(size);
      onRotatedDimsChange?.({ x: size.x, y: size.y, z: size.z });
    }

    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);

    stateRef.current = { scene, camera, renderer, controls, partGroup, reportRotation };

    return () => {
      cancelAnimationFrame(raf);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      controls.dispose();
      renderer.dispose();
      container.removeChild(renderer.domElement);
    };
  }, []);

  // Rebuild the bed grid when printer bed dims change
  useEffect(() => {
    const { scene } = stateRef.current;
    if (!scene || !bedDims) return;

    const existing = scene.getObjectByName("bed");
    if (existing) scene.remove(existing);

    const bedGroup = new THREE.Group();
    bedGroup.name = "bed";

    const grid = new THREE.GridHelper(Math.max(bedDims.x, bedDims.y), 20, 0x4f8cff, 0x2a2d34);
    bedGroup.add(grid);

    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(bedDims.x, bedDims.y),
      new THREE.MeshBasicMaterial({ color: 0x1c1f28, transparent: true, opacity: 0.6, side: THREE.DoubleSide })
    );
    plate.rotation.x = -Math.PI / 2;
    plate.position.y = -0.1;
    bedGroup.add(plate);

    scene.add(bedGroup);
  }, [bedDims]);

  // Load mesh when meshUrl changes
  useEffect(() => {
    const { scene, partGroup, camera, controls, reportRotation } = stateRef.current;
    if (!scene || !partGroup || !meshUrl) return;

    setLoading(true);
    setError(null);

    fetch(meshUrl)
      .then((r) => r.json())
      .then(({ positions, indices }) => {
        // Clear previous part
        while (partGroup.children.length) partGroup.remove(partGroup.children[0]);
        partGroup.rotation.set(0, 0, 0);

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();

        // Center part on bed and sit it on the plate (bottom at y=0).
        // CAD Z becomes viewer Y (up); rotate coordinate frame accordingly.
        geometry.rotateX(-Math.PI / 2);
        geometry.computeBoundingBox();
        const bb = geometry.boundingBox;
        const center = new THREE.Vector3();
        bb.getCenter(center);
        geometry.translate(-center.x, -bb.min.y, -center.z);

        const material = new THREE.MeshStandardMaterial({ color: 0x7c8cff, roughness: 0.55 });
        const mesh = new THREE.Mesh(geometry, material);
        partGroup.add(mesh);

        // Frame camera on the part
        geometry.computeBoundingSphere();
        const radius = geometry.boundingSphere.radius || 50;
        camera.position.set(radius * 2.2, radius * 2.2, radius * 2.2);
        controls.target.set(0, radius * 0.3, 0);
        controls.update();

        reportRotation();
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  }, [meshUrl]);

  function resetRotation() {
    const { partGroup, reportRotation } = stateRef.current;
    if (!partGroup) return;
    partGroup.rotation.set(0, 0, 0);
    reportRotation();
  }

  function nudge(axis, deg) {
    const { partGroup, reportRotation } = stateRef.current;
    if (!partGroup) return;
    partGroup.rotation[axis] += THREE.MathUtils.degToRad(deg);
    reportRotation();
  }

  return (
    <div>
      <div ref={containerRef} style={{ width: "100%", height: 360, borderRadius: 8, overflow: "hidden", position: "relative" }}>
        {loading && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#9aa0ab", fontSize: 13 }}>
            Loading part…
          </div>
        )}
      </div>
      {error && <div style={{ color: "#e08080", fontSize: 12, marginTop: 4 }}>{error}</div>}

      <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: 11, color: "#9aa0ab" }}>Drag the part to rotate. Drag empty space to orbit camera.</span>
        <button onClick={resetRotation} style={{ fontSize: 11, padding: "2px 8px" }}>Reset</button>
        {["x", "y", "z"].map((axis) => (
          <span key={axis} style={{ fontSize: 11, color: "#9aa0ab" }}>
            {axis.toUpperCase()}: {rotation[axis].toFixed(0)}°
            <button onClick={() => nudge(axis, 90)} style={{ fontSize: 10, marginLeft: 4, padding: "1px 5px" }}>+90°</button>
          </span>
        ))}
      </div>
    </div>
  );
}
