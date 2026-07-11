import * as THREE from 'three';

import { getEffectColor, WHITE_COLOR } from './piano-roll-bars.js';

const MAX_PARTICLES = 1400;
const GRAVITY = -1.35;
const DRAG = 0.985;

export function createFireworksSystem({ scene, texture, planeZ = -1.5 }) {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(MAX_PARTICLES * 3);
    const vel = new Float32Array(MAX_PARTICLES * 3);
    const colors = new Float32Array(MAX_PARTICLES * 3);
    const life = new Float32Array(MAX_PARTICLES);
    const maxLife = new Float32Array(MAX_PARTICLES);

    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setDrawRange(0, 0);

    const material = new THREE.PointsMaterial({
        size: 0.13,
        map: texture,
        vertexColors: true,
        transparent: true,
        opacity: 1,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false
    });

    const points = new THREE.Points(geo, material);
    points.renderOrder = 2;
    points.visible = false;
    points.frustumCulled = false;
    scene.add(points);

    let cursor = 0;
    let aliveCount = 0;
    const colorScratch = new THREE.Color();

    function spawnBurst(x, y, midi, intensity = 1) {
        if (!points.visible) return;

        const count = Math.round(26 + intensity * 22);
        const baseColor = getEffectColor(midi);
        const speed = 1.8 + intensity * 1.4 + ((midi - 21) / 87) * 0.6;

        for (let i = 0; i < count; i++) {
            const idx = cursor;
            cursor = (cursor + 1) % MAX_PARTICLES;

            const angle = Math.random() * Math.PI * 2;
            const radial = speed * (0.35 + Math.random() * 0.65);

            pos[idx * 3] = x;
            pos[idx * 3 + 1] = y;
            pos[idx * 3 + 2] = planeZ + (Math.random() - 0.5) * 0.2;

            vel[idx * 3] = Math.cos(angle) * radial;
            vel[idx * 3 + 1] = Math.sin(angle) * radial + 0.25;
            vel[idx * 3 + 2] = 0;

            colorScratch.copy(baseColor).lerp(WHITE_COLOR, Math.random() * 0.45);
            colors[idx * 3] = colorScratch.r;
            colors[idx * 3 + 1] = colorScratch.g;
            colors[idx * 3 + 2] = colorScratch.b;

            maxLife[idx] = 0.9 + Math.random() * 0.9;
            life[idx] = maxLife[idx];
        }

        aliveCount = Math.min(MAX_PARTICLES, aliveCount + count);
        geo.setDrawRange(0, MAX_PARTICLES);
    }

    function update(dt) {
        if (!points.visible || aliveCount === 0) return;

        let alive = 0;
        for (let i = 0; i < MAX_PARTICLES; i++) {
            if (life[i] <= 0) continue;

            life[i] -= dt;
            if (life[i] <= 0) {
                colors[i * 3] = 0;
                colors[i * 3 + 1] = 0;
                colors[i * 3 + 2] = 0;
                continue;
            }

            vel[i * 3 + 1] += GRAVITY * dt;
            vel[i * 3] *= DRAG;
            vel[i * 3 + 1] *= DRAG;

            pos[i * 3] += vel[i * 3] * dt;
            pos[i * 3 + 1] += vel[i * 3 + 1] * dt;

            const fade = Math.min(1, life[i] / (maxLife[i] * 0.55));
            const flicker = life[i] < maxLife[i] * 0.35 && Math.random() < 0.12 ? 0.55 : 1;
            const dim = (0.999 - (1 - fade) * 0.05) * flicker;
            colors[i * 3] *= dim;
            colors[i * 3 + 1] *= dim;
            colors[i * 3 + 2] *= dim;

            alive++;
        }

        aliveCount = alive;
        if (alive === 0) {
            geo.setDrawRange(0, 0);
        }

        geo.attributes.position.needsUpdate = true;
        geo.attributes.color.needsUpdate = true;
    }

    function clear() {
        life.fill(0);
        colors.fill(0);
        aliveCount = 0;
        geo.setDrawRange(0, 0);
        geo.attributes.color.needsUpdate = true;
    }

    function setVisible(visible) {
        points.visible = visible;
        if (!visible) clear();
    }

    return { spawnBurst, update, clear, setVisible };
}
