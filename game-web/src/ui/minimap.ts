import { DOM } from './menu.ts';

let minimapCtx: CanvasRenderingContext2D | null = null;

export function initMinimap() {
    if (DOM.minimapCanvas) {
        minimapCtx = DOM.minimapCanvas.getContext('2d');
    }
}

export function drawMinimap(
    playerX: number, 
    playerZ: number, 
    yaw: number, 
    getTerrainHeightAt: (x: number, z: number) => number
) {
    if (!minimapCtx) return;
    const width = DOM.minimapCanvas.width;
    const height = DOM.minimapCanvas.height;
    const imgData = minimapCtx.createImageData(width, height);
    
    // Mappa "globale" estesa (1 pixel = 4 metri, tot 2400x2400 metri)
    const scale = 4;
    
    // Campioniamo a step di 2 per non bloccare troppo a lungo il thread
    for (let py = 0; py < height; py += 2) {
        for (let px = 0; px < width; px += 2) {
            const worldX = playerX + (px - width/2) * scale;
            const worldZ = playerZ + (py - height/2) * scale;
            
            const h = getTerrainHeightAt(worldX, worldZ);
            
            let r, g, b;
            if (h < -5) {
                r = 15; g = 23; b = 42; 
            } else if (h < 5) {
                r = 30; g = 41; b = 59; 
            } else if (h < 25) {
                r = 51; g = 65; b = 85; 
            } else {
                r = 71; g = 85; b = 105;
            }
            
            for(let dy=0; dy<2; dy++) {
                for(let dx=0; dx<2; dx++) {
                    if (py+dy >= height || px+dx >= width) continue;
                    const idx = ((py+dy) * width + (px+dx)) * 4;
                    imgData.data[idx] = r;
                    imgData.data[idx+1] = g;
                    imgData.data[idx+2] = b;
                    imgData.data[idx+3] = 255;
                }
            }
        }
    }
    minimapCtx.putImageData(imgData, 0, 0);
    
    // Aggiorniamo la rotazione del giocatore (YAW in Three.js è invertito/sfalsato rispetto CSS)
    if (DOM.playerDot) {
        DOM.playerDot.style.transform = `rotate(${-yaw}rad)`;
    }
}
