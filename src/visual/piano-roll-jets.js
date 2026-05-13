import * as THREE from 'three';

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
