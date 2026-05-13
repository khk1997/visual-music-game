import * as THREE from 'three';

export const WHITE_COLOR = new THREE.Color(0xffffff);
export const MIST_TINT_COLOR = new THREE.Color(0x6f8cff);
export const PIANO_ROLL_BAR_BASE_HEIGHT = 0.03;
export const PIANO_ROLL_BAR_PLANE_Z = -1.15;

const EFFECT_COLOR_PALETTE = [
    new THREE.Color(0x00f5d4),
    new THREE.Color(0x3cf0ff),
    new THREE.Color(0x7a5cff),
    new THREE.Color(0xff4fa3),
    new THREE.Color(0xefffff)
];
const PIANO_ROLL_BAR_MAX_INSTANCES = 144;
const PIANO_ROLL_BAR_BASE_WIDTH = 0.18;
const pianoRollBarInstanceScratch = new THREE.Object3D();

export function getEffectColor(midi) {
    return EFFECT_COLOR_PALETTE[Math.abs(midi) % EFFECT_COLOR_PALETTE.length].clone();
}

export function createPianoRollBarInstancingSystem(parent, pianoRollBarTexture) {
    const pianoRollBarGeometries = {
        shadow: new THREE.PlaneGeometry(PIANO_ROLL_BAR_BASE_WIDTH * 1.68, PIANO_ROLL_BAR_BASE_HEIGHT * 1.14),
        aura: new THREE.PlaneGeometry(PIANO_ROLL_BAR_BASE_WIDTH * 1.78, PIANO_ROLL_BAR_BASE_HEIGHT),
        glow: new THREE.PlaneGeometry(PIANO_ROLL_BAR_BASE_WIDTH * 1.28, PIANO_ROLL_BAR_BASE_HEIGHT),
        core: new THREE.PlaneGeometry(PIANO_ROLL_BAR_BASE_WIDTH * 0.82, PIANO_ROLL_BAR_BASE_HEIGHT)
    };
    const pianoRollBarShadowMaterialProps = {
        color: 0x000000,
        transparent: true,
        opacity: 0.18,
        blending: THREE.NormalBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false
    };
    const pianoRollBarAuraMaterialProps = {
        map: pianoRollBarTexture,
        transparent: true,
        opacity: 0.24,
        blending: THREE.NormalBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false
    };
    const pianoRollBarGlowMaterialProps = {
        map: pianoRollBarTexture,
        transparent: true,
        opacity: 0.46,
        blending: THREE.NormalBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false
    };
    const pianoRollBarCoreMaterialProps = {
        transparent: true,
        opacity: 0.92,
        blending: THREE.NormalBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false
    };

    function createPianoRollBarSet({ isBlackKey }) {
        const freeSlots = [];
        const usedSlots = new Uint8Array(PIANO_ROLL_BAR_MAX_INSTANCES);
        for (let i = PIANO_ROLL_BAR_MAX_INSTANCES - 1; i >= 0; i--) {
            freeSlots.push(i);
        }

        const renderBaseOrder = isBlackKey ? 6 : 3;
        const shadowLayer = isBlackKey
            ? createPianoRollBarInstancedLayer({
                baseGeometry: pianoRollBarGeometries.shadow,
                material: createPianoRollBarAlphaMaterial(pianoRollBarShadowMaterialProps),
                renderOrder: renderBaseOrder
            })
            : null;
        const auraLayer = createPianoRollBarInstancedLayer({
            baseGeometry: pianoRollBarGeometries.aura,
            material: createPianoRollBarAlphaMaterial({
                color: 0xffffff,
                ...pianoRollBarAuraMaterialProps
            }),
            renderOrder: renderBaseOrder + 1
        });
        const glowLayer = createPianoRollBarInstancedLayer({
            baseGeometry: pianoRollBarGeometries.glow,
            material: createPianoRollBarAlphaMaterial({
                color: 0xffffff,
                ...pianoRollBarGlowMaterialProps
            }),
            renderOrder: renderBaseOrder + 2
        });
        const coreLayer = createPianoRollBarInstancedLayer({
            baseGeometry: pianoRollBarGeometries.core,
            material: createPianoRollBarAlphaMaterial({
                color: 0xffffff,
                ...pianoRollBarCoreMaterialProps
            }),
            renderOrder: renderBaseOrder + 3
        });

        if (shadowLayer) parent.add(shadowLayer.mesh);
        parent.add(auraLayer.mesh);
        parent.add(glowLayer.mesh);
        parent.add(coreLayer.mesh);

        return {
            isBlackKey,
            freeSlots,
            usedSlots,
            shadowLayer,
            auraLayer,
            glowLayer,
            coreLayer
        };
    }

    return {
        white: createPianoRollBarSet({ isBlackKey: false }),
        black: createPianoRollBarSet({ isBlackKey: true })
    };
}

export function syncPianoRollBarSetCount(barSet) {
    if (!barSet) return;

    let highestUsedSlot = -1;
    for (let i = barSet.usedSlots.length - 1; i >= 0; i--) {
        if (barSet.usedSlots[i]) {
            highestUsedSlot = i;
            break;
        }
    }

    const nextCount = highestUsedSlot + 1;
    if (barSet.shadowLayer) {
        barSet.shadowLayer.mesh.count = nextCount;
    }
    barSet.auraLayer.mesh.count = nextCount;
    barSet.glowLayer.mesh.count = nextCount;
    barSet.coreLayer.mesh.count = nextCount;
}

function updatePianoRollBarLayerInstance(layer, slot, x, y, z, scaleY, color, alpha) {
    if (!layer) return;
    pianoRollBarInstanceScratch.position.set(x, y, z);
    pianoRollBarInstanceScratch.scale.set(1, scaleY, 1);
    pianoRollBarInstanceScratch.updateMatrix();
    layer.mesh.setMatrixAt(slot, pianoRollBarInstanceScratch.matrix);
    layer.mesh.setColorAt(slot, color);
    layer.alphaAttr.setX(slot, alpha);
    layer.mesh.instanceMatrix.needsUpdate = true;
    layer.mesh.instanceColor.needsUpdate = true;
    layer.alphaAttr.needsUpdate = true;
}

export function clearPianoRollBarInstance(barSet, bar) {
    if (!barSet || !bar) return;

    updatePianoRollBarLayerInstance(barSet.auraLayer, bar.slot, 0, 0, PIANO_ROLL_BAR_PLANE_Z, 0.0001, WHITE_COLOR, 0);
    updatePianoRollBarLayerInstance(barSet.glowLayer, bar.slot, 0, 0, PIANO_ROLL_BAR_PLANE_Z, 0.0001, WHITE_COLOR, 0);
    updatePianoRollBarLayerInstance(barSet.coreLayer, bar.slot, 0, 0, PIANO_ROLL_BAR_PLANE_Z, 0.0001, WHITE_COLOR, 0);
    if (barSet.shadowLayer) {
        updatePianoRollBarLayerInstance(barSet.shadowLayer, bar.slot, 0, 0, PIANO_ROLL_BAR_PLANE_Z - 0.001, 0.0001, WHITE_COLOR, 0);
    }
}

export function updatePianoRollBarInstance(barSet, bar, baseOpacity) {
    if (!barSet) return;

    const shimmer = 0.94 + Math.sin(performance.now() * 0.01 + bar.midi * 0.35) * 0.08;
    const scaleY = bar.currentHeight / bar.baseHeight;
    const centerY = bar.positionY;

    if (barSet.shadowLayer) {
        updatePianoRollBarLayerInstance(
            barSet.shadowLayer,
            bar.slot,
            bar.x,
            centerY - bar.currentHeight * 0.03,
            PIANO_ROLL_BAR_PLANE_Z - 0.001,
            scaleY,
            WHITE_COLOR,
            baseOpacity * 0.18
        );
    }

    updatePianoRollBarLayerInstance(
        barSet.auraLayer,
        bar.slot,
        bar.x,
        centerY,
        PIANO_ROLL_BAR_PLANE_Z,
        scaleY,
        bar.color,
        baseOpacity * 0.26 * shimmer
    );
    updatePianoRollBarLayerInstance(
        barSet.glowLayer,
        bar.slot,
        bar.x,
        centerY,
        PIANO_ROLL_BAR_PLANE_Z,
        scaleY,
        bar.color,
        baseOpacity * 0.78 * shimmer
    );
    updatePianoRollBarLayerInstance(
        barSet.coreLayer,
        bar.slot,
        bar.x,
        centerY,
        PIANO_ROLL_BAR_PLANE_Z,
        scaleY,
        bar.coreColor,
        Math.min(1, baseOpacity * 1.08)
    );
}

function createPianoRollBarAlphaMaterial(config) {
    const material = new THREE.MeshBasicMaterial(config);
    material.onBeforeCompile = (shader) => {
        shader.vertexShader = shader.vertexShader.replace(
            '#include <common>',
            '#include <common>\nattribute float instanceAlpha;\nvarying float vInstanceAlpha;'
        ).replace(
            '#include <begin_vertex>',
            '#include <begin_vertex>\nvInstanceAlpha = instanceAlpha;'
        );
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <common>',
            '#include <common>\nvarying float vInstanceAlpha;'
        ).replace(
            'vec4 diffuseColor = vec4( diffuse, opacity );',
            'vec4 diffuseColor = vec4( diffuse, opacity * vInstanceAlpha );'
        );
    };
    return material;
}

function createPianoRollBarInstancedLayer({
    baseGeometry,
    material,
    renderOrder
}) {
    const geometry = baseGeometry.clone();
    const alphaAttr = new THREE.InstancedBufferAttribute(new Float32Array(PIANO_ROLL_BAR_MAX_INSTANCES), 1);
    geometry.setAttribute('instanceAlpha', alphaAttr);

    const mesh = new THREE.InstancedMesh(geometry, material, PIANO_ROLL_BAR_MAX_INSTANCES);
    mesh.renderOrder = renderOrder;
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    for (let i = 0; i < PIANO_ROLL_BAR_MAX_INSTANCES; i++) {
        pianoRollBarInstanceScratch.position.set(0, 0, 0);
        pianoRollBarInstanceScratch.scale.set(0.0001, 0.0001, 0.0001);
        pianoRollBarInstanceScratch.updateMatrix();
        mesh.setMatrixAt(i, pianoRollBarInstanceScratch.matrix);
        mesh.setColorAt(i, WHITE_COLOR);
        alphaAttr.setX(i, 0);
    }

    mesh.instanceMatrix.needsUpdate = true;
    alphaAttr.needsUpdate = true;
    return { mesh, alphaAttr };
}
