import * as THREE from 'three';

import { getEffectColor } from './piano-roll-bars.js';

const BASE_ROTATION_SPEED = 0.12;
const PULSE_DECAY = 2.4;
const COLOR_LERP_SPEED = 3.2;

export function createGeometryPulseSystem({ scene, planeZ = -1.2 }) {
    const group = new THREE.Group();
    group.position.set(0, 0.6, planeZ);
    group.visible = false;
    scene.add(group);

    const coreGeometry = new THREE.IcosahedronGeometry(1.05, 1);
    const coreMaterial = new THREE.MeshBasicMaterial({
        color: 0x123047,
        transparent: true,
        opacity: 0.5,
        toneMapped: false
    });
    const core = new THREE.Mesh(coreGeometry, coreMaterial);
    group.add(core);

    const wireMaterial = new THREE.MeshBasicMaterial({
        color: 0x3cf0ff,
        wireframe: true,
        transparent: true,
        opacity: 0.85,
        toneMapped: false
    });
    const wire = new THREE.Mesh(new THREE.IcosahedronGeometry(1.08, 1), wireMaterial);
    group.add(wire);

    const outerMaterial = new THREE.MeshBasicMaterial({
        color: 0x7a5cff,
        wireframe: true,
        transparent: true,
        opacity: 0.22,
        toneMapped: false
    });
    const outer = new THREE.Mesh(new THREE.IcosahedronGeometry(1.9, 1), outerMaterial);
    group.add(outer);

    const targetColor = new THREE.Color(0x3cf0ff);
    let pulse = 0;
    let spinBoost = 0;
    let bassWeight = 0;

    function noteOn(midi, intensity = 1) {
        if (!group.visible) return;

        const pitchRatio = Math.max(0, Math.min(1, (midi - 21) / 87));
        targetColor.copy(getEffectColor(midi));
        pulse = Math.min(1.6, pulse + 0.45 * intensity + (1 - pitchRatio) * 0.25);
        spinBoost = Math.min(3, spinBoost + 0.6 + pitchRatio * 0.8);
        bassWeight = Math.max(bassWeight, (1 - pitchRatio) * intensity);
    }

    function update(dt, now) {
        if (!group.visible) return;

        pulse = Math.max(0, pulse - PULSE_DECAY * pulse * dt);
        spinBoost = Math.max(0, spinBoost - spinBoost * 1.6 * dt);
        bassWeight = Math.max(0, bassWeight - bassWeight * 1.2 * dt);

        const breath = 1 + Math.sin(now * 1.4) * 0.035;
        const scale = breath * (1 + pulse * 0.28 + bassWeight * 0.1);
        group.scale.setScalar(scale);

        const speed = BASE_ROTATION_SPEED + spinBoost * 0.5;
        wire.rotation.y += speed * dt;
        wire.rotation.x += speed * 0.6 * dt;
        core.rotation.y -= speed * 0.4 * dt;
        outer.rotation.y -= (BASE_ROTATION_SPEED * 0.5 + spinBoost * 0.2) * dt;
        outer.rotation.z += BASE_ROTATION_SPEED * 0.3 * dt;

        const lerpT = Math.min(1, COLOR_LERP_SPEED * dt);
        wireMaterial.color.lerp(targetColor, lerpT);
        outerMaterial.color.lerp(targetColor, lerpT * 0.5);
        coreMaterial.color.lerp(targetColor, lerpT * 0.3);

        wireMaterial.opacity = 0.72 + pulse * 0.28;
        outerMaterial.opacity = 0.16 + pulse * 0.2;
        coreMaterial.opacity = 0.32 + pulse * 0.25;
    }

    function clear() {
        pulse = 0;
        spinBoost = 0;
        bassWeight = 0;
        group.scale.setScalar(1);
    }

    function setVisible(visible) {
        group.visible = visible;
        if (!visible) clear();
    }

    return { noteOn, update, clear, setVisible };
}
