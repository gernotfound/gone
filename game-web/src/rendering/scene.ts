import * as THREE from 'three';
import { DOM } from '../ui/menu.ts';
import { createNaturalSunRayGeometry, createNaturalSunRayMaterial } from './naturalSunRayResources.ts';
import { WORLD_FOG_FAR, WORLD_FOG_NEAR } from '../world/worldConfig.ts';

export class SceneManager {
    public scene!: THREE.Scene;
    public camera!: THREE.PerspectiveCamera;
    public renderer!: THREE.WebGLRenderer;
    public terrainMaterial!: THREE.MeshStandardMaterial;
    public rockGeo!: THREE.DodecahedronGeometry;
    public rockMat!: THREE.MeshStandardMaterial;
    public rayGeo!: THREE.CylinderGeometry;
    public rayMat!: THREE.MeshBasicMaterial;

    private isInitialized = false;
    private renderWidth = 0;
    private renderHeight = 0;

    public init() {
        if (this.isInitialized) return;
        this.scene = new THREE.Scene();

        const fogColor = 0x1e293b;
        this.scene.background = new THREE.Color(fogColor);
        this.scene.fog = new THREE.Fog(fogColor, WORLD_FOG_NEAR, WORLD_FOG_FAR);

        this.rayGeo = createNaturalSunRayGeometry();
        this.rayMat = createNaturalSunRayMaterial();

        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / Math.max(1, window.innerHeight), 0.01, 3000);

        this.renderer = new THREE.WebGLRenderer({
            canvas: DOM.gameCanvas,
            antialias: false,
            alpha: false,
            powerPreference: 'high-performance'
        });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
        this.renderer.shadowMap.enabled = false;
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;

        const hemiLight = new THREE.HemisphereLight(0x0f172a, 0x020617, 1.5);
        this.scene.add(hemiLight);

        const sunLight = new THREE.DirectionalLight(0x38bdf8, 1.2);
        sunLight.position.set(200, 300, -100);
        sunLight.castShadow = false;
        this.scene.add(sunLight);

        this.terrainMaterial = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            roughness: 0.9,
            metalness: 0.1,
            vertexColors: true
        });

        this.rockGeo = new THREE.DodecahedronGeometry(1, 0);
        this.rockMat = new THREE.MeshStandardMaterial({
            color: 0x1e293b,
            roughness: 0.9,
            metalness: 0.1
        });

        this.isInitialized = true;
        this.resize(window.innerWidth, window.innerHeight, true);
    }

    public resize(width: number, height: number, force = false) {
        if (!this.isInitialized) return;
        const safeWidth = Math.max(1, Math.round(Number.isFinite(width) ? width : 1));
        const safeHeight = Math.max(1, Math.round(Number.isFinite(height) ? height : 1));
        if (!force && safeWidth === this.renderWidth && safeHeight === this.renderHeight) return;

        this.renderWidth = safeWidth;
        this.renderHeight = safeHeight;
        this.camera.aspect = safeWidth / safeHeight;
        this.camera.updateProjectionMatrix();
        // CSS already owns canvas sizing; updating only the drawing buffer avoids
        // repeated style/layout writes during mobile browser chrome/orientation churn.
        this.renderer.setSize(safeWidth, safeHeight, false);
    }

    public dispose() {
        if (!this.isInitialized) return;

        this.terrainMaterial.dispose();
        this.rockGeo.dispose();
        this.rockMat.dispose();
        this.rayGeo.dispose();
        this.rayMat.dispose();

        this.renderer.dispose();
        this.renderWidth = 0;
        this.renderHeight = 0;
        this.isInitialized = false;
    }

    public disposeHierarchy(object: THREE.Object3D) {
        object.traverse((child: any) => {
            if (child.userData?.sharedAsset) return;
            if (child.isMesh || child.isInstancedMesh) {
                if (child.geometry && !child.geometry.userData?.sharedAsset) {
                    child.geometry.dispose();
                }
                if (child.material) {
                    const disposeMat = (mat: THREE.Material) => {
                        if (!mat.userData?.sharedAsset) mat.dispose();
                    };
                    if (Array.isArray(child.material)) child.material.forEach(disposeMat);
                    else disposeMat(child.material);
                }
            }
        });
    }
}

export const sceneManager = new SceneManager();
