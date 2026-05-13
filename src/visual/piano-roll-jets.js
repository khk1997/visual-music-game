import * as THREE from 'three';

import {
    PIANO_ROLL_BAR_PLANE_Z,
    WHITE_COLOR,
    getEffectColor
} from './piano-roll-bars.js';

const PIANO_ROLL_JET_MAX_PARTICLES = 960;

export function createPianoRollJetBatch(parent, material, renderOrder) {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(PIANO_ROLL_JET_MAX_PARTICLES * 3);
    const vel = new Float32Array(PIANO_ROLL_JET_MAX_PARTICLES * 3);
    const drift = new Float32Array(PIANO_ROLL_JET_MAX_PARTICLES * 3);
    const sizes = new Float32Array(PIANO_ROLL_JET_MAX_PARTICLES);
    const alphas = new Float32Array(PIANO_ROLL_JET_MAX_PARTICLES);
    const colors = new Float32Array(PIANO_ROLL_JET_MAX_PARTICLES * 3);
    const ages = new Float32Array(PIANO_ROLL_JET_MAX_PARTICLES);
    const phases = new Float32Array(PIANO_ROLL_JET_MAX_PARTICLES);
    const swirl = new Float32Array(PIANO_ROLL_JET_MAX_PARTICLES);
    const freeIndices = [];

    for (let i = PIANO_ROLL_JET_MAX_PARTICLES - 1; i >= 0; i--) {
        freeIndices.push(i);
    }

    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
    geo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));

    const points = new THREE.Points(geo, material);
    points.renderOrder = renderOrder;
    points.visible = false;
    parent.add(points);

    return {
        points,
        pos,
        vel,
        drift,
        sizes,
        alphas,
        colors,
        ages,
        phases,
        swirl,
        freeIndices,
        posAttr: geo.attributes.position,
        sizeAttr: geo.attributes.aSize,
        alphaAttr: geo.attributes.aAlpha,
        colorAttr: geo.attributes.aColor
    };
}

export function acquirePianoRollJetIndices(batch, count) {
    if (batch.freeIndices.length < count) {
        return null;
    }

    const indices = new Array(count);
    for (let i = 0; i < count; i++) {
        indices[i] = batch.freeIndices.pop();
    }
    batch.points.visible = true;
    return indices;
}

export function initializePianoRollJetParticles(batch, indices, point, midi, isBlackKey, isHeldPulse) {
    const {
        pos,
        vel,
        drift,
        sizes,
        alphas,
        colors,
        ages,
        phases,
        swirl
    } = batch;

    for (let i = 0; i < indices.length; i++) {
        const particleIndex = indices[i];
        const offset = particleIndex * 3;
        const spread = (Math.random() - 0.5) * (isHeldPulse
            ? (isBlackKey ? 0.016 : 0.022)
            : (isBlackKey ? 0.014 : 0.019));
        const lift = isHeldPulse
            ? 0.004 + Math.random() * 0.006
            : 0.0045 + Math.random() * 0.0065;
        const color = getEffectColor(midi).lerp(
            WHITE_COLOR,
            isHeldPulse
                ? 0.12 + Math.random() * 0.08
                : 0.18 + Math.random() * 0.1
        );

        pos[offset] = point.x + spread * 0.3;
        pos[offset + 1] = point.y - 0.008 + Math.random() * 0.012;
        pos[offset + 2] = PIANO_ROLL_BAR_PLANE_Z + 0.008 + (Math.random() - 0.5) * 0.006;

        vel[offset] = spread * 0.16;
        vel[offset + 1] = lift;
        vel[offset + 2] = 0;

        drift[offset] = (Math.random() - 0.5) * 0.0014;
        drift[offset + 1] = 0.00055 + Math.random() * 0.0008;
        drift[offset + 2] = (Math.random() - 0.5) * 0.00035;

        sizes[particleIndex] = (isHeldPulse ? 0.9 : 0.72) * ((isBlackKey ? 14 : 13) + Math.random() * 6);
        alphas[particleIndex] = isHeldPulse
            ? 0.054 + Math.random() * 0.036
            : 0.05 + Math.random() * 0.045;
        colors[offset] = color.r;
        colors[offset + 1] = color.g;
        colors[offset + 2] = color.b;
        ages[particleIndex] = Math.random() * 0.18;
        phases[particleIndex] = Math.random() * Math.PI * 2;
        swirl[particleIndex] = 0.00045 + Math.random() * 0.00065;
    }

    batch.points.visible = true;
    batch.posAttr.needsUpdate = true;
    batch.sizeAttr.needsUpdate = true;
    batch.alphaAttr.needsUpdate = true;
    batch.colorAttr.needsUpdate = true;
}

export function updatePianoRollJetEffect(effect) {
    const { batch, indices } = effect;
    let alive = 0;

    for (let i = 0; i < indices.length; i++) {
        const particleIndex = indices[i];
        if (batch.alphas[particleIndex] > 0.006) {
            const offset = particleIndex * 3;
            batch.ages[particleIndex] += 0.06;

            const swirlX = Math.sin(batch.ages[particleIndex] * 3.2 + batch.phases[particleIndex]) * batch.swirl[particleIndex];
            const swirlZ = Math.cos(batch.ages[particleIndex] * 2.4 + batch.phases[particleIndex] * 0.7) * batch.swirl[particleIndex] * 0.35;
            const pulse = effect.isHeldPulse
                ? 0.992 + Math.sin(batch.ages[particleIndex] * 1.15 + batch.phases[particleIndex]) * 0.012
                : 1;

            batch.vel[offset] += batch.drift[offset] + swirlX;
            batch.vel[offset + 1] += batch.drift[offset + 1];
            batch.vel[offset + 2] += batch.drift[offset + 2] + swirlZ;

            batch.pos[offset] += batch.vel[offset];
            batch.pos[offset + 1] += batch.vel[offset + 1];
            batch.pos[offset + 2] += batch.vel[offset + 2];

            batch.vel[offset] *= 0.84;
            batch.vel[offset + 1] *= 0.94;
            batch.vel[offset + 2] *= 0.84;
            batch.alphas[particleIndex] *= (effect.isHeldPulse ? 0.968 : 0.958) * pulse;
            alive++;
        }
    }

    batch.posAttr.needsUpdate = true;
    batch.alphaAttr.needsUpdate = true;

    return alive;
}

export function releasePianoRollJetEffect(effect) {
    const { batch, indices } = effect;
    for (let i = 0; i < indices.length; i++) {
        const index = indices[i];
        batch.alphas[index] = 0;
        batch.sizes[index] = 0;
        batch.pos[index * 3] = 0;
        batch.pos[index * 3 + 1] = 0;
        batch.pos[index * 3 + 2] = 0;
        batch.freeIndices.push(index);
    }

    batch.alphaAttr.needsUpdate = true;
    batch.sizeAttr.needsUpdate = true;
    batch.posAttr.needsUpdate = true;
    if (batch.freeIndices.length === PIANO_ROLL_JET_MAX_PARTICLES) {
        batch.points.visible = false;
    }
}
